#!/usr/bin/env node
/* =====================================================================
 * 打飞机 · Fighter Shooter — tests/run-smoke.js
 * 零依赖无头冒烟测试：菜单 → 开局 → 战斗 → 暂停 → 恢复 → 死亡 → 重开
 *
 * 运行：  node tests/run-smoke.js
 * 详细：  SMOKE_VERBOSE=1 node tests/run-smoke.js
 * 换种子：SMOKE_SEED=12345 node tests/run-smoke.js
 *
 * 退出码：0 = 全部质量门通过；1 = 有 GATE 断言失败或运行时异常/NaN
 * PROBE（探针）只报告不拦截，用于记录已知缺陷与工程指标。
 * ===================================================================== */
'use strict';

const path = require('path');
const { createEnv } = require('./stubs');

const ROOT = path.resolve(__dirname, '..');
const SEED = parseInt(process.env.SMOKE_SEED || '20250728', 10);
const SCRIPTS = ['src/core.js', 'src/entities.js', 'src/game.js', 'src/main.js'];

// ---------------------------------------------------------------------
// 断言框架
// ---------------------------------------------------------------------
const results = { gates: [], probes: [], metrics: [] };
let currentSuite = '(root)';

function suite(name) { currentSuite = name; console.log('\n\x1b[36m▌ ' + name + '\x1b[0m'); }

function gate(name, cond, detail) {
  const ok = !!cond;
  results.gates.push({ suite: currentSuite, name, ok, detail });
  console.log('  ' + (ok ? '\x1b[32m PASS\x1b[0m' : '\x1b[31m FAIL\x1b[0m') + '  ' + name +
    (detail !== undefined && (!ok || process.env.SMOKE_VERBOSE) ? '  \x1b[90m→ ' + detail + '\x1b[0m' : ''));
  return ok;
}

function probe(name, ok, detail) {
  results.probes.push({ suite: currentSuite, name, ok: !!ok, detail });
  console.log('  ' + (ok ? '\x1b[32m OK  \x1b[0m' : '\x1b[33m BUG \x1b[0m') + '  ' + name +
    (detail !== undefined ? '  \x1b[90m→ ' + detail + '\x1b[0m' : ''));
  return !!ok;
}

function metric(name, value) {
  results.metrics.push({ suite: currentSuite, name, value });
  console.log('  \x1b[34m INFO\x1b[0m  ' + name + '  \x1b[90m→ ' + value + '\x1b[0m');
}

// ---------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------
function bootEnv(extra) {
  const env = createEnv(Object.assign({ root: ROOT, seed: SEED, width: 960, height: 720 }, extra || {}));
  for (const s of SCRIPTS) env.loadScript(s);
  return env;
}

// 递归扫描实体数组里的非有限数值
function scanFinite(label, arr, fields) {
  const bad = [];
  if (!Array.isArray(arr)) return bad;
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o || typeof o !== 'object') continue;
    for (const f of (fields || Object.keys(o))) {
      const v = o[f];
      if (typeof v === 'number' && !Number.isFinite(v)) bad.push(label + '[' + i + '].' + f + '=' + v);
      if (bad.length > 10) return bad;
    }
  }
  return bad;
}

function scanGameFinite(g, p) {
  let bad = [];
  bad = bad.concat(scanFinite('bullets', g.bullets, ['x', 'y', 'vx', 'vy', 'r']));
  bad = bad.concat(scanFinite('ebullets', g.ebullets, ['x', 'y', 'vx', 'vy', 'r']));
  bad = bad.concat(scanFinite('enemies', g.enemies, ['x', 'y', 'vy', 'hp', 'hue', 'phase']));
  bad = bad.concat(scanFinite('items', g.items, ['x', 'y', 'vy', 'r', 'hue']));
  bad = bad.concat(scanFinite('particles', g.particles, ['x', 'y', 'vx', 'vy', 'life', 'hue']));
  bad = bad.concat(scanFinite('rings', g.rings, ['x', 'y', 'r', 'maxR', 'life', 'hue']));
  for (const f of ['score', 'lives', 'bombs', 'power', 'wave', 'stage', 'combo', 'shake', 'flash']) {
    if (typeof g[f] === 'number' && !Number.isFinite(g[f])) bad.push('game.' + f + '=' + g[f]);
  }
  for (const f of ['x', 'y']) {
    if (!Number.isFinite(p[f])) bad.push('player.' + f + '=' + p[f]);
  }
  if (g.boss) bad = bad.concat(scanFinite('boss', [g.boss], ['x', 'y', 'ty', 'hp', 'maxHp', 'phase', 'fireT']));
  return bad;
}

function noNewRuntimeIssues(env, label, baseline) {
  const e = env.report.errors.length - baseline.errors;
  const n = env.report.nan.length - baseline.nan;
  const c = env.report.consoleErr.length - baseline.consoleErr;
  const detail = 'errors+' + e + ' nan+' + n + ' console+' + c +
    (e ? ' | first: ' + env.report.errors[baseline.errors].where + ': ' + env.report.errors[baseline.errors].message : '') +
    (n ? ' | nan: ' + env.report.nan[baseline.nan].where + ' ' + env.report.nan[baseline.nan].detail : '');
  return gate(label, e === 0 && n === 0 && c === 0, detail);
}

function snap(env) {
  return {
    errors: env.report.errors.length,
    nan: env.report.nan.length,
    consoleErr: env.report.consoleErr.length,
  };
}

