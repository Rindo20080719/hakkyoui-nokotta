/* ════════════════════════════════════════════
   発狂ーぃ のこった！  フロントエンド JS
   ════════════════════════════════════════════ */

// ── 状態変数 ──────────────────────────────────
let currentState = 'idle';     // idle / recording / result / submit
let currentUser  = null;

// ── アバター設定 ──────────────────────────────
const AVATARS = [
  { char: '龍', color: '#c0392b' }, { char: '虎', color: '#e67e22' },
  { char: '嵐', color: '#2980b9' }, { char: '雷', color: '#d4ac0d' },
  { char: '鬼', color: '#8e44ad' }, { char: '剛', color: '#27ae60' },
  { char: '覇', color: '#1a6b8a' }, { char: '豪', color: '#16a085' },
  { char: '翔', color: '#c0397a' }, { char: '猛', color: '#a04000' },
  { char: '力', color: '#c0392b' }, { char: '轟', color: '#6c3483' },
];
const COLORS = [
  '#c0392b', '#e67e22', '#d4ac0d', '#27ae60',
  '#2980b9', '#8e44ad', '#16a085', '#c0397a',
  '#1a6b8a', '#a04000', '#2c3e50', '#6c3483',
];

let selectedAvatar = '力';
let selectedColor  = '#c0392b';

// 録音関連
let audioCtx     = null;
let analyser     = null;
let mediaStream  = null;
let mediaRecorder= null;
let audioChunks  = [];
let countdownTimer = null;
let animFrameId  = null;
let peakDb       = 0;
let lastDb       = 0;
let dbSamples    = [];   // 5秒間のdBサンプル蓄積用
let countdown    = 5;

// ── dB比較データ ──────────────────────────────
const DB_COMPARISONS = [
  { db: 130, label: 'ジェットエンジン（超至近距離）' },
  { db: 120, label: 'ロケット発射' },
  { db: 115, label: 'ロックコンサート最前列' },
  { db: 110, label: '飛行機の離陸' },
  { db: 105, label: 'チェーンソー使用中' },
  { db: 100, label: '電動ドリル（近距離）' },
  { db: 95,  label: '地下鉄の車内' },
  { db: 90,  label: 'カラオケ（近距離）' },
  { db: 85,  label: 'バイクのエンジン' },
  { db: 80,  label: '掃除機' },
  { db: 75,  label: '電話の着信音' },
  { db: 70,  label: '普通の会話' },
  { db: 65,  label: '図書館の中' },
  { db: 60,  label: '静かなオフィス' },
  { db: 0,   label: 'ほぼ無音の部屋' },
];

function getDbComparison(db) {
  for (const c of DB_COMPARISONS) {
    if (db >= c.db) return c.label;
  }
  return 'ほぼ無音の部屋';
}

// ── BGM ───────────────────────────────────────
let bgm = null;
let bgmUnlocked = false;
let bgmTimer = null;

function playBGMLoop() {
  if (!bgm || !bgmUnlocked) return;
  bgm.currentTime = 0;
  bgm.play().catch(() => {});
  bgmTimer = setTimeout(playBGMLoop, 6800);
}

function initBGM() {
  bgm = document.getElementById('bgmAudio');
  if (!bgm) return;
  bgm.volume = 0.35;
  bgm.loop = false;
  document.addEventListener('click', function unlockBGM() {
    if (!bgmUnlocked) {
      bgmUnlocked = true;
      playBGMLoop();
    }
    document.removeEventListener('click', unlockBGM);
  }, { once: true });
}

function pauseBGM() {
  if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; }
  if (bgm) bgm.pause();
}

function resumeBGM() {
  if (!bgm || !bgmUnlocked) return;
  bgm.play().catch(() => {});
  bgmTimer = setTimeout(playBGMLoop, 6800);
}

// ── 初期化 ────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initBGM();
  await checkAuth();
  await loadRankings();
  loadSeasonInfo();
});

// ── 認証チェック ──────────────────────────────
async function checkAuth() {
  try {
    const r = await fetch('/api/auth/me');
    const d = await r.json();
    if (d.userId) { currentUser = d; updateAuthUI(); }
  } catch {}
}

