import { createRequire } from 'node:module';
const require = createRequire('C://Users//22091//.workbuddy//binaries//node//workspace//');
const { chromium } = require('playwright');

const ROOT = 'D:/MyGame/thunder-fighter';
const OUT = ROOT + '/tools/shot_hitfx.png';

const SHOT_MS = 500;

async function capture(skin, label, outPath) {
  const browser = await chromium.launch({
    headless: true, channel: 'chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });

  // 关键：加载根 index.html → src/game.js（我编辑过的那份），而非 www/ 的同步副本
  await page.goto('file:///' + ROOT + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DJFE && window.DJFE.Game, null, { timeout: 8000 });
  await page.evaluate((s) => {
    DJFE.skins.select(s);
    DJFE.Game.setDifficulty('normal');
  }, skin);
  await page.click('#startBtn');
  await page.waitForTimeout(300);

  // 注入一颗高血量、不移动、不反击的敌机，挡在玩家正上方，吃真实自动开火 → 持续出命中冲击
  await page.evaluate(() => {
    const g = window.DJFE.__debug.game, p = window.DJFE.__debug.player;
    g.enemies.length = 0; g.bullets.length = 0; g.particles.length = 0;
    p.x = 480;
    g.enemies.push({
      type: 'mook', x: 480, y: p.y - 160, baseX: 480, baseY: p.y - 160, w: 40, h: 40,
      vx: 0, vy: 0, hp: 1e9, hue: 30, score: 10, phase: 0, fireT: 9999, lockT: 0,
      diving: false, dvx: 0, dvy: 0, hover: true, flash: 0, px: 480, py: p.y - 160,
      sx: 0, sy: 0, minion: 0, spin: 0,
    });
  });
  await page.waitForTimeout(SHOT_MS);

  const stats = await page.evaluate(() => {
    const g = window.DJFE.__debug.game;
    const streaks = g.particles.filter(p => p.kind === 'streak');
    return {
      total: g.particles.length,
      streaks: streaks.length,
      streakHues: [...new Set(streaks.map(p => p.hue))],
      rings: g.rings.length,
      ringHues: [...new Set(g.rings.map(r => r.hue))],
    };
  });
  await page.screenshot({ path: outPath });
  await browser.close();
  console.log(`[${label}] skin=${skin} → ${outPath}`);
  console.log('   particles=' + stats.total + ' streaks=' + stats.streaks +
              ' streakHues=' + JSON.stringify(stats.streakHues) +
              ' rings=' + stats.rings + ' ringHues=' + JSON.stringify(stats.ringHues) +
              ' pageErrors=' + errors.length + (errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''));
  return stats;
}

(async () => {
  try {
    const cyan = await capture('cyan_knight', 'M档基线', ROOT + '/tools/shot_hitfx.png');
    const violet = await capture('violet', 'L档+微环', ROOT + '/tools/shot_hitfx_violet.png');
    const ok = cyan.streaks > 0 && violet.streaks > 0 && cyan.streakHues.includes(190) && violet.streakHues.includes(259) && violet.rings > 0;
    console.log(ok ? '\nSHOT OK — 命中冲击可见且为武器色，L 档带微环' : '\nSHOT WARN — 见上方统计');
    process.exit(ok ? 0 : 2);
  } catch (e) {
    console.error('SHOT FAILED: ' + (e && e.message ? e.message : e));
    console.error('（Playwright/Chrome 不可用或环境受限；逻辑级验证 tools/verify_hitfx.cjs 已提供确定性证据）');
    process.exit(3);
  }
})();
