/* =====================================================================
 * 打飞机 · Phase 6 验证脚本（开发工具，不随游戏发布）
 *
 *   node tools/verify.js parity    重构前后行为一致性（60Hz，逐帧全量状态比对）
 *   node tools/verify.js refresh   跨刷新率速度一致性（30/60/72/120/144/240Hz）
 *   node tools/verify.js gc        GC 压力对比（对象池效果）
 *   node tools/verify.js           全部
 *
 * 基线代码：tools/.baseline/（改动前的 src 快照）
 * 当前代码：src/
 * ===================================================================== */
'use strict';
const path = require('path');
const { boot, signature } = require('./headless-harness');

const ROOT = path.join(__dirname, '..');
const CUR = path.join(ROOT, 'src');
const BASE = path.join(__dirname, '.baseline');

const T0 = 1000;

// ---- 脚本化输入：只依赖「虚拟时刻 t」，同帧率下两份代码完全对齐 ----
// survivor：常驻无敌（用已有的 __debug 句柄），让战局能一路打到 Boss / 换关，
//           覆盖波次推进、Boss、道具、火力升级、高弹幕
function survivorInput(h, t) {
  const e = t - T0;
  const g = h.DJFE.__debug.game;
  // 简易 AI：优先瞄 Boss，其次追最靠下的敌机，否则来回扫场
  let tx = 480 + Math.sin(e / 700) * 300;
  if (g.boss) tx = g.boss.x;
  else if (g.enemies.length) {
    let best = null;
    for (let i = 0; i < g.enemies.length; i++) if (!best || g.enemies[i].y > best.y) best = g.enemies[i];
    tx = best.x;
  }
  h.setPointer(tx, 520 + Math.sin(e / 1100) * 60);
  h.DJFE.__debug.player.invulnUntil = 1e12; // 常量 → 与帧率无关
  if (!h._bombs) h._bombs = 0;
  if ((e > 8000 && h._bombs === 0) || (e > 20000 && h._bombs === 1) || (e > 33000 && h._bombs === 2)) {
    h._bombs++;
    h.DJFE.Game.bomb();
  }
}
// mortal：不加保护，覆盖 掉血 / 无敌帧 / GAMEOVER 状态切换
function mortalInput(h, t) {
  const e = t - T0;
  h.setPointer(480 + Math.sin(e / 900) * 240, 500 + Math.sin(e / 1300) * 70);
}
// static：整局输入恒定，跨刷新率比对时排除「输入采样时刻」这一变量。
// 指针停在左下角，远离敌机生成列（x≈480），敌机不会被打掉、只是自由下落，
// 于是「敌机下落进度 / 波次推进」直接反映逻辑速度是否随刷新率漂移。
function staticInput(h) {
  h.setPointer(120, 650);
  h.DJFE.__debug.player.invulnUntil = 1e12;
}
const INPUTS = { survivor: survivorInput, mortal: mortalInput, static: staticInput };

// mulberry32：可复现的伪随机源。恒定 rand 会让 spawnEnemy 永远只选到第一种机型，
// 用带种子的 PRNG 才能把 spinner/diver/sniper/splitter 全部跑出来。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 跑一局
 * @param dir 代码目录
 * @param o { fps, ms, rand|seed, input, sample:'frame'|'step'|null }
 */
function play(dir, o) {
  const rnd = o.seed != null ? mulberry32(o.seed) : () => o.rand;
  const h = boot({ dir, rand: rnd, t0: T0, instrument: o.instrument });
  const DJFE = h.DJFE;
  DJFE.Game.init();
  DJFE.Game.setDifficulty(o.diff || 'normal');
  DJFE.Game.start();
  const inputFn = INPUTS[o.input];
  if (o.input === 'static') staticInput(h);

  const nFrames = Math.floor(o.ms / (1000 / o.fps));
  const samples = [];
  const seen = new Set();
  const marks = [];
  let nextMark = 1000;

  for (let i = 1; i <= nFrames; i++) {
    const t = T0 + (i * 1000) / o.fps;
    if (inputFn && o.input !== 'static') inputFn(h, t);
    h.frame(t - h.now);
    const g = DJFE.__debug.game;
    if (o.sample === 'frame') {
      samples.push(signature(DJFE, i));
    } else if (o.sample === 'step') {
      const k = g.runFrames;
      if (!seen.has(k)) { seen.add(k); samples.push(signature(DJFE, k)); }
    }
    while (t - T0 >= nextMark) {
      marks.push({ wallMs: nextMark, steps: g.runFrames, score: g.score, wave: g.wave, stage: g.stage, ne: g.enemies.length });
      nextMark += 1000;
    }
  }
  return { h, DJFE, samples, marks, game: DJFE.__debug.game, ctxOps: h.ctxOps() };
}