function updateAuthUI() {
  document.getElementById('authButtons').classList.toggle('hidden', !!currentUser);
  document.getElementById('userInfo').classList.toggle('hidden', !currentUser);
  if (currentUser) {
    document.getElementById('usernameDisplay').textContent = currentUser.username;
    renderAvatarBadge('headerAvatar', currentUser.avatar, currentUser.avatarColor, 'avatar-sm', currentUser.avatarImage);
  }
}

function renderAvatarBadge(id, avatar, color, sizeClass, imageUrl) {
  const el = document.getElementById(id);
  if (!el) return;
  if (imageUrl) {
    el.textContent         = '';
    el.style.backgroundImage = `url('${imageUrl}')`;
    el.style.backgroundColor = color || '#c0392b';
    el.className           = `avatar-badge ${sizeClass} has-image`;
  } else {
    el.textContent           = avatar || '力';
    el.style.background      = color  || '#c0392b';
    el.style.backgroundImage = '';
    el.className             = `avatar-badge ${sizeClass}`;
  }
}

// ══════════════════════════════════════════════
// 録音フロー
// ══════════════════════════════════════════════

async function startRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'マイクの使用を許可してください！\n設定 → プライバシー → マイク で許可できます。'
      : `マイクにアクセスできませんでした。\n${err.message}`;
    alert(msg);
    return;
  }

  // Web Audio API セットアップ
  audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
  analyser  = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.5;

  const source = audioCtx.createMediaStreamSource(mediaStream);
  source.connect(analyser);

  // MediaRecorder（音声保存用）
  const mimeType = getSupportedMimeType();
  mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {});
  audioChunks   = [];
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.start(100);

  // 状態リセット
  peakDb    = 0;
  dbSamples = [];
  countdown = 5;

  pauseBGM();
  setState('recording');
  startCountdown();
  startAnalysis();
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

// ── カウントダウン ────────────────────────────
function startCountdown() {
  updateCountdownDisplay(5);

  countdownTimer = setInterval(() => {
    countdown--;
    updateCountdownDisplay(countdown);
    if (countdown <= 0) {
      clearInterval(countdownTimer);
      finishRecording();
    }
  }, 1000);
}

function updateCountdownDisplay(n) {
  const el = document.getElementById('countdown');
  el.textContent = n;
  // 残り2秒以下で緊迫感を演出
  el.className = 'countdown' + (n <= 2 ? ' urgent' : '');
}

// ── リアルタイム音量分析 ──────────────────────
function startAnalysis() {
  const bufLen  = analyser.fftSize;
  const timeArr = new Float32Array(bufLen);
  const freqArr = new Uint8Array(analyser.frequencyBinCount);
  const bars    = document.querySelectorAll('.viz-bar');

  function loop() {
    if (currentState !== 'recording') return;
    animFrameId = requestAnimationFrame(loop);

    // RMS計算 → dBFS → 表示用オフセット
    analyser.getFloatTimeDomainData(timeArr);
    let sumSq = 0;
    for (let i = 0; i < bufLen; i++) sumSq += timeArr[i] * timeArr[i];
    const rms    = Math.sqrt(sumSq / bufLen);
    const dbfs   = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
    const dispDb = Math.max(0, Math.round((dbfs + 120) * 10) / 10); // 0〜120表示

    if (dispDb > peakDb) peakDb = dispDb;
    if (dispDb > 0) dbSamples.push(dispDb);

    const avg = dbSamples.length > 0
      ? dbSamples.reduce((a, b) => a + b, 0) / dbSamples.length
      : 0;

    // UI更新
    document.getElementById('dbValue').textContent  = dispDb.toFixed(1);
    document.getElementById('dbPeak').textContent   = `平均: ${avg.toFixed(1)} dB　最高: ${peakDb.toFixed(1)} dB`;
    document.getElementById('dbBar').style.width    = `${Math.min(100, (dispDb / 120) * 100)}%`;

    // ビジュアライザー
    analyser.getByteFrequencyData(freqArr);
    bars.forEach((bar, i) => {
      const v  = freqArr[Math.floor(i * freqArr.length / bars.length)];
      const pct = (v / 255) * 100;
      bar.style.height          = `${Math.max(3, pct)}%`;
      bar.style.backgroundColor = `hsl(${120 - (v / 255) * 120}, 100%, 55%)`;
    });
  }

  loop();
}

