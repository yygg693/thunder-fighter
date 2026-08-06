/* =====================================================================
 * 打飞机 · 无头驱动测试台（开发工具，不随游戏发布）
 * 用 Node vm 沙箱加载 core.js / entities.js / game.js，
 * 用「虚拟时钟 + 可控 rAF + 可控随机数」确定性地驱动主循环，
 * 采样游戏状态签名，用于：
 *   1) 重构前后行为一致性（parity）比对
 *   2) 跨刷新率（30/60/120/144/240Hz）速度一致性验证
 *
 * 用法见 tools/parity-check.js 与 tools/refresh-rate-check.js
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const W = 960, H = 720;

function noop() {}

/** Canvas 2D 上下文桩：所有方法空转，渐变返回可 addColorStop 的桩对象 */
function makeCtxStub() {
  const store = Object.create(null);
  const grad = { addColorStop: noop };
  const fixed = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    canvas: { width: W, height: H },
  };
  // 绘制调用计数：用来判定两版「画的次数」是否真的一样
  const ops = { get: 0, set: 0 };
  const p = new Proxy(store, {
    get(t, k) {
      ops.get++;
      if (k in fixed) return fixed[k];
      if (k in t) return t[k];
      // 未知成员一律当成空转方法（save/restore/beginPath/arc/...）
      return noop;
    },
    set(t, k, v) { ops.set++; t[k] = v; return true; },
    has() { return true; },
  });
  return { ctx: p, ops };
}

/** DOM 元素桩 */
function makeEl(id) {
  const classes = new Set();
  return {
    id,
    width: W, height: H,
    value: '5',
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
    focus: noop,
    click: noop,
    getContext: () => null, // 由 boot 里给 #game 覆盖
  };
}

/**
 * 启动一个游戏实例
 * @param {object} opt
 *  - dir       : 存放 core.js/entities.js/game.js 的目录
 *  - rand      : 随机数实现（默认恒定 0.5；恒定值可让「调用顺序」变化不影响结果）
 *  - t0        : 虚拟起始时刻
 */
function boot(opt) {
  const dir = opt.dir;
  const randFn = opt.rand || (() => 0.5);
  let perfNow = opt.t0 == null ? 1000 : opt.t0;

  const __ctx = makeCtxStub();
  const ctxStub = __ctx.ctx;
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      const e = makeEl(id);
      if (id === 'game') e.getContext = () => ctxStub;
      els.set(id, e);
    }
    return els.get(id);
  };

  let rafCb = null;
  let rafId = 0;
  const timers = [];

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  // 用副本 Math，只替换 random，保证 sin/cos/PI 等原样
  const MathStub = {};
  for (const k of Object.getOwnPropertyNames(Math)) {
    try { MathStub[k] = Math[k]; } catch (e) { /* ignore */ }
  }
  MathStub.random = () => randFn();

  const documentStub = {
    getElementById: getEl,
    createElement: (tag) => {
      const e = makeEl('_' + tag);
      if (tag === 'canvas') e.getContext = () => ctxStub;
      return e;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: makeEl('body'),
    documentElement: makeEl('html'),
  };

  const windowStub = {
    innerWidth: W, innerHeight: H,
    devicePixelRatio: 1,
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    localStorage,
    // 故意不提供 AudioContext：core.js 的 try/catch 会把 audioCtx 置 null（静音跑）
  };

  const sandbox = {
    window: windowStub,
    document: documentStub,
    localStorage,
    Math: MathStub,
    console,
    performance: { now: () => perfNow },
    Date: new Proxy(Date, { get(t, k) { return k === 'now' ? () => 1700000000000 + perfNow : t[k]; } }),
    requestAnimationFrame: (cb) => { rafCb = cb; return ++rafId; },
    cancelAnimationFrame: () => { rafCb = null; },
    setTimeout: (fn, ms) => { timers.push({ fn, at: perfNow + (ms || 0) }); return timers.length; },
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
  };
  sandbox.window.window = sandbox.window;

  vm.createContext(sandbox);

  // 分配计数器：统计沙箱内「会产生新数组」的调用。
  // 改动前主循环每帧要 filter 出 8~9 个新数组，这里能直接量到。
  // 注意：插桩自身（apply + arguments 对象）也会造垃圾，测 GC 时必须关掉，
  // 否则被测信号会被插桩噪声淹没。故设为可选，默认开启。
  const instrument = opt.instrument !== false;
  vm.runInContext(instrument ? `
    globalThis.__alloc = { filter: 0, map: 0, slice: 0, concat: 0, push: 0 };
    for (const m of ['filter', 'map', 'slice', 'concat']) {
      const orig = Array.prototype[m];
      Object.defineProperty(Array.prototype, m, {
        value: function () { globalThis.__alloc[m]++; return orig.apply(this, arguments); },
        writable: true, configurable: true, enumerable: false,
      });
    }
    const _push = Array.prototype.push;
    Object.defineProperty(Array.prototype, 'push', {
      value: function () { globalThis.__alloc.push += arguments.length; return _push.apply(this, arguments); },
      writable: true, configurable: true, enumerable: false,
    });
  ` : 'globalThis.__alloc = { filter: 0, map: 0, slice: 0, concat: 0, push: 0 };',
    sandbox, { filename: '__alloc.js' });

  for (const f of ['core.js', 'entities.js', 'game.js']) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }

  const DJFE = sandbox.window.DJFE;

  function drainTimers() {
    for (let i = 0; i < timers.length; i++) {
      if (timers[i] && timers[i].at <= perfNow) { const fn = timers[i].fn; timers[i] = null; try { fn(); } catch (e) {} }
    }
  }

  return {
    DJFE,
    els,
    /** canvas 桩上的属性读写次数 ≈ 绘制指令数 */
    ctxOps() { return { get: __ctx.ops.get, set: __ctx.ops.set }; },
    /** 沙箱内的数组分配计数（filter/map/slice/concat 各返回一个新数组） */
    alloc() { const a = sandbox.__alloc; return { filter: a.filter, map: a.map, slice: a.slice, concat: a.concat, push: a.push }; },
    resetAlloc() { const a = sandbox.__alloc; a.filter = a.map = a.slice = a.concat = a.push = 0; },
    get now() { return perfNow; },
    /** 把虚拟时钟推进 ms 并触发一次 rAF 回调（模拟一帧） */
    frame(ms) {
      perfNow += ms;
      drainTimers();
      const cb = rafCb; rafCb = null;
      if (cb) cb(perfNow);
    },
    /** 不推进时钟，仅执行一个动作（模拟帧间的用户输入） */
    act(fn) { fn(DJFE); },
    setPointer(x, y) { DJFE.input.pointer.x = x; DJFE.input.pointer.y = y; },
  };
}

