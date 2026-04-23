// supabase-client.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = 'https://rstqwylzeknshxnrubok.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdHF3eWx6ZWtuc2h4bnJ1Ym9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDM2MDgsImV4cCI6MjA5MjMxOTYwOH0.y_9SOU9TTsGxUG1PDvUacI73Bm0tzaqV5HQdjzCxFsU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ============================================================
// 인증 유틸
// ============================================================
export const auth = {
  async signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login.html?verified=1`,
      },
    });
    return { data, error };
  },

  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  async resetPassword(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login.html?reset=1`,
    });
    return { data, error };
  },

  async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  async getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  onChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session?.user || null);
    });
  },
};

// ============================================================
// 프로필 & 구독 유틸
// ============================================================
export const profile = {
  async get() {
    const user = await auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.warn('프로필 조회 실패:', error.message);
      return { id: user.id, email: user.email, is_premium: false };
    }
    return data;
  },

  async isPremium() {
    const p = await profile.get();
    if (!p) return false;
    if (p.premium_until) {
      return new Date(p.premium_until) > new Date();
    }
    return !!p.is_premium;
  },
};

// ============================================================
// 빈칸 동기화 유틸 — 로그인 사용자는 DB, 비로그인은 localStorage
// ============================================================
const BLANKS_STORAGE_KEY = 'jomun_blanks_v1';

export const blanks = {
  async getAll() {
    const user = await auth.getUser();
    if (!user) {
      try {
        const raw = localStorage.getItem(BLANKS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    }
    const { data, error } = await supabase
      .from('user_blanks')
      .select('article_id, blanks_json')
      .eq('user_id', user.id);
    if (error) {
      console.warn('DB 조회 실패, localStorage 폴백:', error.message);
      try {
        const raw = localStorage.getItem(BLANKS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    }
    const result = {};
    for (const row of data || []) result[row.article_id] = row.blanks_json;
    return result;
  },

  async save(articleId, blanksArray) {
    const user = await auth.getUser();

    if (!user) {
      try {
        const raw = localStorage.getItem(BLANKS_STORAGE_KEY);
        const all = raw ? JSON.parse(raw) : {};
        if (blanksArray.length === 0) delete all[articleId];
        else all[articleId] = blanksArray;
        localStorage.setItem(BLANKS_STORAGE_KEY, JSON.stringify(all));
        return { success: true };
      } catch (e) { return { success: false, error: e }; }
    }

    if (blanksArray.length === 0) {
      const { error } = await supabase
        .from('user_blanks')
        .delete()
        .eq('user_id', user.id)
        .eq('article_id', articleId);
      return { success: !error, error };
    }

    const { error } = await supabase
      .from('user_blanks')
      .upsert({
        user_id: user.id,
        article_id: articleId,
        blanks_json: blanksArray,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,article_id' });
    return { success: !error, error };
  },

  async migrateLocalToCloud() {
    const user = await auth.getUser();
    if (!user) return { migrated: 0 };

    let local = {};
    try {
      const raw = localStorage.getItem(BLANKS_STORAGE_KEY);
      local = raw ? JSON.parse(raw) : {};
    } catch { return { migrated: 0 }; }

    const entries = Object.entries(local);
    if (entries.length === 0) return { migrated: 0 };

    const rows = entries.map(([articleId, blanksArray]) => ({
      user_id: user.id,
      article_id: articleId,
      blanks_json: blanksArray,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('user_blanks')
      .upsert(rows, { onConflict: 'user_id,article_id' });

    if (!error) {
      localStorage.removeItem(BLANKS_STORAGE_KEY);
    }
    return { migrated: rows.length, error };
  },
};

// ============================================================
// 네비게이션 바 자동 갱신 헬퍼
// ============================================================
export async function renderAuthNav(selector = '.nav-auth') {
  const container = document.querySelector(selector);
  if (!container) return;

  const user = await auth.getUser();
  if (user) {
    container.innerHTML = `
      <a href="account.html" style="color: var(--text-sub); text-decoration: none; font-size: 15px; font-weight: 500;">내 정보</a>
      <button class="nav-cta" style="background: transparent; border: none; font-family: inherit; cursor: pointer; color: var(--text-sub); font-size: 15px; font-weight: 500; padding: 0;" onclick="window._doLogout()">로그아웃</button>
    `;
    window._doLogout = async () => {
      await auth.signOut();
      window.location.reload();
    };
  } else {
    container.innerHTML = `<a href="login.html" class="nav-cta">로그인</a>`;
  }
}

auth.onChange(() => renderAuthNav());

// ============================================================
// 커스텀 카드 유틸
// ============================================================
export const customCards = {
  async getAll() {
    const user = await auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('custom_cards')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) { console.warn('커스텀 카드 조회 실패:', error.message); return []; }
    return data || [];
  },
  async create(title, body, category = '기타', cardType = 'fill-blank') {
    const user = await auth.getUser();
    if (!user) return { data: null, error: new Error('로그인이 필요합니다') };
    const { data, error } = await supabase
      .from('custom_cards')
      .insert({ user_id: user.id, title, body, category, card_type: cardType })
      .select()
      .single();
    return { data, error };
  },
  async update(id, fields) {
    const user = await auth.getUser();
    if (!user) return { error: new Error('로그인이 필요합니다') };
    const { error } = await supabase
      .from('custom_cards')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    return { error };
  },
  async remove(id) {
    const user = await auth.getUser();
    if (!user) return { error: new Error('로그인이 필요합니다') };
    const { error } = await supabase
      .from('custom_cards')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    return { error };
  },
};

// ============================================================
// 학습 통계
// ============================================================
export const myStats = {
  async get() {
    const user = await auth.getUser();
    if (!user) return null;
    const [{ data: blanksData }, { count: cardsCount }] = await Promise.all([
      supabase.from('user_blanks').select('article_id, blanks_json').eq('user_id', user.id),
      supabase.from('custom_cards').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);
    const rows = blanksData || [];
    const totalBlanks = rows.reduce((s, r) => s + (r.blanks_json || []).length, 0);
    return {
      email: user.email,
      createdAt: user.created_at,
      totalBlanks,
      byLaw: {
        patent:    rows.filter(r => r.article_id.startsWith('patent-')).length,
        trademark: rows.filter(r => r.article_id.startsWith('trademark-')).length,
        design:    rows.filter(r => r.article_id.startsWith('design-')).length,
        custom:    rows.filter(r => r.article_id.startsWith('custom-')).length,
      },
      customCardsCount: cardsCount || 0,
    };
  },
};