// ── 録音終了 ──────────────────────────────────
function finishRecording() {
  currentState = 'result'; // analyseループを止める

  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }

  // MediaRecorder停止
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  // マイク解放
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
  }
  // AudioContext閉じる
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  // 5秒間の平均dBを記録として使用
  lastDb = dbSamples.length > 0
    ? dbSamples.reduce((a, b) => a + b, 0) / dbSamples.length
    : 0;
  lastDb = Math.round(lastDb * 10) / 10;

  // 結果表示
  document.getElementById('resultDb').textContent = lastDb.toFixed(1);

  const achieved  = getRankLabelByDb(lastDb);
  const nextRank  = getNextRank(lastDb);
  const nextMsg   = nextRank
    ? `次の称号「${nextRank.label}」まで あと ${(nextRank.db - lastDb).toFixed(1)} dB`
    : '最高位・横綱達成！！！';
  document.getElementById('resultEstimate').innerHTML =
    `<span class="result-rank-label">${achieved}</span><br><span class="result-next-rank">${nextMsg}</span>`;

  // シェアテキスト更新
  updateShareText();

  resumeBGM();
  setState('result');

  // 大声なら画面を揺らす
  if (lastDb >= 95) {
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 600);
  }
}

// スコアから番付推定（ランキングがない場合の仮推定）
function estimateRank(db) {
  if (db >= 115) return 1;
  if (db >= 110) return 2;
  if (db >= 105) return 3;
  if (db >= 100) return 5;
  if (db >= 95)  return 10;
  if (db >= 88)  return 20;
  if (db >= 80)  return 50;
  return 100;
}

// ── アクション ────────────────────────────────
function retryRecording() {
  audioChunks = [];
  setState('idle');
}

function resetGame() {
  audioChunks = [];
  setState('idle');
}

function showSubmitForm() {
  // ログイン中なら自動でユーザー名をセット
  if (currentUser) document.getElementById('rankUsername').value = currentUser.username;
  document.getElementById('submitDbVal').textContent = lastDb.toFixed(1);
  setState('submit');
}

function showResult() {
  setState('result');
}

// ── ランキング登録 ────────────────────────────
let isSubmitting = false;

async function submitRanking() {
  if (isSubmitting) return;

  const username    = document.getElementById('rankUsername').value.trim();
  const audioPublic = document.getElementById('audioPublic').checked;

  if (!username) {
    alert('力士名（ユーザー名）を入力してください！');
    return;
  }
  if (username.length > 20) {
    alert('力士名は20文字以内で入力してください');
    return;
  }

  isSubmitting = true;
  const submitBtn = document.querySelector('#submitState .btn-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '登録中...'; }

  const formData = new FormData();
  formData.append('username',    username);
  formData.append('decibel',     lastDb.toString());
  formData.append('audioPublic', audioPublic ? 'true' : 'false');

  if (audioPublic && audioChunks.length > 0) {
    const mimeType  = mediaRecorder?.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type: mimeType });
    formData.append('audio', audioBlob, 'recording.webm');
  }

  try {
    const res  = await fetch('/api/rankings', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok) {
      const label   = getRankLabelByDb(lastDb);
      const rankMsg = label === '横綱'  ? '横綱！天覧場所級！！！'
                    : label === '大関'  ? '大関！猛者！'
                    : label === '関脇'  ? '関脇！強豪だ！'
                    : label === '小結'  ? '小結！なかなかやる！'
                    : label === '前頭'  ? '前頭！幕内入り！'
                    : label === '十両'  ? '十両！関取だ！'
                    : label === '幕下'  ? '幕下！まだまだこれから！'
                    : label === '序二段' ? '序二段！稽古あるのみ！'
                    : label === '序ノ口' ? '序ノ口！門を叩いた！'
                    : '見習い…もっと発狂しろ！';
      alert(`登録完了！\n\n世界ランキング ${data.rank} 位！\n${rankMsg}`);
      audioChunks = [];
      await loadRankings();
      setState('idle');
    } else {
      alert('登録に失敗しました：' + data.error);
    }
  } catch (err) {
    alert('通信エラーが発生しました：' + err.message);
  } finally {
    isSubmitting = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '登録する'; }
  }
}