// 极简"自动瞄准机器人"：每帧把虚拟指针挪到最近的可击目标 x 上。
// 玩家不动的话子弹几乎打不到人（弹道是竖直的），无法覆盖击杀/掉落/连击路径。
function makeBot(env, D) {
  const game = () => D.__debug.game;
  const player = () => D.__debug.player;
  return function botFrame(dt) {
    const gg = game(), p = player();
    let target = gg.boss || null;
    let bestD = Infinity;
    for (const en of gg.enemies) {
      if (en.y >= p.y) continue;
      const d = p.y - en.y;
      if (d < bestD) { bestD = d; target = en; }
    }
    if (target && Number.isFinite(target.x)) D.input.pointer.x = target.x;
    env.frame(dt);
  };
}

// =====================================================================
console.log('\x1b[1m雷霆战机 · 无头冒烟测试\x1b[0m  (seed=' + SEED + ', node ' + process.version + ')');
console.log('项目根目录: ' + ROOT);

let env;

// ---------------------------------------------------------------------
suite('S1 · 启动与脚本加载（模拟 index.html 顺序）');
// ---------------------------------------------------------------------
let bootErr = null;
try {
  env = bootEnv();
} catch (e) {
  bootErr = e;
}
if (bootErr) {
  gate('4 个 src 脚本可在 DOM 桩下无异常加载', false, bootErr.message + '\n' + bootErr.stack);
  console.error('\n致命：脚本加载失败，后续用例无法执行。');
  process.exit(1);
}
gate('4 个 src 脚本可在 DOM 桩下无异常加载', true, SCRIPTS.join(' → '));

const D = env.DJFE;
gate('window.DJFE 命名空间已建立', !!D);
gate('DJFE.Game 对外 API 完整', !!(D && D.Game && D.Game.init && D.Game.start && D.Game.togglePause && D.Game.toMenu && D.Game.resume && D.Game.bomb && D.Game.setDifficulty));
gate('DJFE.__debug 调试句柄可用（测试依赖）', !!(D && D.__debug && D.__debug.game && D.__debug.player && D.__debug.STATE));
gate('DJFE.draw 绘制层已注册', !!(D && D.draw && D.draw.player && D.draw.enemy && D.draw.item && D.draw.boss && D.draw.paintShip));
gate('DJFE.audio / input / skins 就绪', !!(D && D.audio && D.input && D.skins && D.skins.current()));

const STATE = D.__debug.STATE;
const g = () => D.__debug.game;
const pl = () => D.__debug.player;

gate('main.js 引导后处于 MENU 状态', g().state === STATE.MENU, 'state=' + g().state);
gate('主循环已注册 requestAnimationFrame', env.pendingRaf > 0, 'pendingRaf=' + env.pendingRaf);
gate('index.html 中不存在 JS 引用却缺失的元素 id',
  env.report.warnings.filter(w => w.kind === 'missing-element-id').length === 0,
  env.report.warnings.filter(w => w.kind === 'missing-element-id').map(w => w.detail).join('; ') || 'none');

// ---------------------------------------------------------------------
suite('S2 · 菜单待机（渲染不崩、状态不漂移）');
// ---------------------------------------------------------------------
let b = snap(env);
env.pump(120);
gate('菜单空转 120 帧后仍在 MENU', g().state === STATE.MENU, 'state=' + g().state);
gate('菜单渲染确实产生了绘制调用', env.report.counters.ctxCalls > 500, 'ctxCalls=' + env.report.counters.ctxCalls);
noNewRuntimeIssues(env, '菜单待机无异常 / 无 NaN / 无 console.error', b);
gate('菜单期间未生成任何游戏实体',
  g().enemies.length === 0 && g().bullets.length === 0 && g().ebullets.length === 0,
  'e=' + g().enemies.length + ' b=' + g().bullets.length + ' eb=' + g().ebullets.length);

// ---------------------------------------------------------------------
suite('S3 · 开局（menu → playing）');
// ---------------------------------------------------------------------
b = snap(env);
D.Game.setDifficulty('normal');
D.Game.start();
gate('start() 后进入 PLAYING', g().state === STATE.PLAYING, 'state=' + g().state);
gate('局内初值正确（分 0 / 命 3 / 火力 1 / 波次 0）',
  g().score === 0 && g().lives === 3 && g().power === 1 && g().wave === 0,
  'score=' + g().score + ' lives=' + g().lives + ' power=' + g().power + ' wave=' + g().wave);
gate('normal 难度炸弹数 = 1', g().bombs === 1, 'bombs=' + g().bombs);
gate('音频上下文已由用户手势解锁（start → initAudio）', env.pendingTimers > 0, 'pendingTimers=' + env.pendingTimers + '（BGM 音序器 setInterval）');
gate('HUD 显示、菜单隐藏',
  !env.byId.get('hud').classList.contains('hidden') && env.byId.get('menu').classList.contains('hidden'));
noNewRuntimeIssues(env, '开局瞬间无异常', b);

// ---------------------------------------------------------------------
suite('S4 · 波次调度与战斗');
// ---------------------------------------------------------------------
b = snap(env);
let r = env.pumpUntil(() => g().wave >= 1, 200);
gate('700ms 内进入第 1 波', r.ok && g().wave === 1, 'wave=' + g().wave + ' after ' + r.frames + ' frames');
gate('第 1 波在第 1 关且非 Boss 波', g().stage === 1 && g().isBossWave === false, 'stage=' + g().stage + ' boss=' + g().isBossWave);