function diffSamples(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    for (const k of Object.keys(x)) {
      const xv = JSON.stringify(x[k]), yv = JSON.stringify(y[k]);
      if (xv !== yv) return { index: i, t: x.t, key: k, a: x[k], b: y[k], sa: x, sb: y };
    }
  }
  if (a.length !== b.length) return { index: n, key: '<length>', a: a.length, b: b.length };
  return null;
}

// ============================ 1. PARITY ============================
function cmdParity() {
  console.log('\n=== [1] 行为一致性 parity（baseline vs current @60Hz，逐帧全量状态比对）===');
  const cases = [];
  // a) 恒定随机源：覆盖若干确定性分支
  for (const rand of [0.05, 0.3, 0.5, 0.72, 0.93]) {
    cases.push({ name: 'survivor 恒定 rand=' + rand, o: { ms: 150000, rand, input: 'survivor', diff: 'normal' } });
    cases.push({ name: 'mortal   恒定 rand=' + rand, o: { ms: 45000, rand, input: 'mortal', diff: 'hard' } });
  }
  // b) 带种子 PRNG：8 种机型 / 分裂 / 道具 / Boss 弹幕全部随机跑开
  for (const seed of [1, 7, 20260601, 88888]) {
    cases.push({ name: 'survivor 种子 ' + seed, o: { ms: 180000, seed, input: 'survivor', diff: 'hard' } });
    cases.push({ name: 'mortal   种子 ' + seed, o: { ms: 60000, seed, input: 'mortal', diff: 'normal' } });
  }
  let allOk = true;
  for (const c of cases) {
    const o = Object.assign({ fps: 60, sample: 'frame' }, c.o);
    const A = play(BASE, o);
    const B = play(CUR, o);
    const d = diffSamples(A.samples, B.samples);
    const tail = A.samples[A.samples.length - 1];
    if (d) {
      allOk = false;
      console.log(`  [${c.name}]  ✗ 不一致 @frame#${d.index} 字段 ${d.key}: base=${JSON.stringify(d.a)} cur=${JSON.stringify(d.b)}`);
      if (d.sa) {
        console.log('    base:', JSON.stringify(d.sa));
        console.log('    cur :', JSON.stringify(d.sb));
      }
    } else {
      console.log(`  [${c.name}]  ✓ ${A.samples.length} 帧全量一致（末帧 state=${tail.state} score=${tail.score} wave=${tail.wave} stage=${tail.stage} chk=${tail.chk}）`);
    }
  }
  console.log(allOk ? '  => PARITY PASS：行为零变化' : '  => PARITY FAIL');
  return allOk;
}

