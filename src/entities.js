/* =====================================================================
 * 打飞机 · Fighter Shooter — entities.js
 * 绘制函数 + 实体工厂：玩家 / 敌机 / Boss / 道具
 * 纯渲染，状态数据由 game.js 传入
 * ===================================================================== */
window.DJFE = window.DJFE || {};
(function (DJFE) {
  'use strict';
  const ctx = DJFE.ctx;

  // ---- 颜色工具 ----
  function hexToRgb2(h) {
    h = (h || '#1fa8e6').replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function mix2(hex, target, amt) {
    const c = hexToRgb2(hex);
    return `rgb(${Math.round(c.r + (target - c.r) * amt)},${Math.round(c.g + (target - c.g) * amt)},${Math.round(c.b + (target - c.b) * amt)})`;
  }
  const lighten = (hex, amt) => mix2(hex, 255, amt);
  const darken = (hex, amt) => mix2(hex, 0, amt);
  function hexA2(hex, a) { const c = hexToRgb2(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }
  function hexPath(c, cx, cy, r) {
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }

  // ---- 玩家战机（按皮肤着色：机身/描边/尾焰/机翼/弹道 + 涂装） ----
  // 复用于游戏内绘制与皮肤编辑器预览
  function paintShip(c, now, px, py, t, hh, skin, opts) {
    opts = opts || {};
    const body = skin.body || '#1fa8e6';
    const accent = skin.accent || '#bff7ff';
    const engine = skin.engine || '#ff8a3c';
    const wing = skin.wing || '#0d5e96';
    const pattern = skin.pattern || 'plain';

    // 护盾：旋转六边形能量罩（用描边色）
    if (opts.shieldUntil && now < opts.shieldUntil) {
      const pulse = 0.55 + 0.45 * Math.sin(now / 110);
      c.save();
      c.translate(px, py);
      c.rotate(now / 600);
      c.strokeStyle = hexA2(accent, 0.45 + 0.35 * pulse);
      c.shadowColor = accent; c.shadowBlur = 16; c.lineWidth = 2.5;
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const rx = Math.cos(a) * t * 0.8, ry = Math.sin(a) * t * 0.8;
        if (i === 0) c.moveTo(rx, ry); else c.lineTo(rx, ry);
      }
      c.closePath(); c.stroke();
      c.restore();
    }

    // 机首火光
    if (opts.muzzle != null && now - opts.muzzle < 60) {
      c.save();
      c.shadowColor = '#bfffff'; c.shadowBlur = 14;
      c.fillStyle = 'rgba(200,255,255,0.95)';
      c.beginPath(); c.arc(px, py - hh * 0.5 - 6, 5, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    c.save();
    c.translate(px, py);

    // 能量翼弧（用描边色，additive 辉光）
    c.save();
    c.globalCompositeOperation = 'lighter';
    const eng = 0.7 + 0.3 * Math.sin(now / 30);
    c.strokeStyle = hexA2(accent, 0.5 * eng);
    c.lineWidth = 3; c.shadowColor = accent; c.shadowBlur = 14;
    c.beginPath();
    c.moveTo(-t * 0.22, hh * 0.05);
    c.quadraticCurveTo(-t * 0.85, hh * 0.2, -t * 0.7, hh * 0.55);
    c.stroke();
    c.beginPath();
    c.moveTo(t * 0.22, hh * 0.05);
    c.quadraticCurveTo(t * 0.85, hh * 0.2, t * 0.7, hh * 0.55);
    c.stroke();
    c.restore();

    // 引擎尾焰（用尾焰色，双层脉动 + 外辉光）
    const flame = 12 + Math.sin(now / 35) * 5;
    const ec = hexToRgb2(engine);
    const fg = c.createLinearGradient(0, hh * 0.30, 0, hh * 0.30 + flame + 14);
    fg.addColorStop(0, `rgba(${ec.r},${ec.g},${ec.b},0.98)`);
    fg.addColorStop(0.5, `rgba(${ec.r},${ec.g},${ec.b},0.5)`);
    fg.addColorStop(1, `rgba(${ec.r},${ec.g},${ec.b},0)`);
    c.fillStyle = fg;
    c.beginPath();
    c.moveTo(-6, hh * 0.38); c.lineTo(0, hh * 0.38 + flame + 14); c.lineTo(6, hh * 0.38);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.moveTo(-2, hh * 0.40); c.lineTo(0, hh * 0.40 + flame * 0.6); c.lineTo(2, hh * 0.40);
    c.closePath(); c.fill();

    // 机翼（用机翼色渐变）
    const wg = c.createLinearGradient(0, hh * 0.02, 0, hh * 0.45);
    wg.addColorStop(0, lighten(wing, 0.25)); wg.addColorStop(1, darken(wing, 0.35));
    c.fillStyle = wg;
    c.beginPath();
    c.moveTo(-t * 0.14, hh * 0.02); c.lineTo(-t * 0.66, hh * 0.46); c.lineTo(-t * 0.16, hh * 0.30);
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(t * 0.14, hh * 0.02); c.lineTo(t * 0.66, hh * 0.46); c.lineTo(t * 0.16, hh * 0.30);
    c.closePath(); c.fill();

    // 机身（主体机身色渐变 + 顶部描边高光）
    c.shadowColor = body; c.shadowBlur = 14;
    const bg = c.createLinearGradient(0, -hh * 0.5, 0, hh * 0.5);
    bg.addColorStop(0, lighten(accent, 0.1));
    bg.addColorStop(0.45, body);
    bg.addColorStop(1, darken(body, 0.4));
    c.fillStyle = bg;
    c.beginPath();
    c.moveTo(0, -hh * 0.5);
    c.lineTo(-t * 0.22, hh * 0.16);
    c.lineTo(-t * 0.10, hh * 0.34);
    c.lineTo(0, hh * 0.22);
    c.lineTo(t * 0.10, hh * 0.34);
    c.lineTo(t * 0.22, hh * 0.16);
    c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = accent; c.lineWidth = 1.5; c.stroke();

    // 涂装（裁剪到机身内）
    if (pattern !== 'plain') {
      c.save();
      c.beginPath();
      c.moveTo(0, -hh * 0.5);
      c.lineTo(-t * 0.22, hh * 0.16);
      c.lineTo(-t * 0.10, hh * 0.34);
      c.lineTo(0, hh * 0.22);
      c.lineTo(t * 0.10, hh * 0.34);
      c.lineTo(t * 0.22, hh * 0.16);
      c.closePath(); c.clip();
      c.globalCompositeOperation = 'overlay';
      if (pattern === 'stripe') {
        c.strokeStyle = accent; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(0, -hh * 0.5); c.lineTo(0, hh * 0.34); c.stroke();
        c.beginPath(); c.moveTo(-t * 0.11, -hh * 0.5); c.lineTo(-t * 0.11, hh * 0.34); c.stroke();
        c.beginPath(); c.moveTo(t * 0.11, -hh * 0.5); c.lineTo(t * 0.11, hh * 0.34); c.stroke();
      } else if (pattern === 'hex') {
        c.strokeStyle = hexA2(accent, 0.7); c.lineWidth = 1.4;
        const r = 4.5;
        for (let gy = -hh; gy < hh; gy += r * 1.7) {
          const off = (Math.floor(gy / r) % 2) * r * 0.9;
          for (let gx = -t; gx < t; gx += r * 1.9) hexPath(c, gx + off, gy, r);
        }
        c.stroke();
      } else if (pattern === 'carbon') {
        c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1.6;
        for (let gy = -hh; gy < hh; gy += 6) {
          c.beginPath(); c.moveTo(-t, gy); c.lineTo(t, gy - 8); c.stroke();
        }
      }
      c.restore();
    }

    // 座舱（玻璃高光，深色取机身暗部）
    const cg = c.createRadialGradient(-2, -hh * 0.18, 1, 0, -hh * 0.10, 9);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(1, darken(body, 0.5));
    c.fillStyle = cg;
    c.beginPath();
    c.ellipse(0, -hh * 0.10, 5.2, 9, 0, 0, Math.PI * 2);
    c.fill();

    // 翼尖灯（用描边色）
    c.fillStyle = accent;
    c.beginPath(); c.arc(-t * 0.62, hh * 0.42, 2.2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(t * 0.62, hh * 0.42, 2.2, 0, Math.PI * 2); c.fill();

    // ---- 火力等级变形（power 1-5 分层加装） ----
    const pw = opts.power || 1;
    if (pw >= 2) {
      // 翼下炮舱（两侧小舱体 + 发光炮口）
      c.fillStyle = darken(wing, 0.15);
      [-1, 1].forEach((sx) => {
        c.beginPath();
        c.moveTo(sx * t * 0.30, hh * 0.10);
        c.lineTo(sx * t * 0.42, hh * 0.18);
        c.lineTo(sx * t * 0.40, hh * 0.34);
        c.lineTo(sx * t * 0.28, hh * 0.28);
        c.closePath(); c.fill();
        c.fillStyle = accent;
        c.shadowColor = accent; c.shadowBlur = 8;
        c.beginPath(); c.arc(sx * t * 0.35, hh * 0.33, 2.4, 0, Math.PI * 2); c.fill();
        c.shadowBlur = 0;
        c.fillStyle = darken(wing, 0.15);
      });
    }
    if (pw >= 3) {
      // 中层副翼（后掠小翼，描边发光）
      c.save();
      c.strokeStyle = hexA2(accent, 0.9); c.lineWidth = 1.6;
      c.shadowColor = accent; c.shadowBlur = 10;
      const sg = c.createLinearGradient(0, -hh * 0.1, 0, hh * 0.25);
      sg.addColorStop(0, lighten(wing, 0.4)); sg.addColorStop(1, darken(wing, 0.2));
      c.fillStyle = sg;
      [-1, 1].forEach((sx) => {
        c.beginPath();
        c.moveTo(sx * t * 0.16, -hh * 0.12);
        c.lineTo(sx * t * 0.55, hh * 0.10);
        c.lineTo(sx * t * 0.20, hh * 0.14);
        c.closePath(); c.fill(); c.stroke();
      });
      c.restore();
    }
    if (pw >= 4) {
      // 浮游炮 ×2（环绕机身公转的发光菱形体）
      const orbA = now / 480;
      [-1, 1].forEach((sx) => {
        const ox = Math.cos(orbA + (sx > 0 ? 0 : Math.PI)) * t * 0.95;
        const oy = Math.sin(orbA + (sx > 0 ? 0 : Math.PI)) * hh * 0.28 - hh * 0.05;
        c.save();
        c.translate(ox, oy); c.rotate(now / 300);
        c.fillStyle = accent; c.shadowColor = accent; c.shadowBlur = 14;
        c.beginPath();
        c.moveTo(0, -6); c.lineTo(4.5, 0); c.lineTo(0, 6); c.lineTo(-4.5, 0);
        c.closePath(); c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(0, 0, 1.8, 0, Math.PI * 2); c.fill();
        c.restore();
      });
    }
    if (pw >= 5) {
      // 全展开：机首上方旋转能量光环
      c.save();
      c.translate(0, -hh * 0.18);
      c.rotate(now / 700);
      c.strokeStyle = hexA2(accent, 0.75); c.lineWidth = 2;
      c.shadowColor = accent; c.shadowBlur = 12;
      c.setLineDash([10, 7]);
      c.beginPath(); c.arc(0, 0, t * 0.52, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.restore();
    }

    c.restore();
  }

  function drawPlayer(now, player, game) {
    let sk = (game && game.skin) || (DJFE.skins && DJFE.skins.current());
    if (!sk) sk = { body: '#1fa8e6', accent: '#bff7ff', engine: '#ff8a3c', wing: '#0d5e96', trail: '#7df9ff', pattern: 'plain' };
    paintShip(ctx, now, player.x, player.y, player.w, player.h, sk, { shieldUntil: player.shieldUntil, muzzle: game && game.muzzle, power: game && game.power });
  }

  // ---- 敌机（四种独立造型） ----
  function drawEnemy(en) {
    const s = en.w;
    ctx.save();
    ctx.translate(en.x, en.y);
    const col = `hsl(${en.hue},85%,62%)`;
    const lite = `hsl(${en.hue},90%,78%)`;
    const dark = `hsl(${en.hue},80%,38%)`;

    if (en.type === 'weaver') {
      // 黄蜂：锐利菱形 + 后掠翼 + 尾刺
      ctx.shadowColor = col; ctx.shadowBlur = 10;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.55);
      ctx.lineTo(s * 0.42, -s * 0.05);
      ctx.lineTo(s * 0.18, s * 0.5);
      ctx.lineTo(-s * 0.18, s * 0.5);
      ctx.lineTo(-s * 0.42, -s * 0.05);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(0, -s * 0.1); ctx.lineTo(s * 0.10, s * 0.5); ctx.lineTo(-s * 0.10, s * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.12, 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'elite') {
      // 重装六边形：装甲板 + 旋转内核 + 尖刺
      const rot = (en.phase || 0) * 0.6;
      ctx.save(); ctx.rotate(rot * 0.3);
      ctx.shadowColor = col; ctx.shadowBlur = 16;
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const px = Math.cos(a) * s * 0.5, py = Math.sin(a) * s * 0.5;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // 内甲
      ctx.fillStyle = dark;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const px = Math.cos(a) * s * 0.32, py = Math.sin(a) * s * 0.32;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // 核心（脉动）
      const cp = 0.6 + 0.4 * Math.sin((en.phase || 0) * 3);
      ctx.fillStyle = `hsl(${en.hue},95%,${60 + 20 * cp}%)`;
      ctx.shadowColor = lite; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.16 * (0.8 + 0.3 * cp), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (en.type === 'spinner') {
      // 回旋机：三叶螺旋桨（旋转）+ 中心能量核
      const rot = (en.phase || 0) * 2.2;
      ctx.save(); ctx.rotate(rot);
      ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.fillStyle = col;
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(i * Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.08);
        ctx.lineTo(s * 0.16, -s * 0.42);
        ctx.lineTo(0, -s * 0.55);
        ctx.lineTo(-s * 0.16, -s * 0.42);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.shadowBlur = 0;
      ctx.restore();
      const cp = 0.6 + 0.4 * Math.sin((en.phase || 0) * 5);
      ctx.fillStyle = lite;
      ctx.shadowColor = lite; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 0, s * (0.14 + 0.04 * cp), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (en.type === 'diver') {
      // 俯冲机：尖锐箭头；锁定时机身闪白
      const locking = en.lockT > 0;
      ctx.shadowColor = locking ? '#ffffff' : col; ctx.shadowBlur = locking ? 18 : 10;
      ctx.fillStyle = locking && Math.floor((en.phase || 0) * 20) % 2 === 0 ? '#ffffff' : col;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.6);                     // 向下尖头（俯冲朝向）
      ctx.lineTo(s * 0.34, -s * 0.1);
      ctx.lineTo(s * 0.14, -s * 0.5);
      ctx.lineTo(-s * 0.14, -s * 0.5);
      ctx.lineTo(-s * 0.34, -s * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // 红色复眼
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath(); ctx.arc(-s * 0.08, -s * 0.18, s * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.08, -s * 0.18, s * 0.05, 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'sniper') {
      // 狙击机：细长机身 + 超长炮管 + 瞄准镜光点
      ctx.shadowColor = col; ctx.shadowBlur = 10;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.55);
      ctx.lineTo(s * 0.18, -s * 0.2);
      ctx.lineTo(s * 0.14, s * 0.4);
      ctx.lineTo(-s * 0.14, s * 0.4);
      ctx.lineTo(-s * 0.18, -s * 0.2);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // 长炮管（朝下）
      ctx.fillStyle = dark;
      ctx.fillRect(-s * 0.045, s * 0.3, s * 0.09, s * 0.5);
      // 瞄准镜（红光脉动）
      const sp = 0.5 + 0.5 * Math.sin((en.phase || 0) * 6);
      ctx.fillStyle = `rgba(255,80,80,${0.5 + 0.5 * sp})`;
      ctx.shadowColor = '#ff5050'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (en.type === 'splitter') {
      // 分裂母体：大圆胞 + 内部 3 个子体脉动
      ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2); ctx.fill();
      // 3 个子体（在母体内缓慢公转）
      const rot = (en.phase || 0) * 1.5;
      for (let i = 0; i < 3; i++) {
        const a = rot + i * Math.PI * 2 / 3;
        const ox = Math.cos(a) * s * 0.2, oy = Math.sin(a) * s * 0.2;
        const pp = 0.7 + 0.3 * Math.sin((en.phase || 0) * 4 + i);
        ctx.fillStyle = lite;
        ctx.beginPath(); ctx.arc(ox, oy, s * 0.09 * pp, 0, Math.PI * 2); ctx.fill();
      }
    } else if (en.type === 'shooter') {
      // 炮手：宽体 + 双管 + 中央核心
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.lineTo(s * 0.5, -s * 0.2);
      ctx.lineTo(s * 0.5, s * 0.45);
      ctx.lineTo(-s * 0.5, s * 0.45);
      ctx.lineTo(-s * 0.5, -s * 0.2);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // 双炮管
      ctx.fillStyle = dark;
      ctx.fillRect(-s * 0.34, s * 0.30, s * 0.14, s * 0.3);
      ctx.fillRect(s * 0.20, s * 0.30, s * 0.14, s * 0.3);
      // 核心
      ctx.fillStyle = '#fff3c4';
      ctx.shadowColor = '#ffd86b'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(0, -s * 0.02, s * 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      // 直冲无人机：圆润机体 + 双引擎 + 红眼
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5);
      ctx.lineTo(s * 0.42, -s * 0.28);
      ctx.lineTo(s * 0.30, s * 0.5);
      ctx.lineTo(-s * 0.30, s * 0.5);
      ctx.lineTo(-s * 0.42, -s * 0.28);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      // 引擎辉光
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(-s * 0.18, s * 0.42, s * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.18, s * 0.42, s * 0.10, 0, Math.PI * 2); ctx.fill();
      // 红眼
      ctx.fillStyle = '#ff5b6e';
      ctx.shadowColor = '#ff5b6e'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(0, -s * 0.04, s * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (en.flash > 0) {
      ctx.globalAlpha = en.flash;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---- 道具（外光晕 + 发光菱形 + 旋转环 + 字母） ----
  function drawItem(it) {
    ctx.save();
    ctx.translate(it.x, it.y);
    const col = `hsl(${it.hue},85%,62%)`;
    const rot = (it.x + it.y) * 0.02 + Date.now() * 0.003;
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
    // 外光晕
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = col; ctx.shadowBlur = 18 * pulse;
    ctx.fillStyle = `hsla(${it.hue},90%,60%,0.22)`;
    ctx.beginPath(); ctx.arc(0, 0, it.r + 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.rotate(rot);
    ctx.shadowColor = col; ctx.shadowBlur = 14;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -it.r); ctx.lineTo(it.r, 0); ctx.lineTo(0, it.r); ctx.lineTo(-it.r, 0);
    ctx.closePath(); ctx.fill();
    ctx.rotate(-rot);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#04121f';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(it.type, 0, 1);
    ctx.restore();
  }

  // ---- Boss（战舰造型：旋转能量冠 + 装甲舰体 + 双翼炮塔 + 脉动用核心 + 追踪眼，按关卡色相） ----
  function drawBoss(b, now, player) {
    const s = b.w;
    ctx.save();
    ctx.translate(b.x, b.y);
    const r = Math.max(0, b.hp / b.maxHp);
    const bh = (b.hue != null) ? b.hue : 10;
    const col = `hsl(${bh},85%,60%)`;
    const lite = `hsl(${bh},90%,72%)`;
    const dark = `hsl(${bh},80%,30%)`;

    // 旋转能量冠（虚线环）
    ctx.save();
    ctx.rotate((now || 0) / 1400);
    ctx.strokeStyle = `hsla(${bh},90%,75%,0.5)`;
    ctx.shadowColor = `hsl(${bh},90%,60%)`; ctx.shadowBlur = 12;
    ctx.lineWidth = 3; ctx.setLineDash([10, 14]);
    ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * 0.62, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 外翼
    ctx.fillStyle = dark;
    [[-1, 1], [1, 1]].forEach(([sx]) => {
      ctx.beginPath();
      ctx.moveTo(sx * s * 0.30, -b.h * 0.1);
      ctx.lineTo(sx * s * 0.52, -b.h * 0.30);
      ctx.lineTo(sx * s * 0.52, b.h * 0.45);
      ctx.lineTo(sx * s * 0.28, b.h * 0.18);
      ctx.closePath(); ctx.fill();
    });
    // 舰体
    ctx.shadowColor = `hsla(${bh},90%,60%,.7)`; ctx.shadowBlur = 20;
    const g = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
    g.addColorStop(0, lite); g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -b.h * 0.5);
    ctx.lineTo(s * 0.30, -b.h * 0.12);
    ctx.lineTo(s * 0.26, b.h * 0.5);
    ctx.lineTo(-s * 0.26, b.h * 0.5);
    ctx.lineTo(-s * 0.30, -b.h * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;

    // 双翼炮塔
    ctx.fillStyle = `hsl(${bh},80%,48%)`;
    [-1, 1].forEach((sx) => {
      ctx.beginPath();
      ctx.arc(sx * s * 0.40, b.h * 0.10, s * 0.07, 0, Math.PI * 2); ctx.fill();
    });

    // 顶部传感器
    ctx.fillStyle = dark;
    ctx.fillRect(-s * 0.06, -b.h * 0.62, s * 0.12, b.h * 0.14);

    // 充能预告（即将开火时核心变亮）
    const charge = Math.max(0, Math.min(1, (b.fireT || 0) / (b.fireGap || 1)));
    const chargeGlow = charge > 0.8 ? (charge - 0.8) / 0.2 : 0;

    // 核心（脉动，亮度随血量 + 充能）
    const pulse = 0.6 + 0.4 * Math.sin((now || 0) / 180);
    const coreL = 48 + 22 * r * pulse + 30 * chargeGlow;
    const core = `hsl(${bh},95%,${coreL}%)`;
    ctx.fillStyle = core;
    ctx.shadowColor = core; ctx.shadowBlur = 18 + 10 * pulse + 20 * chargeGlow;
    ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * (0.13 + 0.03 * pulse + 0.05 * chargeGlow), 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // 核心散热纹
    ctx.strokeStyle = `hsla(${bh},90%,85%,${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * 0.20, 0, Math.PI * 2); ctx.stroke();

    // 追踪眼（朝向玩家）
    if (player) {
      const ea = Math.atan2(player.y - b.y, player.x - b.x);
      const ex = Math.cos(ea) * s * 0.30, ey = Math.sin(ea) * s * 0.12 - b.h * 0.02;
      ctx.fillStyle = `hsla(${bh},100%,85%,0.9)`;
      ctx.shadowColor = core; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(ex, ey, s * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  DJFE.draw = { player: drawPlayer, enemy: drawEnemy, item: drawItem, boss: drawBoss, paintShip };

})(window.DJFE);
