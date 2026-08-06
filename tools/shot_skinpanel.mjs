import { createRequire } from 'node:module';
const require = createRequire('C://Users//22091//.workbuddy//binaries//node//workspace//');
const { chromium } = require('playwright');
const OUT = 'tools/shot_skinpanel.png';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--allow-file-access-from-files','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file:///D:/MyGame/thunder-fighter/www/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DJFE && window.DJFE.Game, null, { timeout: 8000 });

  // 打开皮肤面板（菜单上点「皮肤」按钮）
  await page.click('#menuSkinBtn', { timeout: 4000 });
  await page.waitForTimeout(500);

  // 逐皮肤校验 DOM：精灵图 data URI、描述文字、底部详情条
  const report = await page.evaluate(() => {
    const grid = document.getElementById('skinGrid');
    const cards = grid ? Array.from(grid.children) : [];
    const cardInfo = cards.map((card) => {
      const img = card.querySelector('img.skinimg');
      const tag = card.querySelector('.skintag');
      const wpn = card.querySelector('.skinweapon');
      const nm = card.querySelector('.skinname');
      return {
        id: card.getAttribute('data-id') || (img ? '(no data-id)' : ''),
        hasImg: !!img,
        imgSrcOk: !!(img && img.src && img.src.startsWith('data:image/png') && img.src.length > 1000),
        imgNaturalW: img ? img.naturalWidth : 0,
        name: nm ? nm.textContent : '',
        tag: tag ? tag.textContent : '',
        wpn: wpn ? wpn.textContent : '',
      };
    });
    // 逐皮肤「点击卡片」选中，走真实 UI 路径（renderSkinCards + updateSkinDetail）
    const detailBySkin = {};
    const ids = ['cyan_knight', 'crimson_falcon', 'emerald', 'violet', 'stealth', 'golden'];
    for (let i = 0; i < ids.length; i++) {
      const card = cards[i];
      if (window.DJFE.skins.isCustom(ids[i])) continue;
      card.click();
      const det = document.getElementById('skinDetail');
      detailBySkin[ids[i]] = det ? det.textContent.replace(/\s+/g, ' ').trim() : '(missing)';
    }
    const detDefault = document.getElementById('skinDetail');
    return {
      cardCount: cards.length,
      cardInfo,
      detailBySkin,
      skinDetailExists: !!detDefault,
      skinDetailText: detDefault ? detDefault.textContent.replace(/\s+/g, ' ').trim() : '(missing)',
    };
  });

  await page.screenshot({ path: OUT });
  // 选中 golden 后再截一张，确认详情条随选中更新（覆盖默认 cyan）
  await page.evaluate(() => window.DJFE.skins.select('golden'));
  await page.waitForTimeout(150);
  console.log(JSON.stringify({ out: OUT, errors, report }, null, 2));
  await browser.close();
})();