// ══════════════════════════════════════════════
// ステート管理
// ══════════════════════════════════════════════
function setState(newState) {
  currentState = newState;

  ['idle', 'recording', 'result', 'submit'].forEach(s => {
    const el = document.getElementById(`${s}State`);
    if (el) el.classList.toggle('hidden', s !== newState);
  });

  // 土俵に録音中クラス追加
  const dohyo = document.getElementById('dohyoBtn');
  if (dohyo) dohyo.classList.toggle('recording', newState === 'recording');
}

// ══════════════════════════════════════════════
// ランキング表示
// ══════════════════════════════════════════════
async function loadRankings() {
  try {
    const res  = await fetch('/api/rankings');
    const data = await res.json();
    renderRankings(data);
  } catch {
    document.getElementById('rankingsList').innerHTML =
      '<div class="loading-msg">読み込みに失敗しました</div>';
  }
}

function scrollToRanking() {
  const el = document.getElementById('rankingSection');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function renderRankings(list) {
  const el = document.getElementById('rankingsList');

  if (!list.length) {
    el.innerHTML = '<div class="no-rankings-msg">まだ記録がありません。最初の力士になれ！</div>';
    return;
  }

  el.innerHTML = list.map(r => {
    const rankClass = r.rank <= 3 ? ` r-${r.rank}` : '';
    const badge     = getRankLabelByDb(r.decibel);
    const date      = new Date(r.createdAt).toLocaleDateString('ja-JP');
    const audioBtn  = r.hasAudio
      ? `<button class="btn-audio" onclick="playAudio('${r.audioUrl}', this)">▶ 聴く</button>` : '';
    const deleteBtn = r.isOwn
      ? `<button class="btn-delete" onclick="deleteRanking(${r.id})">削除</button>` : '';

    // アバター（登録済みユーザーはプロフィールから取得、ゲストはデフォルト）
    const avatarChar  = r.avatar      || r.username?.charAt(0) || '力';
    const avatarColor = r.avatarColor || '#5a3e08';
    const avatarHtml  = r.avatarImage
      ? `<div class="avatar-badge avatar-md has-image" style="background-color:${avatarColor};background-image:url('${r.avatarImage}')"></div>`
      : `<div class="avatar-badge avatar-md" style="background:${avatarColor}">${esc(avatarChar)}</div>`;

    return `
      <div class="ranking-item${rankClass}">
        <div class="rank-num">${r.rank}位</div>
        <div class="rank-badge">${badge}</div>
        <div class="rank-avatar">${avatarHtml}</div>
        <div class="rank-name">${esc(r.username)}</div>
        <div class="rank-db">${r.decibel.toFixed(1)} dB</div>
        <div class="rank-date">${date}</div>
        <div class="rank-actions">${audioBtn}${deleteBtn}</div>
      </div>
    `;
  }).join('');
}

// ── シーズン情報表示 ──────────────────────────
async function loadSeasonInfo() {
  try {
    const res  = await fetch('/api/season');
    const data = await res.json();
    if (!data.nextResetAt) return;

    const el = document.getElementById('seasonInfo');
    if (!el) return;

    function updateTimer() {
      const now  = new Date();
      const diff = new Date(data.nextResetAt) - now;
      if (diff <= 0) {
        el.innerHTML = '<span class="season-reset-soon">まもなくリセット！</span>';
        return;
      }
      const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      el.innerHTML = `
        <span class="season-num">シーズン ${data.seasonNumber}</span>
        <span class="season-reset">リセットまで ${days}日 ${hours}時間 ${mins}分</span>
      `;
    }

    updateTimer();
    setInterval(updateTimer, 60 * 1000); // 1分ごと更新
  } catch {}
}

// dBで称号を決定（順位ではなく実力で決まる）
const RANK_THRESHOLDS = [
  { label: '横綱',  db: 112 },
  { label: '大関',  db: 107 },
  { label: '関脇',  db: 102 },
  { label: '小結',  db:  97 },
  { label: '前頭',  db:  92 },
  { label: '十両',  db:  87 },
  { label: '幕下',  db:  82 },
  { label: '序二段', db:  77 },
  { label: '序ノ口', db:  72 },
  { label: '見習い', db:   0 },
];

function getRankLabelByDb(db) {
  for (const r of RANK_THRESHOLDS) {
    if (db >= r.db) return r.label;
  }
  return '見習い';
}

function getNextRank(db) {
  for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
    if (RANK_THRESHOLDS[i].db > db) return RANK_THRESHOLDS[i];
  }
  return null; // 横綱以上はなし
}