r = env.pumpUntil(() => g().enemies.length > 0, 300);
gate('敌机可正常生成', r.ok, 'enemies=' + g().enemies.length + ' after ' + r.frames + ' frames');
gate('玩家自动开火产生子弹', g().bullets.length > 0, 'bullets=' + g().bullets.length);

const botFrame = makeBot(env, D);
for (let i = 0; i < 400; i++) botFrame();
metric('战斗 400 帧（自动瞄准）后 score', g().score);
gate('击杀能累计分数', g().score > 0, 'score=' + g().score);
gate('击杀会产生爆炸粒子', g().particles.length > 0, 'particles=' + g().particles.length);
metric('400 帧内最高连击', g().maxCombo);
let badNums = scanGameFinite(g(), pl());
gate('战斗中所有实体数值均为有限数（无 NaN/Infinity）', badNums.length === 0, badNums.join(', ') || 'clean');
noNewRuntimeIssues(env, '战斗 400 帧无异常 / 无 NaN 绘制参数', b);

// 玩家越界约束
gate('玩家坐标被夹在合法区域内',
  pl().x >= 0 && pl().x <= 960 && pl().y >= 720 * 0.4 - 1 && pl().y <= 720,
  'x=' + pl().x.toFixed(1) + ' y=' + pl().y.toFixed(1));

// ---------------------------------------------------------------------
suite('S5 · 炸弹与道具');
// ---------------------------------------------------------------------
b = snap(env);
g().bombs = 2;
env.pumpUntil(() => g().enemies.length >= 2, 300);
const enemiesBeforeBomb = g().enemies.length;
env.pointerDownOnCanvas(480, 600, 'mouse');
gate('鼠标点击触发炸弹（bombs 2 → 1）', g().bombs === 1, 'bombs=' + g().bombs);
gate('炸弹清空全屏敌机与敌弹', g().enemies.length === 0 && g().ebullets.length === 0,
  'before=' + enemiesBeforeBomb + ' after=' + g().enemies.length);
g().bombs = 0;
env.pointerDownOnCanvas(480, 600, 'mouse');
gate('炸弹数为 0 时点击不会变成负数', g().bombs === 0, 'bombs=' + g().bombs);
env.pointerDownOnCanvas(480, 600, 'touch');
gate('触摸类型指针不误触炸弹', g().bombs === 0);
noNewRuntimeIssues(env, '炸弹路径无异常', b);

// 道具拾取
b = snap(env);
g().power = 1; g().lives = 3; g().bombs = 1;
// 把虚拟指针钉在玩家身上，避免战机在取样帧里飘走导致拾取判定假阴性
function dropOnPlayer(type, hue) {
  D.input.pointer.x = pl().x; D.input.pointer.y = pl().y;
  g().items.push({ x: pl().x, y: pl().y, vy: 0, type, hue, r: 11, dead: false });
  env.pump(3);
}
dropOnPlayer('P', 200);
gate('拾取 P 道具火力 +1', g().power === 2, 'power=' + g().power);
dropOnPlayer('B', 40);
gate('拾取 B 道具炸弹 +1', g().bombs === 2, 'bombs=' + g().bombs);
dropOnPlayer('L', 0);
gate('拾取 L 道具生命 +1', g().lives === 4, 'lives=' + g().lives);
dropOnPlayer('S', 155);
gate('拾取 S 道具获得护盾', pl().shieldUntil > env.clock.now, 'shieldUntil-now=' + (pl().shieldUntil - env.clock.now).toFixed(0) + 'ms');
noNewRuntimeIssues(env, '道具路径无异常', b);
pl().shieldUntil = 0;

// ---------------------------------------------------------------------
suite('S6 · ESC 暂停（playing → paused，逻辑冻结）');
// ---------------------------------------------------------------------
b = snap(env);
env.pumpUntil(() => g().enemies.length > 0, 300);
env.keydown('Escape');
gate('ESC 进入 PAUSED', g().state === STATE.PAUSED, 'state=' + g().state);
gate('暂停浮层已显示', !env.byId.get('pause').classList.contains('hidden'));

const frozen = {
  score: g().score, wave: g().wave, lastShot: g().lastShot,
  enemies: g().enemies.length, bullets: g().bullets.length,
  px: pl().x, py: pl().y,
};
const framesBeforePause = env.report.counters.frames;
env.pump(180);
gate('暂停 180 帧期间主循环仍在运行（保持渲染）',
  env.report.counters.frames - framesBeforePause === 180);
gate('暂停期间分数 / 波次 / 敌机数 / 玩家位置全部冻结',
  g().score === frozen.score && g().wave === frozen.wave &&
  g().enemies.length === frozen.enemies && g().bullets.length === frozen.bullets &&
  pl().x === frozen.px && pl().y === frozen.py,
  'score ' + frozen.score + '→' + g().score + ', enemies ' + frozen.enemies + '→' + g().enemies.length);
gate('暂停期间不再产生新子弹（lastShot 冻结）', g().lastShot === frozen.lastShot);
noNewRuntimeIssues(env, '暂停期间渲染无异常', b);

// 通过按钮恢复
b = snap(env);
env.click('resumeBtn');
gate('点击「继续」按钮恢复 PLAYING', g().state === STATE.PLAYING, 'state=' + g().state);
env.pump(60);
gate('恢复后逻辑重新推进', g().lastShot !== frozen.lastShot);
// 再用 ESC 切换一轮
env.keydown('Escape');
gate('ESC 二次暂停生效', g().state === STATE.PAUSED);
env.keydown('Escape');
gate('ESC 再次按下恢复 PLAYING（可反复切换）', g().state === STATE.PLAYING);
noNewRuntimeIssues(env, '暂停/恢复往返无异常', b);

