const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const db       = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── アップロードディレクトリ ──────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(__dirname, 'public', 'avatars');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

// ── Multer（アバター画像） ────────────────────────────────────
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarsDir),
  filename: (req, file, cb) => {
    const ext = file.mimetype.includes('png')  ? '.png'
              : file.mimetype.includes('gif')  ? '.gif'
              : file.mimetype.includes('webp') ? '.webp'
              : '.jpg';
    // ユーザーIDで固定ファイル名にすると古いファイルを自動上書き
    cb(null, `user_${req.session.userId}${ext}`);
  }
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('画像ファイルのみ受け付けます'));
  }
});

// ── Multer（音声ファイル） ────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext = file.mimetype.includes('mp4') ? '.mp4'
              : file.mimetype.includes('ogg') ? '.ogg'
              : '.webm';
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('audio/')
      ? cb(null, true)
      : cb(new Error('音声ファイルのみ受け付けます'));
  }
});

// ── ミドルウェア ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'hakkyoi-nokotta-sumo-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));
app.use(express.static(path.join(__dirname, 'public')));

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'ログインが必要です' });
  next();
};

// ════════════════════════════════════════════════════════════════
// 認証 API
// ════════════════════════════════════════════════════════════════

// 新規登録
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username?.trim() || !password)
      return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });

    const u = username.trim();
    if (u.length < 2 || u.length > 20)
      return res.status(400).json({ error: 'ユーザー名は2〜20文字で入力してください' });
    if (password.length < 6)
      return res.status(400).json({ error: 'パスワードは6文字以上で入力してください' });

    const hash = await bcrypt.hash(password, 10);
    const user = db.createUser(u, hash);

    req.session.userId   = user.id;
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
  } catch (err) {
    if (err.code === 'UNIQUE')
      return res.status(400).json({ error: 'そのユーザー名はすでに使われています' });
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ログイン
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });

    const user = db.findUserByName(username);
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });

    req.session.userId   = user.id;
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ログアウト
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// 現在のユーザー確認
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ userId: null });
  const user = db.findUserById(req.session.userId);
  res.json({
    userId:      req.session.userId,
    username:    req.session.username,
    avatar:      user?.avatar        || '力',
    avatarColor: user?.avatar_color  || '#c0392b',
    avatarImage: user?.avatar_image  || null,
    catchphrase: user?.catchphrase   || ''
  });
});

// プロフィール更新（テキスト情報）
app.put('/api/auth/profile', requireAuth, (req, res) => {
  const { avatar, avatarColor, catchphrase } = req.body;
  const updated = db.updateUserProfile(req.session.userId, { avatar, avatarColor, catchphrase });
  if (!updated) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  res.json({
    success: true,
    avatar:      updated.avatar,
    avatarColor: updated.avatar_color,
    avatarImage: updated.avatar_image || null,
    catchphrase: updated.catchphrase
  });
});

// アバター画像アップロード
app.post('/api/auth/avatar', requireAuth, (req, res) => {
  // 既存画像を削除してから新しいものを保存
  const exts = ['.jpg', '.png', '.gif', '.webp'];
  exts.forEach(ext => {
    const p = path.join(avatarsDir, `user_${req.session.userId}${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  uploadAvatar.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '画像ファイルが必要です' });

    const avatarUrl = `/avatars/${req.file.filename}`;
    const updated   = db.updateUserProfile(req.session.userId, { avatarImage: avatarUrl });
    if (!updated) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    res.json({ success: true, avatarImage: avatarUrl });
  });
});

// アバター画像削除
app.delete('/api/auth/avatar', requireAuth, (req, res) => {
  const exts = ['.jpg', '.png', '.gif', '.webp'];
  exts.forEach(ext => {
    const p = path.join(avatarsDir, `user_${req.session.userId}${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  db.updateUserProfile(req.session.userId, { avatarImage: '' });
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
// ランキング API
// ════════════════════════════════════════════════════════════════

// ランキング取得
app.get('/api/rankings', (req, res) => {
  const rankings = db.getRankings(100);
  res.json(rankings.map((r, i) => {
    const user = r.user_id ? db.findUserById(r.user_id) : null;
    return {
      rank:        i + 1,
      id:          r.id,
      username:    r.username,
      decibel:     r.decibel,
      hasAudio:    !!(r.audio_public && r.audio_filename),
      audioUrl:    r.audio_public && r.audio_filename ? `/api/audio/${r.audio_filename}` : null,
      createdAt:   r.created_at,
      isOwn:       req.session.userId ? (req.session.userId === r.user_id) : false,
      avatar:      user?.avatar       || null,
      avatarColor: user?.avatar_color || null,
      avatarImage: user?.avatar_image || null,
    };
  }));
});

// スコア登録
app.post('/api/rankings', upload.single('audio'), (req, res) => {
  try {
    const { username, decibel, audioPublic } = req.body;

    if (!username?.trim() || !decibel) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '必要な情報が不足しています' });
    }

    const dbVal = parseFloat(decibel);
    if (isNaN(dbVal) || dbVal < 0 || dbVal > 200) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '無効なデシベル値です' });
    }

    const isPublic = audioPublic === 'true';
    let audioFilename = null;
    let audioMimetype = null;

    if (req.file) {
      if (isPublic) {
        audioFilename = req.file.filename;
        audioMimetype = req.file.mimetype;
      } else {
        fs.unlinkSync(req.file.path);
      }
    }

    const item = db.addRanking({
      user_id:        req.session.userId || null,
      username:       username.trim(),
      decibel:        dbVal,
      audio_public:   isPublic ? 1 : 0,
      audio_filename: audioFilename,
      audio_mimetype: audioMimetype
    });

    // 登録後の順位を計算
    const all  = db.getRankings(1000);
    const rank = all.findIndex(r => r.id === item.id) + 1;

    res.json({ success: true, id: item.id, rank });
  } catch (err) {
    console.error(err);
    try { if (req.file) fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// スコア削除（ログイン必須・自分のみ）
app.delete('/api/rankings/:id', requireAuth, (req, res) => {
  const id      = parseInt(req.params.id);
  const ranking = db.findRankingById(id);

  if (!ranking)
    return res.status(404).json({ error: '記録が見つかりません' });
  if (ranking.user_id !== req.session.userId)
    return res.status(403).json({ error: '自分の記録のみ削除できます' });

  // 音声ファイルも削除
  if (ranking.audio_filename) {
    const p = path.join(uploadsDir, ranking.audio_filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  db.deleteRanking(id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
// 音声ファイル配信
// ════════════════════════════════════════════════════════════════
app.get('/api/audio/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // パストラバーサル防止
  const all      = db.getRankings(1000);
  const ranking  = all.find(r => r.audio_filename === filename && r.audio_public === 1);

  if (!ranking) return res.status(404).send('Not found');

  const audioPath = path.join(uploadsDir, filename);
  if (!fs.existsSync(audioPath)) return res.status(404).send('File not found');

  res.setHeader('Content-Type', ranking.audio_mimetype || 'audio/webm');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(audioPath);
});

// ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏟️  発狂ーぃ のこった！ サーバー起動`);
  console.log(`   http://localhost:${PORT}\n`);
});
