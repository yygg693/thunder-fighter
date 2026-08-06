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
  const settings = Object.assign({ musicVol: 0.55, sfxVol: 0.85, lang: 'zh', fullscreen: false, skillAuto: false }, lsGet(SET_KEY, {}));
  DJFE.settings = settings;
  DJFE.saveSettings = () => lsSet(SET_KEY, settings);

  // ---- 本地排行榜（前 8 名） ----
  const LB_KEY = 'djfe_leaderboard';
  // T3-8 / S13：旧存档记录可能缺 graze 字段，读取时兜底为 0，避免战果/排行榜出现 NaN/undefined。
  DJFE.getLeaderboard = () => {
    const lb = lsGet(LB_KEY, []);
    if (!Array.isArray(lb)) return [];
    let dirty = false;
    const norm = lb.map((e) => {
      if (!e || typeof e !== 'object') { dirty = true; return (e && typeof e === 'object') ? e : {}; }
      if (e.graze == null || !Number.isFinite(e.graze)) { dirty = true; return Object.assign({}, e, { graze: 0 }); }
      return e;
    });
    if (dirty) { try { lsSet(LB_KEY, norm); } catch (e) {} }
    return norm;
  };
  DJFE.addLeaderboard = (entry) => {
    const lb = DJFE.getLeaderboard();
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    const top = lb.slice(0, 8);
    lsSet(LB_KEY, top);
    return top;
  };

  // ---- 战机皮肤（预设 + 自由设计 Mod，localStorage 持久化） ----
  // 字段：body 机身 / accent 描边高光 / engine 尾焰 / wing 机翼 / trail 弹道 / pattern 涂装
  const SKIN_KEY = 'djfe_skins';
  const SKIN_PRESETS = [
    // 方向 B · 柔调画意科幻：整体降饱和 + 偏暖，弹道色一律避开「危险色带」(hue 12-24 琥珀红)，
    // 危险色带为敌弹专属通道；玩家侧统一偏冷青/柔金，保证敌我在高弹幕密度下仍可瞬间分辨。
    { id: 'cyan_knight',    name: '苍蓝骑士', body: '#3d8ba3', accent: '#cfe7ee', engine: '#e0a06a', wing: '#274d5c', trail: '#8fd4e0', pattern: 'plain' },
    { id: 'crimson_falcon', name: '烈焰红隼', body: '#b05a52', accent: '#f0d5c2', engine: '#e0b078', wing: '#6d3330', trail: '#e5a3a8', pattern: 'stripe' },
    { id: 'emerald',        name: '翡翠游隼', body: '#4f9b74', accent: '#d6ece0', engine: '#b3d18f', wing: '#2c5c46', trail: '#9fd4b4', pattern: 'plain' },
    { id: 'violet',         name: '紫电惊鸿', body: '#8272ad', accent: '#e2daf0', engine: '#c08fc0', wing: '#4b3f6b', trail: '#bcaede', pattern: 'hex' },
    { id: 'stealth',        name: '暗夜幽灵', body: '#3a414f', accent: '#8fb3bd', engine: '#8fb3bd', wing: '#1e222b', trail: '#9dc2cc', pattern: 'carbon' },
    { id: 'golden',         name: '黄金圣翼', body: '#c79a3e', accent: '#f2e3b8', engine: '#d8a45f', wing: '#7a5e22', trail: '#e6cf8f', pattern: 'stripe' },
  ];
  let skinState = lsGet(SKIN_KEY, { custom: [], selected: 'cyan_knight' });
  if (!skinState || typeof skinState !== 'object') skinState = { custom: [], selected: 'cyan_knight' };
  if (!Array.isArray(skinState.custom)) skinState.custom = [];
  function findSkin(id) {
    if (!id) return null;
    const p = SKIN_PRESETS.find(s => s.id === id);
    if (p) return p;
    return skinState.custom.find(s => s.id === id) || null;
  }
  DJFE.skins = {
    presets: SKIN_PRESETS,
    list() { return SKIN_PRESETS.concat(skinState.custom); },
    isPreset(id) { return !!SKIN_PRESETS.find(s => s.id === id); },
    isCustom(id) { return !!skinState.custom.find(s => s.id === id); },
    current() { return findSkin(skinState.selected) || SKIN_PRESETS[0]; },
    currentId() { return (findSkin(skinState.selected) ? skinState.selected : 'cyan_knight'); },
    select(id) {
      if (findSkin(id)) { skinState.selected = id; lsSet(SKIN_KEY, skinState); }
      return this.current();
    },
    saveCustom(skin) {
      const id = 'c_' + Date.now().toString(36);
      const rec = Object.assign({ id, custom: true }, skin);
      skinState.custom.push(rec);
      skinState.selected = id;
      lsSet(SKIN_KEY, skinState);
      return rec;
    },
    deleteCustom(id) {
      skinState.custom = skinState.custom.filter(s => s.id !== id);
      if (skinState.selected === id) skinState.selected = 'cyan_knight';
      lsSet(SKIN_KEY, skinState);
    },
  };

  // ---- 碰撞工具 ----
  DJFE.hit = (ax, ay, ar, bx, by, br) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy <= (ar + br) * (ar + br);
  };

  /* =====================================================================
   * 预渲染辉光图集（GLOW ATLAS）
   * ---------------------------------------------------------------------
   * 背景：ctx.shadowBlur 是「每次绘制都重跑一遍高斯模糊」的操作，在弹幕
   *   场景里一帧要触发几百次，是 Canvas2D 里最贵的调用之一。原实现全项目
   *   59 处实时 shadowBlur —— 弹幕密集时它就是帧率杀手。
   * 做法：把「一颗软辉光」按颜色预渲染进一张离屏图集，运行时只做
   *   drawImage 缩放贴图（O(1)，GPU 友好）。
   * 图集：8×8 = 64 格，每格 64×64，格内是中心→边缘衰减的径向渐变。
   *   颜色槽惰性分配；槽用尽后退化成普通半透明圆（无模糊，但绝不崩）。
   * 视觉基调（方向 B · 柔调画意科幻）：刻意做「宽而柔」的衰减曲线——
   *   没有硬核心、没有霓虹刀边，靠大面积低透明度堆出空气感。
   * =================================================================== */
  const GLOW_CELL = 64;                 // 单格边长
  /* 12×12 = 144 个颜色槽（图集 768×768，约 2.3MB 显存，一次性开销）。
   * 为什么不是 8×8=64：实测「全敌机型 × 4 关 Boss × 全道具 × 6 套内置皮肤」
   * 已经吃掉 54 槽，只剩 10。而皮肤编辑器允许玩家自定义任意颜色，
   * 每套自定义皮肤再吃 ~2 槽 —— 存够 5 套就溢出。
   * 溢出不会崩（有兜底圆），但辉光会「静默」退化，是最难被发现的那类劣化，
   * 所以这里按可自定义的上限留余量，而不是按内置内容刚好卡满。 */
  const GLOW_COLS = 12, GLOW_ROWS = 12;
  const GLOW_MAX = GLOW_COLS * GLOW_ROWS;
  let glowAtlas = null, glowCtx = null;
  const glowSlots = new Map();          // colorKey -> {sx, sy}
  let glowNext = 0;

  function glowRGBA(color, a) {
    if (typeof color !== 'string' || !color) return 'rgba(255,255,255,' + a + ')';
    if (color.charCodeAt(0) === 35) {   // '#'
      let h = color.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h, 16);
      if (!Number.isFinite(n)) return 'rgba(255,255,255,' + a + ')';
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    if (color.indexOf('hsla(') === 0) {
      const p = color.slice(5, -1).split(',');
      return 'hsla(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
    }
    if (color.indexOf('hsl(') === 0) return 'hsla(' + color.slice(4, -1) + ',' + a + ')';
    if (color.indexOf('rgba(') === 0) {
      const p = color.slice(5, -1).split(',');
      return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
    }
    if (color.indexOf('rgb(') === 0) return 'rgba(' + color.slice(4, -1) + ',' + a + ')';
    return color;
  }

  function ensureAtlas() {
    if (glowAtlas) return true;
    try {
      glowAtlas = document.createElement('canvas');
      glowAtlas.width = GLOW_CELL * GLOW_COLS;
      glowAtlas.height = GLOW_CELL * GLOW_ROWS;
      glowCtx = glowAtlas.getContext('2d');
    } catch (e) { glowAtlas = null; glowCtx = null; }
    return !!glowCtx;
  }

  // 取（或惰性烘焙）某颜色的辉光槽。返回 null 表示槽已用尽。
  function glowSlot(color) {
    const key = String(color);
    const hitSlot = glowSlots.get(key);
    if (hitSlot !== undefined) return hitSlot;
    if (glowNext >= GLOW_MAX || !ensureAtlas()) { glowSlots.set(key, null); return null; }
    const idx = glowNext++;
    const sx = (idx % GLOW_COLS) * GLOW_CELL;
    const sy = ((idx / GLOW_COLS) | 0) * GLOW_CELL;
    const cx = sx + GLOW_CELL * 0.5, cy = sy + GLOW_CELL * 0.5;
    const g = glowCtx.createRadialGradient(cx, cy, 0, cx, cy, GLOW_CELL * 0.5);
    // 柔调衰减：无硬核心，长尾扩散 —— 方向 B 的「画意」质感来源
    g.addColorStop(0.00, glowRGBA(color, 0.80));
    g.addColorStop(0.22, glowRGBA(color, 0.42));
    g.addColorStop(0.50, glowRGBA(color, 0.15));
    g.addColorStop(0.78, glowRGBA(color, 0.04));
    g.addColorStop(1.00, glowRGBA(color, 0));
    glowCtx.fillStyle = g;
    glowCtx.fillRect(sx, sy, GLOW_CELL, GLOW_CELL);
    const slot = { sx, sy };
    glowSlots.set(key, slot);
    return slot;
  }

  /* 贴一颗辉光：等价于旧代码的 shadowColor/shadowBlur，但零模糊开销。
   * x,y = 中心；r = 辉光半径（≈ 旧 shadowBlur 值 + 形状半径）；a = 强度。 */
  function glow(c, color, x, y, r, a) {
    if (!(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    let al = (a === undefined || a === null) ? 1 : a;
    // 继承外层 globalAlpha：无敌闪烁 / 横幅淡出等整体淡入淡出才不会被辉光穿帮
    const outer = c.globalAlpha;
    al *= (typeof outer === 'number' && Number.isFinite(outer)) ? outer : 1;
    if (!(al > 0)) return;
    const slot = glowSlot(color);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = Math.min(1, al);
    if (slot) {
      c.drawImage(glowAtlas, slot.sx, slot.sy, GLOW_CELL, GLOW_CELL, x - r, y - r, r * 2, r * 2);
    } else {
      // 槽位耗尽的兜底：普通半透明圆，观感略差但不掉帧、不报错
      c.fillStyle = glowRGBA(color, 0.22);
      c.beginPath(); c.arc(x, y, r * 0.7, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  // 沿一段线贴辉光（用于机翼弧、狙击弹拖影这类细长发光体）
  function glowLine(c, color, x0, y0, x1, y1, r, a, steps) {
    const n = Math.max(2, steps || 3);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      glow(c, color, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, a);
    }
  }

  // 色相量化到 24° 一档 —— 把连续色相收敛成有限颜色槽，避免图集被打爆
  const QUANT = 24;
  function quantHue(h) {
    let q = Math.round((Number(h) || 0) / QUANT) * QUANT;
    q %= 360; if (q < 0) q += 360;
    return q;
  }
  // 饱和度/亮度同样量化到 10% 一档：调用方万一传了逐帧连续变化的 s/l，
  // 也不会把 64 个颜色槽打爆（辉光强度请一律走 a 参数，而不是改亮度）
  const quantSL = (v) => {
    let q = Math.round((Number(v) || 0) / 10) * 10;
    return q < 0 ? 0 : (q > 100 ? 100 : q);
  };
  // hsl 辉光便捷入口（敌机/粒子/Boss 都用色相驱动）
  function glowHue(c, h, s, l, x, y, r, a) {
    glow(c, 'hsl(' + quantHue(h) + ',' + quantSL(s) + '%,' + quantSL(l) + '%)', x, y, r, a);
  }

  DJFE.fx = {
    glow, glowLine, glowHue, quantHue,
    // 诊断用：当前占用了多少颜色槽
    stats: () => ({ used: glowNext, max: GLOW_MAX, keys: glowSlots.size }),
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
  // 触屏设备检测（用于 UI 与输入策略分流）
  const isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    || ('ontouchstart' in window);
  DJFE.isTouch = isTouch;
  // 2c-1 · 技能自动释放默认：桌面关 / 触屏开（GDD §0.3）。已存档值优先于默认值。
  if (lsGet(SET_KEY, {}).skillAuto === undefined) settings.skillAuto = isTouch;

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
    // 触屏：手指按下=开始操控，不放炸弹（炸弹走 #btnBomb 按钮，避免每次触摸都误触）
    if (e.pointerType === 'touch') return;
    // 右键 = 技能（离散脉冲，与 Shift 同构）。button===2 走技能并拦截，避免连带放炸弹。
    if (e.button === 2) {
      e.preventDefault();
      if (DJFE._onSkill) DJFE._onSkill();
      return;
    }
    // ⚠ 修右键连带放炸弹 bug：中键/其它非左键一律忽略；左键(0)与无 button 字段(旧环境)
    // 才放炸弹。原代码无 e.button 守卫，右键会误触炸弹。
    if (e.button > 0) return;
    if (DJFE._onPointerDown) DJFE._onPointerDown();   // 左键 → 炸弹
  });
  // 屏蔽游戏画布上的系统右键菜单：放技能(右键)时不弹出浏览器默认菜单挡操作。
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });
  window.addEventListener('keydown', (e) => {
    if (KEY_MAP[e.code]) { keys[KEY_MAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'Escape' && DJFE._onEscape) DJFE._onEscape();
    // 2c-1 · Shift（左/右）= 技能键：独立分支，不进 KEY_MAP（Shift 是脉冲不是持续状态）。
    // e.repeat 守卫：长按不连发，守住 P1「脉冲≠蓄力」精神。仅在游戏中生效。
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) {
      e.preventDefault();
      if (DJFE._onSkill) DJFE._onSkill();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (KEY_MAP[e.code]) { keys[KEY_MAP[e.code]] = false; e.preventDefault(); }
  });
  DJFE.input = { pointer, keys, initAudio };

  // ---- 精灵预加载 ----
  // 美术 B 之后：从程序化绘制升级到 AI 生成的 PNG 贴图。Sprite 是「锦上添花」——
  // 加载失败/未就绪时 entities.js 的绘制函数降级到程序化绘制，游戏照常运行。
  // 加载完成后 sprite 叠加在主体形状之上，保留所有动态特效（glow / 护盾 / 尾焰）。
  const SPRITE_BASE = 'assets/';
  const SPRITE_URLS = {
    player: SPRITE_BASE + 'player.png',
    boss: SPRITE_BASE + 'boss.png',
    enemy_diver: SPRITE_BASE + 'enemy_diver.png',
    enemy_weaver: SPRITE_BASE + 'enemy_weaver.png',
    enemy_elite: SPRITE_BASE + 'enemy_elite.png',
    enemy_spinner: SPRITE_BASE + 'enemy_spinner.png',
    enemy_sniper: SPRITE_BASE + 'enemy_sniper.png',
    enemy_splitter: SPRITE_BASE + 'enemy_splitter.png',
    enemy_shooter: SPRITE_BASE + 'enemy_shooter.png',
    enemy_drone: SPRITE_BASE + 'enemy_drone.png',
    item_P: SPRITE_BASE + 'item_P.png',
    item_S: SPRITE_BASE + 'item_S.png',
    item_B: SPRITE_BASE + 'item_B.png',
    item_L: SPRITE_BASE + 'item_L.png',
    bg_nebula: SPRITE_BASE + 'bg_nebula.png',
  };
  // 各精灵的自然像素尺寸（最长边封顶：player 160 / boss 384 / enemy 128 / item 64）。
  // 绘制时按此表保持长宽比，避免被拉伸；同时在无头桩里 img.width 不可用时兜底。
  // ⚠ 若重新生成精灵且尺寸变化，需同步更新此表。
  const SPRITE_DIMS = {
    player: [155, 160], boss: [384, 357],
    enemy_diver: [103, 128], enemy_weaver: [128, 115], enemy_elite: [117, 128],
    enemy_spinner: [128, 119], enemy_sniper: [40, 128], enemy_splitter: [128, 128],
    enemy_shooter: [121, 128], enemy_drone: [128, 122],
    item_P: [63, 64], item_S: [63, 64], item_B: [62, 64], item_L: [63, 64],
    bg_nebula: [832, 1216],
  };
  // 敌机 / Boss 精灵的基准色相（AI 贴图的主导色），用于按 en.hue / b.hue 做
  // hue-rotate 让机体随关卡变色。道具颜色固定，不参与旋转。
  // 注：sniper 不在此表 —— AI 贴图含超长炮管导致整图 1:3.2 比例，
  // 缩到游戏内尺寸后细节全压垮，强制走矢量降级（entities.js drawEnemy）。
  const SPRITE_BASE_HUE = {
    enemy_drone: 70, enemy_weaver: 10, enemy_shooter: 38, enemy_spinner: 42,
    enemy_diver: 234, enemy_splitter: 260, enemy_elite: 34,
    boss: 28,
  };
  const sprites = { images: {}, pending: 0, ready: false };
  DJFE.sprites = {
    has(name) { return !!sprites.images[name]; },
    get(name) { return sprites.images[name]; },
    bg() { return sprites.images.bg_nebula; },
    isReady() { return sprites.ready; },
    // 精灵自然像素尺寸 {w,h}，无记录返回 null
    dim(name) { const d = SPRITE_DIMS[name]; return d ? { w: d[0], h: d[1] } : null; },
    // 敌机 / Boss 精灵基准色相（用于 hue-rotate 随关卡变色），无记录返回 undefined
    baseHue(name) { return SPRITE_BASE_HUE[name]; },
    // 暴露给外部（例如 Game 启动序列）查询进度
    progress() {
      const total = Object.keys(SPRITE_URLS).length;
      return total === 0 ? 1 : (total - sprites.pending) / total;
    },
  };
  function loadSprites() {
    sprites.pending = Object.keys(SPRITE_URLS).length;
    if (sprites.pending === 0) { sprites.ready = true; return; }
    // 无头环境（如冒烟测试 vm 沙箱）没有 Image 构造器：直接标记就绪，
    // entities.js 自动降级到程序化绘制，绝不阻断游戏启动。
    if (typeof Image === 'undefined') { sprites.ready = true; return; }
    Object.keys(SPRITE_URLS).forEach(function (name) {
      const img = new Image();
      img.onload = function () {
        sprites.images[name] = img;
        if (--sprites.pending <= 0) sprites.ready = true;
      };
      img.onerror = function () {
        // 缺图不阻断游戏；entities.js 走程序化降级
        if (--sprites.pending <= 0) sprites.ready = true;
      };
      img.src = SPRITE_URLS[name];
    });
  }
  loadSprites();

})(window.DJFE);