// XSS対策
function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

async function deleteRanking(id) {
  if (!confirm('この記録を削除しますか？')) return;

  try {
    const res = await fetch(`/api/rankings/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadRankings();
    } else {
      const d = await res.json();
      alert('削除に失敗しました：' + d.error);
    }
  } catch (err) {
    alert('通信エラー：' + err.message);
  }
}

let currentAudio = null;
let currentAudioBtn = null;

function playAudio(url, btn) {
  // 同じボタンを押したら停止
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    resetAudioBtn(currentAudioBtn);
    if (currentAudioBtn === btn) { currentAudio = null; currentAudioBtn = null; return; }
  }

  // 別のボタンが再生中なら止める
  if (currentAudioBtn && currentAudioBtn !== btn) resetAudioBtn(currentAudioBtn);

  currentAudioBtn = btn;
  btn.textContent = '⏸ 再生中...';
  btn.classList.add('playing');

  const audio = new Audio(url);
  currentAudio = audio;

  audio.play().catch(err => {
    alert('再生に失敗しました：' + err.message);
    resetAudioBtn(btn);
  });

  audio.onended = () => resetAudioBtn(btn);
  audio.onerror = () => resetAudioBtn(btn);
}

function resetAudioBtn(btn) {
  if (!btn) return;
  btn.textContent = '▶ 聴く';
  btn.classList.remove('playing');
}

// ══════════════════════════════════════════════
// シェア機能
// ══════════════════════════════════════════════

function buildShareText() {
  const comparison = getDbComparison(lastDb);
  const rank       = getRankLabelByDb(lastDb);
  const siteUrl    = window.location.origin;
  return `あなたの声は${lastDb.toFixed(1)}dB！これは${comparison}とほぼ同じです！称号：「${rank}」\nあなたも試してみて👉 ${siteUrl}\n#発狂ーぃのこった #発狂力測定`;
}

function updateShareText() {
  const el = document.getElementById('shareTextPreview');
  if (!el) return;
  el.textContent = buildShareText();
}

function shareToX() {
  const text = buildShareText();
  const url  = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function shareToLINE() {
  const text = buildShareText();
  const url  = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyShareText() {
  const text = buildShareText();
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.querySelector('.btn-copy-share');
    if (btn) { btn.textContent = '✅ コピーした！'; setTimeout(() => { btn.textContent = '📋 コピー'; }, 2000); }
  } catch {
    prompt('以下のテキストをコピーしてください：', buildShareText());
  }
}

async function shareWithAudio() {
  if (audioChunks.length === 0) {
    alert('音声データがありません。録音後に試してください。');
    return;
  }

  const mimeType = mediaRecorder?.mimeType || 'audio/webm';
  const blob     = new Blob(audioChunks, { type: mimeType });
  const file     = new File([blob], '発狂声.webm', { type: mimeType });

  // モバイルでファイルシェアが使える場合
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: '発狂ーぃ のこった！',
        text:  buildShareText(),
        files: [file]
      });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  // フォールバック：ダウンロード
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = '発狂声.webm';
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════
// 認証UI
// ══════════════════════════════════════════════
function showLogin()    { document.getElementById('loginModal').classList.remove('hidden'); }
function showRegister() { document.getElementById('registerModal').classList.remove('hidden'); }

function showProfile() {
  if (!currentUser) return;

  // 現在の設定をプレビューに反映
  selectedAvatar = currentUser.avatar      || '力';
  selectedColor  = currentUser.avatarColor || '#c0392b';

  renderAvatarBadge('profileAvatarPreview', selectedAvatar, selectedColor, 'avatar-lg', currentUser.avatarImage);

  // 画像アップロード欄の状態を更新
  document.getElementById('avatarFileName').textContent = '未選択';
  document.getElementById('avatarFileInput').value = '';
  const deleteBtn = document.getElementById('avatarDeleteBtn');
  if (currentUser.avatarImage) {
    deleteBtn.classList.remove('hidden');
    document.getElementById('kanjiSection').style.opacity = '0.4';
  } else {
    deleteBtn.classList.add('hidden');
    document.getElementById('kanjiSection').style.opacity = '1';
  }
  document.getElementById('profileCatchphrasePreview').textContent = currentUser.catchphrase || '';
  document.getElementById('profileCatchphrase').value = currentUser.catchphrase || '';

  // アイコングリッド生成
  const avatarGrid = document.getElementById('avatarGrid');
  avatarGrid.innerHTML = AVATARS.map(a => `
    <div class="avatar-option ${a.char === selectedAvatar ? 'selected' : ''}"
         style="background:${selectedColor}"
         onclick="selectAvatar('${a.char}')">
      ${a.char}
    </div>
  `).join('');

  // カラーグリッド生成
  const colorGrid = document.getElementById('colorGrid');
  colorGrid.innerHTML = COLORS.map(c => `
    <div class="color-option ${c === selectedColor ? 'selected' : ''}"
         style="background:${c}"
         onclick="selectColor('${c}')">
    </div>
  `).join('');

  // プロフィールタブを表示
  switchProfileTab('profile');
  document.getElementById('profileModal').classList.remove('hidden');
}

function selectAvatar(char) {
  selectedAvatar = char;
  // グリッド更新
  document.querySelectorAll('.avatar-option').forEach(el => {
    el.classList.toggle('selected', el.textContent.trim() === char);
  });
  renderAvatarBadge('profileAvatarPreview', selectedAvatar, selectedColor, 'avatar-lg');
}

function selectColor(color) {
  selectedColor = color;
  // グリッド更新
  document.querySelectorAll('.avatar-option').forEach(el => el.style.background = color);
  document.querySelectorAll('.color-option').forEach(el => {
    el.classList.toggle('selected', el.style.background === hexToRgb(color) || el.style.background === color);
  });
  renderAvatarBadge('profileAvatarPreview', selectedAvatar, selectedColor, 'avatar-lg');
}

function hexToRgb(hex) {
  // CSSがrgb()形式で返すことがあるため変換して比較できるように
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgb(${r}, ${g}, ${b})`;
}

function previewAvatarImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById('avatarFileName').textContent = file.name;
  const url = URL.createObjectURL(file);
  renderAvatarBadge('profileAvatarPreview', selectedAvatar, selectedColor, 'avatar-lg', url);
  // 漢字セクションを薄く
  document.getElementById('kanjiSection').style.opacity = '0.4';
}

async function deleteAvatarImage() {
  if (!confirm('アバター画像を削除しますか？')) return;
  try {
    const res = await fetch('/api/auth/avatar', { method: 'DELETE' });
    if (res.ok) {
      currentUser.avatarImage = null;
      updateAuthUI();
      document.getElementById('avatarDeleteBtn').classList.add('hidden');
      document.getElementById('avatarFileName').textContent = '未選択';
      document.getElementById('avatarFileInput').value = '';
      document.getElementById('kanjiSection').style.opacity = '1';
      renderAvatarBadge('profileAvatarPreview', selectedAvatar, selectedColor, 'avatar-lg', null);
    }
  } catch { alert('削除に失敗しました'); }
}

async function saveProfile() {
  const catchphrase = document.getElementById('profileCatchphrase').value.trim();
  const fileInput   = document.getElementById('avatarFileInput');

  // 画像がある場合は先にアップロード
  if (fileInput.files[0]) {
    const formData = new FormData();
    formData.append('avatar', fileInput.files[0]);
    try {
      const res  = await fetch('/api/auth/avatar', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        currentUser.avatarImage = data.avatarImage;
      } else {
        document.getElementById('profileError').textContent = data.error;
        document.getElementById('profileError').classList.remove('hidden');
        return;
      }
    } catch {
      document.getElementById('profileError').textContent = '画像のアップロードに失敗しました';
      document.getElementById('profileError').classList.remove('hidden');
      return;
    }
  }

  // リアルタイムプレビュー更新
  document.getElementById('profileCatchphrasePreview').textContent = catchphrase;

  try {
    const res  = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: selectedAvatar, avatarColor: selectedColor, catchphrase })
    });
    const data = await res.json();

    if (res.ok) {
      currentUser.avatar      = data.avatar;
      currentUser.avatarColor = data.avatarColor;
      currentUser.catchphrase = data.catchphrase;
      updateAuthUI();
      closeModal('profileModal');
      await loadRankings();
    } else {
      document.getElementById('profileError').textContent = data.error;
      document.getElementById('profileError').classList.remove('hidden');
    }
  } catch {
    document.getElementById('profileError').textContent = '通信エラーが発生しました';
    document.getElementById('profileError').classList.remove('hidden');
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  // エラーメッセージをリセット
  const err = document.getElementById(id.replace('Modal','') + 'Error') ||
              document.getElementById(id.replace('Modal','') + 'Error');
  if (err) { err.textContent = ''; err.classList.add('hidden'); }
}

function closeOnOverlay(event, id) {
  if (event.target === document.getElementById(id)) closeModal(id);
}

function showFormError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function login() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok) {
      currentUser = data;
      updateAuthUI();
      closeModal('loginModal');
      // フォームをリセット
      document.getElementById('loginUsername').value = '';
      document.getElementById('loginPassword').value = '';
      await loadRankings();
    } else {
      showFormError('loginError', data.error);
    }
  } catch {
    showFormError('loginError', '通信エラーが発生しました');
  }
}

async function register() {
  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirm  = document.getElementById('registerPasswordConfirm').value;

  if (password !== confirm) {
    showFormError('registerError', 'パスワードが一致しません');
    return;
  }

  try {
    const res  = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok) {
      currentUser = data;
      updateAuthUI();
      closeModal('registerModal');
      document.getElementById('registerUsername').value = '';
      document.getElementById('registerPassword').value = '';
      document.getElementById('registerPasswordConfirm').value = '';
      await loadRankings();
    } else {
      showFormError('registerError', data.error);
    }
  } catch {
    showFormError('registerError', '通信エラーが発生しました');
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    updateAuthUI();
    await loadRankings();
  } catch {}
}

// ══════════════════════════════════════════════
// プロフィールタブ切り替え
// ══════════════════════════════════════════════
function switchProfileTab(tab) {
  const isProfile = (tab === 'profile');

  document.getElementById('tabProfile').classList.toggle('active', isProfile);
  document.getElementById('tabHistory').classList.toggle('active', !isProfile);

  document.getElementById('profileTabContent').classList.toggle('hidden', !isProfile);
  document.getElementById('profileTabFooter').classList.toggle('hidden', !isProfile);
  document.getElementById('historyTabContent').classList.toggle('hidden', isProfile);
  document.getElementById('historyTabFooter').classList.toggle('hidden', isProfile);

  if (!isProfile) loadUserHistory();
}

// ══════════════════════════════════════════════
// ユーザー個人履歴
// ══════════════════════════════════════════════
async function loadUserHistory() {
  const el = document.getElementById('historyList');
  if (!el) return;
  el.innerHTML = '<div class="loading-msg">読み込み中...</div>';

  try {
    const res  = await fetch('/api/users/me/history');
    const data = await res.json();
    renderUserHistory(data);
  } catch {
    el.innerHTML = '<div class="loading-msg">読み込みに失敗しました</div>';
  }
}

function renderUserHistory(list) {
  const el = document.getElementById('historyList');
  if (!list.length) {
    el.innerHTML = '<div class="no-rankings-msg">まだ記録がありません</div>';
    return;
  }

  el.innerHTML = list.map(r => {
    const date     = new Date(r.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const badge    = getRankLabelByDb(r.decibel);
    const audioBtn = r.hasAudio
      ? `<button class="btn-audio" onclick="playAudio('${r.audioUrl}', this)">▶ 聴く</button>` : '';
    return `
      <div class="history-item">
        <div class="history-badge">${badge}</div>
        <div class="history-db">${r.decibel.toFixed(1)} <span class="history-db-unit">dB</span></div>
        <div class="history-meta">
          <span class="history-date">${date}</span>
          <span class="history-season">S${r.seasonNumber}</span>
        </div>
        <div class="history-actions">${audioBtn}</div>
      </div>
    `;
  }).join('');
}
