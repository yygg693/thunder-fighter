#!/usr/bin/env node
/* =====================================================================
 * tools/verify_hitfx.cjs — 命中冲击特效逻辑级验证（确定性、零浏览器）
 *
 * 复用 tests/stubs.js 的无头环境，boot 真实 src/game.js，驱动真实命中路径，
 * 断言 hit-feedback 规格的关键不变量：
 *   - 命中冲击产出「方向性碎片条」(kind==='streak')，非纯圆；
 *   - 碎片条色相 = 当前皮肤武器色 b.hue（非敌机色 en.hue）；
 *   - 按武器档位产出正确数量 N 与尺寸 sz0/ar；
 *   - 弱敌一发带走时「先 tick（streak 存在）后 boom（敌机消失）」；
 *   - spawnHitImpact 全程零 Math.random（S16）；
 *   - 碎片条/闪核/微环复用既有池，零扩容（S18 grown===0）；
 *   - L 档（violet/golden）出武器色微冲击环（maxR∈[18,30]）。
 *
 * 退出码 0 = 全部通过；1 = 有断言失败。
 * ===================================================================== */
'use strict';
const path = require('path');
const { createEnv } = require(path.resolve(__dirname, '../tests/stubs.js'));

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = ['src/core.js', 'src/entities.js', 'src/game.js', 'src/main.js'];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m  ' + name + (detail ? '  \x1b[90m→ ' + detail + '\x1b[0m' : '')); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m  ' + name + (detail ? '  \x1b[90m→ ' + detail + '\x1b[0m' : '')); }
  return cond;
}

function bootEnv() {
  const env = createEnv({ root: ROOT, seed: 20250728, width: 960, height: 720 });
  for (const s of SCRIPTS) env.loadScript(s);
  return env;
}

// 造一颗「贴脸」高/低血量敌机，挡在玩家正上方，吃真实自动开火
function placeEnemy(D, hp) {
  const g = D.__debug.game, p = D.__debug.player;
  g.enemies.length = 0; g.bullets.length = 0;
  p.x = 480;
  g.enemies.push({
    type: 'mook', x: 480, y: p.y - 150, baseX: 480, baseY: p.y - 150, w: 40, h: 40,
    vx: 0, vy: 0, hp, hue: 30, score: 10, phase: 0, fireT: 9999, lockT: 0,
    diving: false, dvx: 0, dvy: 0, hover: true, flash: 0, px: 480, py: p.y - 150,
    sx: 0, sy: 0, minion: 0, spin: 0,
  });
}

// 让 rng 计数器在「非致命命中」期间递增即判失败（S16 命中冲击禁 RNG）
function withRngSpy(fn) {
  let calls = 0;
  const orig = Math.random;
  Math.random = function () { calls++; return orig.apply(this, arguments); };
  try { fn(); } finally { Math.random = orig; }
  return calls;
}

const SKINS = [
  ['cyan_knight', 190, 6, 5.8, 5, false],   // M
  ['crimson_falcon', 354, 4, 4.5, 4, false], // S
  ['emerald', 152, 6, 5.8, 5, false],        // M
  ['violet', 259, 8, 7.5, 7, true],          // L
  ['stealth', 194, 6, 5.8, 5, false],        // M
  ['golden', 44, 8, 7.5, 7, true],           // L
];

console.log('\x1b[1m命中冲击特效 · 逻辑级验证\x1b[0m');

