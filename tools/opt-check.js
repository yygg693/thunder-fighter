'use strict';
/* 临时手测：僚机数量 / 齐射弹数随 power 的变化。node tools/opt-check.js */
const path = require('path');
const { createEnv } = require('../tests/stubs');
const ROOT = path.resolve(__dirname, '..');
const env = createEnv({ root: ROOT, seed: 1, width: 960, height: 720 });
for (const s of ['src/core.js', 'src/entities.js', 'src/game.js', 'src/main.js']) env.loadScript(s);
const D = env.DJFE;
D.Game.start();
env.pump(30);
const g = D.__debug.game;
for (const pw of [1, 2, 3, 4, 5]) {
  g.power = pw;
  g.bullets.length = 0;
  const before = g.bullets.length;
  // 直接触发一次射击：把射击计时顶满，再走一帧
  g.shootT = 99999;
  env.pump(1);
  let tries = 0;
  while (g.bullets.length === before && tries++ < 40) env.pump(1);
  const n = g.bullets.length;
  const xs = g.bullets.map((b) => Math.round(b.x - D.__debug.player.x)).sort((a, b) => a - b);
  console.log(`power=${pw}  僚机=${D.options.count()}  本次齐射弹数=${n}  相对X=[${xs.join(',')}]`);
}