/** FNV-1a 32bit */
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

const r6 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

/** 采集一份可比对的游戏状态签名 */
function signature(DJFE, t) {
  const g = DJFE.__debug.game;
  const p = DJFE.__debug.player;
  const parts = [];
  const dump = (list, fields) => {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      for (const f of fields) parts.push(f + ':' + r6(o[f]));
      parts.push('|');
    }
    parts.push('#');
  };
  dump(g.bullets, ['x', 'y', 'vx', 'vy', 'r']);
  dump(g.enemies, ['type', 'x', 'y', 'vy', 'hp', 'phase', 'fireT', 'lockT', 'diving', 'dvx', 'dvy', 'hover', 'flash', 'score', 'hue']);
  dump(g.ebullets, ['x', 'y', 'vx', 'vy', 'r', 'kind', 'dead']);
  dump(g.particles, ['x', 'y', 'vx', 'vy', 'life', 'hue']);
  dump(g.items, ['x', 'y', 'vy', 'type', 'dead']);
  dump(g.rings, ['x', 'y', 'r', 'maxR', 'life', 'hue']);
  return {
    t: r6(t),
    state: g.state,
    score: g.score, lives: g.lives, bombs: g.bombs, power: g.power,
    wave: g.wave, stage: g.stage, stageWave: g.stageWave,
    combo: g.combo, maxCombo: g.maxCombo,
    betweenWaves: g.betweenWaves, waveRemaining: g.waveRemaining, isBossWave: g.isBossWave,
    nb: g.bullets.length, ne: g.enemies.length, neb: g.ebullets.length,
    np: g.particles.length, ni: g.items.length, nr: g.rings.length,
    px: r6(p.x), py: r6(p.y),
    shake: r6(g.shake), flash: r6(g.flash),
    boss: g.boss ? [r6(g.boss.hp), r6(g.boss.x), r6(g.boss.y), r6(g.boss.phase), r6(g.boss.fireT)] : null,
    chk: fnv(parts.join(',')),
  };
}

module.exports = { boot, signature, fnv, W, H };
