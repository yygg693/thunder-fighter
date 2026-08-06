'use strict';
/* 临时手测：新敌种解锁 / 生成 / 行为。node tools/enemy-check.js */
const path = require('path');
const { createEnv } = require('../tests/stubs');
const ROOT = path.resolve(__dirname, '..');

function run(stage, frames) {
  const env = createEnv({ root: ROOT, seed: 4242 + stage, width: 960, height: 720 });
  for (const s of ['src/core.js', 'src/entities.js', 'src/game.js', 'src/main.js']) env.loadScript(s);
  const D = env.DJFE;
  D.Game.start();
  env.pump(30);
  const g = D.__debug.game;
  const seen = {};
  const behave = { turretHover: 0, kamikazeDive: 0, curverCurve: 0 };
  let peakEb = 0, peakEn = 0;
  for (let f = 0; f < frames; f += 10) {
    g.stage = stage;
    g.lives = 999;
    env.pump(10);
    for (const en of g.enemies) {
      seen[en.type] = (seen[en.type] || 0) + 0 + 1;
      if (en.type === 'turret' && en.hover) behave.turretHover++;
      if (en.type === 'kamikaze' && en.diving) behave.kamikazeDive++;
    }
    for (const eb of g.ebullets) if (eb.av) behave.curverCurve++;
    peakEb = Math.max(peakEb, g.ebullets.length);
    peakEn = Math.max(peakEn, g.enemies.length);
  }
  const pool = D.__debug.poolStats();
  let grown = 0; for (const k in pool) grown += pool[k].grown || 0;
  const kinds = Object.keys(seen).sort().join(',');
  const errs = env.errors ? env.errors.length : 0;
  console.log(`S${stage}  出现机型=[${kinds}]`);
  console.log(`      炮台悬停帧=${behave.turretHover}  冲锋锁定帧=${behave.kamikazeDive}  弯曲弹帧=${behave.curverCurve}`
    + `  峰值 eb=${peakEb} en=${peakEn}  池扩容=${grown}  异常=${errs}`);
  return grown === 0 && errs === 0;
}

let ok = true;
for (const st of [1, 2, 3, 4]) ok = run(st, 3600) && ok;
console.log(ok ? '\n  无池扩容 / 无异常\n' : '\n  !! 有问题\n');
