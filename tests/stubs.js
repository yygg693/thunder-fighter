/* =====================================================================
 * 打飞机 · Fighter Shooter — tests/stubs.js
 * 零依赖 DOM / Canvas2D / Web Audio / rAF / localStorage / performance 桩
 *
 * 目的：让 src/*.js（经典 <script> + window.DJFE 命名空间）能在 Node 的
 *      vm 沙箱里原样加载并跑起来，从而做无头冒烟测试。
 *
 * 设计要点：
 *  1. 虚拟时钟 —— performance.now / rAF / setTimeout / setInterval /
 *     AudioContext.currentTime 全部挂在同一条虚拟时间轴上，测试可以
 *     "秒进" 几千帧，且完全确定性、零真实等待。
 *  2. 确定性随机 —— Math.random 用可播种 PRNG 覆盖，消除 flaky。
 *  3. DOM 从真实 index.html 解析 —— getElementById 只认 HTML 里真实存在的
 *     id，JS 引用了但 HTML 没有的 id 会返回 null 并记为 warning，
 *     从而能真正抓出 "元素缺失" 类 bug。
 *  4. Canvas2D 桩带 NaN/undefined 哨兵 —— 任何绘制参数出现
 *     NaN/Infinity，或颜色字符串里出现 "NaN"/"undefined"，都会被记录。
 * ===================================================================== */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------------------------------------------------------------------
// 确定性伪随机（mulberry32）
// ---------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------
// 极简 HTML 解析：只抽取标签名 + 属性，够 DOM 桩用
// ---------------------------------------------------------------------
function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/g;
  let m;
  while ((m = re.exec(raw))) {
    const v = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    attrs[m[1].toLowerCase()] = v;
  }
  return attrs;
}

function parseHtml(html) {
  // 去掉 <script>...</script> 与 <style>...</style> 内容，避免误抓 JS 里的字符串
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const els = [];
  const re = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(cleaned))) {
    els.push({ tag: m[1].toLowerCase(), attrs: parseAttrs(m[2] || '') });
  }
  return els;
}

