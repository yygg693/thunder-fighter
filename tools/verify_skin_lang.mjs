import { createRequire } from 'node:module';
const require = createRequire('C://Users//22091//.workbuddy//binaries//node//workspace//');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--allow-file-access-from-files','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto('file:///D:/MyGame/thunder-fighter/www/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DJFE && window.DJFE.Game, null, { timeout: 8000 });
  await page.click('#menuSkinBtn');
  await page.waitForTimeout(300);

  const zh = await page.evaluate(() => {
    const cards = Array.from(document.getElementById('skinGrid').children);
    const det = document.getElementById('skinDetail');
    return {
      lang: window.DJFE.settings.lang,
      cyanTag: cards[0].querySelector('.skintag').textContent,
      cyanWpn: cards[0].querySelector('.skinweapon').textContent,
      detail: det.textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
    };
  });
  // 直接 dispatch click（设置浮层隐藏，按钮不可见但仍在 DOM，事件处理 attached）
  await page.evaluate(() => {
    const btn = document.querySelector('#settings .seg button[data-lang="en"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(200);
  const en = await page.evaluate(() => {
    const cards = Array.from(document.getElementById('skinGrid').children);
    const det = document.getElementById('skinDetail');
    return {
      lang: window.DJFE.settings.lang,
      cyanTag: cards[0].querySelector('.skintag').textContent,
      cyanWpn: cards[0].querySelector('.skinweapon').textContent,
      detail: det.textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
    };
  });
  console.log(JSON.stringify({ zh, en }, null, 2));
  await browser.close();
})();
