/**
 * db.js — JSONファイルベースの簡易データストア
 * SQLiteネイティブビルド不要。Node.jsのfsモジュールだけで動作する。
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 内部ヘルパー ──────────────────────────────────────────────
function dbPath(name) { return path.join(DATA_DIR, `${name}.json`); }

function read(name) {
  const p = dbPath(name);
  if (!fs.existsSync(p)) return { nextId: 1, items: [] };
  try   { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { nextId: 1, items: [] }; }
}

function write(name, data) {
  fs.writeFileSync(dbPath(name), JSON.stringify(data, null, 2), 'utf8');
}

// ── ユーザー ──────────────────────────────────────────────────
function findUserByName(username) {
  return read('users').items.find(u => u.username === username) || null;
}

function findUserById(id) {
  return read('users').items.find(u => u.id === id) || null;
}

function createUser(username, passwordHash) {
  const db = read('users');
  if (db.items.find(u => u.username === username)) {
    const err = new Error('UNIQUE constraint failed'); err.code = 'UNIQUE'; throw err;
  }
  const user = {
    id: db.nextId++, username, password_hash: passwordHash,
    avatar: '力', avatar_color: '#c0392b', catchphrase: '',
    created_at: new Date().toISOString()
  };
  db.items.push(user);
  write('users', db);
  return user;
}

function updateUserProfile(id, { avatar, avatarColor, catchphrase, avatarImage }) {
  const db  = read('users');
  const idx = db.items.findIndex(u => u.id === id);
  if (idx === -1) return null;
  if (avatar       !== undefined) db.items[idx].avatar        = avatar;
  if (avatarColor  !== undefined) db.items[idx].avatar_color  = avatarColor;
  if (catchphrase  !== undefined) db.items[idx].catchphrase   = catchphrase;
  if (avatarImage  !== undefined) db.items[idx].avatar_image  = avatarImage;
  write('users', db);
  return db.items[idx];
}

// ── ランキング ────────────────────────────────────────────────
function getRankings(limit = 100) {
  return read('rankings').items
    .sort((a, b) => b.decibel - a.decibel)
    .slice(0, limit);
}

function addRanking(entry) {
  const db   = read('rankings');
  const item = { id: db.nextId++, ...entry, created_at: new Date().toISOString() };
  db.items.push(item);
  write('rankings', db);
  return item;
}

function findRankingById(id) {
  return read('rankings').items.find(r => r.id === id) || null;
}

function deleteRanking(id) {
  const db  = read('rankings');
  const idx = db.items.findIndex(r => r.id === id);
  if (idx === -1) return false;
  db.items.splice(idx, 1);
  write('rankings', db);
  return true;
}

module.exports = {
  findUserByName, findUserById, createUser, updateUserProfile,
  getRankings, addRanking, findRankingById, deleteRanking
};