for (const [skin, hue, N, sz0, ar, isL] of SKINS) {
  console.log('\n\x1b[36m▌ 皮肤 ' + skin + '（hue=' + hue + ', ' + (isL ? 'L 重击' : (N === 4 ? 'S 轻击' : 'M 标准')) + '）\x1b[0m');
  const env = bootEnv();
  const D = env.DJFE;
  D.Game.setDifficulty('normal');
  D.skins.select(skin);
  D.Game.start();
  placeEnemy(D, 1e9); // 高血量，非致命，持续出 tick

  const rng = withRngSpy(() => {
    for (let i = 0; i < 40; i++) env.frame(1000 / 60);
  });

  const g = D.__debug.game;
  const streaks = g.particles.filter(p => p.kind === 'streak');
  const sameHue = streaks.filter(p => p.hue === hue);
  ok('碎片条存在且为武器色（hue=' + hue + '）', sameHue.length > 0,
    'streak总数=' + streaks.length + ' 武器色streak=' + sameHue.length);
  ok('碎片条非纯圆（kind==="streak"）', streaks.length > 0);
  ok('尺寸解耦生效 sz0≈' + sz0 + '、ar=' + ar,
    sameHue.every(p => Math.abs((p.baseSz || 0) - sz0) < 1e-6 && (p.ar || 0) === ar),
    sameHue.length ? 'sample baseSz=' + sameHue[0].baseSz + ' ar=' + sameHue[0].ar : 'n/a');
  ok('每发命中产出 N=' + N + ' 颗（累计可见 ≥ N）', sameHue.length >= N,
    '武器色streak=' + sameHue.length);
  ok('非致命命中路径零 RNG（S16）', rng === 0, 'Math.random 调用=' + rng + ' 次');

  if (isL) {
    const ring = g.rings.filter(rg => rg.hue === hue && rg.maxR >= 18 && rg.maxR <= 30);
    ok('L 档出武器色微冲击环（maxR∈[18,30]）', ring.length > 0,
      '符合条件的环=' + ring.length + (ring[0] ? ' maxR=' + ring[0].maxR : ''));
  } else {
    const ring = g.rings.filter(rg => rg.hue === hue);
    ok('非 L 档不出武器色微环', ring.length === 0, '武器色环=' + ring.length);
  }

  const ps = D.__debug.poolStats();
  ok('particles 池零扩容（S18 grown===0）', ps.particles.grown === 0, 'grown=' + ps.particles.grown);
  ok('rings 池零扩容（S18 grown===0）', ps.rings.grown === 0, 'grown=' + ps.rings.grown);
  ok('命中期间无 NaN 粒子', g.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx) && Number.isFinite(p.vy) && Number.isFinite(p.life)));
}

// ---- 专项：弱敌一发带走 → 先 tick 后 boom（根除「无特效」）----
console.log('\n\x1b[36m▌ 弱敌一发带走：tick 在 boom 之前\x1b[0m');
{
  const env = bootEnv();
  const D = env.DJFE;
  D.Game.setDifficulty('normal');
  D.skins.select('cyan_knight');
  D.Game.start();
  const g = D.__debug.game;
  const p = D.__debug.player; p.x = 480;
  g.enemies.length = 0; g.bullets.length = 0; g.particles.length = 0;
  g.enemies.push({
    type: 'mook', x: 480, y: p.y - 150, baseX: 480, baseY: p.y - 150, w: 40, h: 40,
    vx: 0, vy: 0, hp: 1, hue: 30, score: 10, phase: 0, fireT: 9999, lockT: 0,
    diving: false, dvx: 0, dvy: 0, hover: true, flash: 0, px: 480, py: p.y - 150,
    sx: 0, sy: 0, minion: 0, spin: 0,
  });
  // 子弹需若干步飞抵敌机（cyan sp=11 → 约 14 步），故持续推帧直到击杀帧
  let tickSeen = false;
  for (let i = 0; i < 60 && !tickSeen; i++) {
    env.frame(1000 / 60);
    const streakNow = g.particles.filter(pt => pt.kind === 'streak').length;
    const enemyGone = g.enemies.length === 0;
    if (streakNow > 0 && enemyGone) tickSeen = true; // 同帧既出 streak 又击杀
  }
  ok('弱敌一发带走：命中冲击（streak）与击杀同帧出现', tickSeen, 'tick+boom 同帧=' + tickSeen);
}

console.log('\n' + '='.repeat(64));
console.log((fail === 0 ? '\x1b[42m\x1b[30m  HITFX LOGIC PASS  \x1b[0m' : '\x1b[41m\x1b[37m  HITFX LOGIC FAIL  \x1b[0m') +
  '  ' + pass + ' pass / ' + fail + ' fail');
console.log('='.repeat(64));
process.exit(fail === 0 ? 0 : 1);
