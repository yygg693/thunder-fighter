/* =====================================================================
 * 打飞机 · Fighter Shooter — core.js
 * 基础设施：画布 / 本地最高分 / 工具 / 程序化音效 / 输入
 * 通过 window.DJFE 命名空间向其它模块暴露能力（经典 script，file:// 可玩）
 * ===================================================================== */
window.DJFE = window.DJFE || {};
(function (DJFE) {
  'use strict';

  // ---- 画布 ----
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize); resize();
  DJFE.canvas = canvas; DJFE.ctx = ctx;
  DJFE.W = () => W; DJFE.H = () => H;

  // ---- 本地最高分 ----
  const BEST_KEY = 'djfe_best_score';
  let bestScore = 0;
  try { bestScore = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (e) {}
  DJFE.getBest = () => bestScore;
  DJFE.commitBest = (s) => {
    if (s > bestScore) { bestScore = s; try { localStorage.setItem(BEST_KEY, String(bestScore)); } catch (e) {} }
    return bestScore;
  };

  // ---- 碰撞工具 ----
  DJFE.hit = (ax, ay, ar, bx, by, br) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy <= (ar + br) * (ar + br);
  };

  // ---- 音效 (Web Audio, 程序化生成, 零外部文件) ----
  let audioCtx = null, masterGain = null, muted = false;
  function initAudio() {
    if (!audioCtx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.35;
        masterGain.connect(audioCtx.destination);
      } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  const ac = () => (audioCtx ? audioCtx.currentTime : 0);
  function blip(freq, dur, type, vol, slideTo) {
    if (!audioCtx || muted) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, ac());
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ac() + dur);
    g.gain.setValueAtTime(vol || 0.2, ac());
    g.gain.exponentialRampToValueAtTime(0.0001, ac() + dur);
    o.connect(g); g.connect(masterGain);
    o.start(); o.stop(ac() + dur);
  }
  function noiseBurst(dur, vol, lp) {
    if (!audioCtx || muted) return;
    const n = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const g = audioCtx.createGain(); g.gain.value = vol || 0.3;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 1200;
    src.connect(f); f.connect(g); g.connect(masterGain);
    src.start();
  }
  DJFE.audio = {
    init: initAudio,
    isMuted: () => muted,
    toggleMute: () => { muted = !muted; if (!muted) initAudio(); return muted; },
    shoot:    () => blip(880, 0.05, 'square', 0.05, 660),
    explosion:() => noiseBurst(0.25, 0.35, 900),
    hit:      () => blip(200, 0.18, 'sawtooth', 0.25, 80),
    power:    () => { blip(520, 0.08, 'triangle', 0.2, 780); setTimeout(() => blip(820, 0.1, 'triangle', 0.2, 1100), 70); },
    bomb:     () => { noiseBurst(0.6, 0.5, 600); blip(120, 0.5, 'sawtooth', 0.3, 40); },
    boss:     () => blip(140, 0.6, 'sawtooth', 0.3, 90),
    gameOver: () => blip(440, 0.8, 'triangle', 0.3, 110),
  };

  // ---- 输入: 触摸板/鼠标 + 键盘 ----
  const pointer = { x: W / 2, y: H * 0.8, active: false };
  const keys = { up: false, down: false, left: false, right: false };
  const KEY_MAP = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  };
  function onPointerMove(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.active = true;
  }
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', (e) => {
    onPointerMove(e);
    initAudio();                       // 用户手势解锁音频
    if (DJFE._onPointerDown) DJFE._onPointerDown();
  });
  window.addEventListener('keydown', (e) => {
    if (KEY_MAP[e.code]) { keys[KEY_MAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'Escape' && DJFE._onEscape) DJFE._onEscape();
  });
  window.addEventListener('keyup', (e) => {
    if (KEY_MAP[e.code]) { keys[KEY_MAP[e.code]] = false; e.preventDefault(); }
  });
  DJFE.input = { pointer, keys, initAudio };

})(window.DJFE);
