// tools/playtest.mjs — 用 Playwright(Chromium + swiftshader 软件 WebGL) 无头驱动游戏，
// 用于「自己试玩/截图/量 FPS/抓渲染异常」。不改动游戏代码，只读取 DJFE.__debug 状态。
//
// 用法:
//   node tools/playtest.mjs [URL] [OUT_PNG] [SECONDS]
// 例:
//   node tools/playtest.mjs file:///D:/MyGame/thunder-fighter/www/index.html tools/shot.png 5
//
// 说明: Playwright 装在 managed node workspace，ESM 不认 NODE_PATH，故用 createRequire 指过去。

import { createRequire } from 'node:module';
const require = createRequire('C:\\Users\\22091\\.workbuddy\\binaries\\node\\workspace\\');
const { chromium } = require('playwright');

const URL = process.argv[2] || 'file:///D:/MyGame/thunder-fighter/www/index.html';
const OUT = process.argv[3] || 'D:/MyGame/thunder-fighter/tools/shot.png';
const SECONDS = parseInt(process.argv[4] || '5', 10);
const BOT = process.argv.includes('--bot') || process.argv.includes('-b');

(async () => {
  // 用系统已装的 Chrome（channel:'chrome'），免去下载 Playwright 自带的 chromium。
  // swiftshader 软件渲染让无头环境也能跑 WebGL（3D 覆盖层）。
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--allow-file-access-from-files',
      '--no-sandbox',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') errors.push(`[${t}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DJFE && window.DJFE.Game, null, { timeout: 8000 });

  // FPS 计数器
  await page.evaluate(() => {
    window.__frames = 0;
    const f = () => { window.__frames++; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });

  // 启动游戏
  await page.click('#startBtn', { timeout: 4000 });

  // 可选：简单自瞄 bot，把玩家移到最近敌机正下方，用于验证命中火花/子弹效果
  if (BOT) {
    await page.evaluate(() => {
      window.__bot = true;
      const f = () => {
        if (!window.__bot) return;
        const g = window.DJFE.__debug.game;
        const p = g.player;
        const enemies = g.enemies;
        const W = 480; // 逻辑宽度（与游戏一致）
        if (p && enemies && enemies.length) {
          let target = enemies[0];
          let best = Infinity;
          for (const e of enemies) {
            const dy = e.y - p.y;
            const d = Math.abs(e.x - p.x) + dy;
            if (d < best) { best = d; target = e; }
          }
          const spd = 6;
          if (target.x > p.x + 2) p.x = Math.min(W - 20, p.x + spd);
          else if (target.x < p.x - 2) p.x = Math.max(20, p.x - spd);
        }
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  }

  await page.waitForTimeout(SECONDS * 1000);

  const frames = await page.evaluate(() => window.__frames);
  await page.screenshot({ path: OUT });

  const state = await page.evaluate(() => {
    const g = window.DJFE.__debug.game;
    return {
      state: g.state,
      stage: g.stage,
      enemies: g.enemies.length,
      bullets: g.bullets.length,
      ebullets: g.ebullets.length,
      particles: g.particles.length,
      boss: g.boss ? g.boss.kind : null,
      score: g.score,
    };
  });

  console.log('FRAMES:', frames, ' FPS~', (frames / SECONDS).toFixed(1));
  console.log('STATE :', JSON.stringify(state));
  console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
  await browser.close();
})().catch((e) => {
  console.error('PLAYTEST FAIL:', e.message);
  process.exit(1);
});