// ======================= 2. REFRESH RATE ==========================
function cmdRefresh() {
  console.log('\n=== [2] 跨刷新率一致性（30/60/72/120/144/240Hz，30s，静态输入）===');
  const rates = [30, 60, 72, 120, 144, 240];
  const MS = 30000;

  const run = (dir) => rates.map((fps) => {
    const r = play(dir, { fps, ms: MS, rand: 0.5, input: 'static', sample: 'step' });
    return { fps, r };
  });

  const report = (label, runs, expectPass) => {
    console.log(`\n  -- ${label} --`);
    for (const { fps, r } of runs) {
      const g = r.game;
      console.log(`    ${String(fps).padStart(3)}Hz: 逻辑步数=${String(g.runFrames).padStart(5)}  score=${String(g.score).padStart(6)}  wave=${g.wave} stage=${g.stage}`);
    }
    // a) 逻辑步频是否与刷新率无关
    const steps = runs.map((x) => x.r.game.runFrames);
    const stepSpread = Math.max(...steps) - Math.min(...steps);
    const expectSteps = Math.round(MS / (1000 / 60));
    const stepOk = stepSpread <= 2 && Math.abs(steps[0] - expectSteps) <= 2;
    console.log(`    步数区间=${Math.min(...steps)}~${Math.max(...steps)}（期望≈${expectSteps}，容差±2）→ ${stepOk ? '✓' : '✗'}`);
    // b) 相同步数下状态是否逐字节一致（以 60Hz 为基准）
    const ref = runs.find((x) => x.fps === 60).r.samples;
    const refMap = new Map(ref.map((s) => [s.t, s]));
    let stateOk = true;
    for (const { fps, r } of runs) {
      if (fps === 60) continue;
      let cmp = 0, bad = null;
      for (const s of r.samples) {
        const o = refMap.get(s.t);
        if (!o) continue;
        cmp++;
        for (const k of Object.keys(s)) {
          if (JSON.stringify(s[k]) !== JSON.stringify(o[k])) { bad = { step: s.t, k, a: o[k], b: s[k] }; break; }
        }
        if (bad) break;
      }
      if (bad) { stateOk = false; console.log(`    ${fps}Hz vs 60Hz: ✗ step#${bad.step} 字段 ${bad.k} 60Hz=${JSON.stringify(bad.a)} ${fps}Hz=${JSON.stringify(bad.b)}`); }
      else console.log(`    ${fps}Hz vs 60Hz: ✓ 同步数状态完全一致（比对 ${cmp} 个采样点）`);
    }
    const pass = stepOk && stateOk;
    console.log(`    => ${label}：${pass ? 'PASS' : 'FAIL'}${expectPass === false ? '（基线预期 FAIL —— 这就是 D8）' : ''}`);
    return pass;
  };

  const baseRuns = run(BASE);
  report('baseline（改动前）', baseRuns, false);
  const curRuns = run(CUR);
  const ok = report('current（固定步长）', curRuns, true);

  // 直观速度对照：同一墙钟时刻的推进量
  console.log('\n  -- 墙钟 20s 时的进度对照（速度是否随刷新率变化）--');
  const at = (runs, ms) => runs.map(({ fps, r }) => {
    const m = r.marks.find((x) => x.wallMs === ms) || {};
    return `${fps}Hz:score=${m.score},wave=${m.wave}`;
  }).join('  ');
  console.log('    baseline:', at(baseRuns, 20000));
  console.log('    current :', at(curRuns, 20000));
  return ok;
}

// ==================== 3. 分配 / GC 压力 ============================
// 场景：hard + 带种子 PRNG，180s。机型全解锁、Boss 弹幕与分裂母体都会出现。
const LOAD = { fps: 60, ms: 180000, seed: 20260601, input: 'survivor', sample: null, diff: 'hard' };

