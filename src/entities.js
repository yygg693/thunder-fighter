/* =====================================================================
 * 打飞机 · Fighter Shooter — entities.js
 * 绘制函数 + 实体工厂：玩家 / 敌机 / Boss / 道具
 * 纯渲染，状态数据由 game.js 传入
 * ===================================================================== */
window.DJFE = window.DJFE || {};
(function (DJFE) {
  'use strict';
  const ctx = DJFE.ctx;

  // ---- 玩家战机 ----
  function drawPlayer(now, player, game) {
    const px = player.x, py = player.y;
    const t = player.w, hh = player.h;

    // 护盾环
    if (now < player.shieldUntil) {
      const pulse = 0.55 + 0.45 * Math.sin(now / 110);
      ctx.strokeStyle = `rgba(120,255,200,${0.4 + 0.35 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, t * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 机首火光
    if (now - game.muzzle < 50) {
      ctx.fillStyle = 'rgba(190,255,255,0.9)';
      ctx.beginPath(); ctx.arc(0, -hh * 0.5 - 5, 5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.save();
    ctx.translate(px, py);

    // 引擎尾焰 (脉动)
    const flame = 10 + Math.sin(now / 40) * 4;
    const fg = ctx.createLinearGradient(0, hh * 0.35, 0, hh * 0.35 + flame + 10);
    fg.addColorStop(0, 'rgba(180,230,255,0.95)');
    fg.addColorStop(1, 'rgba(80,160,255,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-7, hh * 0.40); ctx.lineTo(0, hh * 0.40 + flame + 10); ctx.lineTo(7, hh * 0.40);
    ctx.closePath(); ctx.fill();

    // 机翼
    ctx.fillStyle = '#1f8fd0';
    ctx.beginPath();
    ctx.moveTo(-t * 0.16, hh * 0.02); ctx.lineTo(-t * 0.62, hh * 0.42); ctx.lineTo(-t * 0.16, hh * 0.28); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(t * 0.16, hh * 0.02); ctx.lineTo(t * 0.62, hh * 0.42); ctx.lineTo(t * 0.16, hh * 0.28); ctx.closePath(); ctx.fill();

    // 机身 (渐变 + 发光)
    ctx.shadowColor = '#36e0ff';
    ctx.shadowBlur = 12;
    const g = ctx.createLinearGradient(0, -hh * 0.5, 0, hh * 0.5);
    g.addColorStop(0, '#e6ffff');
    g.addColorStop(0.45, '#36e0ff');
    g.addColorStop(1, '#1f7fbf');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -hh * 0.5);
    ctx.lineTo(-t * 0.22, hh * 0.18);
    ctx.lineTo(-t * 0.10, hh * 0.32);
    ctx.lineTo(0, hh * 0.22);
    ctx.lineTo(t * 0.10, hh * 0.32);
    ctx.lineTo(t * 0.22, hh * 0.18);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(200,248,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 座舱
    const cg = ctx.createRadialGradient(-2, -hh * 0.18, 1, 0, -hh * 0.10, 9);
    cg.addColorStop(0, '#f2ffff');
    cg.addColorStop(1, '#0a4a7a');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(0, -hh * 0.10, 5.5, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // 翼尖灯
    ctx.fillStyle = '#ff5b6e';
    ctx.beginPath(); ctx.arc(-t * 0.60, hh * 0.40, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(t * 0.60, hh * 0.40, 2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  // ---- 敌机 ----
  function drawEnemy(en) {
    const s = en.w;
    ctx.save();
    ctx.translate(en.x, en.y);
    const col = `hsl(${en.hue},85%,60%)`;
    const dark = `hsl(${en.hue},85%,42%)`;
    if (en.type === 'weaver') {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.5, 0); ctx.lineTo(0, s * 0.5); ctx.lineTo(-s * 0.5, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'elite') {
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 14;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const px = Math.cos(a) * s * 0.5, py = Math.sin(a) * s * 0.5;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.5);
      ctx.lineTo(-s * 0.5, -s * 0.5);
      ctx.lineTo(-s * 0.18, -s * 0.35);
      ctx.lineTo(s * 0.18, -s * 0.35);
      ctx.lineTo(s * 0.5, -s * 0.5);
      ctx.closePath(); ctx.fill();
      if (en.type === 'shooter') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(-2, -s * 0.1, 4, 8);
      }
    }
    if (en.flash > 0) {
      ctx.globalAlpha = en.flash;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---- 道具 ----
  function drawItem(it) {
    ctx.save();
    ctx.translate(it.x, it.y);
    const col = `hsl(${it.hue},85%,60%)`;
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, it.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#04121f';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(it.type, 0, 1);
    ctx.restore();
  }

  // ---- Boss ----
  function drawBoss(b) {
    const s = b.w;
    ctx.save();
    ctx.translate(b.x, b.y);
    const r = Math.max(0, b.hp / b.maxHp);
    ctx.shadowColor = 'rgba(255,60,60,.7)'; ctx.shadowBlur = 18;
    const g = ctx.createLinearGradient(0, -b.h / 2, 0, b.h / 2);
    g.addColorStop(0, '#ff8a5c'); g.addColorStop(1, '#8c1414');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -b.h * 0.5);
    ctx.lineTo(s * 0.5, -b.h * 0.1);
    ctx.lineTo(s * 0.42, b.h * 0.5);
    ctx.lineTo(-s * 0.42, b.h * 0.5);
    ctx.lineTo(-s * 0.5, -b.h * 0.1);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3a0d0d';
    ctx.fillRect(-s * 0.52, -b.h * 0.3, s * 0.16, b.h * 0.5);
    ctx.fillRect(s * 0.36, -b.h * 0.3, s * 0.16, b.h * 0.5);
    const core = `hsl(${r * 30}, 90%, ${50 + 20 * r}%)`;
    ctx.fillStyle = core;
    ctx.shadowColor = core; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(0, -b.h * 0.05, s * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  DJFE.draw = { player: drawPlayer, enemy: drawEnemy, item: drawItem, boss: drawBoss };

})(window.DJFE);
