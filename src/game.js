/* =====================================================================
 * 打飞机 · Fighter Shooter — game.js
 * 游戏状态机 / 波次调度 / 碰撞 / 主循环 / 渲染编排
 * 依赖 core.js (DJFE.audio/input/hit/W/H/ctx) 与 entities.js (DJFE.draw)
 * ===================================================================== */
window.DJFE = window.DJFE || {};
(function (DJFE) {
  'use strict';
  const ctx = DJFE.ctx;
  const audio = DJFE.audio;
  const input = DJFE.input;
  const hit = DJFE.hit;
  let W = DJFE.W(), H = DJFE.H();
  window.addEventListener('resize', () => { W = DJFE.W(); H = DJFE.H(); });

  // ---- DOM ----
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const bombsEl = document.getElementById('bombs');
  const waveEl = document.getElementById('wave');
  const powerEl = document.getElementById('power');
  const stageEl = document.getElementById('stage');
  const finalScoreEl = document.getElementById('finalScore');
  const bestMenuEl = document.getElementById('bestMenu');
  const bestGOEl = document.getElementById('bestGO');
  const sensEl = document.getElementById('sens');
  const sensValEl = document.getElementById('sensVal');

  // ---- 状态机 ----
  const STATE = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover', PAUSED: 'paused', VICTORY: 'victory' };
  const game = {
    state: STATE.MENU,
    score: 0, lives: 3, bombs: 1,
    bullets: [], enemies: [], ebullets: [], particles: [], items: [],
    lastShot: 0, shootInterval: 140,
    flash: 0, runFrames: 0, diff: null,
    wave: 0, waveRemaining: 0, betweenWaves: true, nextWaveAt: 0,
    stage: 1, stageWave: 1,
    waveBannerUntil: 0, stageBannerUntil: 0, spawnTimer: 0, spawnInterval: 700,
    power: 1,
    boss: null, isBossWave: false,
    shake: 0, rings: [], muzzle: 0,
  };
  let bossPattern = 0;
  const player = { x: W / 2, y: H * 0.8, w: 42, h: 50, invulnUntil: 0, shieldUntil: 0 };

  // ---- 配色工具（背景渐变/星云用） ----
  function hexToRgb(h) {
    h = (h || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexA(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
  function shade(h, amt) {
    const [r, g, b] = hexToRgb(h);
    const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  // ---- 视差星空 ----
  let stars = [];
  function buildStars() {
    stars = [];
    const n = Math.max(60, Math.min(260, Math.round((W * H) / 7000)));
    for (let i = 0; i < n; i++) {
      const z = Math.random();
      stars.push({ x: Math.random() * W, y: Math.random() * H, z, r: 0.6 + z * 1.9, sp: 0.3 + z * 1.9 });
    }
  }
  buildStars();
  window.addEventListener('resize', buildStars);

  function drawBackground(now) {
    const stg = STAGES[game.stage - 1] || STAGES[0];
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, stg.bg);
    bg.addColorStop(1, shade(stg.bg, -0.35));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 星云（每关 accent 色，缓慢漂移）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const nx = W * (0.25 + 0.25 * i) + Math.sin(now / 9000 + i * 2) * 70;
      const ny = H * (0.3 + 0.2 * i) + Math.cos(now / 11000 + i * 2) * 50;
      const rad = Math.max(W, H) * 0.55;
      const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, rad);
      ng.addColorStop(0, hexA(stg.accent, 0.10));
      ng.addColorStop(1, hexA(stg.accent, 0));
      ctx.fillStyle = ng;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    // 远景天体（每关 accent 色，藏于右上角作远景氛围，不抢菜单、不像可点按钮）
    const planetR = Math.min(W, H) * 0.20;
    const pxc = W + planetR * 0.35 + Math.sin(now / 16000) * 14;
    const pyc = -planetR * 0.25 + Math.cos(now / 19000) * 12;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pg = ctx.createRadialGradient(pxc, pyc, planetR * 0.2, pxc, pyc, planetR);
    pg.addColorStop(0, hexA(stg.accent, 0.10));
    pg.addColorStop(0.7, hexA(stg.accent, 0.03));
    pg.addColorStop(1, hexA(stg.accent, 0));
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(pxc, pyc, planetR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const bg2 = ctx.createRadialGradient(pxc - planetR * 0.3, pyc - planetR * 0.3, planetR * 0.1, pxc, pyc, planetR * 0.6);
    bg2.addColorStop(0, shade(stg.accent, -0.55));
    bg2.addColorStop(0.85, shade(stg.accent, -0.85));
    bg2.addColorStop(1, shade(stg.accent, -0.97));
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(pxc, pyc, planetR * 0.6, 0, Math.PI * 2); ctx.fill();
    // 底部地平线辉光
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createLinearGradient(0, H, 0, H * 0.68);
    hg.addColorStop(0, hexA(stg.accent, 0.20));
    hg.addColorStop(1, hexA(stg.accent, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(0, H * 0.68, W, H * 0.32);
    ctx.restore();
    // 视差星点
    for (const s of stars) {
      s.y += s.sp;
      if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
      ctx.globalAlpha = 0.35 + s.z * 0.6;
      ctx.fillStyle = s.z > 0.66 ? '#ffffff' : (s.z > 0.33 ? stg.accent : '#9fb6d6');
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function hide(id) { document.getElementById(id).classList.add('hidden'); }
  function setState(s) {
    game.state = s;
    if (s === STATE.MENU) {
      refreshBestUI(); refreshLeaderboard();
      audio.music.setIntensity('menu');
      show('menu'); hide('gameover'); hide('pause'); hide('hud'); hide('panel'); hide('hint'); hide('victory');
    } else if (s === STATE.PLAYING) {
      hide('menu'); hide('gameover'); hide('pause'); hide('victory'); show('hud'); show('panel'); show('hint');
    } else if (s === STATE.GAMEOVER) {
      finalScoreEl.textContent = game.score;
      const raw = game.score;
      game.score = DJFE.commitBest(game.score);
      DJFE.addLeaderboard({ score: raw, stage: game.stage, date: new Date().toISOString().slice(0, 10) });
      refreshBestUI(); refreshLeaderboard();
      audio.gameOver();
      audio.music.setIntensity('menu');
      show('gameover'); hide('pause'); hide('hud'); hide('panel'); hide('hint');
    } else if (s === STATE.VICTORY) {
      victory();
    } else if (s === STATE.PAUSED) {
      show('pause');
    }
  }
  function refreshBestUI() {
    const b = DJFE.getBest();
    if (bestMenuEl) bestMenuEl.textContent = b;
    if (bestGOEl) bestGOEl.textContent = b;
  }
  function refreshLeaderboard() {
    const lb = DJFE.getLeaderboard();
    ['menuLB', 'goLB'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!lb.length) { el.innerHTML = '<div class="lbempty" data-i18n="lb.empty">暂无记录</div>'; return; }
      el.innerHTML = lb.slice(0, 5).map((e, i) =>
        `<div class="lbrow"><span class="lbrank">${i + 1}</span>` +
        `<span class="lbscore">${e.score}</span>` +
        `<span class="lbstage">${e.stage ? ('第' + e.stage + '关') : ''}</span></div>`
      ).join('');
    });
  }

  // ---- 难度 ----
  const DIFFS = {
    easy:   { spawnBase: 900, speedMul: 0.8, hp: 1, bombs: 2 },
    normal: { spawnBase: 700, speedMul: 1.0, hp: 2, bombs: 1 },
    hard:   { spawnBase: 500, speedMul: 1.3, hp: 3, bombs: 1 },
  };

  // ---- 关卡战役 ----
  const STAGE_WAVES = 3; // 每关波数（最后一波为 Boss）
  const STAGES = [
    { name: '近地轨道', bg: '#05060f', accent: '#36e0ff', bossName: '哨戒机甲', bossHue: 200, bossHp: 170 },
    { name: '陨石带',   bg: '#0d0712', accent: '#ffb24a', bossName: '采矿巨蝎', bossHue: 30,  bossHp: 240 },
    { name: '电离层',   bg: '#04101a', accent: '#7dff9b', bossName: '雷云母舰', bossHue: 150, bossHp: 330 },
    { name: '深空要塞', bg: '#14060f', accent: '#ff5b8a', bossName: '歼灭核心', bossHue: 340, bossHp: 460 },
  ];

  let selectedDiff = 'normal';

  function startGame() {
    const d = DIFFS[selectedDiff];
    const now = performance.now();
    game.score = 0; game.lives = 3; game.bombs = d.bombs; game.power = 1;
    audio.music.setIntensity('playing'); audio.music.setStage(1);
    game.bullets = []; game.enemies = []; game.ebullets = []; game.particles = []; game.items = [];
    game.diff = d; game.spawnBase = d.spawnBase; game.lastShot = 0; game.flash = 0;
    game.wave = 0; game.stage = 1; game.betweenWaves = true; game.nextWaveAt = now + 700; game.stageBannerUntil = 0;
    game.boss = null; game.isBossWave = false; bossPattern = 0;
    game.shake = 0; game.rings = []; game.muzzle = 0;
    player.x = W / 2; player.y = H * 0.8; player.invulnUntil = 0; player.shieldUntil = 0;
    input.pointer.x = player.x; input.pointer.y = player.y;
    setState(STATE.PLAYING);
  }
  function gameOver() { setState(STATE.GAMEOVER); }
  function victory() {
    const raw = game.score;
    game.score = DJFE.commitBest(game.score);
    DJFE.addLeaderboard({ score: raw, stage: game.stage, date: new Date().toISOString().slice(0, 10), win: true });
    const fv = document.getElementById('finalScoreV'); if (fv) fv.textContent = game.score;
    const bv = document.getElementById('bestV'); if (bv) bv.textContent = DJFE.getBest();
    refreshBestUI(); refreshLeaderboard();
    audio.bomb();
    hide('menu'); hide('gameover'); hide('pause'); hide('hud'); hide('panel'); hide('hint');
    show('victory');
  }

  // ---- M4 波次调度 ----
  function beginWave(n, now) {
    game.wave = n;
    game.stage = Math.floor((n - 1) / STAGE_WAVES) + 1;
    game.stageWave = ((n - 1) % STAGE_WAVES) + 1;
    game.isBossWave = (game.stageWave === STAGE_WAVES);
    game.spawnInterval = Math.max(220, game.spawnBase - n * 18);
    game.shootInterval = Math.max(95, 150 - n * 3);
    if (game.stageWave === 1) game.stageBannerUntil = now + 2400;
    game.waveBannerUntil = now + 1600;
    if (game.isBossWave) {
      game.waveRemaining = 0;
      spawnBoss(n, now);
    } else {
      game.waveRemaining = 5 + Math.floor(n * 1.6);
      game.spawnTimer = now;
    }
  }

  // ---- M5 Boss ----
  function spawnBoss(n, now) {
    const st = STAGES[game.stage - 1] || STAGES[STAGES.length - 1];
    const tier = Math.floor(n / 3);
    const hp = st.bossHp;
    game.boss = {
      x: W / 2, y: -90, ty: H * 0.16,
      hp, maxHp: hp, w: 140, h: 92,
      hue: st.bossHue, name: st.bossName,
      phase: 0, fireT: 0, fireGap: Math.max(420, 900 - tier * 120),
    };
    audio.boss();
    audio.music.setIntensity('boss'); audio.music.setStage(game.stage);
  }
  function bossFire(b) {
    const cx = b.x, cy = b.y + b.h * 0.4;
    const pat = bossPattern % 3;
    bossPattern++;
    if (pat === 0) {
      const num = 7, spread = Math.PI * 0.6, base = Math.PI / 2 - spread / 2;
      for (let i = 0; i < num; i++) {
        const a = base + spread * (i / (num - 1));
        game.ebullets.push({ x: cx, y: cy, vx: Math.cos(a) * 3.4, vy: Math.sin(a) * 3.4, r: 6, dead: false });
      }
    } else if (pat === 1) {
      const a1 = (bossPattern * 0.5) % (Math.PI * 2);
      game.ebullets.push({ x: cx, y: cy, vx: Math.cos(a1) * 3.2, vy: Math.sin(a1) * 3.2, r: 6, dead: false });
      game.ebullets.push({ x: cx, y: cy, vx: Math.cos(a1 + Math.PI) * 3.2, vy: Math.sin(a1 + Math.PI) * 3.2, r: 6, dead: false });
    } else {
      const ang = Math.atan2(player.y - cy, player.x - cx);
      for (let i = -1; i <= 1; i++) {
        const a = ang + i * 0.18;
        game.ebullets.push({ x: cx, y: cy, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, r: 6, dead: false });
      }
    }
  }
  function onBossKilled(b) {
    for (let i = 0; i < 60; i++) {
      explode(b.x + (Math.random() - 0.5) * b.w, b.y + (Math.random() - 0.5) * b.h, 30 + Math.random() * 30);
    }
    addRing(b.x, b.y, 40, Math.max(W, H) * 0.6);
    addRing(b.x, b.y, 50, Math.max(W, H) * 0.95);
    game.shake = 42;
    game.flash = 1;
    audio.bomb();
    audio.music.setIntensity('playing');
    game.score += 600 + game.wave * 150;
    for (let i = 0; i < 3; i++) dropItem(b.x + (Math.random() - 0.5) * 140, b.y + (Math.random() - 0.5) * 60, true);
    game.boss = null;
  }

  // ---- 触摸板灵敏度 ----
  let sensSpeed = 0.30;
  function applySens(v) {
    const t = (v - 1) / 9;
    sensSpeed = 0.06 + t * (0.55 - 0.06);
    sensValEl.textContent = v;
  }
  sensEl.addEventListener('input', () => applySens(parseInt(sensEl.value, 10)));

  function loseLife(now) {
    if (game.state !== STATE.PLAYING) return;
    game.lives--;
    game.flash = 1;
    audio.hit();
    game.shake = Math.max(game.shake, 14);
    player.invulnUntil = now + 1200;
    if (game.lives <= 0) gameOver();
  }

  function updatePlayer(now, dt) {
    const kx = (input.keys.right ? 1 : 0) - (input.keys.left ? 1 : 0);
    const ky = (input.keys.down ? 1 : 0) - (input.keys.up ? 1 : 0);
    if (kx !== 0 || ky !== 0) {
      player.x += kx * 0.62 * dt;
      player.y += ky * 0.62 * dt;
      input.pointer.x = player.x; input.pointer.y = player.y;
    } else {
      player.x += (input.pointer.x - player.x) * sensSpeed;
      player.y += (input.pointer.y - player.y) * sensSpeed;
    }
    player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
    player.y = Math.max(H * 0.4, Math.min(H - player.h / 2, player.y));
  }

  // ---- 子弹 (火力随 power 升级) ----
  function shoot() {
    game.muzzle = performance.now();
    audio.shoot();
    const bx = player.x, by = player.y - player.h / 2;
    const p = game.power;
    if (p <= 1) {
      game.bullets.push({ x: bx, y: by, vy: -11, r: 4 });
    } else if (p === 2) {
      game.bullets.push({ x: bx - 8, y: by, vy: -11, r: 4 });
      game.bullets.push({ x: bx + 8, y: by, vy: -11, r: 4 });
    } else if (p === 3) {
      game.bullets.push({ x: bx, y: by, vy: -12, r: 4 });
      game.bullets.push({ x: bx - 10, y: by, vy: -9, r: 4, vx: -1.5 });
      game.bullets.push({ x: bx + 10, y: by, vy: -9, r: 4, vx: 1.5 });
    } else if (p === 4) {
      game.bullets.push({ x: bx, y: by, vy: -12, r: 4 });
      game.bullets.push({ x: bx - 9, y: by, vy: -11, r: 4, vx: -1 });
      game.bullets.push({ x: bx + 9, y: by, vy: -11, r: 4, vx: 1 });
      game.bullets.push({ x: bx - 18, y: by, vy: -8, r: 4, vx: -2.5 });
      game.bullets.push({ x: bx + 18, y: by, vy: -8, r: 4, vx: 2.5 });
    } else {
      for (let i = -2; i <= 2; i++) {
        game.bullets.push({ x: bx, y: by, vy: -12, r: 4, vx: i * 1.6 });
      }
    }
  }

  // ---- 敌机生成 ----
  function spawnEnemy() {
    const r = Math.random();
    const v = Math.min(1, game.score / 500 + game.wave * 0.05);
    let type = 'straight';
    if (r < 0.20) type = 'weaver';
    else if (r < 0.25 + 0.25 * v) type = 'shooter';
    else if (r > 0.94 - (game.stage - 1) * 0.02) type = 'elite';
    const baseX = Math.random() * (W - 70) + 35;
    const hpMul = type === 'elite' ? 3 : (type === 'shooter' ? 1.5 : 1);
    const waveHp = 1 + (game.wave - 1) * 0.06;
    const size = type === 'elite' ? 48 : 30;
    const scoreVal = type === 'elite' ? 50 : (type === 'shooter' ? 15 : (type === 'weaver' ? 12 : 10));
    game.enemies.push({
      type, x: baseX, baseX, y: -size,
      w: size, h: size,
      vy: (type === 'elite' ? 0.9 : 1.5 + Math.random() * 1.2) * game.diff.speedMul,
      hp: Math.max(1, Math.round(game.diff.hp * hpMul * waveHp)),
      hue: type === 'elite' ? 45 : (type === 'shooter' ? 18 : 330 + Math.random() * 30),
      score: scoreVal,
      phase: Math.random() * Math.PI * 2,
      fireT: 0,
      flash: 0,
    });
  }

  // ---- M6 道具 ----
  function dropItem(x, y, force) {
    const r = Math.random();
    let type = null;
    if (force) type = r < 0.5 ? 'P' : (r < 0.8 ? 'S' : 'B');
    else if (r < 0.09) type = 'P';
    else if (r < 0.13) type = 'S';
    else if (r < 0.16) type = 'B';
    else if (r < 0.175) type = 'L';
    if (!type) return;
    const hue = type === 'P' ? 200 : (type === 'S' ? 155 : (type === 'B' ? 40 : 0));
    game.items.push({ x, y, vy: 2.2, type, hue, r: 11, dead: false });
  }
  function applyItem(type, now) {
    if (type === 'P') game.power = Math.min(5, game.power + 1);
    else if (type === 'S') player.shieldUntil = now + 8000;
    else if (type === 'B') game.bombs = Math.min(9, game.bombs + 1);
    else if (type === 'L') game.lives = Math.min(9, game.lives + 1);
    explode(player.x, player.y, type === 'L' ? 0 : 200);
    audio.power();
  }
  function onEnemyKilled(en) {
    explode(en.x, en.y, en.hue);
    addRing(en.x, en.y, en.hue, en.w * 1.8);
    audio.explosion();
    game.score += en.score;
    dropItem(en.x, en.y, en.type === 'elite');
  }

  // ---- 炸弹 ----
  function triggerBomb() {
    if (game.bombs <= 0) return;
    game.bombs--;
    game.enemies.forEach(en => { explode(en.x, en.y, en.hue); dropItem(en.x, en.y, false); });
    game.enemies = [];
    game.ebullets = [];
    game.score += 50;
    audio.bomb();
    game.shake = 24;
    addRing(player.x, player.y, 200, Math.max(W, H) * 0.6);
  }

  // ---- 粒子 & 冲击波环 ----
  function explode(x, y, hue) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 5;
      game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue });
    }
    // 白热亮核
    game.particles.push({ x, y, vx: 0, vy: 0, life: 1, hue: 50 });
  }
  function addRing(x, y, hue, maxR) {
    game.rings.push({ x, y, r: 8, maxR, life: 1, hue });
  }

  // ---- 输入回调 (由 core.js 在手势/按键时触发) ----
  DJFE._onPointerDown = () => { if (game.state === STATE.PLAYING) triggerBomb(); };
  DJFE._onEscape = () => {
    if (game.state === STATE.PLAYING) setState(STATE.PAUSED);
    else if (game.state === STATE.PAUSED) setState(STATE.PLAYING);
  };

  // ---- 主循环 ----
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(now - last, 50);
    last = now;
    game.runFrames++;

    if (game.state === STATE.PLAYING) {
      updatePlayer(now, dt);
      if (now - game.lastShot > game.shootInterval) { shoot(); game.lastShot = now; }
      // 引擎尾迹火花
      if (game.runFrames % 2 === 0) {
        game.particles.push({ x: player.x + (Math.random() - 0.5) * 8, y: player.y + player.h * 0.4, vx: (Math.random() - 0.5) * 0.6, vy: 1.4 + Math.random() * 1.2, life: 0.5, hue: 195 });
      }

      // 波次调度
      if (game.betweenWaves) {
        if (now >= game.nextWaveAt) { beginWave(game.wave + 1, now); game.betweenWaves = false; }
      } else {
        if (game.waveRemaining > 0 && now - game.spawnTimer > game.spawnInterval) {
          spawnEnemy(); game.waveRemaining--; game.spawnTimer = now;
        }
        if (game.waveRemaining <= 0 && game.enemies.length === 0) {
          if (game.isBossWave && game.boss) {
            // Boss 未死，等待
          } else {
            game.score += game.wave * 100;
            if (game.isBossWave && game.stage >= STAGES.length) {
              setState(STATE.VICTORY);
            } else {
              game.betweenWaves = true;
              game.nextWaveAt = now + 1500;
            }
          }
        }
      }

      // 玩家子弹
      game.bullets.forEach(b => { b.y += b.vy; if (b.vx) b.x += b.vx; });
      game.bullets = game.bullets.filter(b => b.y > -20 && b.x > -20 && b.x < W + 20);

      // 敌机移动 + 行为
      game.enemies.forEach(en => {
        en.y += en.vy;
        if (en.flash > 0) en.flash = Math.max(0, en.flash - dt * 0.012);
        if (en.type === 'weaver') {
          en.phase += dt * 0.004;
          en.x = en.baseX + Math.sin(en.phase) * 70;
        } else if (en.type === 'shooter') {
          en.fireT += dt;
          if (en.fireT > 1300 && en.y > 0 && en.y < H * 0.7) {
            en.fireT = 0;
            const ang = Math.atan2(player.y - en.y, player.x - en.x);
            game.ebullets.push({ x: en.x, y: en.y + 10, vx: Math.cos(ang) * 4.2, vy: Math.sin(ang) * 4.2, r: 5, dead: false });
          }
        }
      });
      game.enemies = game.enemies.filter(en => {
        if (en.y > H + 40) { loseLife(now); return false; }
        return true;
      });

      // 玩家子弹 vs 敌机
      game.bullets.forEach(b => {
        game.enemies.forEach(en => {
          if (en.hp > 0 && hit(b.x, b.y, b.r, en.x, en.y, en.w * 0.45)) {
            b.y = -999; en.hp--; en.flash = 1;
            if (en.hp <= 0) onEnemyKilled(en);
          }
        });
      });
      game.bullets = game.bullets.filter(b => b.y > -20);
      game.enemies = game.enemies.filter(en => en.hp > 0);

      // 敌弹 vs 玩家
      game.ebullets.forEach(eb => { eb.x += eb.vx; eb.y += eb.vy; });
      game.ebullets.forEach(eb => {
        if (!eb.dead && hit(eb.x, eb.y, eb.r, player.x, player.y, 14)) {
          eb.dead = true; explode(player.x, player.y, 200);
          if (now >= player.invulnUntil && now >= player.shieldUntil) loseLife(now);
        }
      });
      game.ebullets = game.ebullets.filter(eb => !eb.dead && eb.y < H + 20 && eb.x > -20 && eb.x < W + 20);

      // 敌机撞玩家
      game.enemies.forEach(en => {
        if (hit(en.x, en.y, en.w * 0.4, player.x, player.y, 14)) {
          en.hp = 0; explode(en.x, en.y, en.hue);
          if (now >= player.invulnUntil && now >= player.shieldUntil) {
            explode(player.x, player.y, 200); loseLife(now);
          }
        }
      });
      game.enemies = game.enemies.filter(en => en.hp > 0);

      // Boss
      if (game.boss) {
        const b = game.boss;
        if (b.y < b.ty) {
          b.y += 1.4;
        } else {
          b.phase += dt * 0.0016;
          b.x = W / 2 + Math.sin(b.phase) * (W * 0.26);
          b.fireT += dt;
          if (b.fireT > b.fireGap) { b.fireT = 0; bossFire(b); }
        }
        game.bullets.forEach(bu => {
          if (hit(bu.x, bu.y, bu.r, b.x, b.y, b.w * 0.42)) {
            bu.y = -999; b.hp--;
            if (b.hp <= 0) onBossKilled(b);
          }
        });
        game.bullets = game.bullets.filter(bu => bu.y > -20);
        if (now >= player.invulnUntil && now >= player.shieldUntil &&
            hit(b.x, b.y, b.w * 0.38, player.x, player.y, 14)) {
          explode(player.x, player.y, 200); loseLife(now);
        }
      }

      // 道具
      game.items.forEach(it => {
        it.y += it.vy;
        if (!it.dead && hit(it.x, it.y, it.r, player.x, player.y, 16)) {
          it.dead = true; applyItem(it.type, now);
        }
      });
      game.items = game.items.filter(it => !it.dead && it.y < H + 30);

      // 粒子 + 冲击波环 + 屏震衰减
      game.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.life -= 0.04; });
      game.particles = game.particles.filter(p => p.life > 0);
      game.rings.forEach(rg => { rg.r += (rg.maxR - rg.r) * 0.12; rg.life -= 0.04; });
      game.rings = game.rings.filter(rg => rg.life > 0);
      if (game.shake > 0) game.shake *= 0.88;

      if (game.flash > 0) game.flash = Math.max(0, game.flash - 0.04);

      scoreEl.textContent = game.score;
      livesEl.textContent = game.lives;
      bombsEl.textContent = game.bombs;
      waveEl.textContent = game.wave;
      powerEl.textContent = game.power;
      stageEl.textContent = game.stage;
    }

    render(now);
    requestAnimationFrame(loop);
  }

  // ---- 渲染 ----
  function render(now) {
    ctx.save();
    if (game.shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }
    // 当前皮肤（菜单里改了立即生效）
    game.skin = (DJFE.skins ? DJFE.skins.current() : (game.skin || { trail: '#7df9ff' }));
    const stg = STAGES[game.stage - 1] || STAGES[0];
    drawBackground(now);

    // 玩家弹：发光能量束（芯 + 辉光 + 速度拖尾，颜色随皮肤弹道色）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tr = game.skin && game.skin.trail ? game.skin.trail : '#7df9ff';
    game.bullets.forEach(b => {
      const sp = Math.abs(b.vy || 11);
      const len = 9 + sp;
      const grad = ctx.createLinearGradient(b.x, b.y + len, b.x, b.y - len * 0.4);
      grad.addColorStop(0, hexA(tr, 0));
      grad.addColorStop(0.5, hexA(tr, 0.85));
      grad.addColorStop(1, '#eaffff');
      ctx.fillStyle = grad;
      ctx.shadowColor = tr; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(b.x - b.r * 0.7, b.y + len);
      ctx.lineTo(b.x + b.r * 0.7, b.y + len);
      ctx.lineTo(b.x + b.r * 0.4, b.y - len * 0.4);
      ctx.lineTo(b.x - b.r * 0.4, b.y - len * 0.4);
      ctx.closePath(); ctx.fill();
    });
    ctx.restore();

    // 敌弹：高可见度三层（外晕 + 橙红环 + 白热核心）+ 运动拖尾
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    game.ebullets.forEach(eb => {
      const r = eb.r || 6;
      const sp = Math.hypot(eb.vx || 0, eb.vy || 0);
      // 拖尾
      if (sp > 0.5) {
        ctx.strokeStyle = 'rgba(255,120,60,0.35)';
        ctx.lineWidth = r * 0.9;
        ctx.beginPath();
        ctx.moveTo(eb.x, eb.y);
        ctx.lineTo(eb.x - (eb.vx || 0) * 2.4, eb.y - (eb.vy || 0) * 2.4);
        ctx.stroke();
      }
    });
    ctx.restore();
    game.ebullets.forEach(eb => {
      const r = eb.r || 6;
      ctx.save();
      // 外晕
      ctx.shadowColor = '#ff3b2c'; ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(255,90,44,0.30)';
      ctx.beginPath(); ctx.arc(eb.x, eb.y, r + 4, 0, Math.PI * 2); ctx.fill();
      // 橙红主体环
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ff6a2c';
      ctx.beginPath(); ctx.arc(eb.x, eb.y, r, 0, Math.PI * 2); ctx.fill();
      // 白热核心
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff3e8';
      ctx.beginPath(); ctx.arc(eb.x, eb.y, Math.max(2, r * 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    ctx.shadowBlur = 0;

    game.items.forEach(DJFE.draw.item);
    game.enemies.forEach(DJFE.draw.enemy);
    if (game.boss) DJFE.draw.boss(game.boss, now, player);

    const invuln = now < player.invulnUntil;
    const blink = invuln && (Math.floor(now / 100) % 2 === 0);
    if (game.state !== STATE.MENU && !blink) {
      ctx.globalAlpha = invuln ? 0.55 : 1;
      DJFE.draw.player(now, player, game);
      ctx.globalAlpha = 1;
    }

    // 粒子：加法混合 + 辉光 + 运动拖尾
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    game.particles.forEach(p => {
      const a = Math.max(0, p.life);
      ctx.globalAlpha = a;
      const col = `hsl(${p.hue},95%,${55 + 20 * a}%)`;
      const sz = 2 + 4 * a;
      const sp = Math.hypot(p.vx || 0, p.vy || 0);
      if (sp > 2) {
        ctx.strokeStyle = col;
        ctx.lineWidth = sz * 0.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 1.6, p.y - p.vy * 1.6);
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.shadowColor = `hsl(${p.hue},95%,65%)`; ctx.shadowBlur = 10;
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    game.rings.forEach(rg => {
      ctx.strokeStyle = `hsla(${rg.hue},90%,68%,${rg.life * 0.8})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2); ctx.stroke();
    });

    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,40,60,${game.flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (game.state === STATE.PLAYING && now < game.stageBannerUntil) {
      const sa = Math.min(1, (game.stageBannerUntil - now) / 500);
      ctx.save();
      ctx.globalAlpha = sa;
      ctx.textAlign = 'center';
      ctx.fillStyle = stg.accent;
      ctx.font = 'bold 20px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('STAGE ' + game.stage + ' / ' + STAGES.length, W / 2, H * 0.32);
      ctx.font = 'bold 40px -apple-system, "PingFang SC", sans-serif';
      ctx.shadowColor = stg.accent; ctx.shadowBlur = 18;
      ctx.fillText(stg.name, W / 2, H * 0.42);
      ctx.restore();
    }

    if (game.state === STATE.PLAYING && now < game.waveBannerUntil) {
      const a = Math.min(1, (game.waveBannerUntil - now) / 400);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = game.isBossWave ? '#ff6b6b' : '#ffd86b';
      ctx.font = 'bold 46px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = game.isBossWave ? 'rgba(255,80,80,.8)' : 'rgba(255,216,107,.8)';
      ctx.shadowBlur = 18;
      ctx.fillText(game.isBossWave ? 'BOSS 来袭！' : ('第 ' + game.wave + ' 波'), W / 2, H * 0.42);
      ctx.restore();
    }

    if (game.boss) {
      const b = game.boss;
      const bw = Math.min(W * 0.6, 520), bx = (W - bw) / 2, by = 14, bh = 12;
      const r = Math.max(0, b.hp / b.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      ctx.fillStyle = 'rgba(120,20,20,.85)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = r > 0.3 ? '#ff5b5b' : '#ffd24a';
      ctx.fillRect(bx, by, bw * r, bh);
      ctx.fillStyle = '#ffd86b';
      ctx.font = '12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.name || 'BOSS', W / 2, by + bh + 13);
    }

    // 电影感暗角（边缘压暗，中心保持通透，menu 不影响文字）
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.max(W, H) * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  // ---- 暴露给 bootstrap (main.js) ----
  function setMute(btn) {
    btn.addEventListener('click', () => {
      const m = audio.toggleMute();
      btn.textContent = m ? '音效 关' : '音效 开';
    });
  }
  DJFE.Game = {
    init() { applySens(parseInt(sensEl.value, 10)); refreshBestUI(); setState(STATE.MENU); requestAnimationFrame(loop); },
    start() { input.initAudio(); startGame(); },
    setDifficulty(d) { selectedDiff = d; },
    toMenu() { setState(STATE.MENU); },
    resume() { setState(STATE.PLAYING); },
    setMute,
  };

  // 调试句柄（仅供自动化测试 / 控制台使用，不影响玩法）
  DJFE.__debug = {
    get game() { return game; },
    get player() { return player; },
    get STATE() { return STATE; },
  };

})(window.DJFE);