// 暂停期间的绝对时间戳漂移（探针）
b = snap(env);
pl().shieldUntil = env.clock.now + 8000;
env.keydown('Escape');
env.pump(720); // 暂停 12 秒
env.keydown('Escape');
probe('暂停不应消耗护盾/无敌等限时增益',
  pl().shieldUntil > env.clock.now,
  '暂停 12s 后 shieldUntil - now = ' + (pl().shieldUntil - env.clock.now).toFixed(0) + 'ms（<0 表示护盾在暂停中被消耗掉了）');
pl().shieldUntil = 0;

// ---------------------------------------------------------------------
suite('S7 · 致命伤害 → GAMEOVER');
// ---------------------------------------------------------------------
b = snap(env);
g().score = 1234;
g().lives = 3;
const scoreAtDeath = g().score;
const livesTrace = [];
let deathFrames = 0;
for (let i = 0; i < 8 && g().state === STATE.PLAYING; i++) {
  pl().invulnUntil = 0; pl().shieldUntil = 0;
  g().ebullets.push({ x: pl().x, y: pl().y, vx: 0, vy: 0, r: 6, dead: false, kind: 'aim' });
  const before = g().lives;
  const rr = env.pumpUntil(() => g().lives < before || g().state !== STATE.PLAYING, 20);
  livesTrace.push(g().lives);
  deathFrames += rr.frames;
}
gate('每次致命伤害恰好扣 1 条命（无重复扣命）',
  livesTrace.slice(0, 3).join(',') === '2,1,0', 'lives trace = [' + livesTrace.join(',') + ']');
gate('连续致命伤害可耗尽 3 条命并进入 GAMEOVER',
  g().state === STATE.GAMEOVER, 'state=' + g().state + ' lives=' + g().lives + ' (' + deathFrames + ' frames)');
gate('生命值不会掉到负数', g().lives >= 0, 'lives=' + g().lives);
gate('死亡结算面板显示、HUD 隐藏',
  !env.byId.get('gameover').classList.contains('hidden') && env.byId.get('hud').classList.contains('hidden'));
gate('finalScore 显示本局得分', String(env.byId.get('finalScore').textContent) === String(scoreAtDeath),
  'finalScore=' + env.byId.get('finalScore').textContent + ' expected=' + scoreAtDeath);

const lsDump = env.localStorage.__dump();
gate('最高分已写入 localStorage', lsDump['djfe_best_score'] !== undefined, 'djfe_best_score=' + lsDump['djfe_best_score']);
let lb = [];
try { lb = JSON.parse(lsDump['djfe_leaderboard'] || '[]'); } catch (e) { /* noop */ }
gate('排行榜落盘且含本局记录', lb.length >= 1 && lb[0].score === scoreAtDeath,
  'entries=' + lb.length + ' top=' + JSON.stringify(lb[0] || null));
gate('排行榜条目含关卡与日期字段', !!(lb[0] && lb[0].stage && lb[0].date), JSON.stringify(lb[0] || null));

b = snap(env);
env.pump(180);
gate('GAMEOVER 状态下持续渲染 180 帧不崩', g().state === STATE.GAMEOVER);
noNewRuntimeIssues(env, '死亡结算 + 结算画面无异常', b);

// ---------------------------------------------------------------------
suite('S8 · 重开（gameover → playing）');
// ---------------------------------------------------------------------
b = snap(env);
env.click('retryBtn');
gate('点击「再来一局」回到 PLAYING', g().state === STATE.PLAYING, 'state=' + g().state);
gate('重开后状态完全复位（分 0 / 命 3 / 火力 1 / 波次 0 / 关卡 1）',
  g().score === 0 && g().lives === 3 && g().power === 1 && g().wave === 0 && g().stage === 1,
  'score=' + g().score + ' lives=' + g().lives + ' power=' + g().power + ' wave=' + g().wave + ' stage=' + g().stage);
gate('重开后残留实体已清空',
  g().enemies.length === 0 && g().ebullets.length === 0 && g().items.length === 0 && g().boss === null);
r = env.pumpUntil(() => g().wave >= 1 && g().enemies.length > 0, 400);
gate('重开后波次调度与敌机生成恢复正常', r.ok, 'wave=' + g().wave + ' enemies=' + g().enemies.length);
env.pump(200);
badNums = scanGameFinite(g(), pl());
gate('重开后 200 帧内无 NaN 实体', badNums.length === 0, badNums.join(', ') || 'clean');
noNewRuntimeIssues(env, '重开全流程无异常', b);

// ---------------------------------------------------------------------
suite('S9 · 返回菜单与二次开局');
// ---------------------------------------------------------------------
b = snap(env);
D.Game.togglePause();
env.click('quitBtn');
gate('暂停 →「返回菜单」回到 MENU', g().state === STATE.MENU, 'state=' + g().state);
env.pump(60);
env.click('startBtn');
gate('菜单「开始游戏」按钮可再次开局', g().state === STATE.PLAYING, 'state=' + g().state);
env.pump(120);
noNewRuntimeIssues(env, '菜单往返无异常', b);

