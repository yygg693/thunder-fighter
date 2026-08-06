/* =====================================================================
 * 打飞机 · Fighter Shooter — entities.js
 * 绘制函数 + 实体工厂：玩家 / 敌机 / Boss / 道具
 * 纯渲染，状态数据由 game.js 传入
 * ===================================================================== */
window.DJFE = window.DJFE || {};
(function (DJFE) {
  'use strict';
  const ctx = DJFE.ctx;
  // 预渲染辉光图集（见 core.js）：全面取代实时 ctx.shadowBlur
  const fx = DJFE.fx;
  const glow = fx.glow, glowLine = fx.glowLine, glowHue = fx.glowHue;

  // ---- 颜色工具 ----
  function hexToRgb2(h) {
    h = (h || '#3d8ba3').replace('#', '');
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

  // ---- 精灵贴图辅助 -----------------------------------------------------
  // 调用前坐标系应已 translate 到实体中心。name=精灵键；fitW/fitH=适配盒子
  // （保留精灵原始长宽比、居中铺入）；hue=若提供，则按 (目标色相 - 精灵基准色相)
  // 做 hue-rotate，使敌机 / Boss 随关卡变色。返回 true=已绘制，false=精灵未就绪
  // （调用方应走程序化降级）。所有绘制参数均做有限性兜底，绝不向 ctx 喂 NaN。
  //
  // 立体感（治「没立体感」）：首次绘制某精灵时，在离屏画布上烘焙「顶光 + 底影 +
  // 高光点」三层明暗（source-atop 只作用于机体像素、绝不污染背景），之后每帧只
  // drawImage 一次 —— 零实时模糊、零每帧重算。白高光 / 黑暗部经 hue-rotate 不变色，
  // 故随关卡变色后立体关系依然成立。无头环境（img.width=0）或失败则退回原图。
  const spriteDepthCache = new Map();
  function buildDepthSprite(name) {
    const img = DJFE.sprites.get(name);
    const d = DJFE.sprites.dim(name) || { w: 128, h: 128 };
    if (!img || !img.width || !img.height) return null;          // 无头桩 / 未就绪
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const cv = document.createElement('canvas');
      cv.width = d.w; cv.height = d.h;
      const c = cv.getContext('2d');
      if (!c) return null;
      c.drawImage(img, 0, 0, d.w, d.h);
      // 顶-左 主光：体积感核心，机首 / 上缘被照亮
      c.save();
      c.globalCompositeOperation = 'source-atop';
      const g = c.createLinearGradient(0, 0, d.w * 0.75, d.h * 0.95);
      g.addColorStop(0, 'rgba(255,255,255,0.40)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, d.w, d.h);
      c.restore();
      // 底-右 暗部：核心阴影，把扁平机体压出圆柱体积
      c.save();
      c.globalCompositeOperation = 'source-atop';
      const g2 = c.createLinearGradient(d.w, d.h, d.w * 0.30, d.h * 0.18);
      g2.addColorStop(0, 'rgba(0,0,0,0.42)');
      g2.addColorStop(0.55, 'rgba(0,0,0,0.12)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g2; c.fillRect(0, 0, d.w, d.h);
      c.restore();
      // 高光点（specular）：机首 / 座舱处一小团反射，让金属 / 玻璃有"反光"
      c.save();
      c.globalCompositeOperation = 'source-atop';
      const r = Math.max(d.w, d.h) * 0.34;
      const rg = c.createRadialGradient(d.w * 0.40, d.h * 0.26, 0, d.w * 0.40, d.h * 0.26, r);
      rg.addColorStop(0, 'rgba(255,255,255,0.55)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg; c.fillRect(0, 0, d.w, d.h);
      c.restore();
      return cv;
    } catch (e) { return null; }
  }
  function drawSprite(name, fitW, fitH, hue) {
    const sp = DJFE.sprites.get(name);
    if (!sp || !DJFE.sprites.isReady()) return false;
    const d = DJFE.sprites.dim(name) || { w: 128, h: 128 };
    const scale = Math.min(fitW / d.w, fitH / d.h);
    const w = d.w * scale, h = d.h * scale;
    if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return false;
    const prevFilter = ctx.filter;
    if (hue != null) {
      const base = DJFE.sprites.baseHue(name);
      if (base != null) {
        let delta = (hue - base) % 360;
        if (delta > 180) delta -= 360; else if (delta < -180) delta += 360;
        if (delta) ctx.filter = 'hue-rotate(' + delta.toFixed(1) + 'deg)';
      }
    }
    // 立体离屏精灵：首次使用时烘焙；undefined→未构建，null→无头/失败退回原图
    let tex = spriteDepthCache.get(name);
    if (tex === undefined) { tex = buildDepthSprite(name); spriteDepthCache.set(name, tex); }
    try { ctx.drawImage(tex || sp, -w / 2, -h / 2, w, h); } catch (e) {}
    ctx.filter = prevFilter || 'none';
    return true;
  }

  // 散射枪紫环专用色：提到模块级常量，保证 glowSlot 只烘一张图（同一 key 命中缓存）
  const SPREAD_COL = '#b46cff';

  /* 陨石顶点表（单位化，乘 s 使用）：11 个不规则顶点，凸凹交替。
   * 写死而非随机生成 —— 渲染层零 RNG 是 S16 的硬约束，且常量表每帧零分配。 */
  const ROCK_PTS = [
    [0.00, -0.48], [0.26, -0.38], [0.44, -0.14], [0.40, 0.14], [0.24, 0.40],
    [0.02, 0.48], [-0.20, 0.42], [-0.38, 0.22], [-0.46, -0.04], [-0.34, -0.30],
    [-0.14, -0.44],
  ];

  // ---- 玩家战机（按皮肤着色：机身/描边/尾焰/机翼/弹道 + 涂装） ----
  // ---- 2b · 非 cyan 皮肤的 2D 剪影辅助 ---------------------------------
  // 几何上不同的机型：机身轮廓（body 色）与机翼/横向结构（wing 色）。
  // 全部写死坐标、零 RNG（S16 硬约束），与 render3d.js 的 3D 造型同调。
  // 仅发出机身轮廓路径（moveTo/lineTo），beginPath/closePath 由调用方包裹。
  function hullOutline(c, sid, t, hh) {
    switch (sid) {
      case 'crimson_falcon':
        c.moveTo(0, -hh * 0.52); c.lineTo(-t * 0.20, -hh * 0.10);
        c.lineTo(-t * 0.22, hh * 0.30); c.lineTo(0, hh * 0.34);
        c.lineTo(t * 0.22, hh * 0.30); c.lineTo(t * 0.20, -hh * 0.10);
        break;
      case 'emerald':
        c.moveTo(0, -hh * 0.25); c.lineTo(t * 0.16, 0);
        c.lineTo(0, hh * 0.25); c.lineTo(-t * 0.16, 0);
        break;
      case 'violet':
        c.moveTo(0, -hh * 0.50); c.lineTo(t * 0.34, 0);
        c.lineTo(0, hh * 0.50); c.lineTo(-t * 0.34, 0);
        break;
      case 'stealth':
        c.moveTo(0, -hh * 0.45); c.lineTo(t * 0.66, -hh * 0.05);
        c.lineTo(t * 0.50, hh * 0.42); c.lineTo(t * 0.20, hh * 0.28);
        c.lineTo(0, hh * 0.46); c.lineTo(-t * 0.20, hh * 0.28);
        c.lineTo(-t * 0.50, hh * 0.42); c.lineTo(-t * 0.66, -hh * 0.05);
        break;
      case 'golden':
        c.moveTo(-t * 0.30, -hh * 0.45); c.lineTo(t * 0.30, -hh * 0.45);
        c.lineTo(t * 0.30, hh * 0.40); c.lineTo(-t * 0.30, hh * 0.40);
        break;
      default: // cyan_knight 回退（理论上不会走到，cyan 走原样分支）
        c.moveTo(0, -hh * 0.5); c.lineTo(-t * 0.22, hh * 0.16);
        c.lineTo(-t * 0.10, hh * 0.34); c.lineTo(0, hh * 0.22);
        c.lineTo(t * 0.10, hh * 0.34); c.lineTo(t * 0.22, hh * 0.16);
    }
  }

  // 机身轮廓闭合路径（beginPath + hullOutline + closePath），供填充与裁剪复用
  function hullPath(c, sid, t, hh) {
    c.beginPath();
    hullOutline(c, sid, t, hh);
    c.closePath();
  }

  // 机翼 / 横向结构（wing 色）：与 3D 造型同调的简化 2D 轮廓
  function paintWingsNonCyan(c, sid, t, hh, wing) {
    const wg = c.createLinearGradient(0, hh * 0.02, 0, hh * 0.45);
    wg.addColorStop(0, lighten(wing, 0.25)); wg.addColorStop(1, darken(wing, 0.35));
    c.fillStyle = wg;
    const tri = (x1, y1, x2, y2, x3, y3) => {
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3);
      c.closePath(); c.fill();
    };
    if (sid === 'crimson_falcon') {
      // 前掠翼（翼尖前掠）
      tri(-t * 0.14, hh * 0.02, -t * 0.66, -hh * 0.30, -t * 0.16, hh * 0.30);
      tri( t * 0.14, hh * 0.02,  t * 0.66, -hh * 0.30,  t * 0.16, hh * 0.30);
    } else if (sid === 'emerald') {
      // 双尾梁 + 后横梁（构成 H 的横向结构）
      c.fillRect(-t * 0.62, -hh * 0.45, t * 0.22, hh * 0.90);
      c.fillRect( t * 0.40, -hh * 0.45, t * 0.22, hh * 0.90);
      c.fillRect(-t * 0.62,  hh * 0.28, t * 1.24, hh * 0.12);
    } else if (sid === 'violet') {
      // 升力体无翼，仅一对极薄小翼暗示
      tri(-t * 0.10, -hh * 0.10, -t * 0.34, hh * 0.10, -t * 0.12, hh * 0.22);
      tri( t * 0.10, -hh * 0.10,  t * 0.34, hh * 0.10,  t * 0.12, hh * 0.22);
    } else if (sid === 'stealth') {
      // 飞翼本体即机翼，由机身层负责，wing 层留空
    } else if (sid === 'golden') {
      // 宽翼 + 翼下短舱
      tri(-t * 0.14, hh * 0.02, -t * 0.70, hh * 0.16, -t * 0.16, hh * 0.34);
      tri( t * 0.14, hh * 0.02,  t * 0.70, hh * 0.16,  t * 0.16, hh * 0.34);
      c.fillRect(-t * 0.54, hh * 0.10, t * 0.22, hh * 0.18);
      c.fillRect( t * 0.32, hh * 0.10, t * 0.22, hh * 0.18);
    }
  }

  // 复用于游戏内绘制与皮肤编辑器预览
  function paintShip(c, now, px, py, t, hh, skin, opts) {
    opts = opts || {};
    const body = skin.body || '#3d8ba3';
    const accent = skin.accent || '#cfe7ee';
    const engine = skin.engine || '#e0a06a';
    const wing = skin.wing || '#274d5c';
    const pattern = skin.pattern || 'plain';
    // 2b：按皮肤 id 分 2D 剪影；cyan_knight 走原样矢量机体（向后兼容指纹硬门）
    const sid = (skin && skin.id) || 'cyan_knight';

    // 护盾：旋转六边形能量罩（用描边色）
    if (opts.shieldUntil && now < opts.shieldUntil) {
      const pulse = 0.55 + 0.45 * Math.sin(now / 110);
      c.save();
      c.translate(px, py);
      c.rotate(now / 600);
      glow(c, accent, 0, 0, t * 1.05, 0.16 + 0.14 * pulse);
      c.strokeStyle = hexA2(accent, 0.45 + 0.35 * pulse);
      c.lineWidth = 2.5;
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
      glow(c, '#bfffff', px, py - hh * 0.5 - 6, 17, 0.85);
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
    // 翼弧辉光：沿弧线撒 3 颗软光，替代整条描边的实时模糊
    glowLine(c, accent, -t * 0.30, hh * 0.08, -t * 0.70, hh * 0.52, t * 0.30, 0.14 * eng, 3);
    glowLine(c, accent, t * 0.30, hh * 0.08, t * 0.70, hh * 0.52, t * 0.30, 0.14 * eng, 3);
    c.strokeStyle = hexA2(accent, 0.5 * eng);
    c.lineWidth = 3;
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

    // 机翼（用机翼色渐变）—— 仅在无精灵贴图时绘制（有精灵则贴图已含机翼）
    if (!opts.sprite) {
      if (sid === 'cyan_knight') {
        // ⚠ 向后兼容硬门：cyan 的 2D 绘制指纹必须逐位一致，原样保留
        const wg = c.createLinearGradient(0, hh * 0.02, 0, hh * 0.45);
        wg.addColorStop(0, lighten(wing, 0.25)); wg.addColorStop(1, darken(wing, 0.35));
        c.fillStyle = wg;
        c.beginPath();
        c.moveTo(-t * 0.14, hh * 0.02); c.lineTo(-t * 0.66, hh * 0.46); c.lineTo(-t * 0.16, hh * 0.30);
        c.closePath(); c.fill();
        c.beginPath();
        c.moveTo(t * 0.14, hh * 0.02); c.lineTo(t * 0.66, hh * 0.46); c.lineTo(t * 0.16, hh * 0.30);
        c.closePath(); c.fill();
      } else {
        // 其余 5 款：与该款 3D 造型同调的简化 2D 机翼/横向结构（wing 色）
        paintWingsNonCyan(c, sid, t, hh, wing);
      }
    } else {
      // 精灵作机体（带顶光 / 底影 / 高光点的立体缓存），与敌机 / Boss 共用 drawSprite。
      // 动态特效（尾焰 / 护盾 / 火力叠加）仍画在上方。
      const d = DJFE.sprites.dim('player') || { w: 95, h: 160 };
      const sc = (hh * 1.5) / d.h;
      drawSprite('player', d.w * sc, d.h * sc, null);
    }

    // 机身（主体机身色渐变 + 顶部描边高光）—— 仅在无精灵贴图时绘制
    if (!opts.sprite) {
      if (sid === 'cyan_knight') {
        // ⚠ 向后兼容硬门：cyan 的 2D 绘制指纹必须逐位一致，原样保留
        glow(c, body, 0, -hh * 0.05, hh * 0.78, 0.30);
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
        c.strokeStyle = accent; c.lineWidth = 1.5; c.stroke();
      } else {
        // 其余 5 款：与该款 3D 造型同调的简化 2D 机身轮廓（body 色）
        glow(c, body, 0, -hh * 0.05, hh * 0.78, 0.30);
        const bg = c.createLinearGradient(0, -hh * 0.5, 0, hh * 0.5);
        bg.addColorStop(0, lighten(accent, 0.1));
        bg.addColorStop(0.45, body);
        bg.addColorStop(1, darken(body, 0.4));
        c.fillStyle = bg;
        hullPath(c, sid, t, hh);
        c.fill();
        c.strokeStyle = accent; c.lineWidth = 1.5; c.stroke();
      }
    }

    // 涂装（裁剪到机身内）—— 仅在无精灵贴图时绘制
    if (!opts.sprite && pattern !== 'plain') {
      c.save();
      if (sid === 'cyan_knight') {
        // ⚠ 向后兼容硬门：cyan 裁剪区与原样 6 点轮廓逐位一致
        c.beginPath();
        c.moveTo(0, -hh * 0.5);
        c.lineTo(-t * 0.22, hh * 0.16);
        c.lineTo(-t * 0.10, hh * 0.34);
        c.lineTo(0, hh * 0.22);
        c.lineTo(t * 0.10, hh * 0.34);
        c.lineTo(t * 0.22, hh * 0.16);
        c.closePath(); c.clip();
      } else {
        hullPath(c, sid, t, hh); c.clip();
      }
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

    // 座舱（玻璃高光，深色取机身暗部）—— 仅在无精灵贴图时绘制
    if (!opts.sprite) {
      const cg = c.createRadialGradient(-2, -hh * 0.18, 1, 0, -hh * 0.10, 9);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(1, darken(body, 0.5));
      c.fillStyle = cg;
      c.beginPath();
      c.ellipse(0, -hh * 0.10, 5.2, 9, 0, 0, Math.PI * 2);
      c.fill();
    }

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
        glow(c, accent, sx * t * 0.35, hh * 0.33, 10, 0.7);
        c.fillStyle = accent;
        c.beginPath(); c.arc(sx * t * 0.35, hh * 0.33, 2.4, 0, Math.PI * 2); c.fill();
        c.fillStyle = darken(wing, 0.15);
      });
    }
    if (pw >= 3) {
      // 中层副翼（后掠小翼，描边发光）
      c.save();
      c.strokeStyle = hexA2(accent, 0.9); c.lineWidth = 1.6;
      const sg = c.createLinearGradient(0, -hh * 0.1, 0, hh * 0.25);
      sg.addColorStop(0, lighten(wing, 0.4)); sg.addColorStop(1, darken(wing, 0.2));
      [-1, 1].forEach((sx) => { glow(c, accent, sx * t * 0.30, hh * 0.04, t * 0.26, 0.20); });
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
        glow(c, accent, 0, 0, 15, 0.65);
        c.fillStyle = accent;
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
      glow(c, accent, 0, 0, t * 0.70, 0.20);
      c.strokeStyle = hexA2(accent, 0.75); c.lineWidth = 2;
      c.setLineDash([10, 7]);
      c.beginPath(); c.arc(0, 0, t * 0.52, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.restore();
    }

    /* 散射枪（G）状态：机身外一圈紫色能量环。
     * 刻意用写死的紫（不取 skin.accent）—— 这是「增益状态」而不是「战机装饰」，
     * 换皮肤也必须长一个样，否则玩家没法一眼确认散射还在不在。
     * 紫 285° 同时避开了玩家色带 175-200 与敌弹危险带 12-24。
     * 没有 HUD 增益条（GDD §3.7：仅紫环表达可接受），所以这一圈就是唯一读数，
     * 用双环 + 反向旋转虚线把它做得足够显眼。 */
    if (opts.spreadUntil && now < opts.spreadUntil) {
      const left = opts.spreadUntil - now;
      // 最后 1.5s 加快闪烁 —— 不占 HUD 也能把「快没了」传达出去
      const urg = left < 1500 ? 0.55 + 0.45 * Math.sin(now / 60) : 1;
      c.save();
      glow(c, SPREAD_COL, 0, 0, t * 1.3, 0.22 * urg);
      c.strokeStyle = 'rgba(180,108,255,' + (0.7 * urg).toFixed(3) + ')';
      c.lineWidth = 2;
      c.rotate(now / 520);
      c.setLineDash([9, 6]);
      c.beginPath(); c.arc(0, 0, t * 0.95, 0, Math.PI * 2); c.stroke();
      // 内环反向转，两圈错动读起来像「能量在旋」而不是一个静止的贴纸
      c.rotate(-now / 260);
      c.strokeStyle = 'rgba(210,160,255,' + (0.42 * urg).toFixed(3) + ')';
      c.lineWidth = 1.5;
      c.setLineDash([5, 8]);
      c.beginPath(); c.arc(0, 0, t * 0.78, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.restore();
    }

    c.restore();
  }

  /* 僚机 Option：power≥3 的火力挂件。
   * 造型是主机的极简复刻，并且强制吃同一套皮肤色 —— 玩家色带（175~200）的约束
   * 在这里同样成立：僚机一秒都不能被误读成敌机，否则玩家会本能地去躲自己的火力点。
   * 无状态绘制：位置由调用方按 player.x/y + DJFE.options.offs 现算，这里只画。 */
  function paintOption(c, now, ox, oy, sk, ph) {
    const s = 13;
    c.save();
    c.translate(ox, oy);
    // 引擎尾焰：与主机同频脉动（ph 只做相位错开），视觉上认得出是"同一支编队"
    const f = 0.6 + 0.4 * Math.sin((now || 0) / 90 + ph);
    glow(c, sk.trail || '#8fd4e0', 0, s * 0.70, s * (0.46 + 0.24 * f), 0.24 + 0.18 * f);
    // 后掠小翼
    c.fillStyle = sk.wing || '#274d5c';
    c.beginPath();
    c.moveTo(-s * 0.86, s * 0.30); c.lineTo(-s * 0.20, -s * 0.20);
    c.lineTo(-s * 0.20, s * 0.52); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(s * 0.86, s * 0.30); c.lineTo(s * 0.20, -s * 0.20);
    c.lineTo(s * 0.20, s * 0.52); c.closePath(); c.fill();
    // 机体（尖头三角）
    c.fillStyle = sk.body || '#3d8ba3';
    c.beginPath();
    c.moveTo(0, -s * 0.92); c.lineTo(s * 0.42, s * 0.46);
    c.lineTo(-s * 0.42, s * 0.46); c.closePath(); c.fill();
    // 座舱高光
    c.fillStyle = sk.accent || '#cfe7ee';
    c.beginPath(); c.arc(0, -s * 0.18, s * 0.17, 0, Math.PI * 2); c.fill();
    // 尾焰
    c.fillStyle = sk.engine || '#e0a06a';
    c.beginPath();
    c.moveTo(-s * 0.16, s * 0.46); c.lineTo(s * 0.16, s * 0.46);
    c.lineTo(0, s * (0.62 + 0.34 * f)); c.closePath(); c.fill();
    c.restore();
  }

  function drawPlayer(now, player, game) {
    let sk = (game && game.skin) || (DJFE.skins && DJFE.skins.current());
    // 兜底皮肤：与 core.js 默认皮肤「苍蓝骑士」同色，避免皮肤系统未就绪时闪回旧霓虹配色
    if (!sk) sk = { body: '#3d8ba3', accent: '#cfe7ee', engine: '#e0a06a', wing: '#274d5c', trail: '#8fd4e0', pattern: 'plain' };
    /* 僚机先画：主机压在上层，两者重叠时"谁是本体"没有歧义。
     * 位置表向 game.js 现取（DJFE.options），绝不在渲染层复制一份常量 ——
     * 否则改了发射口忘了改画法，子弹就会从空气里冒出来。 */
    const OPT = DJFE.options;
    if (OPT) {
      const oc = OPT.count();
      for (let i = 0; i < oc; i++) {
        paintOption(ctx, now, player.x + OPT.offs[i][0], player.y + OPT.offs[i][1], sk, i * 1.7);
      }
    }
    // 精灵贴图即「苍蓝骑士」实机，仅在默认皮肤且精灵就绪时启用；其它皮肤继续走矢量（含全套自定义配色）
    const sprite = (sk.id === 'cyan_knight' && DJFE.sprites.isReady()) ? DJFE.sprites.get('player') : null;
    if (sprite) {
      paintShip(ctx, now, player.x, player.y, player.w, player.h, sk,
        { shieldUntil: player.shieldUntil, muzzle: game && game.muzzle, power: game && game.power,
          spreadUntil: game && game.spreadUntil, sprite });
    } else {
      paintShip(ctx, now, player.x, player.y, player.w, player.h, sk,
        { shieldUntil: player.shieldUntil, muzzle: game && game.muzzle, power: game && game.power,
          spreadUntil: game && game.spreadUntil });
    }
  }

  // ---- 敌机（四种独立造型） ----
  function drawEnemy(en) {
    const s = en.w;
    // straight 是最高频基础敌机，但没有专用精灵 —— 用 enemy_drone 圆润巡逻机兜底
    // sniper 的 AI 贴图已损坏（被画成一坨模糊光晕、主体缺失，见 audit-sprites），
    // 强制走矢量降级，保证狙击机永远是干净的细长战机而不是一块残破贴图。
    // turret/kamikaze/curver 是扩容期新增，没有对应贴图，直接走矢量不做无谓查表
    let spriteName;
    if (en.type === 'sniper' || en.type === 'turret' || en.type === 'kamikaze' || en.type === 'curver'
        || en.type === 'rock') spriteName = null;
    else if (en.type === 'straight') spriteName = 'enemy_drone';
    else spriteName = 'enemy_' + en.type;
    // ---- 精灵路径（就绪时优先）----
    if (DJFE.sprites.isReady() && spriteName && DJFE.sprites.get(spriteName)) {
      // 关卡色相的统一氛围光：压低强度，避免与机体撞色（hue-rotate 后机体≈en.hue）
      glowHue(ctx, en.hue, 52, 58, en.x, en.y, s * 0.82, 0.22);
      ctx.save();
      ctx.translate(en.x, en.y);
      drawSprite(spriteName, s * 1.32, s * 1.32, en.hue);
      // 引擎尾焰（暖色辉光，独立于机体色相）：给扁平机体补一点"活气"与底部质量感
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glowHue(ctx, 30, 72, 55, 0, s * 0.62, s * 0.5, 0.30);
      ctx.restore();
      // 受击反馈（暖白压暗，保留原"机体仍透得出来"的逻辑，叠在精灵上）
      if (en.flash > 0) {
        ctx.globalAlpha = en.flash * 0.8;
        ctx.fillStyle = '#f7efe2';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.46, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = en.flash;
        ctx.strokeStyle = '#fffaf0';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }
    // ---- 矢量降级（精灵缺失 / 未加载时的保底）----
    ctx.save();
    ctx.translate(en.x, en.y);
    // 方向 B：低饱和 + 中明度，机体靠「明度层次」而非「彩度」拉开体积感
    const col = `hsl(${en.hue},52%,58%)`;
    const lite = `hsl(${en.hue},58%,76%)`;
    const dark = `hsl(${en.hue},44%,31%)`;

    if (en.type === 'rock') {
      /* 漂移陨石：不规则多边形岩块 + 陨坑。造型语言刻意「无对称、无座舱、无引擎」，
       * 让它一眼就不像会开火的东西 —— 玩家对它的第一反应应该是「绕过去」而不是「打它」。
       * ★ 顶点表写死不用 Math.random()：渲染层一律零 RNG（S16 §6.1 会 grep 检查），
       *   而且随机顶点会让同一块石头每帧抖动成噪点。
       *   自转角直接读 en.phase（逻辑层已在漂移里推进），不额外引入时间源。 */
      const rot = (en.phase || 0) * 0.35;
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.62, 0.22);
      ctx.save();
      ctx.rotate(rot);
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < ROCK_PTS.length; i++) {
        const p = ROCK_PTS[i];
        const px2 = p[0] * s, py2 = p[1] * s;
        if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath(); ctx.fill();
      // 受光面：左上一块亮色，给平面多边形一点体积
      ctx.fillStyle = lite;
      ctx.globalAlpha = 0.30;
      ctx.beginPath();
      ctx.moveTo(-s * 0.40, -s * 0.14); ctx.lineTo(-s * 0.12, -s * 0.44);
      ctx.lineTo(s * 0.10, -s * 0.22); ctx.lineTo(-s * 0.18, -s * 0.02);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      // 陨坑（固定三处，位置随岩块一起转）
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(s * 0.16, -s * 0.06, s * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-s * 0.06, s * 0.22, s * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-s * 0.26, s * 0.02, s * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (en.type === 'weaver') {
      // 黄蜂：锐利菱形 + 后掠翼 + 尾刺
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.82, 0.40);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.55);
      ctx.lineTo(s * 0.42, -s * 0.05);
      ctx.lineTo(s * 0.18, s * 0.5);
      ctx.lineTo(-s * 0.18, s * 0.5);
      ctx.lineTo(-s * 0.42, -s * 0.05);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(0, -s * 0.1); ctx.lineTo(s * 0.10, s * 0.5); ctx.lineTo(-s * 0.10, s * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2e8d4';
      ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.12, 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'elite') {
      // 重装六边形：装甲板 + 旋转内核 + 尖刺
      const rot = (en.phase || 0) * 0.6;
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.95, 0.42);
      ctx.save(); ctx.rotate(rot * 0.3);
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        const px = Math.cos(a) * s * 0.5, py = Math.sin(a) * s * 0.5;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
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
      glowHue(ctx, en.hue, 58, 76, 0, 0, s * 0.42 * (0.8 + 0.3 * cp), 0.55);
      ctx.fillStyle = `hsl(${en.hue},64%,${58 + 18 * cp}%)`;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.16 * (0.8 + 0.3 * cp), 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'spinner') {
      // 回旋机：三叶螺旋桨（旋转）+ 中心能量核
      const rot = (en.phase || 0) * 2.2;
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.80, 0.34);
      ctx.save(); ctx.rotate(rot);
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
      ctx.restore();
      const cp = 0.6 + 0.4 * Math.sin((en.phase || 0) * 5);
      glowHue(ctx, en.hue, 58, 76, 0, 0, s * (0.38 + 0.10 * cp), 0.50);
      ctx.fillStyle = lite;
      ctx.beginPath(); ctx.arc(0, 0, s * (0.14 + 0.04 * cp), 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'diver') {
      // 俯冲机：尖锐箭头；锁定时机身闪白
      const locking = en.lockT > 0;
      if (locking) glow(ctx, '#ffffff', 0, 0, s * 1.05, 0.5);
      else glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.80, 0.40);
      ctx.fillStyle = locking && Math.floor((en.phase || 0) * 20) % 2 === 0 ? '#ffffff' : col;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.6);                     // 向下尖头（俯冲朝向）
      ctx.lineTo(s * 0.34, -s * 0.1);
      ctx.lineTo(s * 0.14, -s * 0.5);
      ctx.lineTo(-s * 0.14, -s * 0.5);
      ctx.lineTo(-s * 0.34, -s * 0.1);
      ctx.closePath(); ctx.fill();
      // 复眼（暖中性，不占用危险色带 12–24°）
      ctx.fillStyle = '#eadcc6';
      ctx.beginPath(); ctx.arc(-s * 0.08, -s * 0.18, s * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.08, -s * 0.18, s * 0.05, 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'sniper') {
      // 狙击机：细长机身 + 超长炮管 + 瞄准镜光点
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.70, 0.34);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.55);
      ctx.lineTo(s * 0.18, -s * 0.2);
      ctx.lineTo(s * 0.14, s * 0.4);
      ctx.lineTo(-s * 0.14, s * 0.4);
      ctx.lineTo(-s * 0.18, -s * 0.2);
      ctx.closePath(); ctx.fill();
      // 长炮管（朝下）
      ctx.fillStyle = dark;
      ctx.fillRect(-s * 0.045, s * 0.3, s * 0.09, s * 0.5);
      // 瞄准镜（威胁预告 —— 刻意落在保留危险色带 ~18°，与敌弹同频）
      const sp = 0.5 + 0.5 * Math.sin((en.phase || 0) * 6);
      ctx.fillStyle = `rgba(255,138,74,${0.5 + 0.5 * sp})`;
      glow(ctx, '#ff8a4a', 0, -s * 0.1, s * 0.28 + 3 * sp, 0.24 + 0.26 * sp);
      ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.07, 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'splitter') {
      // 分裂母体：大圆胞 + 内部 3 个子体脉动
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.86, 0.36);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();
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
    } else if (en.type === 'turret') {
      /* 悬停炮台：方底座 + 可旋转炮塔 + 三孔炮口。
       * 剪影刻意做成唯一的"方"的敌机 —— 满屏圆润机体里，方块＝钉在原地的东西，
       * 玩家扫一眼就知道它不会动，可以最后再处理。 */
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.84, 0.32);
      // 底座
      ctx.fillStyle = dark;
      ctx.fillRect(-s * 0.46, -s * 0.10, s * 0.92, s * 0.50);
      ctx.fillStyle = col;
      ctx.fillRect(-s * 0.38, -s * 0.04, s * 0.76, s * 0.34);
      // 支撑腿
      ctx.fillStyle = dark;
      ctx.fillRect(-s * 0.44, s * 0.34, s * 0.14, s * 0.16);
      ctx.fillRect(s * 0.30, s * 0.34, s * 0.14, s * 0.16);
      // 炮塔（缓慢摆动，示意"在瞄"）
      ctx.save();
      ctx.rotate(Math.sin((en.phase || 0) * 0.8) * 0.20);
      ctx.fillStyle = lite;
      ctx.beginPath();
      ctx.moveTo(-s * 0.26, -s * 0.08);
      ctx.lineTo(s * 0.26, -s * 0.08);
      ctx.lineTo(s * 0.18, -s * 0.40);
      ctx.lineTo(-s * 0.18, -s * 0.40);
      ctx.closePath(); ctx.fill();
      // 三孔炮口（朝下）
      ctx.fillStyle = '#14100c';
      for (let i = -1; i <= 1; i++) ctx.fillRect(i * s * 0.14 - s * 0.045, s * 0.24, s * 0.09, s * 0.14);
      ctx.restore();
      // 蓄力指示：快开火时炮口发亮（>75% 才亮，给玩家约 0.5s 反应）
      const tch = Math.min(1, (en.fireT || 0) / 2000);
      if (tch > 0.75) {
        const k = (tch - 0.75) / 0.25;
        glowHue(ctx, en.hue, 58, 76, 0, s * 0.30, s * 0.36, 0.26 + 0.44 * k);
        ctx.fillStyle = `hsl(${en.hue},64%,${64 + 20 * k}%)`;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.arc(i * s * 0.14, s * 0.30, s * 0.05, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (en.type === 'kamikaze') {
      /* 自爆冲锋：细长尖锥 + 拖焰 + 警示斜纹。
       * 锁定完成（diving）后整机点亮并拉长尾焰 —— "它已经决定撞哪了"这件事
       * 必须一眼可见，否则玩家没有做出反应的依据。 */
      const armed = !!en.diving;
      if (armed) glowHue(ctx, en.hue, 58, 76, 0, 0, s * 1.00, 0.42);
      else glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.74, 0.30);
      // 拖焰（朝后 = 上方）
      ctx.fillStyle = `hsla(${en.hue},60%,74%,${armed ? 0.55 : 0.28})`;
      ctx.beginPath();
      ctx.moveTo(-s * 0.13, -s * 0.30);
      ctx.lineTo(s * 0.13, -s * 0.30);
      ctx.lineTo(0, -s * (armed ? 1.00 : 0.66));
      ctx.closePath(); ctx.fill();
      // 锥体（尖头朝下）
      ctx.fillStyle = armed ? lite : col;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.62);
      ctx.lineTo(s * 0.26, -s * 0.24);
      ctx.lineTo(0, -s * 0.40);
      ctx.lineTo(-s * 0.26, -s * 0.24);
      ctx.closePath(); ctx.fill();
      // 警示斜纹（两道暗带）
      ctx.fillStyle = dark;
      ctx.fillRect(-s * 0.20, -s * 0.06, s * 0.40, s * 0.07);
      ctx.fillRect(-s * 0.14, s * 0.10, s * 0.28, s * 0.07);
      // 弹头
      ctx.fillStyle = `hsl(${en.hue},66%,${armed ? 88 : 70}%)`;
      ctx.beginPath(); ctx.arc(0, s * 0.40, s * 0.07, 0, Math.PI * 2); ctx.fill();
    } else if (en.type === 'curver') {
      /* 弧线机：弯翼 + 两侧发射舱。
       * 机体随正弦走位倾斜（读 phase 的余弦＝当前横向速度），
       * 让"它正在往哪边飘"从姿态上就读得出来，而不用盯着位置差分。 */
      const bank = Math.cos(en.phase || 0) * 0.34;
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.80, 0.32);
      ctx.save();
      ctx.rotate(bank);
      // 弯翼：一对向后弯的月牙
      ctx.fillStyle = dark;
      for (let k = -1; k <= 1; k += 2) {
        ctx.beginPath();
        ctx.moveTo(k * s * 0.10, -s * 0.16);
        ctx.quadraticCurveTo(k * s * 0.62, -s * 0.06, k * s * 0.44, s * 0.40);
        ctx.quadraticCurveTo(k * s * 0.34, s * 0.02, k * s * 0.08, s * 0.10);
        ctx.closePath(); ctx.fill();
      }
      // 机体：纺锤
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.50);
      ctx.quadraticCurveTo(s * 0.22, 0, 0, s * 0.48);
      ctx.quadraticCurveTo(-s * 0.22, 0, 0, -s * 0.50);
      ctx.closePath(); ctx.fill();
      // 两侧发射舱（蓄力时点亮，位置就是弯曲弹的出膛口）
      const cch = Math.min(1, (en.fireT || 0) / 1800);
      const lit = cch > 0.78 ? (cch - 0.78) / 0.22 : 0;
      if (lit > 0) glowHue(ctx, en.hue, 58, 76, 0, s * 0.24, s * 0.44, 0.24 + 0.40 * lit);
      ctx.fillStyle = lit > 0 ? `hsl(${en.hue},64%,${62 + 22 * lit}%)` : lite;
      for (let k = -1; k <= 1; k += 2) {
        ctx.beginPath(); ctx.arc(k * s * 0.17, s * 0.22, s * 0.065, 0, Math.PI * 2); ctx.fill();
      }
      // 座舱
      ctx.fillStyle = '#eadcc6';
      ctx.beginPath(); ctx.arc(0, -s * 0.18, s * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (en.type === 'shooter') {
      // 炮手：宽体 + 双管 + 中央核心
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.82, 0.30);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.lineTo(s * 0.5, -s * 0.2);
      ctx.lineTo(s * 0.5, s * 0.45);
      ctx.lineTo(-s * 0.5, s * 0.45);
      ctx.lineTo(-s * 0.5, -s * 0.2);
      ctx.closePath(); ctx.fill();
      // 双炮管
      ctx.fillStyle = dark;
      ctx.fillRect(-s * 0.34, s * 0.30, s * 0.14, s * 0.3);
      ctx.fillRect(s * 0.20, s * 0.30, s * 0.14, s * 0.3);
      // 核心（改用自身色相，避让道具金 ~45°）
      glowHue(ctx, en.hue, 58, 76, 0, -s * 0.02, s * 0.42, 0.36);
      ctx.fillStyle = lite;
      ctx.beginPath(); ctx.arc(0, -s * 0.02, s * 0.14, 0, Math.PI * 2); ctx.fill();
    } else {
      // 直冲无人机：圆润机体 + 双引擎 + 红眼
      glowHue(ctx, en.hue, 52, 58, 0, 0, s * 0.76, 0.30);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5);
      ctx.lineTo(s * 0.42, -s * 0.28);
      ctx.lineTo(s * 0.30, s * 0.5);
      ctx.lineTo(-s * 0.30, s * 0.5);
      ctx.lineTo(-s * 0.42, -s * 0.28);
      ctx.closePath(); ctx.fill();
      // 引擎辉光
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(-s * 0.18, s * 0.42, s * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.18, s * 0.42, s * 0.10, 0, Math.PI * 2); ctx.fill();
      // 传感器眼（改用自身色相，避免与敌弹危险色带混淆）
      glowHue(ctx, en.hue, 58, 76, 0, -s * 0.04, s * 0.38, 0.32);
      ctx.fillStyle = lite;
      ctx.beginPath(); ctx.arc(0, -s * 0.04, s * 0.13, 0, Math.PI * 2); ctx.fill();
    }

    /* 受击反馈：旧版是纯白实心圆整个盖住机体，一帧内敌机「消失」成一个白点 ——
     * 命中感有了，但丢失了「打中的是谁」。方向 B 改成暖白 + 只压到 0.8 alpha，
     * 并叠一圈更亮的描边：轮廓被强调，机体仍然透得出来。 */
    if (en.flash > 0) {
      ctx.globalAlpha = en.flash * 0.8;
      ctx.fillStyle = '#f7efe2';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.46, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = en.flash;
      ctx.strokeStyle = '#fffaf0';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---- 道具（外光晕 + 发光菱形 + 旋转环 + 字母） ----
  function drawItem(it) {
    const spriteName = 'item_' + it.type;
    // ---- 精灵路径（就绪时优先；道具颜色固定，不旋转色相）----
    if (DJFE.sprites.isReady() && DJFE.sprites.get(spriteName)) {
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
      glowHue(ctx, it.hue, 60, 62, it.x, it.y, (it.r + 14) * (0.85 + 0.25 * pulse), 0.30 * pulse);
      ctx.save();
      ctx.translate(it.x, it.y);
      drawSprite(spriteName, it.r * 2.6, it.r * 2.6, null);
      ctx.restore();
      return;
    }
    // ---- 矢量降级 ----
    ctx.save();
    ctx.translate(it.x, it.y);
    // 方向 B：道具保持「柔金/暖色」友善档，饱和度低于旧霓虹版但明度更高 —— 靠亮度而非彩度抢眼
    const col = `hsl(${it.hue},60%,64%)`;
    const rot = (it.x + it.y) * 0.02 + Date.now() * 0.003;
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
    // 外光晕（图集辉光取代 shadowBlur）；两层共用同一色槽，省图集空间
    glowHue(ctx, it.hue, 60, 62, 0, 0, (it.r + 14) * (0.85 + 0.25 * pulse), 0.30 * pulse);
    ctx.rotate(rot);
    glowHue(ctx, it.hue, 60, 62, 0, 0, it.r * 1.7, 0.26);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -it.r); ctx.lineTo(it.r, 0); ctx.lineTo(0, it.r); ctx.lineTo(-it.r, 0);
    ctx.closePath(); ctx.fill();
    ctx.rotate(-rot);
    ctx.fillStyle = '#181109';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(it.type, 0, 1);
    ctx.restore();
  }

  /* ==== Boss 七款造型 ====================================================
   * 分发表落在 entities.js（渲染层）而不是 BOSS_KINDS（game.js 逻辑层）：
   * game.js 里一行 ctx 调用都不该有，否则以后想换渲染后端就得动玩法代码。
   *
   * 每款只读 Boss 的公开状态字段（hue/w/h/hp/maxHp/fireT/fireGap/pi/form/ovr/
   * tele/teleX/teleY/ghostT/beamPhase/phase/minions），不反查招式表 —— 造型和
   * 弹幕解耦，改招式不会连带改画法。
   *
   * 调用约定：
   *   ① 进入时调用方已 translate 到 (b.x, b.y)，各款只画本地坐标；
   *   ② 必须自平衡 ctx 状态（save 几次 restore 几次，globalAlpha 复位）；
   *   ③ glowHue 的 sat/lit 只准取已有色槽 (54,60)/(68,66)/(68,78) —— 这三组
   *      辉光图集里已经烘好了，用新组合会当场多烘一张图。强度一律走 alpha。
   *
   * p = { s, hh, r, col, lite, dark, pulse, charge, chargeGlow }，由 drawBoss
   * 预算好共用，省掉六份重复的 hsl 字符串拼接。
   * ==================================================================== */
  const BOSS_SHAPES = {

    /* S1 哨戒机甲：人形 —— 双梯形肩甲（占宽约 55%）+ 胸口探照灯窝 + 无腿推进裙。
     * 唯一"人形"剪影，与通用舰体三段模板（能量冠+舰体+核心）彻底区隔。
     * 充能时胸口探照灯变亮；满血期肩甲交叠处泛防护辉光。相位由 b.phase 驱动，零 RNG。 */
    sentinel(b, now, player, p) {
      const s = p.s, hb = b.h;
      const phase = (b.phase || 0);
      const healthy = p.r > 0.66;                        // 满血档：防护辉光
      const blink = 0.82 + 0.18 * Math.sin(phase * 3);   // 相位呼吸（确定性，非 RNG）

      ctx.save();

      // ① 推进裙（无腿）：上窄下微张的梯形，底部斜切收口，像悬浮推进器
      glowHue(ctx, p.hh, 54, 60, 0, hb * 0.30, Math.max(s, hb) * 0.5, 0.18);
      let g = ctx.createLinearGradient(0, hb * 0.18, 0, hb * 0.46);
      g.addColorStop(0, p.lite); g.addColorStop(1, p.dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-s * 0.16, hb * 0.18);
      ctx.lineTo(s * 0.16, hb * 0.18);
      ctx.lineTo(s * 0.26, hb * 0.44);   // 裙底外扩
      ctx.lineTo(s * 0.10, hb * 0.46);   // 斜切收口
      ctx.lineTo(0, hb * 0.40);
      ctx.lineTo(-s * 0.10, hb * 0.46);
      ctx.lineTo(-s * 0.26, hb * 0.44);
      ctx.closePath(); ctx.fill();

      // ② 躯干（胸甲）：上宽下窄多边形，中央内凹探照灯窝
      glowHue(ctx, p.hh, 54, 60, 0, -hb * 0.02, Math.max(s, hb) * 0.42, 0.20);
      g = ctx.createLinearGradient(0, -hb * 0.30, 0, hb * 0.22);
      g.addColorStop(0, p.lite); g.addColorStop(1, p.dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-s * 0.20, -hb * 0.28);
      ctx.lineTo(s * 0.20, -hb * 0.28);
      ctx.lineTo(s * 0.15, hb * 0.20);
      ctx.lineTo(-s * 0.15, hb * 0.20);
      ctx.closePath(); ctx.fill();

      // ②b 胸口探照灯窝（内凹暗圆）+ 发光灯（充能更亮，满血更亮）
      const lampY = -hb * 0.02, lampR = s * 0.12;
      ctx.fillStyle = `hsl(${p.hh},32%,12%)`;
      ctx.beginPath(); ctx.arc(0, lampY, lampR * 1.12, 0, Math.PI * 2); ctx.fill();
      glowHue(ctx, p.hh, 68, 78, 0, lampY, lampR * (1.4 + 0.9 * p.chargeGlow), (0.22 + 0.50 * p.chargeGlow) * blink);
      const lampL = Math.max(20, Math.min(96, 52 + 26 * p.r + 22 * p.chargeGlow));
      ctx.fillStyle = `hsl(${p.hh},72%,${lampL}%)`;
      ctx.beginPath(); ctx.arc(0, lampY, lampR * (0.66 + 0.18 * p.chargeGlow), 0, Math.PI * 2); ctx.fill();

      // ②c 胸甲散热缝（暗线，强化装甲质感；画在灯之上不压灯芯亮度）
      ctx.strokeStyle = `hsla(${p.hh},36%,16%,0.5)`; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-s * 0.12, -hb * 0.14); ctx.lineTo(-s * 0.12, hb * 0.10);
      ctx.moveTo(s * 0.12, -hb * 0.14); ctx.lineTo(s * 0.12, hb * 0.10);
      ctx.stroke();

      // ③ 双臂（短粗 Box，各持方形炮盒）：自肩甲外侧垂下
      for (let k = -1; k <= 1; k += 2) {
        ctx.fillStyle = `hsl(${p.hh},46%,40%)`;
        ctx.beginPath();
        ctx.moveTo(k * s * 0.20, hb * 0.04);
        ctx.lineTo(k * s * 0.34, hb * 0.06);
        ctx.lineTo(k * s * 0.38, hb * 0.22);
        ctx.lineTo(k * s * 0.22, hb * 0.22);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = `hsl(${p.hh},50%,34%)`;        // 肘炮盒
        ctx.fillRect(k * s * 0.30 - s * 0.05, hb * 0.22, s * 0.10, s * 0.10);
        glowHue(ctx, p.hh, 68, 66, k * s * 0.35, hb * 0.30, s * (0.07 + 0.10 * p.chargeGlow), 0.18 + 0.40 * p.chargeGlow);
      }

      // ④ 双梯形肩甲（识别标志：占宽约 55%；坐标取自 GDD §3.1 明示）
      for (let k = -1; k <= 1; k += 2) {
        glowHue(ctx, p.hh, 54, 60, k * s * 0.34, -hb * 0.08, Math.max(s, hb) * 0.34, 0.20);
        g = ctx.createLinearGradient(0, -hb * 0.30, 0, hb * 0.10);
        g.addColorStop(0, p.lite); g.addColorStop(1, `hsl(${p.hh},44%,30%)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(k * s * 0.50, -hb * 0.20);
        ctx.lineTo(k * s * 0.18, -hb * 0.30);
        ctx.lineTo(k * s * 0.18, -hb * 0.02);
        ctx.lineTo(k * s * 0.50, hb * 0.10);
        ctx.closePath(); ctx.fill();
        // 肩甲琥珀警示斜纹（hue 38，走纯 fill 不占 glow 色槽）
        ctx.fillStyle = `hsl(38,62%,52%)`;
        ctx.beginPath();
        ctx.moveTo(k * s * 0.46, -hb * 0.12);
        ctx.lineTo(k * s * 0.40, -hb * 0.14);
        ctx.lineTo(k * s * 0.50, hb * 0.06);
        ctx.lineTo(k * s * 0.50, hb * 0.02);
        ctx.closePath(); ctx.fill();
      }

      // ⑤ 头部传感（小座舱，强化人形读感）
      ctx.fillStyle = `hsl(${p.hh},50%,46%)`;
      ctx.beginPath();
      ctx.moveTo(-s * 0.08, -hb * 0.30);
      ctx.lineTo(s * 0.08, -hb * 0.30);
      ctx.lineTo(s * 0.06, -hb * 0.42);
      ctx.lineTo(-s * 0.06, -hb * 0.42);
      ctx.closePath(); ctx.fill();
      glowHue(ctx, p.hh, 68, 78, 0, -hb * 0.36, s * 0.12, 0.30 * blink);
      ctx.fillStyle = `hsla(${p.hh},70%,84%,${0.70 + 0.30 * p.chargeGlow})`;
      ctx.beginPath(); ctx.arc(0, -hb * 0.36, s * 0.035, 0, Math.PI * 2); ctx.fill();

      // ⑥ 满血防护辉光（肩甲交叠处 / 胸口，b.phase 驱动）
      if (healthy) {
        glowHue(ctx, p.hh, 68, 78, 0, -hb * 0.14, s * 0.34, (0.10 + 0.10 * Math.sin(phase * 2)) * (0.6 + 0.4 * p.pulse));
      }

      // ⑦ 推进裙喷口（4 具向下锥形，斜切底收口；内焰由相位 + 充能驱动，确定性）
      ctx.fillStyle = `hsl(${p.hh},46%,26%)`;
      ctx.beginPath(); ctx.moveTo(-s * 0.20, hb * 0.44); ctx.lineTo(-s * 0.10, hb * 0.44); ctx.lineTo(-s * 0.15, hb * 0.52); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(s * 0.10, hb * 0.44); ctx.lineTo(s * 0.20, hb * 0.44); ctx.lineTo(s * 0.15, hb * 0.52); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s * 0.06, hb * 0.46); ctx.lineTo(-s * 0.02, hb * 0.46); ctx.lineTo(-s * 0.04, hb * 0.54); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(s * 0.02, hb * 0.46); ctx.lineTo(s * 0.06, hb * 0.46); ctx.lineTo(s * 0.04, hb * 0.54); ctx.closePath(); ctx.fill();
      const flame = (0.5 + 0.5 * Math.abs(Math.sin(phase * 4 + 1))) * (0.6 + 0.4 * p.pulse);
      ctx.fillStyle = `hsla(${p.hh},70%,72%,${0.5 * flame + 0.3 * p.chargeGlow})`;
      ctx.beginPath(); ctx.moveTo(-s * 0.18, hb * 0.52); ctx.lineTo(-s * 0.12, hb * 0.52); ctx.lineTo(-s * 0.15, hb * 0.52 + hb * 0.06 * flame); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(s * 0.12, hb * 0.52); ctx.lineTo(s * 0.18, hb * 0.52); ctx.lineTo(s * 0.15, hb * 0.52 + hb * 0.06 * flame); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s * 0.045, hb * 0.54); ctx.lineTo(-s * 0.015, hb * 0.54); ctx.lineTo(-s * 0.03, hb * 0.54 + hb * 0.06 * flame); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(s * 0.015, hb * 0.54); ctx.lineTo(s * 0.045, hb * 0.54); ctx.lineTo(s * 0.03, hb * 0.54 + hb * 0.06 * flame); ctx.closePath(); ctx.fill();

      ctx.restore();
    },

    /* S2 采矿巨蝎：宽甲壳 + 双螯 + 上翘尾针。
     * 尾针尖就是充能预告的落点 —— 玩家盯尾巴就知道下一发什么时候来。 */
    scorpion(b, now, player, p) {
      const s = p.s, hb = b.h;
      const sw = 0.5 + 0.5 * Math.sin((b.phase || 0) * 2);   // 螯开合

      // 尾（先画，压在甲壳下面）：五节由粗到细沿抛物线上翘
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const nx = s * 0.16 * Math.sin(t * 1.9);
        const ny = hb * 0.26 - hb * 0.92 * t;
        ctx.fillStyle = i % 2 ? p.dark : `hsl(${p.hh},48%,38%)`;
        ctx.beginPath(); ctx.arc(nx, ny, s * 0.085 * (1 - 0.42 * t), 0, Math.PI * 2); ctx.fill();
      }
      // 针尖：充能时点亮并前伸，是这款 Boss 唯一的开火预告
      const tipX = s * 0.16 * Math.sin(1.9) + s * 0.05 * p.chargeGlow;
      const tipY = -hb * 0.66 - hb * 0.06 * p.chargeGlow;
      glowHue(ctx, p.hh, 68, 78, tipX, tipY, s * (0.16 + 0.20 * p.chargeGlow), 0.28 + 0.50 * p.chargeGlow);
      ctx.fillStyle = `hsl(${p.hh},70%,${64 + 22 * p.chargeGlow}%)`;
      ctx.beginPath();
      ctx.moveTo(tipX - s * 0.05, tipY + s * 0.08);
      ctx.lineTo(tipX + s * 0.05, tipY + s * 0.08);
      ctx.lineTo(tipX + s * 0.01, tipY - s * 0.14);
      ctx.closePath(); ctx.fill();

      // 双螯：外臂 + 内钳，钳口随 sw 张合
      ctx.strokeStyle = p.dark; ctx.lineWidth = s * 0.075; ctx.lineCap = 'round';
      for (let k = -1; k <= 1; k += 2) {
        const ax = k * s * 0.40, ay = hb * 0.10;
        ctx.beginPath();
        ctx.moveTo(k * s * 0.20, hb * 0.02);
        ctx.lineTo(ax, ay);
        ctx.lineTo(ax + k * s * 0.14, ay - hb * 0.20);
        ctx.stroke();
        const cx2 = ax + k * s * 0.14, cy2 = ay - hb * 0.20;
        ctx.fillStyle = `hsl(${p.hh},50%,46%)`;
        for (let j = -1; j <= 1; j += 2) {
          ctx.save();
          ctx.translate(cx2, cy2);
          ctx.rotate(j * (0.30 + 0.34 * sw));
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(k * s * 0.05, -hb * 0.20);
          ctx.lineTo(k * s * 0.13, -hb * 0.10);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
      ctx.lineCap = 'butt';

      // 甲壳：宽六边形，上亮下暗
      glowHue(ctx, p.hh, 54, 60, 0, 0, Math.max(s, hb) * 0.62, 0.22);
      const g2 = ctx.createLinearGradient(0, -hb * 0.34, 0, hb * 0.40);
      g2.addColorStop(0, p.lite); g2.addColorStop(1, p.dark);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(0, -hb * 0.36);
      ctx.lineTo(s * 0.34, -hb * 0.12);
      ctx.lineTo(s * 0.28, hb * 0.32);
      ctx.lineTo(-s * 0.28, hb * 0.32);
      ctx.lineTo(-s * 0.34, -hb * 0.12);
      ctx.closePath(); ctx.fill();
      // 甲缝
      ctx.strokeStyle = `hsla(${p.hh},40%,18%,0.55)`; ctx.lineWidth = 2;
      for (let i = 1; i <= 2; i++) {
        const yy = -hb * 0.36 + hb * 0.68 * (i / 3);
        ctx.beginPath(); ctx.moveTo(-s * 0.30, yy); ctx.lineTo(s * 0.30, yy); ctx.stroke();
      }
      // 复眼列（四点，血越少越亮 —— 濒死的凶相）
      const eyeA = 0.45 + 0.45 * (1 - p.r);
      glowHue(ctx, p.hh, 68, 78, 0, -hb * 0.20, s * 0.34, 0.20 + 0.24 * (1 - p.r));
      ctx.fillStyle = `hsla(${p.hh},72%,82%,${eyeA})`;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc((i - 1.5) * s * 0.10, -hb * 0.20, s * 0.033, 0, Math.PI * 2); ctx.fill();
      }
    },

    /* S3 雷云母舰：扁长舰体 + 两侧机库 + 舰桥 + 下挂弹舱。
     * 机库亮度直接绑 b.minions —— 场上还剩几架僚机，看舱门就知道。 */
    carrier(b, now, player, p) {
      const s = p.s, hb = b.h;
      const bay = Math.min(1, (b.minions || 0) / 3);

      // 主舰体：横向梯形，比其它款更扁更宽
      glowHue(ctx, p.hh, 54, 60, 0, 0, Math.max(s, hb) * 0.66, 0.20);
      const g2 = ctx.createLinearGradient(0, -hb * 0.36, 0, hb * 0.36);
      g2.addColorStop(0, p.lite); g2.addColorStop(1, p.dark);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(-s * 0.34, -hb * 0.30);
      ctx.lineTo(s * 0.34, -hb * 0.30);
      ctx.lineTo(s * 0.50, hb * 0.06);
      ctx.lineTo(s * 0.30, hb * 0.34);
      ctx.lineTo(-s * 0.30, hb * 0.34);
      ctx.lineTo(-s * 0.50, hb * 0.06);
      ctx.closePath(); ctx.fill();

      // 两侧机库：舱门凹口 + 出库导轨，有僚机在场时亮
      for (let k = -1; k <= 1; k += 2) {
        const bx = k * s * 0.36;
        ctx.fillStyle = '#14100c';
        ctx.fillRect(bx - s * 0.09, -hb * 0.10, s * 0.18, hb * 0.26);
        glowHue(ctx, p.hh, 68, 66, bx, hb * 0.03, s * 0.22, 0.16 + 0.34 * bay);
        ctx.fillStyle = `hsla(${p.hh},68%,72%,${0.30 + 0.50 * bay})`;
        ctx.fillRect(bx - s * 0.07, hb * 0.10, s * 0.14, hb * 0.04);
        ctx.strokeStyle = `hsla(${p.hh},50%,70%,0.40)`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx, hb * 0.14); ctx.lineTo(bx, hb * 0.34); ctx.stroke();
      }

      // 舰桥：顶部梯形塔 + 舷窗带
      ctx.fillStyle = `hsl(${p.hh},48%,44%)`;
      ctx.beginPath();
      ctx.moveTo(-s * 0.15, -hb * 0.30);
      ctx.lineTo(s * 0.15, -hb * 0.30);
      ctx.lineTo(s * 0.10, -hb * 0.52);
      ctx.lineTo(-s * 0.10, -hb * 0.52);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = `hsla(${p.hh},64%,80%,0.75)`;
      for (let i = 0; i < 3; i++) ctx.fillRect(-s * 0.075 + i * s * 0.055, -hb * 0.46, s * 0.032, hb * 0.05);

      // 下挂弹舱：三格，充能时逐格点亮（从中间往两边）
      for (let i = -1; i <= 1; i++) {
        const lit = p.chargeGlow > (1 - Math.abs(i)) * 0.0 + Math.abs(i) * 0.5;
        ctx.fillStyle = lit ? `hsl(${p.hh},70%,${58 + 20 * p.chargeGlow}%)` : p.dark;
        ctx.fillRect(i * s * 0.15 - s * 0.05, hb * 0.32, s * 0.10, hb * 0.10);
      }
      if (p.chargeGlow > 0) glowHue(ctx, p.hh, 68, 78, 0, hb * 0.36, s * 0.34, 0.44 * p.chargeGlow);
    },

    /* S4 歼灭核心：三层同心环 + 中央球核。
     * 环的转向刻意与 b.beamPhase 同源 —— 旋臂光束扫哪边，环就转哪边，
     * 玩家不用记招式表，看环就能预判走位方向。这是本款唯一的"读盘"信息。 */
    core(b, now, player, p) {
      const s = p.s, hb = b.h;
      const bp = b.beamPhase || 0;
      const ovr = Math.max(0, Math.min(1, b.ovr || 0));

      // 三层环：外/内顺 beamPhase，中层反向，制造齿轮咬合感
      const rings = [[0.62, 1.0, 10, 3], [0.46, -1.6, 7, 4], [0.30, 2.4, 5, 3]];
      for (let i = 0; i < rings.length; i++) {
        const rr = rings[i][0], sp = rings[i][1], seg = rings[i][2], lw = rings[i][3];
        ctx.save();
        ctx.rotate(bp * sp);
        ctx.strokeStyle = `hsla(${p.hh},${56 + 14 * ovr}%,${64 + 20 * ovr}%,${0.55 + 0.30 * ovr})`;
        ctx.lineWidth = lw;
        for (let k = 0; k < seg; k++) {
          const a0 = (k / seg) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(s, hb) * rr * 0.5, a0, a0 + Math.PI * 2 / seg * 0.62);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 四根能量支架（固定不转，给旋转的环一个静止参照）
      ctx.fillStyle = p.dark;
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate(Math.PI / 4 + k * Math.PI / 2);
        ctx.fillRect(-s * 0.035, -Math.max(s, hb) * 0.34, s * 0.07, Math.max(s, hb) * 0.22);
        ctx.restore();
      }

      // 中央球核：脉动 + 过载时泛白发烫
      glowHue(ctx, p.hh, 68, 66, 0, 0,
        s * (0.34 + 0.10 * p.pulse) + 30 * p.chargeGlow + 26 * ovr,
        0.26 + 0.18 * p.pulse + 0.32 * p.chargeGlow + 0.30 * ovr);
      const g2 = ctx.createRadialGradient(0, 0, s * 0.02, 0, 0, s * 0.24);
      g2.addColorStop(0, `hsl(${p.hh},${72 - 30 * ovr}%,${76 + 20 * ovr}%)`);
      g2.addColorStop(1, p.col);
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(0, 0, s * (0.20 + 0.03 * p.pulse), 0, Math.PI * 2); ctx.fill();

      // 过载红边：血线以下时套一圈会喘的高温轮廓
      if (ovr > 0) {
        ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin((now || 0) / 70));
        ctx.strokeStyle = `hsl(${p.hh},80%,88%)`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },

    /* S5 相位幻影：棱形水晶 + 瞬移残影 + 公转棱镜碎片。
     * b.tele 是残影渐隐、b.ghostT 是"残影即将爆散"的倒计时 —— 两者都必须画出来，
     * 否则玩家会觉得"它凭空在别处开了一枪"，那是不讲道理，不是难。 */
    phaser(b, now, player, p) {
      const s = p.s, hb = b.h;
      const hull = (a) => {
        ctx.beginPath();
        ctx.moveTo(0, -hb * 0.50);
        ctx.lineTo(s * 0.42, 0);
        ctx.lineTo(0, hb * 0.50);
        ctx.lineTo(-s * 0.42, 0);
        ctx.closePath();
        ctx.globalAlpha = a; ctx.fill(); ctx.globalAlpha = 1;
      };

      // 残影：drawBoss 已 translate 到 (b.x,b.y)，残影按相对偏移画
      const tele = Math.max(0, Math.min(1, b.tele || 0));
      if (tele > 0 && (b.teleX || b.teleY)) {
        ctx.save();
        ctx.translate((b.teleX || 0) - b.x, (b.teleY || 0) - b.y);
        ctx.fillStyle = p.lite;
        hull(0.26 * tele);
        ctx.strokeStyle = `hsla(${p.hh},64%,84%,${0.42 * tele})`;
        ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }

      // 主体：ghostT 倒计时内半透（它正在"不在场"，打不实）
      const ghost = (b.ghostT || 0) > 0 ? 0.52 : 1;
      glowHue(ctx, p.hh, 54, 60, 0, 0, Math.max(s, hb) * 0.60, 0.20 * ghost);
      const g2 = ctx.createLinearGradient(0, -hb * 0.5, 0, hb * 0.5);
      g2.addColorStop(0, p.lite); g2.addColorStop(1, p.dark);
      ctx.fillStyle = g2;
      hull(ghost);
      // 棱面高光
      ctx.strokeStyle = `hsla(${p.hh},66%,88%,${0.55 * ghost})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -hb * 0.50); ctx.lineTo(0, hb * 0.50);
      ctx.moveTo(-s * 0.42, 0); ctx.lineTo(s * 0.42, 0);
      ctx.stroke();

      // 三块棱镜碎片绕核心公转
      const rot = (b.anchorT || 0) * 0.0016;
      ctx.fillStyle = `hsla(${p.hh},68%,80%,${0.72 * ghost})`;
      for (let i = 0; i < 3; i++) {
        const a = rot + i * Math.PI * 2 / 3;
        const ox = Math.cos(a) * s * 0.26, oy = Math.sin(a) * hb * 0.22;
        ctx.save(); ctx.translate(ox, oy); ctx.rotate(a * 1.7);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.07); ctx.lineTo(s * 0.05, 0);
        ctx.lineTo(0, s * 0.07); ctx.lineTo(-s * 0.05, 0);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      // 核心：充能时是唯一亮点（半透状态下也照常预告，公平性）
      glowHue(ctx, p.hh, 68, 78, 0, 0, s * (0.22 + 0.06 * p.pulse) + 26 * p.chargeGlow,
        0.22 + 0.12 * p.pulse + 0.40 * p.chargeGlow);
      ctx.fillStyle = `hsl(${p.hh},72%,${72 + 18 * p.chargeGlow}%)`;
      ctx.beginPath(); ctx.arc(0, 0, s * (0.09 + 0.02 * p.pulse + 0.04 * p.chargeGlow), 0, Math.PI * 2); ctx.fill();
    },

    /* S6 终末虚空：引力环 + 四块可崩落岩甲 + 中心暗洞。
     * b.form 每 +1 就少画一块岩甲 —— 血条之外的第二套进度指示，
     * 让"打了这么久到底有没有用"这个问题在造型上就有答案。 */
    void(b, now, player, p) {
      const s = p.s, hb = b.h;
      const R = Math.max(s, hb) * 0.5;
      const form = Math.max(0, Math.min(4, b.form || 0));
      const rot = (b.phase || 0);

      // 引力环 ×2 反向：虚线，越靠近核心转得越快
      ctx.save();
      ctx.rotate(rot * 0.5);
      ctx.strokeStyle = `hsla(${p.hh},58%,76%,0.30)`;
      ctx.lineWidth = 3; ctx.setLineDash([9, 15]);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, Math.PI * 2); ctx.stroke();
      ctx.rotate(-rot * 1.7);
      ctx.strokeStyle = `hsla(${p.hh},58%,76%,0.22)`;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.70, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 四块岩甲：已崩落的直接不画，缺口就是伤害进度
      glowHue(ctx, p.hh, 54, 60, 0, 0, R * 1.10, 0.20);
      for (let i = 0; i < 4; i++) {
        if (i < form) continue;
        const a = rot * 0.35 + i * Math.PI / 2;
        ctx.save();
        ctx.rotate(a);
        const g2 = ctx.createLinearGradient(0, -R * 0.56, 0, -R * 0.18);
        g2.addColorStop(0, p.col); g2.addColorStop(1, p.dark);
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.moveTo(-R * 0.30, -R * 0.22);
        ctx.lineTo(-R * 0.20, -R * 0.56);
        ctx.lineTo(R * 0.22, -R * 0.52);
        ctx.lineTo(R * 0.30, -R * 0.20);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `hsla(${p.hh},50%,82%,0.35)`; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }

      // 中心暗洞：径向渐变吸到近黑，充能时从洞里透出光
      const g3 = ctx.createRadialGradient(0, 0, R * 0.04, 0, 0, R * 0.42);
      g3.addColorStop(0, `hsl(${p.hh},74%,${16 + 56 * p.chargeGlow}%)`);
      g3.addColorStop(0.55, `hsl(${p.hh},40%,10%)`);
      g3.addColorStop(1, `hsla(${p.hh},40%,10%,0)`);
      ctx.fillStyle = g3;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2); ctx.fill();
      if (p.chargeGlow > 0) glowHue(ctx, p.hh, 68, 78, 0, 0, R * 0.50, 0.50 * p.chargeGlow);
      // 视界边缘
      ctx.strokeStyle = `hsla(${p.hh},64%,72%,${0.40 + 0.30 * p.pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R * (0.30 + 0.02 * p.pulse), 0, Math.PI * 2); ctx.stroke();
    },

    /* S7 织网者（EX）：背景织机格 + 放射丝线冠 + 纺锤菱核 + 分段核心。
     * 丝线股数直接绑 p.r —— 掉血就断股，冠越秃说明打得越深（血条之外的第二套进度指示，
     * 和 void 的岩甲崩落是同一套设计语言）。
     * ⚠ 渲染零 RNG：冠的自转走 b.phase（move 里按 dt 累加），背景织机格走 now
     *   （drawBoss 传进来的确定性渲染时钟 rt，不是 performance.now），
     *   丝线呼吸走 sin(rot + i) —— 六档刷新率下逐位一致（S16）。 */
    weaverqueen(b, now, player, p) {
      const s = p.s, hb = b.h;
      const R = Math.max(s, hb) * 0.5;
      const rot = (b.phase || 0);
      const tele = Math.max(0, Math.min(1, b.tele || 0));

      // ① 瞬移残影：离开点留一枚淡菱。瞬移必须画出"它已经不在那了"，
      //    否则玩家会觉得是"凭空换位"——那是耍赖，不是难度。
      if (tele > 0 && (b.teleX || b.teleY)) {
        ctx.save();
        ctx.translate((b.teleX || 0) - b.x, (b.teleY || 0) - b.y);
        ctx.strokeStyle = `hsla(${p.hh},64%,84%,${0.40 * tele})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -hb * 0.42); ctx.lineTo(s * 0.32, 0);
        ctx.lineTo(0, hb * 0.42); ctx.lineTo(-s * 0.32, 0);
        ctx.closePath(); ctx.stroke();
        ctx.restore();
      }

      // ② 背景织机格：正交虚线格缓慢转动，是招牌「织网」的视觉预告 ——
      //    玩家第一眼就该知道这东西和"网"有关。
      ctx.save();
      ctx.rotate((now || 0) / 5200);
      ctx.strokeStyle = `hsla(${p.hh},46%,72%,0.09)`;
      ctx.lineWidth = 2; ctx.setLineDash([7, 11]);
      for (let i = -2; i <= 2; i++) {
        const o = i * R * 0.34;
        ctx.beginPath(); ctx.moveTo(-R * 1.12, o); ctx.lineTo(R * 1.12, o); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(o, -R * 1.12); ctx.lineTo(o, R * 1.12); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();

      // ③ 丝线冠：12 股径向丝 + 末端结点，两圈虚线弧把它们织成网。
      //    live 随 p.r 递减 —— 满血 12 股，濒死只剩 5 股（断股即伤害进度）。
      const STRANDS = 12;
      const live = Math.max(4, Math.round(STRANDS * (0.42 + 0.58 * p.r)));
      glowHue(ctx, p.hh, 54, 60, 0, 0, R * 1.04, 0.18);
      ctx.save();
      ctx.rotate(rot * 0.6);
      for (let i = 0; i < live; i++) {
        const a = Math.PI * 2 * (i / STRANDS);
        const ca = Math.cos(a), sa = Math.sin(a);
        const len = R * (0.62 + 0.24 * Math.sin(rot * 1.3 + i));   // 一伸一缩的"抽丝"
        ctx.strokeStyle = `hsla(${p.hh},52%,74%,0.34)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ca * R * 0.22, sa * R * 0.22);
        ctx.lineTo(ca * len, sa * len);
        ctx.stroke();
        ctx.fillStyle = `hsla(${p.hh},66%,80%,${0.42 + 0.34 * p.pulse})`;
        ctx.beginPath(); ctx.arc(ca * len, sa * len, R * 0.035, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = `hsla(${p.hh},50%,78%,0.22)`;
      ctx.lineWidth = 2; ctx.setLineDash([5, 9]);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.52, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // ④ 舰体：纵长菱核 + 两侧纺锤臂（织机的"梭"）
      const g2 = ctx.createLinearGradient(0, -hb * 0.46, 0, hb * 0.46);
      g2.addColorStop(0, p.lite); g2.addColorStop(1, p.dark);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(0, -hb * 0.46);
      ctx.lineTo(s * 0.24, -hb * 0.10);
      ctx.lineTo(0, hb * 0.46);
      ctx.lineTo(-s * 0.24, -hb * 0.10);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = p.dark;
      for (let k = -1; k <= 1; k += 2) {
        ctx.beginPath();
        ctx.moveTo(k * s * 0.19, -hb * 0.16);
        ctx.lineTo(k * s * 0.42, -hb * 0.02);
        ctx.lineTo(k * s * 0.38, hb * 0.20);
        ctx.lineTo(k * s * 0.17, hb * 0.10);
        ctx.closePath(); ctx.fill();
      }
      // 甲缝：血越低裂纹越显（破损态由 p.r 驱动，零 RNG）
      ctx.strokeStyle = `hsla(${p.hh},34%,18%,${0.30 + 0.45 * (1 - p.r)})`;
      ctx.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        const yy = -hb * 0.34 + hb * 0.60 * (i / 4);
        ctx.beginPath(); ctx.moveTo(-s * 0.16, yy); ctx.lineTo(s * 0.16, yy); ctx.stroke();
      }

      // ⑤ 核心分段：三段同心弧反向扫动 + 脉动芯，充能时整芯点亮（开火预告）
      for (let i = 0; i < 3; i++) {
        const rr = R * (0.14 + 0.07 * i);
        const a0 = rot * (1.0 + 0.5 * i) * (i % 2 ? -1 : 1) + i * 0.7;
        ctx.strokeStyle = `hsla(${p.hh},62%,${72 + 8 * i}%,${0.34 + 0.30 * p.pulse})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + Math.PI * 1.25); ctx.stroke();
      }
      glowHue(ctx, p.hh, 68, 78, 0, 0, R * (0.24 + 0.06 * p.pulse) + 26 * p.chargeGlow,
        0.24 + 0.14 * p.pulse + 0.40 * p.chargeGlow);
      ctx.fillStyle = `hsl(${p.hh},72%,${68 + 20 * p.chargeGlow}%)`;
      ctx.beginPath();
      ctx.arc(0, 0, R * (0.10 + 0.02 * p.pulse + 0.04 * p.chargeGlow), 0, Math.PI * 2); ctx.fill();
    },
  };

  /* ==== T3-7 · 破损态 / 崩落氛围层（7 款通用）==============================
   * 设计文档 design/gdd/t3-gameplay-breadth.md §5。两条硬约束，改动时不可破：
   *   ① 渲染层零 RNG —— 裂纹位置走确定性散列 hash01(seed+i)，呼吸/自转走
   *      drawBoss 传进来的 now（= 渲染时钟 rt，确定性）。绝不用 Math.random()
   *      或 performance.now()，否则六档刷新率画面不一致（S16 红线）。
   *   ② ctx 自平衡 —— save/restore 配对，globalAlpha / lineDash / lineCap 出门复位。
   *
   * 为什么破损态挡在 0.66 / 0.33 两道坎上：这两个数就是 checkBossPhase 的相位
   * 阈值。玩家看见"它开始掉渣"的同一刻正好是相位切换 —— 破损态因此不只是装饰，
   * 而是一条不用读血条就能读到的战况信息（和 void 的岩甲崩落、weaverqueen 的
   * 断股是同一套设计语言）。
   * ==================================================================== */

  // 确定性散列（与 game.js 的 hash01 同式）：整数 → [0,1)，取代渲染层的 Math.random
  const hash01 = (i) => { const v = i * 0.6180339887498949; return v - Math.floor(v); };

  /* 逐款破损参数。cracks 基础裂纹数 / vents 能量逸散口数 / spanX,spanY 裂纹散布
   * 范围（相对 s 与 b.h）/ tint 暗化强度 / seed 款别散列种子。
   * seed 互质取值：保证七款的裂法各不相同，而同一款每局裂在同一处 ——
   * 玩家能把"裂纹形状"当成血量刻度来读，随机裂纹反而没有这个信息价值。 */
  const BOSS_DAMAGE = {
    sentinel:    { cracks: 5, vents: 2, spanX: 0.28, spanY: 0.40, tint: 0.24, seed: 11 },  // 走精灵：暗化收敛，别糊住贴图
    scorpion:    { cracks: 6, vents: 2, spanX: 0.32, spanY: 0.30, tint: 0.30, seed: 23 },  // 甲壳厚：裂纹密而短
    carrier:     { cracks: 7, vents: 3, spanX: 0.44, spanY: 0.26, tint: 0.28, seed: 37 },  // 舰体扁长：裂纹横向铺开
    core:        { cracks: 4, vents: 4, spanX: 0.24, spanY: 0.24, tint: 0.20, seed: 41 },  // 环状体：裂纹少、逸散多（过载感）
    phaser:      { cracks: 5, vents: 2, spanX: 0.28, spanY: 0.38, tint: 0.22, seed: 53 },  // 水晶：裂纹沿棱线，暗化最轻
    void:        { cracks: 6, vents: 3, spanX: 0.34, spanY: 0.34, tint: 0.32, seed: 67 },  // 岩甲：暗化最重
    weaverqueen: { cracks: 6, vents: 3, spanX: 0.26, spanY: 0.40, tint: 0.30, seed: 79 },  // 纵长菱核：裂纹竖向
  };
  const BOSS_DAMAGE_DEF = { cracks: 5, vents: 2, spanX: 0.30, spanY: 0.36, tint: 0.26, seed: 7 };

  /* 破损层：画在各款造型之后（叠在舰体表面），相位涟漪之前。
   * d = 1 - p.r 是破损度；p.r 已在 drawBoss 做过 maxHp>0 的 NaN 护栏。 */
  function bossDamageLayer(b, now, p) {
    const d = 1 - p.r;
    if (d <= 0.34) return;                                  // 血量 > 0.66：完好，只吃各款自身的 pulse
    const cfg = BOSS_DAMAGE[b.kind] || BOSS_DAMAGE_DEF;
    const heavy = d > 0.67;                                 // 血量 < 0.33：重创档
    const kk = Math.max(0, Math.min(1, heavy ? (d - 0.67) / 0.33 : (d - 0.34) / 0.33));  // 档内插值
    const s = p.s, hb = b.h, big = Math.max(s, hb);
    ctx.save();

    // ① 暗化：受损装甲失去反光，整体压一层暗椭圆。轻创起 0.25、重创到满。
    ctx.globalAlpha = cfg.tint * (heavy ? 0.55 + 0.45 * kk : 0.25 + 0.30 * kk);
    ctx.fillStyle = `hsl(${p.hh},22%,10%)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.40, hb * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // ② 裂纹：三点折线（起点 → 偏折点 → 终点），比直线更像"崩"而不是"划"。
    //    重创档裂纹数翻倍、线更粗 —— 一眼分得出两档，不用去数条数。
    const n = heavy ? cfg.cracks * 2 : cfg.cracks;
    ctx.strokeStyle = `hsla(${p.hh},30%,18%,${0.45 + 0.40 * kk})`;
    ctx.lineWidth = heavy ? 2.2 : 1.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const h1 = hash01(cfg.seed + i * 3 + 1);
      const h2 = hash01(cfg.seed + i * 3 + 2);
      const h3 = hash01(cfg.seed + i * 3 + 3);
      const x0 = (h1 * 2 - 1) * s * cfg.spanX;
      const y0 = (h2 * 2 - 1) * hb * cfg.spanY;
      const a = h3 * Math.PI * 2;
      const len = (heavy ? 0.17 : 0.11) * big * (0.6 + 0.8 * h1);
      const mx = x0 + Math.cos(a) * len * 0.55, my = y0 + Math.sin(a) * len * 0.55;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(mx + Math.cos(a + 0.9) * len * 0.22, my + Math.sin(a + 0.9) * len * 0.22);
      ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // ③ 能量逸散：只在重创档出现 —— 裂口往外喷的呼吸光点。
    //    相位 now/150 + i*1.7 错开，几个口不会同步闪（同步闪像故障灯，不像泄能）。
    if (heavy) {
      for (let i = 0; i < cfg.vents; i++) {
        const vx = (hash01(cfg.seed * 2 + i * 5 + 1) * 2 - 1) * s * cfg.spanX * 0.9;
        const vy = (hash01(cfg.seed * 2 + i * 5 + 2) * 2 - 1) * hb * cfg.spanY * 0.9;
        const br = 0.45 + 0.55 * Math.abs(Math.sin((now || 0) / 150 + i * 1.7));
        glowHue(ctx, p.hh, 68, 78, vx, vy, big * (0.10 + 0.06 * br), (0.18 + 0.30 * br) * kk);
        ctx.fillStyle = `hsla(${p.hh},74%,${76 + 12 * br}%,${(0.30 + 0.45 * br) * kk})`;
        ctx.beginPath();
        ctx.arc(vx, vy, big * 0.018 * (0.8 + 0.5 * br), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* 氛围层（吸积盘 / 相位回声 / 织机网）：只有 void / phaser / weaverqueen
   * 这三款"空间系"Boss 有 —— 机械系（sentinel/scorpion/carrier/core）加盘会
   * 串味。画在 shape() 之前，沉在舰体背后。
   * 全部相位走 now（渲染时钟 rt）与 p.r，零 RNG。 */
  const BOSS_AURA = {
    /* 终末虚空：三圈同心吸积盘，压扁成椭圆（盘不是球）。
     * 半径随 p.r 收缩 —— 血越低盘吸得越紧，濒死时整个盘贴到本体上，
     * 视觉上就是"它正在把自己吸塌"。 */
    void(b, now, p) {
      const R = Math.max(p.s, b.h) * 0.5;
      const tight = 0.62 + 0.38 * p.r;                       // 血量驱动的收缩系数
      ctx.save();
      ctx.rotate((now || 0) / 2600);
      for (let i = 0; i < 3; i++) {
        const rr = R * tight * (1.34 + i * 0.30);
        ctx.strokeStyle = `hsla(${p.hh},40%,60%,${0.13 - i * 0.03})`;
        ctx.lineWidth = 6 - i;
        ctx.beginPath();
        ctx.ellipse(0, 0, rr, rr * 0.34, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 盘上的物质团：8 颗沿盘运行的亮点，让"它在转"这件事有参照物
      for (let i = 0; i < 8; i++) {
        const a = (now || 0) / 900 + i * Math.PI / 4;
        const rr = R * tight * 1.50;
        glowHue(ctx, p.hh, 68, 66, Math.cos(a) * rr, Math.sin(a) * rr * 0.34, R * 0.16, 0.10 + 0.06 * p.pulse);
      }
      ctx.restore();
    },

    /* 相位幻影：两圈反向自转的回声环 + 四道折射短弧。
     * 整体不透明度绑 b.tele（刚瞬移完最亮）—— 玩家余光扫到"空间在抖"，
     * 就知道它下一秒要换位，这是瞬移的公平预告。 */
    phaser(b, now, p) {
      const R = Math.max(p.s, b.h) * 0.5;
      const tele = Math.max(0, Math.min(1, b.tele || 0));
      const a0 = 0.10 + 0.16 * tele;
      ctx.save();
      ctx.rotate((now || 0) / 3100);
      ctx.strokeStyle = `hsla(${p.hh},50%,72%,${a0})`;
      ctx.lineWidth = 3; ctx.setLineDash([6, 12]);
      ctx.beginPath(); ctx.arc(0, 0, R * 1.20, 0, Math.PI * 2); ctx.stroke();
      ctx.rotate(-(now || 0) / 1500);
      ctx.strokeStyle = `hsla(${p.hh},50%,72%,${a0 * 0.72})`;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.98, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 折射短弧：四段沿环滑动的高光，速度与环反向，制造"空间错位"
      ctx.strokeStyle = `hsla(${p.hh},64%,86%,${0.10 + 0.22 * tele})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const s0 = (now || 0) / 700 + i * Math.PI / 2;
        ctx.beginPath(); ctx.arc(0, 0, R * 1.09, s0, s0 + 0.42); ctx.stroke();
      }
      ctx.restore();
    },

    /* 织网者：外圈斜向织机网。shape() 内部已有一层正交虚线格（近景经纬），
     * 这里补的是远景的 ±45° 斜纹 + 一圈缓转的网环 —— 两层不同角度、不同转速
     * 叠出"织机在运转"的纵深，而不是同一张格子画两遍。 */
    weaverqueen(b, now, p) {
      const R = Math.max(p.s, b.h) * 0.5;
      ctx.save();
      ctx.rotate(Math.PI / 4 - (now || 0) / 7400);            // 与 shape 内格子反向慢转
      ctx.strokeStyle = `hsla(${p.hh},44%,70%,0.075)`;
      ctx.lineWidth = 2; ctx.setLineDash([5, 13]);
      for (let i = -3; i <= 3; i++) {
        const o = i * R * 0.42;
        ctx.beginPath(); ctx.moveTo(-R * 1.55, o); ctx.lineTo(R * 1.55, o); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(o, -R * 1.55); ctx.lineTo(o, R * 1.55); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
      // 网环：一圈由 12 个结点串起的外环，结点呼吸相位错开（sin(now+i)）
      ctx.save();
      ctx.rotate((now || 0) / 4300);
      ctx.strokeStyle = `hsla(${p.hh},48%,74%,0.14)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.32, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        const br = 0.4 + 0.6 * Math.abs(Math.sin((now || 0) / 640 + i * 0.8));
        ctx.fillStyle = `hsla(${p.hh},62%,80%,${0.10 + 0.20 * br})`;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * R * 1.32, Math.sin(a) * R * 1.32, R * 0.028 * (0.7 + 0.6 * br), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  };

  /* 通用舰体（S1 哨戒机甲 + 任何未注册款的兜底）：
   * 旋转能量冠 + 装甲舰体 + 双翼炮塔 + 脉动核心 + 追踪眼。 */
  function bossHullGeneric(b, now, player, p) {
    const s = p.s, bh = p.hh;
    const col = p.col, lite = p.lite, dark = p.dark;

    // 旋转能量冠（虚线环）
    ctx.save();
    ctx.rotate((now || 0) / 1400);
    ctx.strokeStyle = `hsla(${bh},58%,76%,0.45)`;
    glowHue(ctx, bh, 54, 60, 0, -b.h * 0.02, s * 0.92, 0.20);
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
    glowHue(ctx, bh, 54, 60, 0, 0, Math.max(s, b.h) * 0.68, 0.24);
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

    // 双翼炮塔
    ctx.fillStyle = `hsl(${bh},48%,44%)`;
    [-1, 1].forEach((sx) => {
      ctx.beginPath();
      ctx.arc(sx * s * 0.40, b.h * 0.10, s * 0.07, 0, Math.PI * 2); ctx.fill();
    });

    // 顶部传感器
    ctx.fillStyle = dark;
    ctx.fillRect(-s * 0.06, -b.h * 0.62, s * 0.12, b.h * 0.14);

    // 核心（脉动，亮度随血量 + 充能）
    const coreL = 48 + 22 * p.r * p.pulse + 30 * p.chargeGlow;
    const core = `hsl(${bh},70%,${coreL}%)`;
    // 亮度固定、强度走 alpha —— 否则 coreL 每帧连续变化会把图集颜色槽打爆
    glowHue(ctx, bh, 68, 66, 0, -b.h * 0.02,
      s * (0.46 + 0.10 * p.pulse) + 26 * p.chargeGlow, 0.30 + 0.16 * p.pulse + 0.34 * p.chargeGlow);
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * (0.13 + 0.03 * p.pulse + 0.05 * p.chargeGlow), 0, Math.PI * 2); ctx.fill();
    // 核心散热纹
    ctx.strokeStyle = `hsla(${bh},56%,84%,${0.44 + 0.36 * p.pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * 0.20, 0, Math.PI * 2); ctx.stroke();

    // 追踪眼（朝向玩家）
    if (player) {
      const ea = Math.atan2(player.y - b.y, player.x - b.x);
      const ex = Math.cos(ea) * s * 0.30, ey = Math.sin(ea) * s * 0.12 - b.h * 0.02;
      glowHue(ctx, bh, 68, 78, ex, ey, s * 0.20, 0.40);
      ctx.fillStyle = `hsla(${bh},66%,86%,0.88)`;
      ctx.beginPath(); ctx.arc(ex, ey, s * 0.05, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---- Boss（按 kind 分发七款造型，缺省回落通用舰体） ----
  function drawBoss(b, now, player) {
    const s = b.w;
    const shape = BOSS_SHAPES[b.kind];
    const hh = (b.hue != null) ? b.hue : 10;
    /* NaN 护栏：maxHp 理论上恒 > 0，但 Boss 是调试面板可写的对象，一旦除零，
     * r 变 NaN 会一路灌进 hsl() —— 那不会抛错，只会静默画不出来，最难查。
     * p 提到分支之前算：精灵路径（sentinel）也要吃 T3-7 破损层，两条路径共用一份。 */
    const charge = Math.max(0, Math.min(1, (b.fireT || 0) / (b.fireGap || 1)));
    const p = {
      s, hh,
      r: (b.maxHp > 0) ? Math.max(0, Math.min(1, b.hp / b.maxHp)) : 0,
      // 方向 B：Boss 同样降饱和，但保留更宽的明度跨度（lite→dark）以撑住体量感
      col: `hsl(${hh},54%,56%)`,
      lite: `hsl(${hh},60%,74%)`,
      dark: `hsl(${hh},46%,26%)`,
      pulse: 0.6 + 0.4 * Math.sin((now || 0) / 180),
      charge,
      // 充能预告（即将开火时核心变亮）
      chargeGlow: charge > 0.8 ? (charge - 0.8) / 0.2 : 0,
    };
    /* boss.png 那张贴图是照着 S1 哨戒机甲画的。扩容期新增的六款没有对应贴图，
     * 硬套会让七个 Boss 长成同一个样 —— 差异化 Boss 的第一条就废了。
     * 所以：注册了专属造型的一律走矢量，只有未注册款（尚未画专属造型的 Boss）才吃精灵。 */
    if (!shape && DJFE.sprites.isReady() && DJFE.sprites.get('boss')) {
      const bh = hh;
      // 旋转能量冠（沿用原虚线环作氛围光环，缩在精灵背后）
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate((now || 0) / 1400);
      ctx.strokeStyle = `hsla(${bh},58%,76%,0.32)`;
      ctx.lineWidth = 3; ctx.setLineDash([10, 14]);
      ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // 充能光晕（铺在精灵背后，sprite 之后核心还会再亮一次）
      glowHue(ctx, bh, 54, 60, b.x, b.y, Math.max(s, b.h) * 0.68, 0.18);
      ctx.save();
      ctx.translate(b.x, b.y);
      drawSprite('boss', s * 1.5, b.h * 1.9, bh);
      // 充能预告：核心高亮（叠加在精灵核心区）
      const chargeGlow = p.chargeGlow;
      if (chargeGlow > 0) {
        glowHue(ctx, bh, 68, 78, 0, -b.h * 0.02, s * 0.5, 0.45 * chargeGlow);
        ctx.fillStyle = `hsla(${bh},70%,82%,${0.55 * chargeGlow})`;
        ctx.beginPath(); ctx.arc(0, -b.h * 0.02, s * 0.13, 0, Math.PI * 2); ctx.fill();
      }
      // T3-7 破损态：精灵路径（sentinel）同样要吃，否则七款里独它不掉渣
      bossDamageLayer(b, now, p);
      ctx.restore();
      return;
    }
    // ---- 矢量路径（七款分发 / 通用兜底）----
    ctx.save();
    ctx.translate(b.x, b.y);

    // T3-7 氛围层：仅空间系三款（void / phaser / weaverqueen），沉在舰体背后
    const aura = BOSS_AURA[b.kind];
    if (aura) aura(b, now, p);

    if (shape) shape(b, now, player, p);
    else bossHullGeneric(b, now, player, p);

    // T3-7 破损态：叠在造型之上、相位涟漪之下（涟漪是"无敌中"，不该被裂纹压住）
    bossDamageLayer(b, now, p);

    /* 公共尾 · 相位切换无敌：七款统一叠一层护盾涟漪。
     * 没有这层，玩家在 1.2s 无敌窗口里会以为"我打不中它"或"游戏卡了"，
     * 而不是"它现在无敌"—— 反馈缺失比难度本身更劝退。 */
    if (b.invulnT > 0) {
      ctx.globalAlpha = 0.26 + 0.34 * Math.abs(Math.sin((now || 0) / 90));
      ctx.strokeStyle = `hsl(${hh},70%,86%)`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(s, b.h) * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  DJFE.draw = { player: drawPlayer, enemy: drawEnemy, item: drawItem, boss: drawBoss, paintShip };

})(window.DJFE);