function cmdAlloc() {
  console.log('\n=== [3] 热循环分配量（对象池效果，120s 满弹幕负载）===');

  const measure = (label, dir) => {
    const h0 = process.hrtime.bigint();
    const r = play(dir, LOAD);
    const ms = Number(process.hrtime.bigint() - h0) / 1e6;
    const al = r.h.alloc();
    const g = r.game;
    const pools = r.DJFE.__debug.poolStats ? r.DJFE.__debug.poolStats() : null;
    console.log(`\n  -- ${label} --`);
    console.log(`     模拟耗时 ${ms.toFixed(0)}ms   末帧 bullets=${g.bullets.length} ebullets=${g.ebullets.length} particles=${g.particles.length} score=${g.score}`);
    console.log(`     新建数组次数：filter=${al.filter}  map=${al.map}  slice=${al.slice}  concat=${al.concat}   合计=${al.filter + al.map + al.slice + al.concat}`);
    console.log(`     实体入列次数（push）：${al.push}`);
    return { ms, al, pools, r };
  };

  const a = measure('baseline（改动前）', BASE);
  const b = measure('current（对象池）', CUR);

  const arrA = a.al.filter + a.al.map + a.al.slice + a.al.concat;
  const arrB = b.al.filter + b.al.map + b.al.slice + b.al.concat;
  let gets = 0, grown = 0, prealloc = 0;
  for (const k of Object.keys(b.pools)) { gets += b.pools[k].gets; grown += b.pools[k].grown; prealloc += b.pools[k].cap; }

  console.log('\n  -- 结论 --');
  console.log(`     新建数组：${arrA} -> ${arrB}（${arrA ? (100 * (arrA - arrB) / arrA).toFixed(1) : 0}% 消除）`);
  console.log(`     实体对象：改动前需新建 ${gets} 个（= 池的取用次数，行为已证明逐位一致）`);
  console.log(`               改动后运行期新建 ${grown} 个 + 启动时预分配 ${prealloc} 个`);
  const saved = gets - grown;
  console.log(`     => 单局(120s)少产生垃圾对象约 ${saved} 个 + 少产生临时数组 ${arrA - arrB} 个`);

  console.log('\n  -- 池水位（peak=同时在用峰值 / cap=预分配容量 / grown=容量不足时的追加分配）--');
  let capWarn = false;
  for (const k of Object.keys(b.pools)) {
    const p = b.pools[k];
    const head = p.cap ? (100 * p.peak / p.cap).toFixed(0) : '-';
    const warn = p.grown > 0 ? '  ⚠ 容量不足，已动态扩容' : (p.peak / p.cap > 0.85 ? '  ⚠ 水位偏高' : '');
    if (warn) capWarn = true;
    console.log(`     ${k.padEnd(10)} peak=${String(p.peak).padStart(4)} / cap=${String(p.cap).padStart(4)}  (${head}%)  gets=${String(p.gets).padStart(6)}  grown=${p.grown}${warn}`);
  }
  // ---- 池容量压力：多种子 / 长局，取各池水位最大值 ----
  console.log('\n  -- 池容量压力（多种子 300s hard 长局，取水位最大值）--');
  const hi = {};
  for (const seed of [1, 7, 42, 20260601, 88888]) {
    const r = play(CUR, { fps: 60, ms: 300000, seed, input: 'survivor', sample: null, diff: 'hard' });
    const ps = r.DJFE.__debug.poolStats();
    for (const k of Object.keys(ps)) {
      if (!hi[k] || ps[k].peak > hi[k].peak) hi[k] = { peak: ps[k].peak, cap: ps[k].cap, grown: ps[k].grown, seed };
    }
    for (const k of Object.keys(ps)) hi[k].grown = Math.max(hi[k].grown, ps[k].grown);
    const g = r.game;
    console.log(`     seed=${String(seed).padStart(8)}  wave=${String(g.wave).padStart(2)} stage=${g.stage} score=${String(g.score).padStart(6)}  ` +
      `峰值 b=${ps.bullets.peak} eb=${ps.ebullets.peak} p=${ps.particles.peak} e=${ps.enemies.peak}`);
  }
  let stressWarn = false;
  console.log('     ---- 各池全局最高水位 ----');
  for (const k of Object.keys(hi)) {
    const p = hi[k];
    const pct = 100 * p.peak / p.cap;
    const warn = p.grown > 0 ? '  ⚠ 已扩容' : (pct > 85 ? '  ⚠ 水位偏高' : (pct < 8 ? '  · 容量宽裕' : ''));
    if (p.grown > 0 || pct > 85) stressWarn = true;
    console.log(`     ${k.padEnd(10)} max peak=${String(p.peak).padStart(4)} / cap=${String(p.cap).padStart(4)}  (${pct.toFixed(0)}%)${warn}`);
  }

  const ok = arrB === 0 && grown === 0 && !capWarn && !stressWarn;
  console.log(`  => ${ok ? '热循环零分配 + 池容量充足 PASS' : '仍有分配或水位告警，需复核'}`);
  return ok;
}

// 真实 GC：用子进程 --trace-gc 跑同一负载。
// 指标取「新生代回收字节数」——每次 Scavenge 打印 before -> after，差值即本次清掉的垃圾，
// 累加起来近似整局产生的垃圾总量，比「GC 次数」更能反映分配压力
//（次数还受 semi-space 大小、存活对象多少影响，容易反向）。
// 跑 REPS 遍取中位数，避免单次抖动。
const GC_REPS = 3;
function median(a) { const s = a.slice().sort((x, y) => x - y); return s[(s.length - 1) >> 1]; }