// ---------------------------------------------------------------------
suite('S10 · Boss 波全链路（生成 → 弹幕 → 击杀）');
// ---------------------------------------------------------------------
b = snap(env);
// 强制推进到第 3 波（stageWave 3 = Boss 波）
g().enemies = []; g().ebullets = []; g().waveRemaining = 0;
g().wave = 2; g().betweenWaves = true; g().nextWaveAt = env.clock.now;
r = env.pumpUntil(() => g().boss !== null, 200);
gate('第 3 波触发 Boss 生成', r.ok && g().isBossWave === true,
  'wave=' + g().wave + ' boss=' + (g().boss ? g().boss.name : 'null'));
if (g().boss) {
  const bossHp0 = g().boss.maxHp;
  metric('Boss 名称 / 血量', (g().boss.name || '?') + ' / ' + bossHp0);
  r = env.pumpUntil(() => g().boss && g().boss.y >= g().boss.ty - 0.5, 400);
  gate('Boss 入场下落到位', r.ok, 'y=' + (g().boss ? g().boss.y.toFixed(1) : 'n/a'));
  pl().invulnUntil = env.clock.now + 600000; // 免疫，专测 Boss 弹幕逻辑
  r = env.pumpUntil(() => g().ebullets.length > 0, 400);
  gate('Boss 会发射弹幕', r.ok, 'ebullets=' + g().ebullets.length);
  env.pump(400);
  gate('Boss 血量会被玩家子弹削减', g().boss === null || g().boss.hp < bossHp0,
    'hp=' + (g().boss ? g().boss.hp : 'killed') + '/' + bossHp0);
  if (g().boss) g().boss.hp = 1;
  const scoreBeforeBossKill = g().score;
  r = env.pumpUntil(() => g().boss === null, 600);
  gate('Boss 可被击杀并清场', r.ok, 'frames=' + r.frames);
  gate('击杀 Boss 后加分', g().score > scoreBeforeBossKill, '+' + (g().score - scoreBeforeBossKill));
  gate('击杀 Boss 后掉落道具', g().items.length > 0, 'items=' + g().items.length);
  badNums = scanGameFinite(g(), pl());
  gate('Boss 战全程无 NaN 实体', badNums.length === 0, badNums.join(', ') || 'clean');
  env.pump(200);
  r = env.pumpUntil(() => g().wave >= 4, 600);
  gate('Boss 死后能推进到下一关第 1 波', r.ok && g().stage === 2,
    'wave=' + g().wave + ' stage=' + g().stage);
}
noNewRuntimeIssues(env, 'Boss 全链路无异常 / 无 NaN 绘制参数', b);
pl().invulnUntil = 0;

// ---------------------------------------------------------------------
suite('S11 · 长跑稳定性与内存增长');
// ---------------------------------------------------------------------
b = snap(env);
D.Game.toMenu();
D.Game.start();
pl().invulnUntil = env.clock.now + 3600000; // 长跑期间不死，专测实体池
const peak = { bullets: 0, ebullets: 0, enemies: 0, particles: 0, items: 0, rings: 0 };
const LONG_FRAMES = 3000;
const longBot = makeBot(env, D);
for (let i = 0; i < LONG_FRAMES; i++) {
  longBot();
  const gg = g();
  peak.bullets = Math.max(peak.bullets, gg.bullets.length);
  peak.ebullets = Math.max(peak.ebullets, gg.ebullets.length);
  peak.enemies = Math.max(peak.enemies, gg.enemies.length);
  peak.particles = Math.max(peak.particles, gg.particles.length);
  peak.items = Math.max(peak.items, gg.items.length);
  peak.rings = Math.max(peak.rings, gg.rings.length);
}
metric('长跑 ' + LONG_FRAMES + ' 帧（≈' + (LONG_FRAMES / 60).toFixed(0) + 's 虚拟时长）峰值实体数', JSON.stringify(peak));
metric('长跑后 wave / stage / score', g().wave + ' / ' + g().stage + ' / ' + g().score);
gate('子弹池不失控（峰值 < 400）', peak.bullets < 400, 'peak=' + peak.bullets);
gate('敌弹池不失控（峰值 < 2000）', peak.ebullets < 2000, 'peak=' + peak.ebullets);
gate('敌机池不失控（峰值 < 300）', peak.enemies < 300, 'peak=' + peak.enemies);
gate('粒子池不失控（峰值 < 6000）', peak.particles < 6000, 'peak=' + peak.particles);
gate('冲击波环不失控（峰值 < 200）', peak.rings < 200, 'peak=' + peak.rings);
gate('长跑后仍在 PLAYING（状态机无卡死）',
  g().state === STATE.PLAYING || g().state === STATE.VICTORY, 'state=' + g().state);
badNums = scanGameFinite(g(), pl());
gate('长跑后无 NaN 实体', badNums.length === 0, badNums.join(', ') || 'clean');
noNewRuntimeIssues(env, '长跑 3000 帧无异常 / 无 NaN 绘制参数', b);
metric('累计 canvas 绘制调用', env.report.counters.ctxCalls);
metric('累计定时器触发次数（BGM 音序器为主）', env.report.counters.timerFires);
metric('残留待触发定时器', env.pendingTimers);
metric('rAF 队列长度（应恒为 1）', env.pendingRaf);
gate('rAF 未泄漏（队列恒为 1 条主循环）', env.pendingRaf === 1, 'pendingRaf=' + env.pendingRaf);

