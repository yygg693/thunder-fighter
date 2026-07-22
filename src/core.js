/* =====================================================================
 * 打飞机 · Fighter Shooter — core.js
 * 基础设施：画布 / 本地最高分 / 设置 / 排行榜 / 工具 / 程序化音效+BGM / 输入
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

  // ---- 本地存储辅助 ----
  function lsGet(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---- 本地最高分 ----
  const BEST_KEY = 'djfe_best_score';
  let bestScore = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  DJFE.getBest = () => bestScore;
  DJFE.commitBest = (s) => { if (s > bestScore) { bestScore = s; try { localStorage.setItem(BEST_KEY, String(bestScore)); } catch (e) {} } return bestScore; };

  // ---- 设置（音量/语言/全屏，持久化） ----
  const SET_KEY = 'djfe_settings';
  const settings = Object.assign({ musicVol: 0.55, sfxVol: 0.85, lang: 'zh', fullscreen: false }, lsGet(SET_KEY, {}));
  DJFE.settings = settings;
  DJFE.saveSettings = () => lsSet(SET_KEY, settings);

  // ---- 本地排行榜（前 8 名） ----
  const LB_KEY = 'djfe_leaderboard';
  DJFE.getLeaderboard = () => lsGet(LB_KEY, []);
  DJFE.addLeaderboard = (entry) => {
    const lb = DJFE.getLeaderboard();
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    const top = lb.slice(0, 8);
    lsSet(LB_KEY, top);
    return top;
  };

  // ---- 碰撞工具 ----
  DJFE.hit = (ax, ay, ar, bx, by, br) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy <= (ar + br) * (ar + br);
  };

  // ---- 音效 (Web Audio, 程序化生成, 零外部文件) ----
  let audioCtx = null, masterGain = null, sfxGain = null, musicGain = null, muted = false;
  function initAudio() {
    if (!audioCtx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        masterGain = audioCtx.createGain(); masterGain.gain.value = 0.9; masterGain.connect(audioCtx.destination);
        sfxGain = audioCtx.createGain(); sfxGain.gain.value = settings.sfxVol; sfxGain.connect(masterGain);
        musicGain = audioCtx.createGain(); musicGain.gain.value = settings.musicVol; musicGain.connect(masterGain);
        music.start('menu'); // 解锁后直接起菜单 BGM
      } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  const ac = () => (audioCtx ? audioCtx.currentTime : 0);
  function blip(freq, dur, type, vol, slideTo, target) {
    if (!audioCtx || muted) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, ac());
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ac() + dur);
    g.gain.setValueAtTime(vol || 0.2, ac());
    g.gain.exponentialRampToValueAtTime(0.0001, ac() + dur);
    o.connect(g); g.connect(target || sfxGain);
    o.start(); o.stop(ac() + dur);
  }
  function noiseBurst(dur, vol, lp, target) {
    if (!audioCtx || muted) return;
    const n = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const g = audioCtx.createGain(); g.gain.value = vol || 0.3;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 1200;
    src.connect(f); f.connect(g); g.connect(target || sfxGain);
    src.start();
  }

  // ---- 程序化自适应 BGM（Web Audio 步进音序器） ----
  // 三档强度：menu（舒缓 pad）/ playing（驱动节拍）/ boss（更密更快）
  const music = (function () {
    let timer = null, step = 0, nextTime = 0, intensity = 'menu', stage = 1, playing = false;
    const BPM = { menu: 92, playing: 124, boss: 144 };
    const roots = [110.0, 98.0, 130.8, 87.3]; // A2 G2 C3 F2（每关一个调性）
    const freq = (root, semi) => root * Math.pow(2, semi / 12);
    // 贝斯 / 琶音 走句（16 步）
    const bassPat = [0, null, 0, null, 7, null, 5, null, 0, null, 0, null, 3, null, 5, null];
    const arpPat  = [0, 3, 7, 12, 7, 3, 0, 3, 5, 8, 12, 8, 7, 3, 0, 3];
    function scheduleStep(s, t) {
      const bpm = BPM[intensity] || 120;
      const stepDur = (60 / bpm) / 2;
      const root = roots[(stage - 1) % roots.length];
      if (intensity === 'menu') {
        if (s % 8 === 0) [0, 3, 7].forEach(iv => blip(freq(root, iv + 12), stepDur * 8, 'sine', 0.10, null, musicGain));
        return;
      }
      if (s % 4 === 0) noiseBurst(0.13, 0.55, 180, musicGain);            // kick
      if (s % 2 === 1) noiseBurst(0.04, 0.13, 7000, musicGain);           // hat
      if (s === 4 || s === 12) noiseBurst(0.10, 0.28, 2600, musicGain);  // snare
      const bn = bassPat[s];
      if (bn !== null) blip(freq(root, bn - 12), stepDur * 1.7, 'sawtooth', 0.30, null, musicGain);
      const an = arpPat[s];
      blip(freq(root, an), stepDur * 0.9, 'square', intensity === 'boss' ? 0.22 : 0.14, null, musicGain);
    }
    function tick() {
      if (!audioCtx) return;
      const bpm = BPM[intensity] || 120;
      const stepDur = (60 / bpm) / 2;
      while (nextTime < ac() + 0.12) { scheduleStep(step, nextTime); nextTime += stepDur; step = (step + 1) % 16; }
    }
    return {
      start(level) {
        if (playing) { if (level) intensity = level; return; }
        if (!audioCtx) { if (level) intensity = level; return; }
        playing = true; step = 0; nextTime = ac() + 0.06; if (level) intensity = level;
        timer = setInterval(tick, 25);
      },
      stop() { playing = false; if (timer) { clearInterval(timer); timer = null; } },
      setIntensity(l) { intensity = l; },
      setStage(n) { stage = n; },
    };
  })();

  DJFE.audio = {
    init: initAudio,
    isMuted: () => muted,
    toggleMute: () => { muted = !muted; if (!muted) initAudio(); return muted; },
    setMusicVol: (v) => { settings.musicVol = v; if (musicGain) musicGain.gain.value = v; DJFE.saveSettings(); },
    setSfxVol: (v) => { settings.sfxVol = v; if (sfxGain) sfxGain.gain.value = v; DJFE.saveSettings(); },
    music,
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
