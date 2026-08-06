import { createRequire } from 'node:module';
const require = createRequire('C://Users//22091//.workbuddy//binaries//node//workspace//');
const { chromium } = require('playwright');

// 7 款 Boss（顺序与 STAGES / render3d.js BOSS_KINDS_LIST 一致）
const KINDS = ['sentinel', 'scorpion', 'carrier', 'core', 'phaser', 'void', 'weaverqueen'];

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--allow-file-access-from-files', '--no-sandbox'];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args });
  const page = await browser.newPage({ viewport: { width: 760, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  for (const kind of KINDS) {
    errors.length = 0;
    await page.goto('file:///D:/MyGame/thunder-fighter/www/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.DJFE && window.DJFE.Game && window.DJFE.render3d, null, { timeout: 8000 });
    await page.click('#startBtn', { timeout: 4000 });
    // 强制刷出指定种类的 Boss（debug 专用，不影响生产逻辑）
    await page.evaluate((k) => {
      if (DJFE.__debug && DJFE.__debug.spawnBoss) DJFE.__debug.spawnBoss(k);
    }, kind);
    // 等 Boss 入场落位（y 从 -90 升到 H*0.16）并稳定渲染
    await page.waitForTimeout(1600);
    const OUT = `tools/shot_boss_${kind}.png`;
    await page.screenshot({ path: OUT });
    // 回读 3D 层状态：boss 网格应可见
    const diag = await page.evaluate(() => {
      const st = DJFE.render3d._state();
      const g = DJFE.__debug.game;
      const kind = g.boss ? g.boss.kind : null;
      const vis = st && st.bosses && kind && st.bosses[kind] ? st.bosses[kind].group.visible : null;
      const r3dActive = !!(st && !st.renderer.__failed);
      const b64 = window.DJFE_SPRITE_B64 || {};
      return { bossKind: kind, meshVisible: vis, hasTex: !!b64['boss_' + kind], r3dActive };
    });
    console.log(`[${kind}] saved ${OUT} :: diag=${JSON.stringify(diag)} errors=${errors.length}`);
    if (errors.length) console.log('   errors:', errors.slice(0, 4));
  }
  await browser.close();
})();