// ---------------------------------------------------------------------
suite('S12 · 窗口尺寸变化健壮性');
// ---------------------------------------------------------------------
b = snap(env);
env.resizeWindow(400, 800);
env.pump(120);
gate('缩小到 400×800 后继续运行不崩', g().state === STATE.PLAYING);
env.resizeWindow(2560, 1080);
env.pump(120);
gate('放大到 2560×1080 后继续运行不崩', g().state === STATE.PLAYING);
badNums = scanGameFinite(g(), pl());
gate('resize 后无 NaN 实体', badNums.length === 0, badNums.join(', ') || 'clean');
noNewRuntimeIssues(env, 'resize 无异常 / 无 NaN 绘制参数', b);
env.resizeWindow(960, 720);
env.pump(30);

// ---------------------------------------------------------------------
suite('S13 · 设置 / 皮肤 / 存档持久化');
// ---------------------------------------------------------------------
b = snap(env);
D.Game.toMenu();
env.pump(10);
env.click('menuSkinBtn');
gate('皮肤面板可打开且缩略图渲染不崩', !env.byId.get('skins').classList.contains('hidden'));
gate('皮肤卡片已渲染（6 个预设）', env.byId.get('skinGrid').children.length >= 6,
  'cards=' + env.byId.get('skinGrid').children.length);
env.click('newSkinBtn');
gate('皮肤编辑器可打开', !env.byId.get('skinEditor').classList.contains('hidden'));
env.input('edName', '测试涂装');
env.input('edBody', '#ff0000');
env.pump(5);
env.click('edSave');
gate('自定义皮肤可保存并落盘',
  env.localStorage.__dump()['djfe_skins'] && env.localStorage.__dump()['djfe_skins'].indexOf('测试涂装') >= 0,
  (env.localStorage.__dump()['djfe_skins'] || '').slice(0, 120));
gate('保存后自动选中新皮肤', D.skins.current().name === '测试涂装', 'current=' + D.skins.current().name);
env.click('skinsClose');

env.click('settingsBtn');
gate('设置浮层可打开', !env.byId.get('settings').classList.contains('hidden'));
env.input('musicVol', 20);
env.input('sfxVol', 30);
gate('音量设置写入 settings 并落盘',
  Math.abs(D.settings.musicVol - 0.2) < 1e-9 && Math.abs(D.settings.sfxVol - 0.3) < 1e-9,
  'music=' + D.settings.musicVol + ' sfx=' + D.settings.sfxVol);
gate('settings 已持久化到 localStorage', !!env.localStorage.__dump()['djfe_settings']);
env.click('settingsClose');
env.input('sens', 9);
gate('灵敏度滑杆联动 sensVal 文本', String(env.byId.get('sensVal').textContent) === '9',
  'sensVal=' + env.byId.get('sensVal').textContent);
env.click('muteBtn');
gate('静音按钮可切换', D.audio.isMuted() === true, 'muted=' + D.audio.isMuted());
env.click('muteBtn');
gate('静音可再次取消', D.audio.isMuted() === false);
noNewRuntimeIssues(env, '设置 / 皮肤路径无异常', b);

// 语言切换
b = snap(env);
const langBtns = env.document.querySelectorAll('#settings .seg button');
gate('语言切换按钮可被选择器命中', langBtns.length === 2, 'count=' + langBtns.length);
if (langBtns.length === 2) {
  langBtns[1].click();  // EN
  gate('切换到 EN 后 settings.lang 更新', D.settings.lang === 'en', 'lang=' + D.settings.lang);
  gate('i18n 文案已替换为英文', env.byId.get('startBtn').innerHTML === 'START',
    'startBtn="' + env.byId.get('startBtn').innerHTML + '"');
  langBtns[0].click(); // 中文
  gate('切回中文生效', D.settings.lang === 'zh' && env.byId.get('startBtn').innerHTML === '开始游戏');
}
const diffBtns = env.document.querySelectorAll('#menu .diff button');
gate('难度按钮可被选择器命中', diffBtns.length === 3, 'count=' + diffBtns.length);
if (diffBtns.length === 3) {
  diffBtns[0].click(); // easy
  D.Game.start();
  gate('easy 难度生效（炸弹 2 / 敌机血量系数 1）',
    g().bombs === 2 && g().diff && g().diff.hp === 1, 'bombs=' + g().bombs + ' hp=' + (g().diff && g().diff.hp));
  diffBtns[2].click(); // hard
  D.Game.start();
  gate('hard 难度生效（炸弹 1 / 敌机血量系数 3）',
    g().bombs === 1 && g().diff && g().diff.hp === 3, 'bombs=' + g().bombs + ' hp=' + (g().diff && g().diff.hp));
  diffBtns[1].click();
}
noNewRuntimeIssues(env, '语言 / 难度切换无异常', b);

// ---------------------------------------------------------------------
suite('S14 · 键盘操控');
// ---------------------------------------------------------------------
b = snap(env);
D.Game.toMenu(); D.Game.start();
env.pump(30);
const kx0 = pl().x;
env.keydown('KeyA');
env.pump(40);
const kxLeft = pl().x;
env.keyup('KeyA');
env.keydown('KeyD');
env.pump(80);
const kxRight = pl().x;
env.keyup('KeyD');
gate('A / ArrowLeft 向左移动', kxLeft < kx0, kx0.toFixed(1) + ' → ' + kxLeft.toFixed(1));
gate('D / ArrowRight 向右移动', kxRight > kxLeft, kxLeft.toFixed(1) + ' → ' + kxRight.toFixed(1));
env.keydown('ArrowUp');
env.pump(40);
env.keyup('ArrowUp');
gate('方向键上移生效且被上边界夹住', pl().y >= 720 * 0.4 - 0.01, 'y=' + pl().y.toFixed(1));
noNewRuntimeIssues(env, '键盘输入无异常', b);