// ---------------------------------------------------------------------
// 主环境工厂
// ---------------------------------------------------------------------
function createEnv(options) {
  const opts = Object.assign({
    root: path.resolve(__dirname, '..'),
    html: null,           // 不传则读 root/index.html
    width: 960,
    height: 720,
    seed: 20250728,
    touch: false,
    trackNaN: true,
  }, options || {});

  const htmlPath = path.join(opts.root, 'index.html');
  const html = opts.html != null ? opts.html : fs.readFileSync(htmlPath, 'utf8');
  const parsed = parseHtml(html);

  // ---- 诊断收集器 ----
  const report = {
    errors: [],      // 抛出的异常
    warnings: [],    // 缺失 id / 未支持选择器 等
    nan: [],         // 绘制参数 NaN / 颜色串含 NaN|undefined
    consoleErr: [],  // console.error / console.warn
    counters: { frames: 0, rafCalls: 0, timerFires: 0, ctxCalls: 0 },
  };
  const NAN_CAP = 40;
  function recordError(where, err) {
    report.errors.push({ where, message: String(err && err.message || err), stack: err && err.stack });
  }
  function recordWarn(kind, detail) {
    report.warnings.push({ kind, detail });
  }
  function recordNaN(where, detail) {
    if (report.nan.length < NAN_CAP) report.nan.push({ where, detail });
  }

  // ---- 虚拟时钟 ----
  const clock = { now: 0 };

  // ---- 虚拟定时器 ----
  let timerSeq = 1;
  const timers = new Map(); // id -> {fn, at, every, args}
  function setTimeoutStub(fn, ms, ...args) {
    const id = timerSeq++;
    timers.set(id, { fn, at: clock.now + (Number(ms) || 0), every: 0, args });
    return id;
  }
  function setIntervalStub(fn, ms, ...args) {
    const id = timerSeq++;
    const every = Math.max(1, Number(ms) || 1);
    timers.set(id, { fn, at: clock.now + every, every, args });
    return id;
  }
  function clearTimerStub(id) { timers.delete(id); }
  function runDueTimers() {
    let guard = 0;
    for (;;) {
      let pick = null, pickId = -1;
      for (const [id, t] of timers) {
        if (t.at <= clock.now && (pick === null || t.at < pick.at)) { pick = t; pickId = id; }
      }
      if (!pick) return;
      if (++guard > 5000) { recordWarn('timer-storm', 'runDueTimers exceeded 5000 iterations in one frame'); return; }
      if (pick.every > 0) pick.at = clock.now + pick.every; else timers.delete(pickId);
      report.counters.timerFires++;
      try { pick.fn.apply(null, pick.args); }
      catch (e) { recordError('timer', e); }
    }
  }

  // ---- 虚拟 requestAnimationFrame ----
  let rafSeq = 1;
  let rafQueue = new Map();
  function requestAnimationFrameStub(cb) { const id = rafSeq++; rafQueue.set(id, cb); return id; }
  function cancelAnimationFrameStub(id) { rafQueue.delete(id); }

  // ---- Canvas 2D 上下文桩（带 NaN 哨兵） ----
  const CTX_METHODS = [
    'save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform',
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo',
    'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip', 'isPointInPath',
    'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'measureText',
    'drawImage', 'putImageData', 'getImageData', 'createImageData',
    'setLineDash', 'getLineDash', 'clip',
  ];
  const CTX_COLOR_PROPS = ['fillStyle', 'strokeStyle', 'shadowColor', 'font', 'lineCap', 'lineJoin',
    'textAlign', 'textBaseline', 'globalCompositeOperation', 'filter'];
  const CTX_NUM_PROPS = ['globalAlpha', 'lineWidth', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY',
    'miterLimit', 'lineDashOffset'];

  function badColorString(s) {
    return typeof s === 'string' && (s.indexOf('NaN') >= 0 || s.indexOf('undefined') >= 0 || s.indexOf('null') >= 0);
  }

  function makeGradient(label) {
    return {
      addColorStop(off, color) {
        if (!opts.trackNaN) return;
        if (typeof off === 'number' && !Number.isFinite(off)) recordNaN(label + '.addColorStop', 'offset=' + off);
        if (badColorString(color)) recordNaN(label + '.addColorStop', 'color=' + color);
      },
    };
  }

  function makeCtx(label) {
    const ctx = { canvas: null, __label: label };
    for (const name of CTX_METHODS) {
      ctx[name] = function (...args) {
        report.counters.ctxCalls++;
        if (opts.trackNaN) {
          for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (typeof a === 'number' && !Number.isFinite(a)) recordNaN(label + '.' + name, 'arg[' + i + ']=' + a);
            else if (typeof a === 'string' && badColorString(a)) recordNaN(label + '.' + name, 'arg[' + i + ']="' + a + '"');
          }
        }
        if (name === 'measureText') return { width: (String(args[0] || '')).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
        if (name === 'getLineDash') return [];
        if (name === 'isPointInPath') return false;
        if (name === 'getImageData' || name === 'createImageData') {
          const w = Math.max(1, Math.floor(args[2] || 1)), h = Math.max(1, Math.floor(args[3] || 1));
          return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        }
        return undefined;
      };
    }
    ctx.createLinearGradient = function (...a) {
      report.counters.ctxCalls++;
      if (opts.trackNaN) a.forEach((v, i) => { if (typeof v === 'number' && !Number.isFinite(v)) recordNaN(label + '.createLinearGradient', 'arg[' + i + ']=' + v); });
      return makeGradient(label + ':linear');
    };
    ctx.createRadialGradient = function (...a) {
      report.counters.ctxCalls++;
      if (opts.trackNaN) a.forEach((v, i) => { if (typeof v === 'number' && !Number.isFinite(v)) recordNaN(label + '.createRadialGradient', 'arg[' + i + ']=' + v); });
      return makeGradient(label + ':radial');
    };
    ctx.createPattern = function () { return makeGradient(label + ':pattern'); };
    // 带哨兵的属性
    for (const p of CTX_COLOR_PROPS) {
      let v = '';
      Object.defineProperty(ctx, p, {
        get() { return v; },
        set(nv) {
          if (opts.trackNaN && badColorString(nv)) recordNaN(label + '.' + p, String(nv));
          v = nv;
        },
        enumerable: true, configurable: true,
      });
    }
    for (const p of CTX_NUM_PROPS) {
      let v = p === 'globalAlpha' ? 1 : (p === 'lineWidth' ? 1 : 0);
      Object.defineProperty(ctx, p, {
        get() { return v; },
        set(nv) {
          if (opts.trackNaN && typeof nv === 'number' && !Number.isFinite(nv)) recordNaN(label + '.' + p, String(nv));
          v = nv;
        },
        enumerable: true, configurable: true,
      });
    }
    return ctx;
  }

  // ---- DOM 元素桩 ----
  function makeClassList(el, initial) {
    const set = new Set(String(initial || '').split(/\s+/).filter(Boolean));
    return {
      add(...c) { c.forEach(x => set.add(x)); el.className = [...set].join(' '); },
      remove(...c) { c.forEach(x => set.delete(x)); el.className = [...set].join(' '); },
      contains(c) { return set.has(c); },
      toggle(c, force) {
        const on = force === undefined ? !set.has(c) : !!force;
        if (on) set.add(c); else set.delete(c);
        el.className = [...set].join(' ');
        return on;
      },
      get length() { return set.size; },
      toString() { return [...set].join(' '); },
    };
  }

  function makeElement(tag, attrs) {
    attrs = attrs || {};
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      id: attrs.id || '',
      children: [],
      style: {},
      _listeners: Object.create(null),
      _ctx: null,
      className: attrs.class || '',
      textContent: '',
      innerHTML: '',
      value: attrs.value !== undefined ? attrs.value : '',
      checked: false,
      disabled: false,
      placeholder: attrs.placeholder || '',
      width: attrs.width !== undefined ? Number(attrs.width) : 300,
      height: attrs.height !== undefined ? Number(attrs.height) : 150,
      lang: '',
      _attrs: attrs,
    };
    el.classList = makeClassList(el, attrs.class);
    el.dataset = {};
    for (const k of Object.keys(attrs)) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        el.dataset[camel] = attrs[k];
      }
    }
    el.getAttribute = (n) => (attrs[String(n).toLowerCase()] !== undefined ? attrs[String(n).toLowerCase()] : null);
    el.setAttribute = (n, v) => { attrs[String(n).toLowerCase()] = String(v); };
    el.hasAttribute = (n) => attrs[String(n).toLowerCase()] !== undefined;
    el.removeAttribute = (n) => { delete attrs[String(n).toLowerCase()]; };
    el.appendChild = (c) => { el.children.push(c); return c; };
    el.removeChild = (c) => { el.children = el.children.filter(x => x !== c); return c; };
    el.querySelectorAll = () => [];
    el.querySelector = () => null;
    el.focus = () => {};
    el.blur = () => {};
    el.getBoundingClientRect = () => ({
      left: 0, top: 0, right: el.width, bottom: el.height,
      width: el.width, height: el.height, x: 0, y: 0,
    });
    el.getContext = (kind) => {
      if (kind !== '2d') return null;
      if (!el._ctx) { el._ctx = makeCtx('ctx#' + (el.id || el.tagName)); el._ctx.canvas = el; }
      return el._ctx;
    };
    el.addEventListener = (type, fn) => {
      (el._listeners[type] || (el._listeners[type] = [])).push(fn);
    };
    el.removeEventListener = (type, fn) => {
      if (el._listeners[type]) el._listeners[type] = el._listeners[type].filter(f => f !== fn);
    };
    el.dispatchEvent = (ev) => fireOn(el, ev.type, ev);
    el.click = () => fireOn(el, 'click', { type: 'click' });
    el.requestFullscreen = () => Promise.resolve();
    el.remove = () => {};
    return el;
  }

  function fireOn(target, type, init) {
    const ev = Object.assign({
      type,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
      target, currentTarget: target,
    }, init || {});
    const list = (target._listeners && target._listeners[type]) || [];
    for (const fn of list.slice()) {
      try { fn.call(target, ev); }
      catch (e) { recordError('event:' + type + '@' + (target.id || target.tagName || 'window'), e); }
    }
    return ev;
  }

  // ---- 从 index.html 构建元素表 ----
  const byId = new Map();
  const allEls = [];
  for (const d of parsed) {
    const el = makeElement(d.tag, d.attrs);
    allEls.push(el);
    if (d.attrs.id) byId.set(d.attrs.id, el);
  }
  const i18nEls = allEls.filter(e => e._attrs['data-i18n'] !== undefined);
  const diffBtns = allEls.filter(e => e.tagName === 'BUTTON' && e._attrs['data-diff'] !== undefined);
  const langBtns = allEls.filter(e => e.tagName === 'BUTTON' && e._attrs['data-lang'] !== undefined);

  const documentElement = makeElement('html', {});
  const bodyEl = makeElement('body', {});

  const missingIds = new Set();
  const unhandledSelectors = new Set();

  const documentStub = {
    documentElement,
    body: bodyEl,
    head: makeElement('head', {}),
    fullscreenElement: null,
    _listeners: Object.create(null),
    getElementById(id) {
      const el = byId.get(id);
      if (!el) {
        if (!missingIds.has(id)) {
          missingIds.add(id);
          recordWarn('missing-element-id', id + ' —— JS 引用了该 id，但 index.html 中不存在');
        }
        return null;
      }
      return el;
    },
    querySelectorAll(sel) {
      const s = String(sel).trim();
      if (s === '[data-i18n]') return i18nEls.slice();
      if (/^#menu\s+\.diff\s+button$/.test(s) || s === '.diff button') return diffBtns.slice();
      if (/^#settings\s+\.seg\s+button$/.test(s) || s === '.seg button') return langBtns.slice();
      if (!unhandledSelectors.has(s)) {
        unhandledSelectors.add(s);
        recordWarn('unhandled-selector', s + ' —— DOM 桩未实现该选择器，已返回空集合');
      }
      return [];
    },
    querySelector(sel) { const r = documentStub.querySelectorAll(sel); return r.length ? r[0] : null; },
    createElement(tag) { return makeElement(tag, {}); },
    createElementNS(ns, tag) { return makeElement(tag, {}); },
    createTextNode(t) { return { nodeType: 3, textContent: String(t) }; },
    addEventListener(type, fn) { (documentStub._listeners[type] || (documentStub._listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      if (documentStub._listeners[type]) documentStub._listeners[type] = documentStub._listeners[type].filter(f => f !== fn);
    },
    dispatchEvent(ev) { return fireOn(documentStub, ev.type, ev); },
    exitFullscreen() { documentStub.fullscreenElement = null; return Promise.resolve(); },
    get visibilityState() { return 'visible'; },
    get hidden() { return false; },
  };
  documentElement.requestFullscreen = () => { documentStub.fullscreenElement = documentElement; return Promise.resolve(); };

  // ---- localStorage 桩 ----
  const lsMap = new Map();
  const localStorageStub = {
    getItem(k) { const v = lsMap.get(String(k)); return v === undefined ? null : v; },
    setItem(k, v) { lsMap.set(String(k), String(v)); },
    removeItem(k) { lsMap.delete(String(k)); },
    clear() { lsMap.clear(); },
    key(i) { return [...lsMap.keys()][i] ?? null; },
    get length() { return lsMap.size; },
    __dump() { return Object.fromEntries(lsMap); },
  };

  // ---- Web Audio 桩 ----
  function makeAudioParam(v) {
    return {
      value: v,
      setValueAtTime(x) { this.value = x; return this; },
      linearRampToValueAtTime(x) { this.value = x; return this; },
      exponentialRampToValueAtTime(x) { this.value = x; return this; },
      setTargetAtTime() { return this; },
      cancelScheduledValues() { return this; },
    };
  }
  function makeNode(extra) {
    return Object.assign({
      connect(dest) { return dest; },
      disconnect() {},
    }, extra || {});
  }
  class AudioContextStub {
    constructor() {
      this.sampleRate = 44100;
      this.state = 'running';
      this.destination = makeNode({});
      this.__oscCount = 0;
      this.__bufCount = 0;
    }
    get currentTime() { return clock.now / 1000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { return makeNode({ gain: makeAudioParam(1) }); }
    createOscillator() {
      this.__oscCount++;
      const self = this;
      return makeNode({
        type: 'sine',
        frequency: makeAudioParam(440),
        detune: makeAudioParam(0),
        start(t) { if (typeof t === 'number' && !Number.isFinite(t)) recordNaN('osc.start', String(t)); },
        stop(t) { if (typeof t === 'number' && !Number.isFinite(t)) recordNaN('osc.stop', String(t)); self.__oscCount--; },
      });
    }
    createBiquadFilter() { return makeNode({ type: 'lowpass', frequency: makeAudioParam(350), Q: makeAudioParam(1) }); }
    createBuffer(ch, len, rate) {
      if (!Number.isFinite(len) || len <= 0) { recordNaN('createBuffer', 'length=' + len); len = 1; }
      const data = new Float32Array(Math.floor(len));
      this.__bufCount++;
      return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: () => data };
    }
    createBufferSource() {
      const self = this;
      return makeNode({ buffer: null, loop: false, playbackRate: makeAudioParam(1), start() {}, stop() { self.__bufCount--; } });
    }
    createDynamicsCompressor() {
      return makeNode({ threshold: makeAudioParam(-24), knee: makeAudioParam(30), ratio: makeAudioParam(12), attack: makeAudioParam(0.003), release: makeAudioParam(0.25) });
    }
    createAnalyser() { return makeNode({ fftSize: 2048, getByteFrequencyData() {}, getByteTimeDomainData() {} }); }
    createStereoPanner() { return makeNode({ pan: makeAudioParam(0) }); }
  }

  // ---- Image 桩（让 sprite 预加载在无头环境不崩）----
  // src 赋值时同步触发 onload（冒烟测试需要精灵路径被覆盖，且不卡 pending）。
  // onload 内的异常被吞掉，避免污染测试报告。width/height 由调用方（DJFE.sprites.dim）
  // 兜底，这里固定为 0 即可。
  class ImageStub {
    constructor() {
      this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0;
      this.onload = null; this.onerror = null; this._src = '';
      const self = this;
      Object.defineProperty(this, 'src', {
        get() { return self._src; },
        set(v) {
          self._src = v;
          if (typeof self.onload === 'function') {
            try { self.onload.call(self); } catch (e) { /* 吞掉加载回调异常 */ }
          }
        },
      });
      Object.defineProperty(this, 'complete', { get() { return true; } });
    }
  }

  // ---- console 转发 + 捕获 ----
  const consoleStub = {
    log: (...a) => { if (process.env.SMOKE_VERBOSE) console.log('   [game]', ...a); },
    info: (...a) => { if (process.env.SMOKE_VERBOSE) console.info('   [game]', ...a); },
    debug: () => {},
    warn: (...a) => { report.consoleErr.push({ level: 'warn', msg: a.map(String).join(' ') }); },
    error: (...a) => { report.consoleErr.push({ level: 'error', msg: a.map(String).join(' ') }); },
    trace: () => {},
    table: () => {},
    group: () => {}, groupEnd: () => {},
    time: () => {}, timeEnd: () => {},
  };

  // ---- window / 全局沙箱 ----
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = documentStub;
  sandbox.navigator = {
    userAgent: 'node-smoke-harness',
    language: 'zh-CN',
    languages: ['zh-CN'],
    maxTouchPoints: opts.touch ? 5 : 0,
    vibrate: () => true,
    serviceWorker: { register: () => Promise.resolve({}) },
  };
  sandbox.location = { href: 'file:///index.html', protocol: 'file:', search: '', hash: '', reload() {} };
  sandbox.innerWidth = opts.width;
  sandbox.innerHeight = opts.height;
  sandbox.devicePixelRatio = 1;
  sandbox.localStorage = localStorageStub;
  sandbox.sessionStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, length: 0,
  };
  sandbox.performance = { now: () => clock.now, timeOrigin: 0, mark: () => {}, measure: () => {} };
  sandbox.requestAnimationFrame = requestAnimationFrameStub;
  sandbox.cancelAnimationFrame = cancelAnimationFrameStub;
  sandbox.setTimeout = setTimeoutStub;
  sandbox.clearTimeout = clearTimerStub;
  sandbox.setInterval = setIntervalStub;
  sandbox.clearInterval = clearTimerStub;
  sandbox.queueMicrotask = (fn) => { try { fn(); } catch (e) { recordError('microtask', e); } };
  sandbox.AudioContext = AudioContextStub;
  sandbox.webkitAudioContext = AudioContextStub;
  sandbox.Image = ImageStub;
  sandbox.console = consoleStub;
  sandbox.alert = () => {};
  sandbox.matchMedia = (q) => ({
    media: q,
    matches: opts.touch && /coarse/.test(q) ? true : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });
  sandbox.fetch = () => Promise.reject(new Error('fetch not available in smoke harness'));
  sandbox._listeners = Object.create(null);
  sandbox.addEventListener = (type, fn) => { (sandbox._listeners[type] || (sandbox._listeners[type] = [])).push(fn); };
  sandbox.removeEventListener = (type, fn) => {
    if (sandbox._listeners[type]) sandbox._listeners[type] = sandbox._listeners[type].filter(f => f !== fn);
  };
  sandbox.dispatchEvent = (ev) => fireOn(sandbox, ev.type, ev);
  if (opts.touch) sandbox.ontouchstart = null;

  vm.createContext(sandbox, { name: 'thunder-fighter-smoke' });

  // 覆盖沙箱内 Math.random 为确定性 PRNG（必须在 contextify 之后，才能拿到沙箱自己的 Math）
  const rng = mulberry32(opts.seed);
  sandbox.__seededRandom = rng;
  vm.runInContext('(function(){ var r = __seededRandom; Math.random = function(){ return r(); }; })();', sandbox);
  try { delete sandbox.__seededRandom; } catch (e) { /* noop */ }

  // ---- 加载脚本 ----
  function loadScript(relPath) {
    const abs = path.join(opts.root, relPath);
    const code = fs.readFileSync(abs, 'utf8');
    const script = new vm.Script(code, { filename: relPath });
    script.runInContext(sandbox, { displayErrors: true });
  }

  // ---- 帧驱动 ----
  const FRAME_MS = 1000 / 60;
  function frame(dt) {
    const step = dt === undefined ? FRAME_MS : dt;
    clock.now += step;
    report.counters.frames++;
    runDueTimers();
    const queue = rafQueue;
    rafQueue = new Map();
    for (const cb of queue.values()) {
      report.counters.rafCalls++;
      try { cb(clock.now); }
      catch (e) { recordError('rAF@frame' + report.counters.frames, e); }
    }
  }
  function pump(frames, dt) {
    for (let i = 0; i < frames; i++) frame(dt);
  }
  function pumpUntil(pred, maxFrames, dt) {
    const cap = maxFrames || 1200;
    for (let i = 0; i < cap; i++) {
      let ok = false;
      try { ok = !!pred(); } catch (e) { recordError('pumpUntil-predicate', e); }
      if (ok) return { ok: true, frames: i };
      frame(dt);
    }
    let ok = false;
    try { ok = !!pred(); } catch (e) { recordError('pumpUntil-predicate', e); }
    return { ok, frames: cap };
  }

  // ---- 事件注入辅助 ----
  function keydown(code) { return fireOn(sandbox, 'keydown', { code, key: code, preventDefault() {} }); }
  function keyup(code) { return fireOn(sandbox, 'keyup', { code, key: code, preventDefault() {} }); }
  function pointerDownOnCanvas(x, y, pointerType) {
    const cv = byId.get('game');
    if (!cv) { recordWarn('missing-element-id', 'game canvas 不存在，无法注入指针事件'); return null; }
    return fireOn(cv, 'pointerdown', { clientX: x, clientY: y, pointerType: pointerType || 'mouse' });
  }
  function pointerMoveOnCanvas(x, y, pointerType) {
    const cv = byId.get('game');
    if (!cv) return null;
    return fireOn(cv, 'pointermove', { clientX: x, clientY: y, pointerType: pointerType || 'mouse' });
  }
  function click(id) {
    const el = byId.get(id);
    if (!el) { recordWarn('missing-element-id', id + ' —— 无法点击'); return false; }
    fireOn(el, 'click', { preventDefault() {} });
    return true;
  }
  function input(id, value) {
    const el = byId.get(id);
    if (!el) return false;
    el.value = String(value);
    fireOn(el, 'input', {});
    return true;
  }
  function resizeWindow(w, h) {
    sandbox.innerWidth = w; sandbox.innerHeight = h;
    fireOn(sandbox, 'resize', {});
  }

  return {
    sandbox,
    clock,
    report,
    document: documentStub,
    localStorage: localStorageStub,
    byId,
    loadScript,
    frame, pump, pumpUntil,
    keydown, keyup, pointerDownOnCanvas, pointerMoveOnCanvas, click, input, resizeWindow,
    get DJFE() { return sandbox.DJFE; },
    get pendingTimers() { return timers.size; },
    get pendingRaf() { return rafQueue.size; },
    FRAME_MS,
    seed: opts.seed,
  };
}

module.exports = { createEnv, mulberry32, parseHtml, parseAttrs };