function cmdGc() {
  console.log('\n=== [4] 真实 GC（子进程 --trace-gc，' + GC_REPS + ' 次取中位数）===');
  const { spawnSync } = require('child_process');
  // Scavenge 5.3 (5.8) -> 4.9 (6.8) MB, pooled: 0 MB, 0.63 / 0.00 ms
  const RE = /\b(Scavenge|Mark-Compact|Mark-sweep)\b\s+([\d.]+)\s*\([\d.]+\)\s*->\s*([\d.]+)\s*\([\d.]+\)\s*MB.*?([\d.]+)\s*\/\s*[\d.]+\s*ms/;

  const once = (dir) => {
    const res = spawnSync(process.execPath, ['--trace-gc', __filename, '_load', dir], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    let n = 0, pause = 0, freed = 0;
    for (const line of out.split('\n')) {
      const m = line.match(RE);
      if (!m) continue;
      n++;
      freed += Math.max(0, parseFloat(m[2]) - parseFloat(m[3]));
      pause += parseFloat(m[4]);
    }
    const wall = Number((out.match(/__WALL__ ([\d.]+)/) || [])[1] || 0);
    return { n, pause, freed, wall };
  };

  const run = (label, dir) => {
    const rs = [];
    for (let i = 0; i < GC_REPS; i++) rs.push(once(dir));
    const r = {
      n: median(rs.map((x) => x.n)),
      pause: median(rs.map((x) => x.pause)),
      freed: median(rs.map((x) => x.freed)),
      wall: median(rs.map((x) => x.wall)),
    };
    console.log(
      `  ${label}: 回收垃圾=${r.freed.toFixed(0).padStart(5)}MB  GC 次数=${String(r.n).padStart(4)}` +
      `  停顿合计=${r.pause.toFixed(1).padStart(6)}ms  模拟耗时=${r.wall}ms`);
    return r;
  };

  const a = run('baseline（改动前）', BASE);
  const b = run('current（对象池）', CUR);

  const pct = (x, y) => (x ? (100 * (x - y) / x) : 0);
  const dFreed = pct(a.freed, b.freed);
  const dPause = pct(a.pause, b.pause);
  const sign = (v) => (v >= 0 ? `降低 ${v.toFixed(1)}%` : `上升 ${(-v).toFixed(1)}%`);
  console.log(`  => 垃圾总量 ${a.freed.toFixed(0)}MB -> ${b.freed.toFixed(0)}MB（${sign(dFreed)}）`);
  console.log(`     GC 停顿 ${a.pause.toFixed(1)}ms -> ${b.pause.toFixed(1)}ms（${sign(dPause)}）`);
  console.log('     注：无头环境下 render 里的字符串/样式赋值也在造垃圾，且两版完全相同，');
  console.log('        会稀释对象池的收益；确定性的分配消除量以 [3] 的计数为准。');

  // 判定放宽：只要垃圾总量没有变多即算通过（真实收益已由 [3] 的确定性计数证明）
  const ok = b.freed <= a.freed * 1.02;
  console.log(`  => ${ok ? 'GC 压力未变差 PASS' : '⚠ 垃圾总量反而上升，需复核'}`);
  return ok;
}

// ============================ main ================================
const cmd = process.argv[2] || 'all';

// 子进程模式：只跑一遍负载，供 --trace-gc 观测
if (cmd === '_load') {
  const t = process.hrtime.bigint();
  // 关掉数组插桩：插桩自身的 apply/arguments 会造大量垃圾，污染 GC 观测
  play(process.argv[3], Object.assign({}, LOAD, { instrument: false }));
  console.log('__WALL__ ' + (Number(process.hrtime.bigint() - t) / 1e6).toFixed(0));
  process.exit(0);
}

let ok = true;
if (cmd === 'parity' || cmd === 'all') ok = cmdParity() && ok;
if (cmd === 'refresh' || cmd === 'all') ok = cmdRefresh() && ok;
if (cmd === 'alloc' || cmd === 'all') ok = cmdAlloc() && ok;
if (cmd === 'gc' || cmd === 'all') ok = cmdGc() && ok;
console.log('\n' + (ok ? '全部检查通过 ✓' : '存在未通过项 ✗'));
process.exit(ok ? 0 : 1);