// ---------------------------------------------------------------------
suite('S15 · 通关（VICTORY）路径');
// ---------------------------------------------------------------------
b = snap(env);
D.Game.toMenu(); D.Game.start();
env.pump(60);
g().score = 10;                 // 故意设一个远低于历史最高分的本局得分
g().enemies = []; g().ebullets = []; g().boss = null;
// 最终关从 DJFE.__debug 派生，不把关卡数写死在测试里 —— 关卡表一改，这里自动跟上
const finalStage = D.__debug.stageCount;
const stageWaves = D.__debug.stageWaves;
const finalWave = (finalStage - 1) * stageWaves + stageWaves;
g().wave = finalWave; g().stage = finalStage; g().stageWave = stageWaves; g().isBossWave = true;
g().waveRemaining = 0; g().betweenWaves = false;
const bestBeforeVictory = D.getBest();
const expectedVictoryScore = 10 + finalWave * 100; // 通关波次奖励 wave*100
r = env.pumpUntil(() => g().state === STATE.VICTORY, 120);
gate('最终关 Boss 清场后进入 VICTORY', r.ok, 'state=' + g().state);
gate('通关面板显示', !env.byId.get('victory').classList.contains('hidden'));
env.pump(120);
probe('通关结算「本局得分」应显示本局分数而非历史最高分',
  String(env.byId.get('finalScoreV').textContent) === String(expectedVictoryScore),
  'finalScoreV=' + env.byId.get('finalScoreV').textContent +
  '，本局实际得分=' + expectedVictoryScore + '，历史最高=' + bestBeforeVictory +
  '（game.js victory() 先执行 game.score = commitBest(game.score) 再回填 DOM）');
noNewRuntimeIssues(env, 'VICTORY 路径无异常', b);

// ---------------------------------------------------------------------
suite('S16 · 帧率解耦矩阵（D8 回归门 · 六档 refresh）');
// ---------------------------------------------------------------------
// 量化「逻辑步频与刷新率解耦」：同一虚拟时长下，30/60/72/120/144/240Hz 各档
// 应跑出完全一致的逻辑步数（固定时间步长累加器保证）。任一阵营偏离即翻红。
// 与 eng 的 refresh 柱（6 档 1798~1800 步 + 与 60Hz 逐采样点同态）是同一断言的两种表述。
function refreshSample(fps, virtualMs) {
  const e2 = bootEnv();
  e2.sandbox.DJFE.Game.setDifficulty('normal');
  e2.sandbox.DJFE.Game.start();
  const gg = e2.sandbox.DJFE.__debug.game;
  const before = gg.runFrames;
  const dt = 1000 / fps;
  const n = Math.floor(virtualMs / dt);
  for (let i = 0; i < n; i++) e2.frame(dt);
  return { fps, steps: gg.runFrames - before, frames: n };
}
const REFRESH_RATES = [30, 60, 72, 120, 144, 240];
const REFRESH_MS = 6000;
const refreshSamples = REFRESH_RATES.map(f => refreshSample(f, REFRESH_MS));
for (const s of refreshSamples) {
  metric(s.fps + 'Hz 逻辑步数', s.steps + ' 步（' + s.frames + ' 帧驱动 / ' + REFRESH_MS + 'ms）');
}
const baseSteps = refreshSamples.find(s => s.fps === 60).steps;
const allConsistent = refreshSamples.every(s => Math.abs(s.steps - baseSteps) <= 2);
gate('六档刷新率下逻辑步数一致（与 60Hz 偏差 ≤ 2 步）', allConsistent,
  '60Hz=' + baseSteps + ' 各档=' + refreshSamples.map(s => s.fps + ':' + s.steps).join(' '));

// 兼容旧口径：60Hz vs 144Hz 标记子弹位移比（应 ≈1.0，捕捉「逐帧位移」类回归）
function measureBulletTravel(dtMs, virtualMs) {
  const e2 = bootEnv();
  e2.sandbox.DJFE.Game.setDifficulty('normal');
  e2.sandbox.DJFE.Game.start();
  const gg = e2.sandbox.DJFE.__debug.game;
  const marker = { x: 900, y: 700, vy: -1, r: 4 };
  gg.bullets.push(marker);
  const y0 = marker.y;
  const frames = Math.floor(virtualMs / dtMs);
  for (let i = 0; i < frames; i++) e2.frame(dtMs);
  return { travel: y0 - marker.y, frames };
}
const at60 = measureBulletTravel(1000 / 60, 600);
const at144 = measureBulletTravel(1000 / 144, 600);
metric('600ms 标记子弹位移 @60Hz', at60.travel.toFixed(1) + 'px (' + at60.frames + ' 帧)');
metric('600ms 标记子弹位移 @144Hz', at144.travel.toFixed(1) + 'px (' + at144.frames + ' 帧)');
const bRatio = at60.travel > 0 ? (at144.travel / at60.travel) : 0;
gate('60Hz 与 144Hz 标记子弹位移比 ≈ 1.0（帧率解耦）', bRatio > 0.85 && bRatio < 1.15,
  '144Hz / 60Hz 位移比 = ' + bRatio.toFixed(2) + 'x');

