import { createRequire } from 'node:module';
const require = createRequire('C://Users//22091//.workbuddy//binaries//node//workspace//');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--allow-file-access-from-files','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 720 }, deviceScaleFactor: 1 });
  await page.goto('file:///D:/MyGame/thunder-fighter/www/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DJFE && window.DJFE.Game, null, { timeout: 8000 });
  await page.evaluate(() => { DJFE.skins.select('cyan_knight'); DJFE.Game.setDifficulty('normal'); });
  await page.click('#startBtn');
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const g = window.DJFE.__debug.game;
    const p = window.DJFE.__debug.player;
    const out = {};
    for (const power of [3, 4, 5]) {
      g.power = power;
      g.bullets.length = 0;
      p.x = 480; p.y = 600;
      g.lastShot = -1e9; // 强制下一帧触发 shoot()
    }
    return out;
  });
  // 让 rAF 跑约 300ms，可能触发多次射击；然后断言所有 cyan dot 子弹 vx 均为竖直
  await page.waitForTimeout(300);
  const bullets = await page.evaluate(() => {
    const g = window.DJFE.__debug.game;
    return g.bullets.map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: b.r }));
  });
  const allVertical = bullets.every(b => b.vx === 0 || b.vx === undefined || b.vx === null);
  console.log(JSON.stringify({ totalBullets: bullets.length, allVertical, sample: bullets.slice(0, 8) }, null, 2));
  await browser.close();
  if (!allVertical) process.exit(1);
})();
