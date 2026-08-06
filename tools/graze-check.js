'use strict';
/* 临时手测：擦弹甜蜜带 / 一发只记一次 / 满槽加成 / 1.5 倍分。node tools/graze-check.js */
const path = require('path');
const { createEnv } = require('../tests/stubs');
const ROOT = path.resolve(__dirname, '..');
const env = createEnv({ root: ROOT, seed: 7, width: 960, height: 720 });
for (const s of ['src/core.js', 'src/entities.js', 'src/game.js', 'src/main.js']) env.loadScript(s);
const D = env.DJFE;
D.Game.start();
env.pump(30);
const g = D.__debug.game;
const P = D.__debug.player;

function mkEb(x, y, vy) {
  return { x, y, vx: 0, vy, r: 4, dead: false, kind: undefined, px: x, py: y, sx: 0, sy: 0,
           ax: 0, ay: 0, av: 0, hold: 0, ttl: 0, split: 0, splitN: 0, gz: 0 };
}

// ---- ① 甜蜜带 + 一发只记一次 ----
function shootPast(dx) {
  g.ebullets.length = 0;
  g.graze = 0; g.grazeMeter = 0; g.lives = 999;
  g.ebullets.push(mkEb(P.x + dx, P.y - 60, 3));
  P.invulnUntil = 0; P.shieldUntil = 0;
  env.pump(60);
  return g.graze;
}
console.log(`① 偏移 22px 掠过 → graze=${shootPast(22)}   期望 1（一发只记一次）`);
console.log(`   偏移 40px 远离 → graze=${shootPast(40)}   期望 0（带外不计）`);
console.log(`   偏移  6px 命中 → graze=${shootPast(6)}   期望 1（命中前先穿过甜蜜带，标准语义）`);

// ---- ② 无敌期间不计 ----
g.ebullets.length = 0; g.graze = 0; g.grazeMeter = 0;
g.ebullets.push(mkEb(P.x + 22, P.y - 60, 3));
P.invulnUntil = 1e12;
env.pump(60);
console.log(`② 无敌期间掠过    → graze=${g.graze}   期望 0（不许白嫖擦弹槽）`);
P.invulnUntil = 0;

// ---- ③ 满槽 → 开启加成窗口 ----
g.graze = 0; g.grazeMeter = 0; g.grazeBoostUntil = 0; g.lives = 999;
let hits = 0, rounds = 0;
while (g.grazeBoostUntil === 0 && rounds++ < 400) {
  g.ebullets.length = 0;
  P.invulnUntil = 0; P.shieldUntil = 0;
  g.ebullets.push(mkEb(P.x + 22, P.y, 0));
  hits++;
  env.pump(1);
}
console.log(`③ 满槽所需擦弹数=${hits}   期望 84（= 1 / 0.012 上取整）  加成窗口=${g.grazeBoostUntil > 0 ? '已开启' : '未开启'}  槽已复位=${g.grazeMeter === 0}`);

// ---- ④ 1.5 倍分（走真实击杀路径）----
function killOne(boost) {
  g.score = 0; g.combo = 0; g.comboUntil = 0; g.items.length = 0;
  g.grazeBoostUntil = boost ? 1e12 : 0;
  g.enemies.length = 0; g.bullets.length = 0; g.ebullets.length = 0;
  // 波次调度器置惰性：否则"清空本波"的 +100 通关奖励会混进分数，两次调用状态还不一样
  g.betweenWaves = true; g.waveRemaining = 99; g.nextWaveAt = 1e12; g.isBossWave = false;
  const ex = 200, ey = 200;
  g.enemies.push({ type: 'straight', x: ex, baseX: ex, y: ey, w: 30, h: 30, vy: 0, hp: 1,
                   hue: 232, score: 100, phase: 0, fireT: 0, lockT: 0, diving: false,
                   dvx: 0, dvy: 0, hover: false, flash: 0, px: ex, py: ey });
  g.bullets.push({ x: ex, y: ey + 6, vx: undefined, vy: -1, r: 4, px: ex, py: ey + 6, sx: 0, sy: 0 });
  env.pump(3);
  return g.score;
}
const s0 = killOne(false), s1 = killOne(true);
console.log(`④ 击杀 100 分敌机  无加成=${s0}  有加成=${s1}   期望 100 / 150（连击 x1 时 ×1.5）`);
console.log(s0 === 100 && s1 === 150 ? '\n  全部符合预期\n' : '\n  !! 有偏差，需排查\n');