// ---------------------------------------------------------------------
suite('S18 · 对象池零扩容回归门（D4）');
// ---------------------------------------------------------------------
// 重压一局（hard + 常驻无敌 survivor）覆盖 Boss / 分裂母体 / 弹幕高峰，
// 跑完后断言每对象池 grown === 0（容量充足、无运行时扩容）。任何未来代码路径
// 漏出超容实体都会让 grown>0 而翻红。观测点：DJFE.__debug.poolStats()（eng 已暴露，零 src 改动）。
{
  const e4 = bootEnv();
  e4.sandbox.DJFE.Game.setDifficulty('hard');
  e4.sandbox.DJFE.Game.start();
  const g4 = () => e4.sandbox.DJFE.__debug.game;
  const p4 = () => e4.sandbox.DJFE.__debug.player;
  p4().invulnUntil = 1e12; // survivor：常驻无敌，把一局打到底
  const FR = 1000 / 60;
  const N = 10800; // 180s @60Hz，足够覆盖多波 + 多 Boss
  for (let i = 0; i < N; i++) {
    const gg = g4();
    let tx = 480 + Math.sin(i / 42) * 300;
    if (gg.boss) tx = gg.boss.x;
    else if (gg.enemies.length) { let b = null; for (const en of gg.enemies) if (!b || en.y > b.y) b = en; if (b) tx = b.x; }
    e4.sandbox.DJFE.input.pointer.x = tx;
    e4.sandbox.DJFE.input.pointer.y = 520 + Math.sin(i / 66) * 60;
    e4.frame(FR);
  }
  const ps = e4.sandbox.DJFE.__debug.poolStats();
  let totalGrown = 0; const perPool = {};
  for (const k of Object.keys(ps)) { totalGrown += ps[k].grown; perPool[k] = ps[k].grown; }
  gate('D4 重压一局零对象池扩容（每池 grown === 0）', totalGrown === 0,
    'totalGrown=' + totalGrown + ' perPool=' + JSON.stringify(perPool) + ' runFrames=' + g4().runFrames);
}

// ---------------------------------------------------------------------
suite('S17 · 环境诊断汇总');
// ---------------------------------------------------------------------
const warnKinds = {};
for (const w of env.report.warnings) warnKinds[w.kind] = (warnKinds[w.kind] || 0) + 1;
metric('DOM 桩告警统计', JSON.stringify(warnKinds));
for (const w of env.report.warnings.slice(0, 12)) console.log('        \x1b[33m·\x1b[0m ' + w.kind + ': ' + w.detail);
gate('未出现「JS 引用了 index.html 不存在的元素」', !warnKinds['missing-element-id']);
gate('全程零未捕获异常', env.report.errors.length === 0, 'errors=' + env.report.errors.length);
gate('全程零 NaN/undefined 绘制参数', env.report.nan.length === 0, 'nan=' + env.report.nan.length);
gate('全程零 console.error / console.warn', env.report.consoleErr.length === 0,
  env.report.consoleErr.slice(0, 3).map(c => c.level + ':' + c.msg).join(' | ') || 'none');

if (env.report.errors.length) {
  console.log('\n\x1b[31m--- 异常明细 ---\x1b[0m');
  for (const e of env.report.errors.slice(0, 10)) {
    console.log('  [' + e.where + '] ' + e.message);
    if (e.stack) console.log('    ' + String(e.stack).split('\n').slice(1, 4).join('\n    '));
  }
}
if (env.report.nan.length) {
  console.log('\n\x1b[31m--- NaN / undefined 绘制参数明细 ---\x1b[0m');
  for (const n of env.report.nan.slice(0, 20)) console.log('  ' + n.where + '  ' + n.detail);
}

// ---------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------
const passed = results.gates.filter(x => x.ok).length;
const failed = results.gates.filter(x => !x.ok);
const bugs = results.probes.filter(x => !x.ok);

console.log('\n' + '='.repeat(72));
console.log('\x1b[1m冒烟测试汇总\x1b[0m');
console.log('  质量门 GATE : ' + passed + ' / ' + results.gates.length + ' 通过');
console.log('  探针 PROBE  : ' + (results.probes.length - bugs.length) + ' / ' + results.probes.length + ' 正常，' + bugs.length + ' 项记为缺陷');
console.log('  运行时诊断  : ' + env.report.errors.length + ' 异常 / ' + env.report.nan.length + ' NaN / ' +
  env.report.consoleErr.length + ' console 错误 / ' + env.report.warnings.length + ' 桩告警');
console.log('  虚拟时长    : ' + (env.clock.now / 1000).toFixed(1) + 's，' + env.report.counters.frames + ' 帧，' +
  env.report.counters.ctxCalls + ' 次绘制调用');

if (failed.length) {
  console.log('\n\x1b[31m失败的质量门：\x1b[0m');
  for (const f of failed) console.log('  ✗ [' + f.suite + '] ' + f.name + (f.detail ? '  → ' + f.detail : ''));
}
if (bugs.length) {
  console.log('\n\x1b[33m探针记录的缺陷（不拦截冒烟门）：\x1b[0m');
  for (const bug of bugs) console.log('  ! [' + bug.suite + '] ' + bug.name + (bug.detail ? '\n      ' + bug.detail : ''));
}

const ok = failed.length === 0;
console.log('\n' + (ok ? '\x1b[42m\x1b[30m  SMOKE PASS  \x1b[0m' : '\x1b[41m\x1b[37m  SMOKE FAIL  \x1b[0m') +
  '  seed=' + SEED);
console.log('='.repeat(72));
process.exit(ok ? 0 : 1);
