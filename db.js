/**
 * db.js — Supabase (PostgreSQL + Storage) ベースのデータストア
 */
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── ユーザー ──────────────────────────────────────────────────
async function findUserByName(username) {
  const { data } = await supabase
    .from('users').select('*').eq('username', username).maybeSingle();
  return data || null;
}

async function findUserById(id) {
  const { data } = await supabase
    .from('users').select('*').eq('id', id).maybeSingle();
  return data || null;
}

async function createUser(username, passwordHash) {
  const existing = await findUserByName(username);
  if (existing) {
    const err = new Error('UNIQUE constraint failed'); err.code = 'UNIQUE'; throw err;
  }
  const { data, error } = await supabase.from('users').insert({
    username,
    password_hash: passwordHash,
    avatar: '力',
    avatar_color: '#c0392b',
    catchphrase: '',
    avatar_image: '',
  }).select().single();
  if (error) throw error;
  return data;
}

async function updateUserProfile(id, { avatar, avatarColor, catchphrase, avatarImage }) {
  const updates = {};
  if (avatar      !== undefined) updates.avatar       = avatar;
  if (avatarColor !== undefined) updates.avatar_color = avatarColor;
  if (catchphrase !== undefined) updates.catchphrase  = catchphrase;
  if (avatarImage !== undefined) updates.avatar_image = avatarImage;
  const { data, error } = await supabase
    .from('users').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data || null;
}

// ── ランキング ────────────────────────────────────────────────
async function getRankings(limit = 100) {
  const { data } = await supabase
    .from('rankings').select('*')
    .order('decibel', { ascending: false })
    .limit(limit);
  return data || [];
}

async function addRanking(entry) {
  const { data, error } = await supabase
    .from('rankings').insert(entry).select().single();
  if (error) throw error;
  return data;
}

async function findRankingById(id) {
  const { data } = await supabase
    .from('rankings').select('*').eq('id', id).maybeSingle();
  return data || null;
}

async function deleteRanking(id) {
  const { error } = await supabase.from('rankings').delete().eq('id', id);
  return !error;
}

// ── ユーザー個人履歴 ──────────────────────────────────────────
async function addUserRecord(entry) {
  const { data, error } = await supabase
    .from('user_history').insert(entry).select().single();
  if (error) throw error;
  return data;
}

async function getUserRecords(userId, limit = 50) {
  const { data } = await supabase
    .from('user_history').select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ── シーズン管理 ──────────────────────────────────────────────
async function getSeasonInfo() {
  const { data } = await supabase
    .from('season').select('*')
    .order('id', { ascending: false })
    .limit(1).maybeSingle();

  if (!data) {
    // 初回: シーズン1を作成
    const now = new Date();
    const info = {
      season_number: 1,
      started_at:    now.toISOString(),
      next_reset_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const { data: created } = await supabase.from('season').insert(info).select().single();
    return created ? _toSeasonShape(created) : null;
  }
  return _toSeasonShape(data);
}

async function archiveAndResetRankings() {
  const season = await getSeasonInfo();
  if (!season) return null;

  // ランキングを全削除（user_history に個人記録は残る）
  await supabase.from('rankings').delete().gte('id', 0);

  // 新シーズン開始
  const now = new Date();
  const newSeasonData = {
    season_number: season.seasonNumber + 1,
    started_at:    now.toISOString(),
    next_reset_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const { data } = await supabase.from('season').insert(newSeasonData).select().single();
  return data ? _toSeasonShape(data) : null;
}

// DB の snake_case → 従来の camelCase 形式に変換
function _toSeasonShape(row) {
  return {
    seasonNumber: row.season_number,
    startedAt:    row.started_at,
    nextResetAt:  row.next_reset_at,
  };
}

module.exports = {
  supabase,
  findUserByName, findUserById, createUser, updateUserProfile,
  getRankings, addRanking, findRankingById, deleteRanking,
  addUserRecord, getUserRecords,
  getSeasonInfo, archiveAndResetRankings,
};
