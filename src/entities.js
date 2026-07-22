/* =====================================================================
 * 打飞机 · Fighter Shooter — entities.js
 * 绘制函数 + 实体工厂：玩家 / 敌机 / Boss / 道具
 * 纯渲染，状态数据由 game.js 传入
 * ===================================================================== */
window.DJFE = window.DJFE || {};
(function (DJFE) {
  'use strict';
  const ctx = DJFE.ctx;

  // ---- 玩家战机（流光机身 + 座舱 + 翼尖灯 + 引擎辉光） ----
  function drawPlayer(now, player, game) {
    const px = player.x, py = player.y;
    const t = player.w, hh = player.h;

    // 护盾环
    if (now < player.shieldUntil) {
      const pulse = 0.55 + 0.45 * Math.sin(now / 110);
      ctx.strokeStyle = `rgba(120,255,200,${0.4 + 0.35 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, t * 0.78, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 机首火光
    if (now - game.muzzle < 60) {
      ctx.save();
      ctx.shadowColor = '#bfffff'; ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(200,255,255,0.95)';
      ctx.beginPath(); ctx.arc(px, py - hh * 0.5 - 6, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(px, py);

    // 引擎尾焰（双层脉动）
    const flame = 12 + Math.sin(now / 35) * 5;
    const fg = ctx.createLinearGradient(0, hh * 0.30, 0, hh * 0.30 + flame + 14);
    fg.addColorStop(0, 'rgba(190,240,255,0.98)');
    fg.addColorStop(0.5, 'rgba(90,180,255,0.6)');
    fg.addColorStop(1, 'rgba(60,140,255,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-6, hh * 0.38); ctx.lineTo(0, hh * 0.38 + flame + 14); ctx.lineTo(6, hh * 0.38);
    ctx.closePath(); ctx.fill();
    // 内核
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(-2, hh * 0.40); ctx.lineTo(0, hh * 0.40 + flame * 0.6); ctx.lineTo(2, hh * 0.40);
    ctx.closePath(); ctx.fill();

    // 机翼（带翼尖上扬）
    const wing = ctx.createLinearGradient(0, hh * 0.02, 0, hh * 0.45);
    wing.addColorStop(0, '#2aa7e6'); wing.addColorStop(1, '#0d5e96');
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(-t * 0.14, hh * 0.02); ctx.lineTo(-t * 0.66, hh * 0.46); ctx.lineTo(-t * 0.16, hh * 0.30);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(t * 0.14, hh * 0.02); ctx.lineTo(t * 0.66, hh * 0.46); ctx.lineTo(t * 0.16, hh * 0.30);
    ctx.closePath(); ctx.fill();

    // 机身（渐变 + 发光描边）
    ctx.shadowColor = '#36e0ff'; ctx.shadowBlur = 14;
    const g = ctx.createLinearGradient(0, -hh * 0.5, 0, hh * 0.5);
    g.addColorStop(0, '#f2ffff');
    g.addColorStop(0.45, '#46e6ff');
    g.addColorStop(1, '#1c7fc4');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -hh * 0.5);
    ctx.lineTo(-t * 0.22, hh * 0.16);
    ctx.lineTo(-t * 0.10, hh * 0.34);
    ctx.lineTo(0, hh * 0.22);
    ctx.lineTo(t * 0.10, hh * 0.34);
    ctx.lineTo(t * 0.22, hh * 0.16);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(220,250,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 座舱（玻璃高光）
    const cg = ctx.createRadialGradient(-2, -hh * 0.18, 1, 0, -hh * 0.10, 9);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(1, '#0a4a7a');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(0, -hh * 0.10, 5.2, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // 翼尖灯
    ctx.fillStyle = '#ff5b6e';
    ctx.beginPath(); ctx.arc(-t * 0.62, hh * 0.42, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(t * 0.62, hh * 0.42, 2.2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
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

  // ---- 道具（发光菱形 + 旋转环 + 字母） ----
  function drawItem(it) {
    ctx.save();
    ctx.translate(it.x, it.y);
    const col = `hsl(${it.hue},85%,62%)`;
    const rot = (it.x + it.y) * 0.02 + Date.now() * 0.003;
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

  // ---- Boss（战舰造型：装甲舰体 + 双翼炮塔 + 脉动核心，按关卡色相） ----
  function drawBoss(b, now) {
    const s = b.w;
    ctx.save();
    ctx.translate(b.x, b.y);
    const r = Math.max(0, b.hp / b.maxHp);
    const bh = (b.hue != null) ? b.hue : 10;
    const col = `hsl(${bh},85%,60%)`;
    const lite = `hsl(${bh},90%,72%)`;
    const dark = `hsl(${bh},80%,30%)`;

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

    // 核心（脉动，亮度随血量）
    const pulse = 0.6 + 0.4 * Math.sin((now || 0) / 180);
    const core = `hsl(${bh},95%,${48 + 22 * r * pulse}%)`;
    ctx.fillStyle = core;
    ctx.shadowColor = core; ctx.shadowBlur = 18 + 10 * pulse;
    ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * (0.13 + 0.03 * pulse), 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // 核心散热纹
    ctx.strokeStyle = `hsla(${bh},90%,85%,${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * 0.20, 0, Math.PI * 2); ctx.stroke();

    ctx.restore();
  }

  DJFE.draw = { player: drawPlayer, enemy: drawEnemy, item: drawItem, boss: drawBoss };

})(window.DJFE);
