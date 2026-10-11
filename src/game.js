/* =====================================================================
 * 打飞机 · Fighter Shooter — game.js
 * 游戏状态机 / 波次调度 / 碰撞 / 主循环 / 渲染编排
 * 依赖 core.js (DJFE.audio/input/hit/W/H/ctx) 与 entities.js (DJFE.draw)
 * ===================================================================== */
window.DJFE = window.DJFE || {};
(function (DJFE) {
  'use strict';
  const ctx = DJFE.ctx;
  const audio = DJFE.audio;
  const input = DJFE.input;
  const hit = DJFE.hit;
  // 预渲染辉光图集（core.js）：取代实时 ctx.shadowBlur
  const fx = DJFE.fx;
  const glow = fx.glow, glowLine = fx.glowLine, glowHue = fx.glowHue;
  let W = DJFE.W(), H = DJFE.H();
  window.addEventListener('resize', () => { W = DJFE.W(); H = DJFE.H(); });

  // ---- DOM ----
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const bombsEl = document.getElementById('bombs');
  const waveEl = document.getElementById('wave');
  const powerEl = document.getElementById('power');
  const stageEl = document.getElementById('stage');
  const finalScoreEl = document.getElementById('finalScore');
  const bestMenuEl = document.getElementById('bestMenu');
  const bestGOEl = document.getElementById('bestGO');
  const sensEl = document.getElementById('sens');
  const sensValEl = document.getElementById('sensVal');
  const touchUIEl = document.getElementById('touchUI');
  const bombCntEl = document.getElementById('bombCnt');
  const comboWrapEl = document.getElementById('comboWrap');
  const comboEl = document.getElementById('combo');
  const maxComboGOEl = document.getElementById('maxComboGO');
  const maxComboVEl = document.getElementById('maxComboV');
  const grazeBarEl = document.getElementById('grazeBar');
  const grazeFillEl = document.getElementById('grazeFill');
  // T3-1 · HUD 增益指示（仿 comboWrap：wrap 切 hidden，值写 <b>）
  const buffWrapEl = document.getElementById('buffWrap');
  const buffEl = document.getElementById('buff');
  // 2c-1 · 技能 HUD 元素引用（独立 #skillWrap，D9）。取用处一律 if(el) 守卫。
  const skillWrapEl = document.getElementById('skillWrap');
  const skillFillEl = document.getElementById('skillFill');
  const skillLabelEl = document.getElementById('skillLabel');

  // ---- 状态机 ----
  const STATE = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover', PAUSED: 'paused', VICTORY: 'victory' };
  const game = {
    state: STATE.MENU,
    score: 0, lives: 3, bombs: 1,
    bullets: [], enemies: [], ebullets: [], particles: [], items: [],
    lastShot: 0, shootInterval: 140,
    flash: 0, runFrames: 0, diff: null,
    wave: 0, waveRemaining: 0, betweenWaves: true, nextWaveAt: 0,
    stage: 1, stageWave: 1,
    waveBannerUntil: 0, stageBannerUntil: 0, spawnTimer: 0, spawnInterval: 700,
    power: 1,
    combo: 0, comboUntil: 0, maxCombo: 0,
    // 擦弹：graze 累计次数（仅供 HUD/统计）、grazeMeter 槽 [0,1]、grazeBoostUntil 加成到期时刻(逻辑时钟 ms)
    graze: 0, grazeMeter: 0, grazeBoostUntil: 0,
    /* T3-3/T3-8 擦弹统计。⚠ 致命陷阱：game.graze 是「每增压周期计数器」，满槽
     * 时会被清零（见下方擦弹段），它不是整局总量。所以另立两个字段：
     *   maxGraze   —— 单周期峰值（"你最秀的一波贴了多少"），入排行榜维度；
     *   grazeTotal —— 整局累加，每次擦弹 +1，入战果面板。
     * 两者都在 startGame 复位，任何一处漏了都会把上一局的数带进新局。 */
    maxGraze: 0, grazeTotal: 0,
    // 散射枪（G 道具）到期时刻，逻辑时钟 ms；0 = 未激活
    spreadUntil: 0,
    /* 2c-1 · 技能框架（只搭骨架，六款效果在 2c-2 接入）。
     * skillCharge 充能槽 ∈ [0,1]（封顶 1.0，禁止囤积）；skillCdUntil 释放后防连点锁(逻辑时钟 ms)；
     * skillAuto 自动释放开关（读 settings 持久化，不随 startGame 清零）；
     * skillQueued 输入→step 的待消费标志（S16：输入只置标志，step 内结算逻辑）。
     * 老存档无这些字段也能照常玩：全部安全默认(charge=0 不释放)。 */
    skillCharge: 0, skillCdUntil: 0, skillAuto: false, skillQueued: false,
    // 2c-2 · 技能效果定时器（时间戳口径，逻辑时钟 ms；0 = 未激活）。全部 startGame 复位。
    overdriveUntil: 0,   // cyan_knight 超载齐射：shoot 间隔 ×0.6 窗口
    dashUntil: 0,        // crimson_falcon 灼焰突刺：穿透射流 + 无敌窗口
    cloakUntil: 0,       // stealth 幽影潜行：潜行(豁免伤害 + 擦弹翻倍)窗口
    // golden 圣裁连爆：5 波延迟环爆的定长波次表（常驻，startGame 只重置字段不 new）
    skillWaves: [
      { atX: 0, atY: 0, fireAt: 0, used: false },
      { atX: 0, atY: 0, fireAt: 0, used: false },
      { atX: 0, atY: 0, fireAt: 0, used: false },
      { atX: 0, atY: 0, fireAt: 0, used: false },
      { atX: 0, atY: 0, fireAt: 0, used: false },
    ],
    /* P2b · 当前皮肤的武器 profile（SKIN_WEAPONS 里的**常量对象引用**，不是副本）。
     * 由 startGame() 从皮肤 id 确定性推导 —— **不新增任何存档字段**，
     * 存档里仍然只有 djfe_skins.selected 一个 id。
     * null == 未开局 ⇒ shoot() 兜底 cyan_knight（旧存档 / 自定义皮肤同此路径）。 */
    weapon: null,
    boss: null, isBossWave: false,
    /* T3-3 战果数据：bossBreakTimes 每项 {kind, name, ms}，Boss 被击破时推入；
     * bossFightStart 是本场 Boss 的入场逻辑时刻，spawnT 缺失时的兜底基准。
     * 数组实例常驻复用（startGame 只 length=0，不 new []），与池化风格一致。 */
    bossBreakTimes: [], bossFightStart: 0,
    shake: 0, rings: [], muzzle: 0, hitStop: 0,
  };
  let bossPattern = 0;
  // px/py = 上一逻辑步的位置（渲染外插用）；sx/sy = 渲染期间的原值暂存
  const player = { x: W / 2, y: H * 0.8, w: 42, h: 50, invulnUntil: 0, shieldUntil: 0, px: W / 2, py: H * 0.8, sx: 0, sy: 0 };

  /* ===================================================================
   * D8 · 固定时间步长（Fixed Timestep）
   * 详见 docs/architecture/adr-fixed-timestep.md
   * -------------------------------------------------------------------
   * 红线是「行为零变化」，所以这里不去改任何一条数值公式，而是把
   * 「逻辑时钟」定义成 T_ORIGIN + tick*1000/60 —— 也就是「一台永远不掉帧的
   * 60fps 机器上的 performance.now()」。于是喂给 update 的 now/dt 与改动前
   * 逐位相同，shootInterval / fireT / invulnUntil 等全部原样保留。
   * =================================================================== */
  const HZ = 60;                        // 逻辑频率：全部数值平衡都是按 60fps 每帧调出来的
  const STEP = 1000 / HZ;               // 单步逻辑时长(ms)
  const MAX_CATCHUP = 5;                // 单帧最多补算 5 步(≈83ms)，多出来的时间直接丢弃，杜绝死亡螺旋
  const ACC_EPS = 1e-6;                 // 累加器容差(1ns)：吸收 rAF 时间戳的浮点噪声，避免整步被误判为「差一点点」
  const T_ORIGIN = performance.now();   // 逻辑时钟原点（与改动前 last 的初值同源）
  function stepTime(k) { return T_ORIGIN + (k * 1000) / HZ; }
  function logicNow() { return stepTime(game.runFrames); }

  /* ===================================================================
   * D4 · 对象池
   * -------------------------------------------------------------------
   * 目标：热循环零分配。两件事同时做：
   *   1) 实体对象预分配复用，取代 push({...}) 的每帧新建；
   *   2) 用「原地稳定压缩」取代 arr = arr.filter(...)，既不新建数组，
   *      又严格保持原有顺序（顺序会影响碰撞判定次序，必须一致）。
   * 池被取空时不丢内容、改为临时新建并计入 grown —— 宁可多分配也不改变行为，
   * grown>0 会在 poolStats() / 性能 HUD 上报警，提示容量该调大了。
   * =================================================================== */
  function Pool(name, cap, make) {
    this.name = name; this.make = make; this.cap = cap;
    this.free = new Array(cap);
    this.top = cap;
    this.used = 0; this.peak = 0; this.grown = 0; this.gets = 0;
    for (let i = 0; i < cap; i++) this.free[i] = make();
  }
  Pool.prototype.get = function () {
    let o;
    this.gets++;   // 取用总次数 == 改动前需要新建对象字面量的次数
    if (this.top > 0) o = this.free[--this.top];
    else { o = this.make(); this.grown++; this.cap++; }
    this.used++;
    if (this.used > this.peak) this.peak = this.used;
    return o;
  };
  Pool.prototype.put = function (o) {
    this.used--;
    if (this.top < this.free.length) this.free[this.top++] = o;
    else this.free.push(o);
  };

  // 原地稳定压缩：保留 keep() 为真的元素（顺序不变），其余归还池。不产生新数组。
  function sweep(list, pool, keep) {
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (keep(o)) { if (w !== i) list[w] = o; w++; }
      else pool.put(o);
    }
    if (w !== list.length) list.length = w;
  }
  function clearList(list, pool) {
    for (let i = 0; i < list.length; i++) pool.put(list[i]);
    list.length = 0;
  }

  // 容量：按 docs/commercialization-refactor-plan.md §3.3(2) 的峰值估算取 2 倍冗余。
  // 粒子例外——Boss 阵亡瞬间 60 次 explode ≈ 1140 颗，故单独放大。
  /* 玩家弹（P2a · BULLET_KINDS 形态库，design/gdd/variety-v2.md §2.8）
   * 基础 9 字段之外新增 10 个形态字段，**全部安全默认**——默认值组合起来
   * 精确等价于改动前的「匀速直线 · 1 伤 · 命中即销毁」，因此不改任何调用方时
   * 冒烟必须逐位一致（GDD §6.4 安全阀 #1）。
   *   kind   形态标识，'' / 'dot' 等价（保证旧调用路径行为逐位不变）
   *   dmg    单发伤害，1 == 现状（读取处一律 `dmg > 0 ? dmg : 1` 护栏）
   *   pierce 本发可命中的目标总数上限，0 == 命中即销毁 == 现状（laser pierce=2 ⇒ 穿 2 架后熄）
   *   hits   已命中计数（内部），`hits >= pierce` 即销毁
   *   hitCd  命中冷却步数，防「同一颗穿透弹跨步重复命中同一敌」（§2.2 陷阱）
   *   av     每步角速度(rad)，0 == 直线 —— 与敌弹 av 语义完全一致
   *   ttl    寿命步数，0 == 不限（由出界回收）
   *   blastR 环爆半径，0 == 无环爆
   *   turn   每步最大转向角(rad)，0 == 无制导
   *   target 本步选中的制导目标下标（只读诊断用，每步重算，绝不跨步缓存对象引用）
   *   blast  一次性环爆latch（内部）：ttl 到点由推进相位置 1、判定相位消费并清 0 */
  function mkBullet()   {
    return {
      x: 0, y: 0, vx: undefined, vy: 0, r: 0, px: 0, py: 0, sx: 0, sy: 0,
      kind: '', dmg: 1, pierce: 0, hits: 0, hitCd: 0,
      av: 0, ttl: 0, blastR: 0, turn: 0, target: -1, blast: 0, hue: 0,
    };
  }
  // 敌弹扩展字段（Boss 扩容期）：ax/ay 每步加速度、av 每步角速度(rad)、hold 延迟启动步数、
  // ttl 寿命步数、split 分裂倒计时步数、splitN 分裂片数、gz 擦弹已计数标记。
  // P2a 追加：blastR 环爆半径 / blast 环爆 latch / pierce 穿透（敌侧对单一玩家目标恒无效，
  // 留字段只为「玩家弹与敌弹共享同一套形态库」的对称性，见 GDD §2.0）。
  // 全部默认 0 —— 旧调用路径(addEbullet)行为与改动前逐位一致。
  function mkEbullet()  {
    return {
      x: 0, y: 0, vx: 0, vy: 0, r: 0, dead: false, kind: undefined, px: 0, py: 0, sx: 0, sy: 0,
      ax: 0, ay: 0, av: 0, hold: 0, ttl: 0, split: 0, splitN: 0, gz: 0,
      blastR: 0, blast: 0, pierce: 0,
    };
  }
  function mkParticle() { return { x: 0, y: 0, vx: 0, vy: 0, life: 0, hue: 0, px: 0, py: 0, sx: 0, sy: 0, kind: '', baseSz: 0, ar: 0 }; }
  function mkItem()     { return { x: 0, y: 0, vy: 0, type: '', hue: 0, r: 0, dead: false, px: 0, py: 0, sx: 0, sy: 0 }; }
  function mkRing()     { return { x: 0, y: 0, r: 0, maxR: 0, life: 0, hue: 0, pr: 0, sr: 0 }; }
  function mkEnemy() {
    return {
      type: '', x: 0, baseX: 0, y: 0, w: 0, h: 0, vy: 0, hp: 0, hue: 0, score: 0,
      phase: 0, fireT: 0, lockT: 0, diving: false, dvx: 0, dvy: 0, hover: false, flash: 0,
      px: 0, py: 0, sx: 0, sy: 0,
      // 扩容期：minion=Boss 召唤物（计入召唤上限）；spin=自转角，陨石与炮塔用
      minion: 0, spin: 0,
    };
  }
  /* Boss 扩容期容量重定：6 关 6 款 Boss + 召唤小机 + 陨石 + 僚机，弹幕与粒子峰值
   * 都会数倍于原 4 关版本。S18 卡死「grown === 0」，S11 卡死峰值上限，
   * 两道门夹住 —— cap 必须 ≥ 实测峰值，又不能大到把内存吃穿。 */
  const POOL = {
    bullets:   new Pool('bullets',   512,  mkBullet),
    ebullets:  new Pool('ebullets',  1600, mkEbullet),
    particles: new Pool('particles', 7000, mkParticle),
    enemies:   new Pool('enemies',   256,  mkEnemy),
    items:     new Pool('items',     128,  mkItem),
    rings:     new Pool('rings',     96,   mkRing),
  };

  // 存活判定（提到模块级：避免主循环每帧新建闭包）
  /* 下边界 y < H+20 是给散射枪的「后方 1 发」（vy 为正）兜底的：常规玩家子弹
   * 一律向上飞，只靠 y > -20 就能回收；一旦出现向下飞的弹，缺了下边界它会一路
   * 飞到 y=+∞ 却永远判活，把 bullets 池（cap 512）慢慢灌满 ⇒ S18 零扩容门失守。
   * 对现有向上子弹恒真，零行为变化。 */
  const keepBulletInPlay = (b) => b.y > -20 && b.y < H + 20 && b.x > -20 && b.x < W + 20;
  const keepBulletAlive  = (b) => b.y > -20;
  const keepEnemyInPlay  = (en) => en.y <= H + 40 && en.x > -60 && en.x < W + 60;
  const keepEnemyAlive   = (en) => en.hp > 0;
  const keepEbullet      = (eb) => !eb.dead && eb.y < H + 20 && eb.x > -20 && eb.x < W + 20;
  const keepItem         = (it) => !it.dead && it.y < H + 30;
  const keepParticle     = (p) => p.life > 0;
  const keepRing         = (rg) => rg.life > 0;

  // 取用助手：字段一律显式赋满，杜绝上一轮的残留值。
  // 注意 vx/kind 允许传 undefined —— 改动前的对象字面量本就没有这两个字段，
  // 保持 undefined 才能做到「逐字段逐位一致」的行为比对。
  /* 玩家弹发射口。P2a 起支持形态参数：
   *   kind = BULLET_KINDS 里的形态名（缺省 '' 等价 'dot'）
   *   opt  = { dmg, pierce, av, ttl, blastR, turn }，缺省即安全默认
   * 形态字段一律「无条件重置」——纪律照抄 addEbulletEx：池对象是复用的，
   * 漏掉任何一个都会让新弹继承上一颗弹的残留行为（最难查的一类 bug）。
   * ⚠ 真实签名第 4 参是半径、第 5 参才是横向速度，别把 vx 塞进第 4 位。 */
  function addBullet(x, y, vy, r, vx, kind, opt) {
    const b = POOL.bullets.get();
    b.x = x; b.y = y; b.vy = vy; b.r = r; b.vx = vx;
    b.px = x; b.py = y;
    b.kind = kind || '';
    b.dmg = (opt && opt.dmg > 0) ? opt.dmg : 1;
    b.pierce = (opt && opt.pierce) || 0;
    b.hits = 0;
    b.hitCd = 0;
    b.av = (opt && opt.av) || 0;
    b.ttl = (opt && opt.ttl) || 0;
    b.blastR = (opt && opt.blastR) || 0;
    b.turn = (opt && opt.turn) || 0;
    b.target = -1;
    b.blast = 0;
    // 发射即把武器/皮肤身份色写入子弹，命中冲击与（顺带的）死亡爆炸都读 b.hue（hit-feedback §4）
    b.hue = (opt && Number.isFinite(opt.hue)) ? opt.hue : ((weaponOf(DJFE.skins.currentId()) || {}).hue || 0);
    game.bullets.push(b);
  }
  function addEbullet(x, y, vx, vy, r, kind) {
    addEbulletEx(x, y, vx, vy, r, kind, null);
  }
  /* 扩展版发射口。opt 里的字段全部「无条件重置」——池对象是复用的，
   * 漏掉任何一个都会让新弹继承上一颗弹的残留行为（最难查的一类 bug）。
   * opt = { ax, ay, av, hold, ttl, split, splitN, blastR, pierce }，缺省即 0。 */
  function addEbulletEx(x, y, vx, vy, r, kind, opt) {
    const e = POOL.ebullets.get();
    e.x = x; e.y = y; e.vx = vx; e.vy = vy; e.r = r; e.dead = false; e.kind = kind;
    e.px = x; e.py = y;
    e.ax = (opt && opt.ax) || 0;
    e.ay = (opt && opt.ay) || 0;
    e.av = (opt && opt.av) || 0;
    e.hold = (opt && opt.hold) || 0;
    e.ttl = (opt && opt.ttl) || 0;
    e.split = (opt && opt.split) || 0;
    e.splitN = (opt && opt.splitN) || 0;
    e.gz = 0;
    e.blastR = (opt && opt.blastR) || 0;
    e.pierce = (opt && opt.pierce) || 0;
    e.blast = 0;
    game.ebullets.push(e);
  }
  /* 二段分裂：母弹到点自毁，沿原飞行方向张开一把小扇。
   * 速度为 0 的母弹 atan2/hypot 都会退化，这里全部兜底成「朝下」，杜绝 NaN。 */
  function splitEbullet(eb) {
    eb.dead = true;
    const n = eb.splitN > 1 ? eb.splitN : 3;
    const sp0 = Math.sqrt(eb.vx * eb.vx + eb.vy * eb.vy);
    const sp = sp0 > 1e-4 ? sp0 : 2.6;
    const base = sp0 > 1e-4 ? Math.atan2(eb.vy, eb.vx) : Math.PI / 2;
    const spread = 0.86;
    const stepA = n > 1 ? spread / (n - 1) : 0;
    const r2 = Math.max(3, eb.r * 0.7);
    for (let k = 0; k < n; k++) {
      const a = base - spread / 2 + stepA * k;
      addEbulletEx(eb.x, eb.y, Math.cos(a) * sp, Math.sin(a) * sp, r2, eb.kind, null);
    }
  }
  function addParticle(x, y, vx, vy, life, hue, kind, baseSz, ar) {
    const p = POOL.particles.get();
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.hue = hue;
    p.kind = kind || ''; p.baseSz = baseSz || 0; p.ar = ar || 0;
    p.px = x; p.py = y;
    game.particles.push(p);
  }

  // ---- 配色工具（背景渐变/星云用） ----
  function hexToRgb(h) {
    h = (h || '#000000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexA(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
  function shade(h, amt) {
    const [r, g, b] = hexToRgb(h);
    const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  // ---- 视差星空 + 尘埃微粒 ----
  let stars = [];
  let moteCount = 0;
  // 无理数取小数部分：把「下标」散列成均匀分布的伪随机数。
  // 用它而不是 Math.random() 生成尘埃，是因为渲染层一旦消耗 RNG，
  // 就会整体平移种子化冒烟测试里所有实体的轨迹（seed=20250728 依赖调用次序）。
  const frac = (x) => x - Math.floor(x);
  function buildStars() {
    stars = [];
    const n = Math.max(60, Math.min(260, Math.round((W * H) / 7000)));
    for (let i = 0; i < n; i++) {
      const z = Math.random();
      stars.push({ x: Math.random() * W, y: Math.random() * H, z, r: 0.6 + z * 1.9, sp: 0.3 + z * 1.9 });
    }
    // 尘埃数量随画布面积伸缩；纯几何推导，不动 RNG
    moteCount = Math.max(28, Math.min(90, Math.round((W * H) / 24000)));
  }
  buildStars();
  window.addEventListener('resize', buildStars);

  function drawBackground(now) {
    const stg = STAGES[game.stage - 1] || STAGES[0];
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, stg.bg);
    bg.addColorStop(1, shade(stg.bg, -0.35));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // ---- AI 星云底图（bg_nebula.png）-------------------------------------
    // 方向 B 升级：用预生成的深邃星云贴图作基底，纵深感强于纯程序化渐变；
    // 以 cover 方式铺满并缓慢纵向滚动。逐关 accent 色调仍由上方程序化星云层叠加。
    const bgImg = DJFE.sprites.get('bg_nebula');
    if (bgImg && DJFE.sprites.isReady()) {
      const bdim = DJFE.sprites.dim('bg_nebula') || { w: 832, h: 1216 };
      const baspect = bdim.w / bdim.h;
      let bw = W, bh = W / baspect;
      if (bh < H + 60) { bh = H + 60; bw = bh * baspect; }
      const scroll = (now / 26000) % 1;
      const by = -((bh - H) * scroll);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(bgImg, (W - bw) / 2, by, bw, bh);
      ctx.globalAlpha = 1;
    }
    // ---- 层叠星云（方向 B 的「空气感」主来源）------------------------------
    // 从 3 层提到 5 层，冷暖双色调交替；每层漂移速度/半径/相位都不同 ——
    // 层与层之间的相对运动才产生纵深，单层再厚也只是一张平贴的糊纸。
    const a2 = stg.accent2 || stg.accent;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const warm = (i % 2) === 1;
      const tint = warm ? a2 : stg.accent;
      const depth = 0.35 + i * 0.16;                 // 越大 = 越近 = 漂得越快
      const nx = W * (0.16 + 0.19 * i) + Math.sin(now / (12000 - i * 1500) + i * 1.7) * (50 + 34 * depth);
      const ny = H * (0.20 + 0.16 * i) + Math.cos(now / (14000 - i * 1600) + i * 2.3) * (40 + 28 * depth);
      const rad = Math.max(W, H) * (0.30 + 0.13 * i);
      const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, rad);
      ng.addColorStop(0.00, hexA(tint, warm ? 0.075 : 0.065));
      ng.addColorStop(0.45, hexA(tint, warm ? 0.030 : 0.026));
      ng.addColorStop(1.00, hexA(tint, 0));
      ctx.fillStyle = ng;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    // 远景天体（每关 accent 色，藏于右上角作远景氛围，不抢菜单、不像可点按钮）
    const planetR = Math.min(W, H) * 0.20;
    const pxc = W + planetR * 0.35 + Math.sin(now / 16000) * 14;
    const pyc = -planetR * 0.25 + Math.cos(now / 19000) * 12;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pg = ctx.createRadialGradient(pxc, pyc, planetR * 0.2, pxc, pyc, planetR);
    pg.addColorStop(0, hexA(stg.accent, 0.10));
    pg.addColorStop(0.7, hexA(stg.accent, 0.03));
    pg.addColorStop(1, hexA(stg.accent, 0));
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(pxc, pyc, planetR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const bg2 = ctx.createRadialGradient(pxc - planetR * 0.3, pyc - planetR * 0.3, planetR * 0.1, pxc, pyc, planetR * 0.6);
    bg2.addColorStop(0, shade(stg.accent, -0.55));
    bg2.addColorStop(0.85, shade(stg.accent, -0.85));
    bg2.addColorStop(1, shade(stg.accent, -0.97));
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(pxc, pyc, planetR * 0.6, 0, Math.PI * 2); ctx.fill();
    // 底部地平线辉光
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createLinearGradient(0, H, 0, H * 0.68);
    hg.addColorStop(0, hexA(stg.accent, 0.13));
    hg.addColorStop(1, hexA(stg.accent, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(0, H * 0.68, W, H * 0.32);
    ctx.restore();
    // 视差星点：位移改为按「逻辑步」推进（与刷新率解耦），绘制仍每帧一次。
    // 60Hz 下 starSteps 恒为 1，推进时机与 Math.random 调用次序与改动前完全一致。
    //
    // ⚠ 位移必须和绘制留在同一趟遍历里。最初实现把「推进」拆成独立的一趟循环，
    //   结果 V8 无法再把 s.y 保持在未装箱的浮点寄存器里，每次读写都要新建
    //   HeapNumber —— 实测 180s 长局凭空多出约 45MB 垃圾，把对象池省下的量整个吃掉。
    //   因此这里只把「补步」（starSteps>1，掉帧追帧时才发生）走独立循环，
    //   最后一步与绘制融合。Math.random 的调用次序不受影响：无论哪条分支，
    //   都是「每一步按 stars 顺序遍历一遍」。
    while (starSteps > 1) {
      for (const s of stars) {
        s.y += s.sp;
        if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
      }
      starSteps--;
    }
    const stepStars = starSteps > 0;
    starSteps = 0;
    for (const s of stars) {
      if (stepStars) {
        s.y += s.sp;
        if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
      }
      // 方向 B：星点不再用纯白刺点，改暖白 / accent / 暗尘灰三档，整体压低亮度
      ctx.globalAlpha = 0.26 + s.z * 0.48;
      ctx.fillStyle = s.z > 0.66 ? '#f2ece4' : (s.z > 0.33 ? stg.accent : '#8d96a8');
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // ---- 尘埃微粒（近景层）------------------------------------------------
    // 位置由下标经无理数散列推导 + 时间驱动漂移，全程零 Math.random()：
    // 渲染层绝不能消耗 RNG，否则种子化冒烟测试的实体轨迹会整体偏移。
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < moteCount; i++) {
      const fx0 = frac(i * 0.7548776662);   // 横向分布
      const fz = frac(i * 0.5698402909);    // 深度（决定速度/大小/亮度）
      const sp = 8 + fz * 26;               // px/s：越近漂得越快
      const mx = fx0 * W + Math.sin(now / 3400 + i) * (3 + fz * 7);
      const my = ((fz * H + now * sp / 1000) % (H + 40)) - 20;
      ctx.globalAlpha = 0.05 + fz * 0.13;
      ctx.fillStyle = (i % 3 === 0) ? a2 : stg.accent;
      ctx.beginPath(); ctx.arc(mx, my, 0.7 + fz * 1.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---- 柔光边缘（rim light）---------------------------------------------
    // 左上斜射的一层极薄的光，给整个画面一个统一的方向性光源。
    // 这是「画意」的关键：有方向的光才有体积感，均匀照明只会显得平。
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rl = ctx.createLinearGradient(0, 0, W * 0.55, H * 0.42);
    rl.addColorStop(0.00, hexA(stg.accent, 0.085));
    rl.addColorStop(0.55, hexA(stg.accent, 0.018));
    rl.addColorStop(1.00, hexA(stg.accent, 0));
    ctx.fillStyle = rl;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function hide(id) { document.getElementById(id).classList.add('hidden'); }
  function setState(s) {
    const _prev = game.state;
    game.state = s;
    // BUG-02 修复：暂停时限时增益不被暂停吞噬。
    // 暂停期间 step() 内部早退、但 runFrames/logicNow 仍随墙钟前移，恢复瞬间会把
    // shield/cloak/dash/overdrive/invuln/skillCd 这类「剩余时长」型增益误判过期。
    // 故在 PAUSED→PLAYING 跃迁时按暂停时长顺延它们，等价于「暂停冻结了增益」。
    // 之所以放在 setState 而非 loop：所有暂停/恢复都经此唯一入口；
    // 且 S6 探针在恢复按键后立即读取、不触发下一帧 pump，必须在状态跃迁时同步完成。
    // 注意：此处不改动 logicNow/runFrames/nextWaveAt，故波次/刷怪调度（S10）不受影响。
    if (s === STATE.PAUSED) {
      _pauseLogicAt = logicNow();
    } else if (_prev === STATE.PAUSED && s === STATE.PLAYING) {
      const pausedDur = logicNow() - _pauseLogicAt;
      if (pausedDur > 0) {
        const p = player;
        if (_pauseLogicAt < p.shieldUntil) p.shieldUntil += pausedDur;
        // M-08 修复：cloak/dash/overdrive/skillCd 实际住在 game 对象（运行期全用 game.*Until），
        // 旧代码读写的是 player 上的死字段（恒 0），补偿分支永不触发、暂停照样吞掉技能类增益。
        // 故条件与赋值都指向 game。shield/invuln 确在 player 上，保持不动。
        if (_pauseLogicAt < game.cloakUntil) game.cloakUntil += pausedDur;
        if (_pauseLogicAt < game.dashUntil) game.dashUntil += pausedDur;
        if (_pauseLogicAt < game.overdriveUntil) game.overdriveUntil += pausedDur;
        if (_pauseLogicAt < p.invulnUntil) p.invulnUntil += pausedDur;
        if (_pauseLogicAt < game.skillCdUntil) game.skillCdUntil += pausedDur;
      }
    }
    // 触屏控制层只在 PLAYING 状态显示（CSS 还需 pointer:coarse 匹配）
    if (touchUIEl) touchUIEl.classList.toggle('ingame', s === STATE.PLAYING);
    if (s === STATE.MENU) {
      refreshBestUI(); refreshLeaderboard();
      audio.music.setIntensity('menu');
      show('menu'); hide('gameover'); hide('pause'); hide('hud'); hide('panel'); hide('hint'); hide('victory');
    } else if (s === STATE.PLAYING) {
      hide('menu'); hide('gameover'); hide('pause'); hide('victory'); show('hud'); show('panel'); show('hint');
    } else if (s === STATE.GAMEOVER) {
      finalScoreEl.textContent = game.score;
      if (maxComboGOEl) maxComboGOEl.textContent = game.maxCombo;
      const raw = game.score;
      game.score = DJFE.commitBest(game.score);
      // T3-8：graze 维度取 maxGraze（单周期峰值），不是 game.graze（周期归零值）
      DJFE.addLeaderboard({ score: raw, stage: game.stage, date: new Date().toISOString().slice(0, 10), graze: game.maxGraze | 0 });
      refreshBestUI(); refreshLeaderboard();
      audio.gameOver();
      audio.music.setIntensity('menu');
      show('gameover'); hide('pause'); hide('hud'); hide('panel'); hide('hint');
    } else if (s === STATE.VICTORY) {
      victory();
    } else if (s === STATE.PAUSED) {
      show('pause');
    }
  }
  function refreshBestUI() {
    const b = DJFE.getBest();
    if (bestMenuEl) bestMenuEl.textContent = b;
    if (bestGOEl) bestGOEl.textContent = b;
  }
  function refreshLeaderboard() {
    const lb = DJFE.getLeaderboard();
    ['menuLB', 'goLB'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!lb.length) { el.innerHTML = '<div class="lbempty" data-i18n="lb.empty">暂无记录</div>'; return; }
      /* T3-8 擦弹列。旧存档没有 graze 字段，这里 ||0 兜底 —— core.js 的
       * getLeaderboard 已经做过一次归一，这里是第二道闸：DOM 永远不吃 undefined。 */
      el.innerHTML = lb.slice(0, 5).map((e, i) =>
        `<div class="lbrow"><span class="lbrank">${i + 1}</span>` +
        `<span class="lbscore">${e.score}</span>` +
        `<span class="lbgraze">G ${(e.graze || 0)}</span>` +
        `<span class="lbstage">${e.stage ? (DJFE.t('result.stagePrefix') + ' ' + e.stage + DJFE.t('result.stageSuffix')) : ''}</span></div>`
      ).join('');
    });
  }

  // ---- 难度 ----
  const DIFFS = {
    easy:   { spawnBase: 900, speedMul: 0.8, hp: 1, bombs: 2 },
    normal: { spawnBase: 700, speedMul: 1.0, hp: 2, bombs: 1 },
    hard:   { spawnBase: 500, speedMul: 1.3, hp: 3, bombs: 1 },
  };

  // ---- 关卡战役 ----
  const STAGE_WAVES = 3; // 每关波数（最后一波为 Boss）
  const STAGES = [
    // 方向 B · 柔调画意科幻：底色由「纯黑霓虹」改为带色温的暗调（暖灰/褐紫/墨青/酒紫），
    // accent 一律降饱和，作为大气散射色而非霓虹描边色 —— 空气感来自层叠星云而非高饱和线条。
    // accent2 = 星云第二色调（冷暖对位）。层叠星云交替使用 accent / accent2，
    // 两个色温在低透明度下互相渗透，才有「画意」的空气感，而不是单色糊一片。
    { nameKey: 'stage.1.name', bg: '#0d1117', accent: '#7fb0bd', accent2: '#c98f6b', bossKey: 'boss.sentinel.name', bossHue: 198, bossHp: 290, bossKind: 'sentinel' },
    { nameKey: 'stage.2.name', bg: '#151016', accent: '#c99a6b', accent2: '#8a6f9c', bossKey: 'boss.scorpion.name', bossHue: 32,  bossHp: 430, bossKind: 'scorpion' },
    { nameKey: 'stage.3.name', bg: '#0e1418', accent: '#8fb89c', accent2: '#b58fa8', bossKey: 'boss.carrier.name', bossHue: 150, bossHp: 580, bossKind: 'carrier' },
    { nameKey: 'stage.4.name', bg: '#17101a', accent: '#b98aa0', accent2: '#7f93b5', bossKey: 'boss.core.name', bossHue: 338, bossHp: 460, bossKind: 'core' },
    { nameKey: 'stage.5.name', bg: '#12101d', accent: '#9d8fc4', accent2: '#c78fa6', bossKey: 'boss.phaser.name', bossHue: 288, bossHp: 500, bossKind: 'phaser' },
    { nameKey: 'stage.6.name', bg: '#0b0a14', accent: '#8f92c9', accent2: '#6fa6b8', bossKey: 'boss.void.name', bossHue: 262, bossHp: 640, bossKind: 'void' },
    /* S7 EX·织网（t3-gameplay-breadth §7.7 方案 A）：终末虚空崩解后的「余波 Boss」。
     * 追加而不是替换 —— beginWave / spawnBoss / victory 全走既有路径，
     * STAGES.length 变 7 后 __debug.stageCount 与通关门 (stage >= STAGES.length)
     * 自动跟随，冒烟 S15 的 finalWave 从 stageCount 派生，无需改测试。 */
    { nameKey: 'stage.7.name', bg: '#100b19', accent: '#b18fd6', accent2: '#8fc2b4', bossKey: 'boss.weaverqueen.name', bossHue: 283, bossHp: 1500, bossKind: 'weaverqueen' },
  ];

  let selectedDiff = 'normal';

  function startGame() {
    const d = DIFFS[selectedDiff];
    const now = logicNow();   // 用逻辑时钟，与主循环里的 now 同源
    game.score = 0; game.lives = 3; game.bombs = d.bombs; game.power = 1;
    game.combo = 0; game.comboUntil = 0; game.maxCombo = 0;
    game.graze = 0; game.grazeMeter = 0; game.grazeBoostUntil = 0;
    // T3-3/T3-8：擦弹统计与战果清单必须与 graze 一起复位，否则跨局串数
    game.maxGraze = 0; game.grazeTotal = 0;
    game.bossBreakTimes.length = 0; game.bossFightStart = 0;
    game.spreadUntil = 0;
    // 2c-1 · 技能状态复位（skillAuto 读 settings 持久化，不在此清零）
    game.skillCharge = 0; game.skillCdUntil = 0; game.skillQueued = false;
    game.skillAuto = !!(DJFE.settings && DJFE.settings.skillAuto);
    // 2c-2 · 技能效果定时器复位（安全默认 0；skillWaves 只重置字段不 new，避免跨局串数）
    game.overdriveUntil = 0; game.dashUntil = 0; game.cloakUntil = 0;
    for (let i = 0; i < game.skillWaves.length; i++) {
      const w = game.skillWaves[i]; w.atX = 0; w.atY = 0; w.fireAt = 0; w.used = false;
    }
    /* P2b · 武器配装：开局时从皮肤 id **确定性推导**一次，整局不变。
     * 刻意不在 shoot() 里每发查一次 DJFE.skins —— 逻辑步里读 UI 侧的可变状态
     * 会让「菜单里手滑点一下皮肤」变成局内数值突变，S16 的确定性也就没了底。
     * 也刻意不读 game.skin：那个字段是 draw() 每帧刷的**渲染态**，
     * 无头环境（不跑 draw）下恒为 undefined，逻辑层依赖它就是埋雷。 */
    game.weapon = weaponOf(DJFE.skins ? DJFE.skins.currentId() : '');
    audio.music.setIntensity('playing'); audio.music.setStage(1);
    // 全部归还池；数组实例本身复用，不再 new []
    clearList(game.bullets, POOL.bullets);
    clearList(game.enemies, POOL.enemies);
    clearList(game.ebullets, POOL.ebullets);
    clearList(game.particles, POOL.particles);
    clearList(game.items, POOL.items);
    game.diff = d; game.spawnBase = d.spawnBase; game.lastShot = 0; game.flash = 0;
    game.wave = 0; game.stage = 1; game.betweenWaves = true; game.nextWaveAt = now + 700; game.stageBannerUntil = 0;
    game.boss = null; game.isBossWave = false; bossPattern = 0;
    game.shake = 0; clearList(game.rings, POOL.rings); game.muzzle = 0; game.hitStop = 0;
    player.x = W / 2; player.y = H * 0.8; player.invulnUntil = 0; player.shieldUntil = 0;
    player.px = player.x; player.py = player.y;
    input.pointer.x = player.x; input.pointer.y = player.y;
    setState(STATE.PLAYING);
  }
  function gameOver() { setState(STATE.GAMEOVER); }

  /* T3-3 · 战果面板渲染。三块内容：Boss 击破耗时清单 / 本局擦弹 / 最高擦弹。
   * 全程 if(el) 守卫：DOM 缺一块只是这块不显示，不该把整个通关演出带崩（S17）。
   * 清单复用排行榜那套 .lbrow/.lbrank/.lbscore/.lbstage 类名 —— 零新增样式语汇。 */
  function renderResultPanel() {
    const list = document.getElementById('resultBossList');
    if (list) {
      const bt = game.bossBreakTimes;
      if (!bt || !bt.length) {
        // S15 那种「直接把 boss 置 null 通关」的路径会走到这：空清单也要有话说，不能留空白
        list.innerHTML = '<div class="lbempty" data-i18n="result.empty">本局未记录击破</div>';
      } else {
        list.innerHTML = bt.map((e, i) => {
          const sec = (Number.isFinite(e.ms) ? e.ms : 0) / 1000;
          return `<div class="lbrow"><span class="lbrank">${i + 1}</span>` +
                 `<span class="lbscore">${e.name || e.kind || '?'}</span>` +
                 `<span class="lbstage">${sec.toFixed(1)}s</span></div>`;
        }).join('');
      }
    }
    const gt = document.getElementById('resultGrazeTotal');
    if (gt) gt.textContent = Math.max(0, Math.round(game.grazeTotal || 0));
    const gm = document.getElementById('resultGrazeMax');
    if (gm) gm.textContent = Math.max(0, Math.round(game.maxGraze || 0));
  }

  function victory() {
    const raw = game.score;
    game.score = DJFE.commitBest(game.score);
    // T3-8：graze 取 maxGraze（峰值），与 GAMEOVER 分支同源
    DJFE.addLeaderboard({ score: raw, stage: game.stage, date: new Date().toISOString().slice(0, 10), win: true, graze: game.maxGraze | 0 });
    const fv = document.getElementById('finalScoreV'); if (fv) fv.textContent = raw; // M-07：结算显示本局分；上一步 commitBest 已把 game.score 覆盖成最高分
    const bv = document.getElementById('bestV'); if (bv) bv.textContent = DJFE.getBest();
    if (maxComboVEl) maxComboVEl.textContent = game.maxCombo;
    renderResultPanel();
    refreshBestUI(); refreshLeaderboard();
    audio.bomb();
    hide('menu'); hide('gameover'); hide('pause'); hide('hud'); hide('panel'); hide('hint');
    show('victory');
  }

  // ---- M4 波次调度 ----
  function beginWave(n, now) {
    game.wave = n;
    game.stage = Math.floor((n - 1) / STAGE_WAVES) + 1;
    game.stageWave = ((n - 1) % STAGE_WAVES) + 1;
    game.isBossWave = (game.stageWave === STAGE_WAVES);
    game.spawnInterval = Math.max(220, game.spawnBase - n * 18);
    game.shootInterval = Math.max(95, 150 - n * 3);
    if (game.stageWave === 1) game.stageBannerUntil = now + 2400;
    game.waveBannerUntil = now + 1600;
    if (game.isBossWave) {
      game.waveRemaining = 0;
      game.power = Math.min(5, game.power + 1);   // Tier 2（平衡）：Boss 波进场保证火力 +1，给到更厚的 Boss 战火力
      spawnBoss(n, now);
    } else {
      game.waveRemaining = 5 + Math.floor(n * 1.6);
      game.spawnTimer = now;
    }
  }

  /* 玩法开关。默认值 = 首发配置；改这里不需要动任何逻辑代码。
   * voidGravity：终末虚空 P3 的玩家牵引。代码路径完整保留，但默认关闭 ——
   *   见 void.move 里的长注释（SDT 自主感 > 压迫感）。控制台可 DJFE.config.voidGravity = true 试玩。 */
  const CONFIG = { voidGravity: false };
  DJFE.config = CONFIG;

  /* ===================================================================
   * BOSS_KINDS · Boss 种类注册表
   * -------------------------------------------------------------------
   * 取代原来那个全局 `bossPattern % 3`：每款 Boss 自带体型、移动、相位表与
   * 招式表，spawnBoss 只负责按 STAGES[i].bossKind 查表装配。
   * 增一款 Boss = 加一条表项，调度代码一行不动。
   *   w / h            体型（碰撞与绘制共用）
   *   move(b, dt, now) 入场落位后的逐步移动
   *   phases[]         按血量比阈值从高到低排列的相位表
   *                      at   进入该相位的 hp/maxHp 阈值
   *                      gap  该相位开火间隔(ms)，覆盖 b.fireGap
   *                      pats 招式函数数组，按 b.patIdx 轮转派发
   *   onPhase(b, i)    可选，相位切换瞬间的一次性副作用
   *   draw(b,now,pl)   可选，缺省走 entities.js 的通用 Boss 造型
   * =================================================================== */
  const BOSS_KINDS = {
    /* ---- S1 哨戒机甲 ------------------------------------------------
     * 教学关 Boss：动作大、弹速慢、留缝宽。
     * 招牌「双肩装甲」——满血期受伤减半，逼玩家先把血打过 66% 才见真章；
     * 装甲一崩（进 P1）伤害恢复，手感上是明显的"打穿了"。 */
    sentinel: {
      w: 140, h: 92,
      move(b, dt) {
        b.phase += dt * (0.0016 + b.pi * 0.0005);
        b.x = W / 2 + Math.sin(b.phase) * (W * 0.26);
      },
      onPhase(b, i) { b.dmgMul = (i === 0) ? 0.5 : 1; },   // 装甲期减伤 → 崩落后恢复
      phases: [
        { at: 1.00, gap: 900, pats: [
          (b, cx, cy) => fanShot(cx, cy, 7, Math.PI * 0.60, Math.PI / 2, 3.4, 6, 'fan', -1),
          (b, cx, cy) => aimShot(cx, cy, 3, 0, 4.0, 6, 'aim', b.seq),
          (b, cx, cy) => ringShot(cx, cy, 12, 2.8, hash01(b.seq) * TAU, 5, 'ring', 0, 0),
        ] },
        { at: 0.66, gap: 720, pats: [
          (b, cx, cy) => fanShot(cx, cy, 9, Math.PI * 0.72, Math.PI / 2, 3.6, 6, 'fan', 4),
          (b, cx, cy) => aimShot(cx, cy, 5, 0.10, 4.4, 5, 'aim', b.seq),
          (b, cx, cy) => wallShot(-12, 9, 3.2, 5, 'fan', 2 + (b.seq % 5)),
        ] },
        { at: 0.33, gap: 560, pats: [
          (b, cx, cy) => { fanShot(cx, cy, 11, Math.PI * 0.86, Math.PI / 2, 3.8, 6, 'fan', 5);
                           fanShot(cx, cy, 6, Math.PI * 0.70, Math.PI / 2, 2.6, 5, 'fan', -1); },
          (b, cx, cy) => aimShot(cx, cy, 5, 0.22, 5.0, 5, 'aim', b.seq),
          (b, cx, cy) => ringShot(cx, cy, 16, 3.0, hash01(b.seq) * TAU, 5, 'ring', b.seq % 16, 3),
        ] },
      ],
    },

    /* ---- S2 采矿巨蝎 ------------------------------------------------
     * 8 字巡游 + 招牌「尾刺穿刺」：先在屏幕上排出一条定格的预警刺（不伤人），
     * 900ms 后自根部向外依次点火，变成一条高速穿刺线。
     * 预警期长得刻意 —— 这一招要的是"看得见、躲得开、但必须现在就动"。 */
    scorpion: {
      w: 150, h: 96,
      move(b, dt) {
        b.phase += dt * 0.0013;
        b.x = W / 2 + Math.sin(b.phase) * (W * 0.28);
        // 8 字的纵向分量：始终 ≥ 0，否则 y 会掉回 ty 以下重新触发入场下落
        b.y = b.ty + 14 + Math.sin(b.phase * 2) * 14;
      },
      phases: [
        { at: 1.00, gap: 820, pats: [
          (b, cx, cy) => stingerShot(b, cx, cy, 12, 54),
          (b, cx, cy) => { fanShot(cx, cy, 5, Math.PI * 0.5, Math.PI / 2, 3.2, 6, 'fan', -1);
                           fanShot(cx, cy, 5, Math.PI * 0.5, -Math.PI / 2, 2.4, 5, 'fan', -1); },
          (b, cx, cy) => aimShot(cx, cy, 3, 0.08, 4.2, 6, 'aim', b.seq),
        ] },
        { at: 0.66, gap: 680, pats: [
          (b, cx, cy) => stingerShot(b, cx, cy, 14, 48),
          (b, cx, cy) => ringShot(cx, cy, 14, 3.0, hash01(b.seq) * TAU, 5, 'ring', 0, 0),
          (b, cx, cy) => curveShot(cx, cy, 8, Math.PI * 0.8, Math.PI / 2, 3.0, 0.016, 5, 'fan'),
        ] },
        { at: 0.33, gap: 520, pats: [
          (b, cx, cy) => { stingerShot(b, cx, cy, 14, 42); subFire(b, 'diver', 2); },
          (b, cx, cy) => ringShot(cx, cy, 18, 3.2, hash01(b.seq) * TAU, 5, 'ring', b.seq % 18, 3),
          (b, cx, cy) => aimShot(cx, cy, 5, 0.24, 4.8, 5, 'aim', b.seq),
          (b, cx, cy) => curveShot(cx, cy, 10, Math.PI * 0.9, Math.PI / 2, 3.2, 0.020, 5, 'fan'),
        ] },
      ],
    },

    /* ---- S3 雷云母舰 ------------------------------------------------
     * 不横扫、只悬停 —— 靠"弹幕覆盖面"而不是"本体走位"施压。
     * 招牌「舰载弹射」：抛出的不是弹而是弹母，飞到半途二段分裂成一把小扇，
     * 于是安全区会在弹飞行途中突然消失，逼玩家提前预判而不是贴着弹走。 */
    carrier: {
      w: 190, h: 76,
      move(b, dt) {
        b.phase += dt * 0.0009;
        b.x = W / 2 + Math.sin(b.phase) * (W * 0.14);
        b.y = b.ty + 10 + Math.sin(b.phase * 1.7) * 10;
      },
      phases: [
        { at: 1.00, gap: 900, pats: [
          (b, cx, cy) => splitVolley(cx, cy, 3, Math.PI * 0.34, 2.9, 30, 3),
          (b, cx, cy) => wallShot(-12, 8, 3.0, 5, 'fan', 1 + (b.seq % 6)),
          (b, cx, cy) => aimShot(cx, cy, 3, 0, 4.2, 6, 'aim', b.seq),
        ] },
        { at: 0.66, gap: 760, pats: [
          (b, cx, cy) => splitVolley(cx, cy, 5, Math.PI * 0.48, 3.0, 28, 3),
          (b, cx, cy) => subFire(b, 'shooter', 2),
          (b, cx, cy) => ringShot(cx, cy, 12, 2.9, hash01(b.seq) * TAU, 5, 'ring', 0, 0),
        ] },
        { at: 0.33, gap: 600, pats: [
          (b, cx, cy) => splitVolley(cx, cy, 6, Math.PI * 0.60, 3.1, 26, 3),
          (b, cx, cy) => { wallShot(-12, 10, 3.2, 5, 'fan', b.seq % 10);
                           wallShot(-40, 10, 3.2, 5, 'fan', (b.seq + 5) % 10); },
          (b, cx, cy) => subFire(b, 'shooter', 3),
          (b, cx, cy) => crossRainShot(6, 3.4, 5, 'aim', b.seq),
        ] },
      ],
    },

    /* ---- S4 歼灭核心 ------------------------------------------------
     * 唯一的等比 Boss，几乎站着不动 —— 它的威胁是「弹幕的几何」而不是走位。
     * 站定，玩家才有余裕读几何；它要是同时乱跑，旋转臂就从「可解的谜题」
     * 退化成「随机噪声」。招牌「旋转光束」是弹链模拟，不引入 beam 实体。 */
    core: {
      w: 132, h: 132,
      move(b, dt) {
        b.phase += dt * 0.0013;
        const amp = H * 0.03;
        b.x = W / 2 + Math.cos(b.phase) * (W * 0.10);
        b.y = b.ty + amp * 1.1 + Math.sin(b.phase) * amp;   // 恒 ≥ ty，不会重触发入场
        // 光束相位：全 Boss 唯一的角度权威。按 dt 累加 → 转速 = rad/ms，与刷新率无关
        b.beamPhase += (b.pi >= 2 ? -0.00050 : 0.00050) * dt;
        // 核心过载：血量跌破 15% 后进入，开火更密 + 每 2s 追加一轮散射。
        // 这是全作唯一「不完全可读」的弹幕，有意为之 —— 它只出现在濒死的最后十几秒，
        // 是收尾的混乱，不是主要考核，密度压在能靠站位概率通过的水平。
        if (!b.ovr && b.maxHp > 0 && b.hp / b.maxHp < 0.15) {
          b.ovr = 1;
          b.fireGap = Math.max(320, b.fireGap * 0.6);
          game.shake = Math.max(game.shake, 12);
        }
        if (b.ovr) {
          b.subT += dt;
          if (b.subT >= 2000) {
            b.subT = 0; b.seq++;
            for (let i = 0; i < 32; i++) {
              const a = TAU * hash01(b.seq * 17 + i * 3 + 1);
              const sp = 2.4 + hash01(b.seq * 5 + i * 7 + 2) * 1.2;
              addEbulletEx(b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp, 4.5, 'aim', { ttl: 240 });
            }
          }
        }
      },
      phases: [
        { at: 1.00, gap: 1000, pats: [
          (b, cx, cy) => ringShot(cx, cy, 24, 2.7, hash01(b.seq) * TAU, 5, 'ring', 0, 0),
          (b, cx, cy) => aimShot(cx, cy, 3, 0, 4.2, 6, 'aim', b.seq),
        ] },
        { at: 0.66, gap: 780, pats: [
          (b) => rotorBeam(b, 4, 14, 1.9, 16, 4, 240),
          (b, cx, cy) => ringShot(cx, cy, 24, 2.9, hash01(b.seq) * TAU, 5, 'ring', b.seq % 24, 3),
          (b, cx, cy) => aimShot(cx, cy, 5, 0.12, 4.6, 5, 'aim', b.seq),
        ] },
        { at: 0.33, gap: 620, pats: [
          (b) => rotorBeam(b, 6, 13, 2.0, 16, 4, 220),
          (b, cx, cy) => pulseRings(cx, cy, 3, 24, 2.2, 0.4, 45, hash01(b.seq) * TAU, 5, 'ring'),
          (b, cx, cy) => aimShot(cx, cy, 5, 0.22, 5.0, 5, 'aim', b.seq),
        ] },
      ],
    },

    /* ---- S5 相位幻影 ------------------------------------------------
     * 最小的 Boss，"难打中"就是它的防御。招牌是位置欺骗：
     * 残影爆散惩罚"追着 Boss 打"的本能，双子分身让弹数翻倍但几何不变。
     * 考的是「不要追，去猜它下一步落在哪」。 */
    phaser: {
      w: 120, h: 100,
      move(b, dt) {
        if (b.tele > 0) b.tele = Math.max(0, b.tele - dt / 350);   // 相位中 0.35s 淡出
        if (b.ghostT > 0 && --b.ghostT === 0) {
          // 残影爆散：离开点在 0.5s 后炸成一圈环形弹
          const n = b.pi >= 2 ? 16 : 12;
          ringShot(b.teleX, b.teleY, n, 2.8, hash01(b.seq * 13 + 3) * TAU, 5, 'ring', 0, 0);
          addRing(b.teleX, b.teleY, b.hue, 120);
        }
        b.anchorT += dt;
        const period = 1800 - b.pi * 320;
        if (b.anchorT >= period) { b.anchorT = 0; blinkTo(b, PHASER_ANCHORS, 30); }
      },
      phases: [
        { at: 1.00, gap: 800, pats: [
          (b, cx, cy) => aimBurst(cx, cy, 4, 5, 4.4, 5, 'aim', b.seq),
          (b, cx, cy) => fanShot(cx, cy, 7, Math.PI * 0.62, Math.PI / 2, 3.3, 6, 'fan', -1),
        ] },
        { at: 0.66, gap: 660, pats: [
          (b, cx, cy) => { fanShot(cx, cy, 7, Math.PI * 0.66, Math.PI / 2, 3.4, 6, 'fan', -1);
                           if (b.teleX) fanShot(b.teleX, b.teleY, 7, Math.PI * 0.66, Math.PI / 2, 3.4, 6, 'fan', -1); },
          (b, cx, cy) => { aimBurst(cx, cy, 4, 5, 4.6, 5, 'aim', b.seq);
                           if (b.teleX) aimBurst(b.teleX, b.teleY, 4, 5, 4.6, 5, 'aim', b.seq + 1); },
          (b, cx, cy) => spiralShot(cx, cy, 3, b.seq, 3.2, 5, 'ring', 0.42),
        ] },
        { at: 0.33, gap: 520, pats: [
          (b) => crossRainShot(14, 3.2, 5, 'aim', b.seq),
          (b, cx, cy) => { fanShot(cx, cy, 9, Math.PI * 0.78, Math.PI / 2, 3.5, 6, 'fan', 4);
                           if (b.teleX) fanShot(b.teleX, b.teleY, 9, Math.PI * 0.78, Math.PI / 2, 3.5, 6, 'fan', 4); },
          (b, cx, cy) => { aimShot(cx, cy, 5, 0.20, 5.0, 5, 'aim', b.seq);
                           if (b.teleX) aimShot(b.teleX, b.teleY, 5, 0.20, 5.0, 5, 'aim', b.seq + 2); },
        ] },
      ],
    },

    /* ---- S6 终末虚空（最终 Boss）--------------------------------------
     * 集大成 + 记忆考核。三个阶段各借一款前作 Boss 的移动模式 —— 这不是偷懒，
     * 是叙事：它"吞噬了前面所有的敌人"，所以它会用它们的动作。
     * 招牌三件：漩涡（所有弹带角速度）、回响（1.2s 后重放）、崩落（每掉 25% 血碎一块）。 */
    void: {
      w: 160, h: 160,
      move(b, dt) {
        if (b.pi === 0) {
          // 形态一：横扫（借 sentinel）
          b.phase += dt * 0.0014;
          b.x = W / 2 + Math.sin(b.phase) * (W * 0.24);
        } else if (b.pi === 1) {
          // 形态二：8 字（借 scorpion）
          b.phase += dt * 0.0013;
          const amp = 16;
          b.x = W / 2 + Math.sin(b.phase) * (W * 0.26);
          b.y = b.ty + amp * 1.1 + Math.sin(b.phase * 2) * amp;
        } else {
          // 形态三：瞬移（借 phaser）
          if (b.tele > 0) b.tele = Math.max(0, b.tele - dt / 350);
          b.anchorT += dt;
          if (b.anchorT >= 2200) { b.anchorT = 0; blinkTo(b, VOID_ANCHORS, 0); }
          /* 玩家牵引（Q4 决策：做代码路径，默认关闭）。
           * 力度上限 1.2px/步 —— 最低灵敏度档 sensSpeed=0.06 下，手指离开 20px 玩家
           * 每步就能走 >1.2px，所以「玩家永远能抵抗」。
           * 即便如此仍默认关：任何直接改写 player.x 的机制都在侵蚀自主感，
           * 压迫感的收益小于「我的操作不算数」的挫败。 */
          if (CONFIG.voidGravity) {
            const pull = (W / 2 - player.x) * 0.004;
            player.x += pull > 1.2 ? 1.2 : (pull < -1.2 ? -1.2 : pull);
          }
        }
        if (b.pi >= 1) tickEcho(b);
      },
      // 崩落：每损失 25% HP 崩掉一块晶体。血量因此成为可视信息 ——
      // 玩家不看血条也知道打到哪了。
      onDamage(b) {
        if (!(b.maxHp > 0)) return;
        const lost = 1 - b.hp / b.maxHp;
        while (b.form < 3 && lost >= (b.form + 1) * 0.25) {
          b.form++;
          explode(b.x, b.y + b.h * 0.2, b.hue);
          addRing(b.x, b.y, b.hue, b.w * 1.4);
          game.shake = Math.max(game.shake, 10);
          shatterRock(b);
        }
      },
      phases: [
        { at: 1.00, gap: 760, pats: [
          (b, cx, cy) => fanShot(cx, cy, 9, Math.PI * 0.80, Math.PI / 2, 3.3, 6, 'fan', 4),
          (b, cx, cy) => spiralShot(cx, cy, 3, b.seq, 3.0, 5, 'ring', 0.40),
          (b, cx, cy) => aimShot(cx, cy, 5, 0.10, 4.4, 5, 'aim', b.seq),
        ] },
        { at: 0.66, gap: 620, echo: true, pats: [
          (b, cx, cy) => vortexShot(cx, cy, 20, 2.9, hash01(b.seq) * TAU, 5, 'ring', 0.005, 260),
          (b, cx, cy) => ringShot(cx, cy, 22, 3.0, hash01(b.seq * 3) * TAU, 5, 'ring', b.seq % 22, 3),
          (b, cx, cy) => aimShot(cx, cy, 5, 0.18, 4.8, 5, 'aim', b.seq),
        ] },
        { at: 0.33, gap: 500, echo: true, pats: [
          (b, cx, cy) => vortexShot(cx, cy, 28, 3.0, hash01(b.seq) * TAU, 5, 'ring', 0.007, 240),
          (b) => rotorBeam(b, 4, 12, 2.1, 17, 4, 200),
          (b) => crossRainShot(14, 3.3, 5, 'aim', b.seq),
          (b, cx, cy) => aimShot(cx, cy, 7, 0.24, 5.0, 5, 'aim', b.seq),
        ] },
      ],
    },

    /* ---- S7 织网者（EX Boss）------------------------------------------
     * 战役收尾的额外尖峰。它不靠"更快的弹"施压，靠「封锁」——
     * 招牌『织网』先在半屏上钉出一片 hold 悬停虚影（只画不伤），1.5s 后整片激活下压，
     * 列奇偶反向横移把网眼织歪。压迫感全部来自「你有 1.5 秒，但只有这 1.5 秒」。
     * 移动照抄 phaser / void P3 的瞬移（blinkTo + 写死锚点表），零新机制：
     * 织网封锁横向、瞬移打断"贴脸输出"，两者合起来才逼得出走位。 */
    weaverqueen: {
      w: 150, h: 132,
      move(b, dt) {
        // 冠部自转相位：仅供绘制读取，按 dt 累加 ⇒ 与刷新率无关（S16）
        b.phase += dt * 0.0012;
        if (b.tele > 0) b.tele = Math.max(0, b.tele - dt / 350);   // 残影 0.35s 淡出
        b.anchorT += dt;
        // 相位越深跳得越勤：2.4s → 2.0s → 1.6s
        const period = 2400 - b.pi * 400;
        if (b.anchorT >= period) {
          b.anchorT = 0;
          /* ghostSteps 传 0：不启用 phaser 的「残影爆散」——那套要在 move 里
           * 自减 ghostT，属于额外机制。这里只要位置欺骗，不要二段伤害。 */
          blinkTo(b, WEAVER_ANCHORS, 0);
        }
      },
      phases: [
        /* P0 教学：先「织机呼吸」（双层脉冲环）建立节奏预期，再宽扇留缝。
         * 招牌织网刻意留到 P1 才登场 —— 先让玩家熟悉它的开火节拍。 */
        { at: 1.00, gap: 900, pats: [
          (b, cx, cy) => pulseRings(cx, cy, 2, 10, 2.4, 0.8, 24, hash01(b.seq) * TAU, 6, 'ring'),
          (b, cx, cy) => fanShot(cx, cy, 7, Math.PI * 0.60, Math.PI / 2, 3.4, 6, 'fan', -1),
        ] },
        /* P1 织网登场：网封锁横向 → 追踪逼你动 → 环收口。
         * 三招轮转 ⇒ 网每 2.16s 才来一次，留足读网时间。 */
        { at: 0.66, gap: 720, pats: [
          (b) => weaveNet(8, 5, 90, 2.4, 0.5, 6, 'ring', 0),
          (b, cx, cy) => aimShot(cx, cy, 5, 0.12, 4.2, 5, 'aim', b.seq),
          (b, cx, cy) => ringShot(cx, cy, 14, 2.8, hash01(b.seq * 3) * TAU, 5, 'ring', b.seq % 14, 3),
        ] },
        /* P2 三重叠加：双层错峰网（hold 差 30 步 = 半个身位的时间差）+ 漩涡 + 连爆。
         * 第二张网半格错开，把网眼从 8 列细分成 16 列 —— 缝仍在，但要求走位精度。 */
        { at: 0.33, gap: 560, pats: [
          (b) => { weaveNet(8, 4, 90, 2.4, 0.5, 6, 'ring', 0);
                   weaveNet(8, 3, 120, 2.7, -0.5, 5, 'ring', 0.5); },
          (b, cx, cy) => vortexShot(cx, cy, 14, 2.6, hash01(b.seq) * TAU, 5, 'ring', 0.012, 240),
          (b, cx, cy) => aimBurst(cx, cy, 6, 10, 4.0, 5, 'aim', b.seq),
        ] },
      ],
    },
  };
  // entities.js 先于 game.js 加载，绘制侧必须在「运行时」查这张表，不能在模块顶层缓存
  DJFE.bossKinds = BOSS_KINDS;

  // ---- M5 Boss ----
  function spawnBoss(n, now, forceKind) {
    const st = STAGES[game.stage - 1] || STAGES[STAGES.length - 1];
    // forceKind（仅 __debug.spawnBoss 使用）：跳过 STAGES 派生，直接装配指定种类，
    // 用于自动化验证「每款 Boss 独立精灵」。生产路径永远不传，逻辑零变化。
    const kind = (forceKind && BOSS_KINDS[forceKind]) ? forceKind
      : ((st.bossKind && BOSS_KINDS[st.bossKind]) ? st.bossKind : 'sentinel');
    const K = BOSS_KINDS[kind];
    const tier = Math.floor(n / 3);
    const hp = st.bossHp;
    /* T3-3 击破耗时基准。用逻辑时钟（now 由 beginWave 从 logicNow() 传下来），
     * 不用 performance.now —— 否则暂停/掉帧会把耗时算进去，战果面板上就是一串
     * 与实际交战无关的数。now 异常时回落 logicNow()，绝不让 NaN 进字段。 */
    const spawnT = Number.isFinite(now) ? now : logicNow();
    game.bossFightStart = spawnT;
    game.boss = {
      kind, x: W / 2, y: -90, ty: H * 0.16,
      hp, maxHp: hp, w: K.w, h: K.h,
      hue: st.bossHue, name: DJFE.t(st.bossKey),
      phase: 0, fireT: 0, fireGap: Math.max(420, 900 - tier * 120),
      px: W / 2, py: -90, sx: 0, sy: 0,
      spawnT,         // 入场逻辑时刻(ms)：击破耗时 = logicNow() - spawnT

      // ---- 扩容期字段（全部显式置 0：Boss 每关重建，但字段形状必须一次定死）----
      pi: 0,          // 当前相位序号（phases 下标）
      patIdx: 0,      // 相位内招式游标
      seq: 0,         // 累计开火次数：弹幕相位推进 + 确定性抖动的种子
      beamPhase: 0,   // 旋转光束相位(rad)，由 move 按 dt 累加
      invulnT: 0,     // 相位切换后的无敌剩余(ms)
      dmgMul: 1,      // 受伤倍率（sentinel 双肩装甲期 0.5）
      subT: 0,        // 召唤计时(ms)
      minions: 0,     // 在场召唤物计数
      anchorT: 0,     // 瞬移 / 形态切换计时(ms)
      anchor: 0,      // 当前锚点序号（phaser）
      tele: 0,        // 瞬移残影渐隐 [0,1]
      teleX: 0, teleY: 0,   // 残影位置
      form: 0,        // 已崩落的晶体块数（void）
      ovr: 0,         // 过载状态 [0,1]（core）
      ghostT: 0,      // 残影爆散倒计时(步)（phaser）
      // 回响队列：固定 4 格、随 Boss 一次性预分配，运行期只改字段不新建对象
      echo: [
        { pi: 0, pat: 0, x: 0, y: 0, due: 0 },
        { pi: 0, pat: 0, x: 0, y: 0, due: 0 },
        { pi: 0, pat: 0, x: 0, y: 0, due: 0 },
        { pi: 0, pat: 0, x: 0, y: 0, due: 0 },
      ],
    };
    // 装配相位 0：把 phases[0].gap 与 onPhase 的初始副作用（如装甲减伤）落到位。
    // i===0 不会触发相位爆，纯初始化。
    enterBossPhase(game.boss, 0);
    audio.boss();
    audio.music.setIntensity('boss'); audio.music.setStage(game.stage);
    return game.boss;   // 返回装配好的 Boss 引用（__debug.spawnBoss 透传，生产侧忽略返回值）
  }
  /* ===================================================================
   * 弹幕原语库
   * -------------------------------------------------------------------
   * Boss 招式一律由这几条原语拼装，理由有三：
   *   ① 招式只描述「参数」，弹幕形状的实现全局只有一份；
   *   ② 每条原语单次发射量都是可数的，池容量能静态推算（S18 零扩容门）；
   *   ③ 全部零 Math.random() —— 抖动走无理数散列，种子化冒烟的实体轨迹
   *      不会因为 Boss 换了个招式就被整体平移。
   * 约定：spd 单位 = px/逻辑步；角度 0 = 正右，PI/2 = 正下（与屏幕坐标一致）。
   * =================================================================== */
  const TAU = Math.PI * 2;
  // 黄金比无理数散列：把整数序号散成 [0,1) 的均匀伪随机数。看着随机，实则完全确定。
  const hash01 = (i) => { const v = i * 0.6180339887498949; return v - Math.floor(v); };

  // 扇形：以 base 为轴张开 spread，n 发均分。gapIdx>=0 时空出第 gapIdx 发（留「缝」给玩家钻）
  function fanShot(cx, cy, n, spread, base, spd, r, kind, gapIdx) {
    if (!(n > 0)) return;
    const st = n > 1 ? spread / (n - 1) : 0;
    const a0 = base - spread / 2;
    for (let i = 0; i < n; i++) {
      if (i === gapIdx) continue;
      const a = a0 + st * i;
      addEbullet(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind);
    }
  }
  // 瞄准连发：朝玩家现位置，n 发以 0.16 rad 密排，jitter 为额外抖动幅度（由 seq 决定，零 RNG）
  function aimShot(cx, cy, n, jitter, spd, r, kind, seq) {
    const ang = Math.atan2(player.y - cy, player.x - cx);
    for (let i = 0; i < n; i++) {
      const j = jitter ? (hash01((seq || 0) * 7 + i * 3 + 1) - 0.5) * jitter : 0;
      const a = ang + j + (n > 1 ? (i - (n - 1) / 2) * 0.16 : 0);
      addEbullet(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind);
    }
  }
  // 环形：n 发均分整圆，off 为整体相位。gapCount>0 时自 gapFrom 起连续空出若干发
  function ringShot(cx, cy, n, spd, off, r, kind, gapFrom, gapCount) {
    if (!(n > 0)) return;
    const gc = gapCount > 0 ? gapCount : 0;
    for (let i = 0; i < n; i++) {
      if (gc > 0 && ((i - (gapFrom || 0)) % n + n) % n < gc) continue;
      const a = (off || 0) + TAU * (i / n);
      addEbullet(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind);
    }
  }
  // 螺旋：每次调用发 arms 条臂，相位按 seq 递进 —— 连续调用即画出旋臂
  function spiralShot(cx, cy, arms, seq, spd, r, kind, stepA) {
    if (!(arms > 0)) return;
    const off = (seq || 0) * (stepA || 0.38);
    for (let i = 0; i < arms; i++) {
      const a = off + TAU * (i / arms);
      addEbullet(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind);
    }
  }
  // 弹墙：整屏宽度均分 n 格垂直落下，gapIdx 处留一道生门
  function wallShot(y, n, spd, r, kind, gapIdx) {
    if (!(n > 0)) return;
    const cw = W / n;
    for (let i = 0; i < n; i++) {
      if (i === gapIdx) continue;
      addEbullet(cw * (i + 0.5), y, 0, spd, r, kind);
    }
  }
  // 横穿雨：左右两侧交替射入的水平弹，逼玩家上下走位
  function crossRainShot(n, spd, r, kind, seq) {
    if (!(n > 0)) return;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const y = H * (0.14 + 0.46 * t);
      const fromLeft = (((seq || 0) + i) % 2) === 0;
      addEbullet(fromLeft ? -14 : W + 14, y, fromLeft ? spd : -spd, 0, r, kind);
    }
  }
  // 弯曲弹：左右两半反向自旋，飞出去会张成花瓣。av 单位 = rad/逻辑步
  function curveShot(cx, cy, n, spread, base, spd, av, r, kind) {
    if (!(n > 0)) return;
    const st = n > 1 ? spread / (n - 1) : 0;
    const a0 = base - spread / 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + st * i;
      const sgn = (i < n / 2) ? -1 : 1;
      addEbulletEx(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind, { av: av * sgn });
    }
  }
  // 延迟环：先在原地悬停 hold 步（作预警），再逐发依次启动 —— 「定格 → 齐射」的压迫感
  function holdRing(cx, cy, n, spd, off, r, kind, hold) {
    if (!(n > 0)) return;
    for (let i = 0; i < n; i++) {
      const a = (off || 0) + TAU * (i / n);
      addEbulletEx(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind, { hold: (hold || 0) + i });
    }
  }
  /* 旋转光束：不是真 beam 实体，而是沿一条射线密排的弹链。
   * ⚠ 角度必须由 Boss 自己的相位 b.beamPhase 推出（beamPhase 在 Boss 更新里按 dt 累加），
   *   绝不能给每颗弹挂 av 让它们各自转 —— 那样光束会随存活帧数「拧」成螺旋，
   *   而且每颗弹的自转步数取决于它被创建的时刻，各档刷新率下结果不一致（S16 直接翻红）。 */
  /* 尾刺穿刺（巨蝎招牌）：朝玩家排一整条定格的弹链作预警，warn 步后自根部
   * 向外依次点火。hold 期间的弹不参与碰撞（见 step 里的敌弹判定），
   * 所以预警线本身没有杀伤——它只负责"通知玩家现在必须动"。 */
  function stingerShot(b, cx, cy, count, warn) {
    const ang = Math.atan2(player.y - cy, player.x - cx);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < count; i++) {
      const d = 26 + i * 24;
      addEbulletEx(cx + ca * d, cy + sa * d, ca * 7.4, sa * 7.4, 5.5, 'sniper',
        { hold: warn + i * 2, ttl: 200 });
    }
  }
  /* 舰载弹射（母舰招牌）：抛出的是「弹母」，飞行 delay 步后自毁并炸成 n 片小扇。
   * 安全区会在弹飞到一半时突然消失，逼玩家提前读招而不是贴着弹缝走。 */
  function splitVolley(cx, cy, n, spread, spd, delay, splitN) {
    if (!(n > 0)) return;
    const st = n > 1 ? spread / (n - 1) : 0;
    const a0 = Math.PI / 2 - spread / 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + st * i;
      addEbulletEx(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, 7, 'ring',
        { split: delay, splitN });
    }
  }
  function beamChain(b, baseA, count, spd, gap, r, kind, ttl) {
    if (!(count > 0)) return;
    const a = baseA + (b.beamPhase || 0);
    const ca = Math.cos(a), sa = Math.sin(a);
    const cx = b.x, cy = b.y + b.h * 0.10;
    for (let i = 0; i < count; i++) {
      const d = 30 + i * gap;
      addEbulletEx(cx + ca * d, cy + sa * d, ca * spd, sa * spd, r, kind, { ttl: ttl || 0 });
    }
  }
  /* 旋转光束组（核心招牌）：arms 条等分的弹链，整体角度由 b.beamPhase 决定。
   * beamPhase 在 core.move 里按 dt 累加，所以「转速」是每秒多少弧度，与刷新率无关；
   * 每颗弹自己只是直线飞出去 —— 转的是「发射角」，不是弹。
   * ttl 是硬约束：1.9px/步的弹要 350 步才飞出屏幕，不设寿命会长期压池（S18）。 */
  function rotorBeam(b, arms, per, spd, gap, r, ttl) {
    if (!(arms > 0)) return;
    for (let a = 0; a < arms; a++) beamChain(b, TAU * (a / arms), per, spd, gap, r, 'ring', ttl);
  }
  /* 环脉冲：layers 层同心环依次点火（靠 hold 错开），速度逐层递增。
   * 层与层之间的径向间距会越拉越大，形成"呼吸"，玩家要在层间的空档穿过去。 */
  function pulseRings(cx, cy, layers, n, spd0, dspd, gapSteps, off, r, kind) {
    if (!(layers > 0) || !(n > 0)) return;
    for (let L = 0; L < layers; L++) {
      const sp = spd0 + dspd * L;
      const o = (off || 0) + L * 0.13;
      for (let i = 0; i < n; i++) {
        const a = o + TAU * (i / n);
        addEbulletEx(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp, r, kind, { hold: L * gapSteps });
      }
    }
  }
  /* 漩涡环（虚空招牌）：整圈弹统一带角速度，飞出去会缓缓弯成逆时针弧。
   * ⚠ 带 av 的弹轨迹是螺旋，未必飞得出屏幕边界 → 必须挂 ttl 兜底，否则绕圈永生（S18 泄漏）。 */
  function vortexShot(cx, cy, n, spd, off, r, kind, av, ttl) {
    if (!(n > 0)) return;
    for (let i = 0; i < n; i++) {
      const a = (off || 0) + TAU * (i / n);
      addEbulletEx(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind,
        { av, ttl: ttl || 240 });
    }
  }
  /* 瞄准连爆：朝玩家当前位置排 n 发，靠 hold 逐发错开点火。
   * 注：设计稿原意是"每发重新取一次玩家角度"，那需要一套延迟开火队列；
   * 这里改用「同角度 + 错峰启动 + 散列微张」近似——玩家横移仍能把它拉成一串而非一点，
   * 教学意图（奖励移动）保住，代价是不需要新调度器。 */
  function aimBurst(cx, cy, n, gapSteps, spd, r, kind, seq) {
    if (!(n > 0)) return;
    const ang = Math.atan2(player.y - cy, player.x - cx);
    for (let i = 0; i < n; i++) {
      const a = ang + (hash01((seq || 0) * 11 + i * 5 + 1) - 0.5) * 0.14;
      addEbulletEx(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind, { hold: i * gapSteps });
    }
  }
  /* 织网（织网者招牌）：在上半屏钉出 cols×rows 一整片悬停弹，hold 步内只画不伤
   * （复用 stingerShot 同一条 hold 语义：step 里 hold>0 直接 continue，擦弹也跳过），
   * 到点整片同时激活，向下推进，相邻列反向横移 ±drift 把网眼「织」歪。
   * 与尾刺的区别：尾刺是一条线的预警，织网是一整面的封锁——玩家必须在 1.5s 内
   * 选定要钻哪一格，而不是简单地左右一闪。
   * ⚠ P2 可读性红线：列间距 = W*0.80/(cols-1)，cols=8 时约 110px ≈ 3.9 个玩家判定圈。
   *   缝必须留得出来 —— 网一旦密到穿不过去，1.5s 预警就没有意义，
   *   它会从「读得懂的弹幕」退化成「看得见的秒杀墙」。
   * 零 RNG：格点坐标由 c / j 线性推出，横移方向取列奇偶，xoff 是整片的半格偏移，
   *   全程不碰 Math.random（S16 六档一致）。
   * S18：单次 cols*rows 发（8×5=40）≪ ebullets cap 1600，P2 双网 56 发仍有大量余量。 */
  function weaveNet(cols, rows, hold, spd, drift, r, kind, xoff) {
    if (!(cols > 1) || !(rows > 0)) return;
    const stepX = 0.80 / (cols - 1);
    for (let c = 0; c < cols; c++) {
      const x = W * (0.10 + stepX * (c + (xoff || 0)));
      const dx = (c % 2 ? 1 : -1) * (drift || 0);
      for (let j = 0; j < rows; j++) {
        const y = H * (0.18 + 0.42 * (rows > 1 ? j / (rows - 1) : 0));
        addEbulletEx(x, y, dx, spd, r, kind, { hold });
      }
    }
  }

  /* ---- 瞬移（相位幻影 / 虚空 P3 共用）--------------------------------
   * 锚点表写死，不随机生成 —— 玩家必须能学会"它只会去这 6 个地方"，
   * 否则瞬移就从「可预判」退化成「随机耍赖」。
   * 落点选择用 hash01(seq) 散列：看起来在跳，实则完全确定（S16 六档一致）。 */
  const PHASER_ANCHORS = [0.18, 0.17, 0.50, 0.16, 0.82, 0.17, 0.22, 0.29, 0.50, 0.31, 0.78, 0.29];
  const VOID_ANCHORS   = [0.16, 0.18, 0.84, 0.18, 0.50, 0.30, 0.20, 0.32, 0.80, 0.32];
  /* 织网者锚点：6 个，全部压在上半屏（y ≤ 0.30H）。刻意比 phaser 的分布更靠中，
   * 因为织网已经封住横向了 —— 再让本体满屏乱跳，玩家会同时丢失"网在哪"和"它在哪"。 */
  const WEAVER_ANCHORS = [0.22, 0.17, 0.78, 0.17, 0.50, 0.16, 0.34, 0.30, 0.66, 0.30, 0.50, 0.28];
  function blinkTo(b, anchors, ghostSteps) {
    const cnt = (anchors.length / 2) | 0;
    // 离开点留作残影：既是爆散源，也是"双子分身"的第二发射点
    b.teleX = b.x; b.teleY = b.y;
    b.tele = 1;
    b.ghostT = ghostSteps;
    let idx = b.anchor;
    // 公平性护栏：落点不得贴玩家脸（<60px），最多重挑 2 次，仍冲突就取对位锚点。
    // 少了这条，玩家会被「凭空出现的 Boss」原地撞死。
    for (let t = 0; t < 3; t++) {
      idx = (idx + 1 + Math.floor(hash01(b.seq * 3 + t + 1) * (cnt - 1))) % cnt;
      if (Math.abs(anchors[idx * 2] * W - player.x) >= 60) break;
    }
    if (Math.abs(anchors[idx * 2] * W - player.x) < 60) idx = (idx + ((cnt / 2) | 0)) % cnt;
    b.anchor = idx;
    b.x = anchors[idx * 2] * W;
    // 落点绝不能高于 ty，否则 step 里的入场判定 (y < ty) 会重新触发一次下落
    b.y = Math.max(b.ty, anchors[idx * 2 + 1] * H);
    // 瞬移后必须同步插值基准：否则高刷下的运动外插会拿「跨屏位移」去外推，
    // 把 Boss 甩到屏幕外（b.x += (b.x - b.px) * alpha）
    b.px = b.x; b.py = b.y;
  }

  /* ---- 回响队列（虚空招牌）------------------------------------------
   * Boss 每次开火把 {相位, 招式号, 坐标} 入队，72 步（1.2s）后在原坐标重放一次。
   * 玩家必须记住"1.2 秒前它在哪、发了什么" —— 引入记忆维度而不是纯反应。
   * 队列固定 4 格且预分配：满了直接不入队（宁可少一次回响，也不许弹幕无上限叠）。 */
  function pushEcho(b, pat, x, y, due) {
    const q = b.echo;
    if (!q) return;
    for (let i = 0; i < q.length; i++) {
      if (q[i].due <= 0) { q[i].pi = b.pi; q[i].pat = pat; q[i].x = x; q[i].y = y; q[i].due = due; return; }
    }
  }
  function fireEcho(b, e) {
    const K = BOSS_KINDS[b.kind] || BOSS_KINDS.sentinel;
    const ph = K.phases && K.phases[e.pi];
    if (!ph || !ph.pats || !ph.pats.length) return;
    ph.pats[e.pat % ph.pats.length](b, e.x, e.y);
  }
  function tickEcho(b) {
    const q = b.echo;
    if (!q) return;
    for (let i = 0; i < q.length; i++) {
      const e = q[i];
      if (e.due <= 0) continue;
      e.due--;
      if (e.due === 20) addRing(e.x, e.y, b.hue, 76);   // 提前 ~0.33s 的收缩环预警
      if (e.due === 0) fireEcho(b, e);
    }
  }
  /* 崩落的残骸。陨石实体在第 12 步接入，这里先只出视觉 ——
   * 分两趟做是有意的：先让相位/伤害钩子跑通冒烟，再往战场上扔实体。 */
  function shatterRock(b) {
    addRing(b.x, b.y + b.h * 0.25, b.hue, b.w * 0.8);
  }

  /* Boss 相位系统。血量比跌破阈值就升相位，只前进不回退（打回血也不降相位，
   * 否则玩家会在阈值线上反复看到「相位爆」）。
   * 相位爆 = 清屏 + 冲击波 + 定格 + 加分 + 1.2s 无敌：既是奖励反馈，也是喘息窗口，
   * 顺便把上一相位残留的漫天弹幕一次性抹掉，避免两套弹幕叠加成不可躲的死局。 */
  function enterBossPhase(b, i) {
    const K = BOSS_KINDS[b.kind] || BOSS_KINDS.sentinel;
    const ph = K.phases && K.phases[i];
    b.pi = i;
    b.patIdx = 0;
    b.fireT = 0;
    if (ph && ph.gap > 0) b.fireGap = ph.gap;
    if (i > 0) {
      clearList(game.ebullets, POOL.ebullets);
      addRing(b.x, b.y, b.hue, Math.max(W, H) * 0.55);
      for (let k = 0; k < 8; k++) {
        explode(b.x + (Math.random() - 0.5) * b.w, b.y + (Math.random() - 0.5) * b.h, b.hue);
      }
      game.shake = Math.max(game.shake, 20);
      game.hitStop = Math.max(game.hitStop, 90);
      game.score += 200 * i;
      b.invulnT = 1200;
      audio.boss();
    }
    if (K.onPhase) K.onPhase(b, i);
  }
  function checkBossPhase(b) {
    const K = BOSS_KINDS[b.kind] || BOSS_KINDS.sentinel;
    const ph = K.phases;
    if (!ph || !ph.length) return;
    const r = b.maxHp > 0 ? b.hp / b.maxHp : 0;   // maxHp 兜底：绝不让 0/0 变 NaN
    let want = 0;
    for (let i = ph.length - 1; i >= 0; i--) { if (r <= ph[i].at) { want = i; break; } }
    if (want > b.pi) enterBossPhase(b, want);
  }

  function bossFire(b) {
    const K = BOSS_KINDS[b.kind] || BOSS_KINDS.sentinel;
    const ph = K.phases && K.phases[b.pi];
    b.seq++;
    if (ph && ph.pats && ph.pats.length) {
      // 相位内招式轮转派发：pats 是一张「循环播放列表」，不再是 %3 硬编码
      const idx = b.patIdx % ph.pats.length;
      b.patIdx++;
      const cx0 = b.x, cy0 = b.y + b.h * 0.4;
      ph.pats[idx](b, cx0, cy0);
      // 该相位开了回响：把这一发压进队列，72 步（1.2s）后在原坐标重放
      if (ph.echo) pushEcho(b, idx, cx0, cy0, 72);
      return;
    }
    // ---- legacy 弹幕（未注册 phases 的 Boss 走这条，保留作回归基线）----
    const cx = b.x, cy = b.y + b.h * 0.4;
    const pat = bossPattern % 3;
    bossPattern++;
    if (pat === 0) {
      const num = 7, spread = Math.PI * 0.6, base = Math.PI / 2 - spread / 2;
      for (let i = 0; i < num; i++) {
        const a = base + spread * (i / (num - 1));
        addEbullet(cx, cy, Math.cos(a) * 3.4, Math.sin(a) * 3.4, 6, undefined);
      }
    } else if (pat === 1) {
      const a1 = (bossPattern * 0.5) % (Math.PI * 2);
      addEbullet(cx, cy, Math.cos(a1) * 3.2, Math.sin(a1) * 3.2, 6, undefined);
      addEbullet(cx, cy, Math.cos(a1 + Math.PI) * 3.2, Math.sin(a1 + Math.PI) * 3.2, 6, undefined);
    } else {
      const ang = Math.atan2(player.y - cy, player.x - cx);
      for (let i = -1; i <= 1; i++) {
        const a = ang + i * 0.18;
        addEbullet(cx, cy, Math.cos(a) * 4, Math.sin(a) * 4, 6, undefined);
      }
    }
  }
  function onBossKilled(b) {
    /* T3-3 击破耗时：先记账再放烟花 —— explode 里那 60 次爆炸不该有机会
     * 把这条记录挤掉。上限 32 条纯属防守（一局最多 STAGES.length 场 Boss，
     * 但调试面板能手搓 Boss，不设上限就是一条慢速内存泄漏）。 */
    if (game.bossBreakTimes.length < 32) {
      const st0 = Number.isFinite(b.spawnT) ? b.spawnT
                : (Number.isFinite(game.bossFightStart) ? game.bossFightStart : logicNow());
      let ms = logicNow() - st0;
      if (!Number.isFinite(ms) || ms < 0) ms = 0;   // NaN / 时钟回拨兜底，面板绝不吃 NaN
      game.bossBreakTimes.push({ kind: b.kind, name: b.name, ms });
    }
    for (let i = 0; i < 60; i++) {
      explode(b.x + (Math.random() - 0.5) * b.w, b.y + (Math.random() - 0.5) * b.h, 30 + Math.random() * 30);
    }
    bossCollapse(b);
    addRing(b.x, b.y, 40, Math.max(W, H) * 0.6);
    addRing(b.x, b.y, 50, Math.max(W, H) * 0.95);
    // 方向 B：震屏幅度整体下调（42→26），改用「低幅 + 缓收」的沉闷感，
    // 而不是原来那种硬桌子似的高频抖 —— 柔调画面配硬震会立刻出戏。
    // 同时触发 ~100ms 命中定格（hit-stop），让 Boss 崩解的瞬间有"分量感"。
    game.shake = 30;
    game.hitStop = Math.max(game.hitStop, 100);
    game.flash = 1;
    audio.bomb();
    audio.music.setIntensity('playing');
    game.score += 600 + game.wave * 150;
    for (let i = 0; i < 3; i++) dropItem(b.x + (Math.random() - 0.5) * 140, b.y + (Math.random() - 0.5) * 60, true);
    game.boss = null;
    addSkillCharge(0.30);               // 2c-1 · 技能充能：Boss 击破一次性 +0.30
  }

  // ---- 触摸板灵敏度 ----
  let sensSpeed = 0.30;
  function applySens(v) {
    const t = (v - 1) / 9;
    sensSpeed = 0.06 + t * (0.55 - 0.06);
    sensValEl.textContent = v;
  }
  sensEl.addEventListener('input', () => applySens(parseInt(sensEl.value, 10)));

  function loseLife(now) {
    if (game.state !== STATE.PLAYING) return;
    game.lives--;
    game.combo = 0; game.comboUntil = 0;   // 受击清空连击
    game.flash = 1;
    audio.hit();
    game.shake = Math.max(game.shake, 9);
    player.invulnUntil = now + 1200;
    if (game.lives <= 0) gameOver();
  }

  function updatePlayer(now, dt) {
    const kx = (input.keys.right ? 1 : 0) - (input.keys.left ? 1 : 0);
    const ky = (input.keys.down ? 1 : 0) - (input.keys.up ? 1 : 0);
    if (kx !== 0 || ky !== 0) {
      player.x += kx * 0.62 * dt;
      player.y += ky * 0.62 * dt;
      input.pointer.x = player.x; input.pointer.y = player.y;
    } else {
      player.x += (input.pointer.x - player.x) * sensSpeed;
      player.y += (input.pointer.y - player.y) * sensSpeed;
    }
    player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
    player.y = Math.max(H * 0.4, Math.min(H - player.h / 2, player.y));
  }

  /* ---- 僚机 Option ------------------------------------------------------
   * power >= 3 出 1 架，power === 5 出 2 架。
   *
   * 定位不是"多一门炮"，是「power 等级的可视化」：玩家不看 HUD，扫一眼机翼
   * 就知道自己在哪一档 —— 空翼=1~2 级、单僚机=3~4 级、双翼=满级。所以 1 架时
   * 刻意只挂左侧而不居中：不对称本身就是可读的状态信号。
   *
   * 三条自我约束：
   *   ① 无独立状态 —— 位置纯粹是 player.x/y 的函数。不做弹性追随、不留插值
   *      变量，也就没有暂停恢复 / 复活 / 换关时的不同步，不吃对象池。
   *   ② 不参与任何碰撞 —— 它是火力挂件，不是第二个受击面，更不是护盾。
   *   ③ 位置表只有这一份，绘制侧走 DJFE.options 读同一张表，绝不复制常量。
   */
  const OPTION_OFFS = [[-34, 8], [34, 8]];
  function optionCount() { return game.power >= 5 ? 2 : (game.power >= 3 ? 1 : 0); }
  DJFE.options = { offs: OPTION_OFFS, count: optionCount };

  /* ---- 擦弹 Graze 调参 ---------------------------------------------------
   * 甜蜜带 (14, 26]px：内沿 14 就是玩家判定半径，外沿 26 约等于机身半宽。
   * 平方形式直接存，热路径里省一次 sqrt（峰值 400+ 发敌弹 × 60Hz）。
   * GAIN 0.012 ⇒ 满槽需 84 次擦弹。按 Boss 战每秒 3~6 次擦的手感，
   * 约 15~28 秒一次加成 —— 一场 Boss 战能吃到 2~3 次，够甜但不至于常驻。 */
  const GRAZE_IN2 = 14 * 14;
  const GRAZE_OUT2 = 26 * 26;
  const GRAZE_GAIN = 0.012;
  const GRAZE_BOOST_MS = 6000;
  const GRAZE_SCORE_MUL = 1.5;

  /* ---- 子弹 (火力随 power 升级) ------------------------------------------
   * 两条调用路径，语义严格分开：
   *
   *  ① `shoot()` —— 常规主武器。P2b 起**按当前皮肤的武器 profile 派发**
   *     （game.weapon，开局时由皮肤 id 确定性推导）。cyan_knight 的 profile
   *     是 { kind:'', pattern:'dot' }，直接落回本函数下半段那些**一字未动**的
   *     power 分支 —— 所以选苍蓝骑士时，从弹对象字段到 ctx 调用序列都与
   *     P2a 前逐位一致（向后兼容硬门）。
   *
   *  ② `shoot(kind, opt)` —— 显式指定形态（P2a 预留、Phase 2c 技能要用）。
   *     传了合法 kind 就**绕开皮肤 profile**，沿用 power 分支的几何形状但换弹种。
   *     非法 / 缺省的 kind 一律回落 ''（= dot）：形态名拼错时应该退化成
   *     「能打的普通弹」，而不是造出一颗判定正常却画不出来的幽灵弹。
   *
   * 僚机（optionCount）**恒发 dot**，不随皮肤走 —— 这是刻意的取舍：
   *   · 僚机是「power 等级的可视化」，不是第二套武器，让它跟着换弹种会把
   *     6 款 profile × 5 档 power 的 DPS 校准矩阵再翻一倍，§6.2 的 C1 收敛带
   *     直接失效（金翼 p5 会多出 2 发环爆 = 群体 DPS 再 +40%）；
   *   · 且僚机弹与主武器同频同源，形态一致时玩家反而分不清哪股火力是自己的主炮。
   *   ⚠ 若主理人要改成「僚机随皮肤」，需连带重算 §6.2 的 p3/p5 两列。 */
  function shoot(kind, opt) {
    const bk = (kind && BULLET_KINDS[kind]) ? kind : '';
    const bo = bk ? (opt || undefined) : undefined;
    const now = logicNow();
    game.muzzle = now;
    audio.shoot();
    const bx = player.x, by = player.y - player.h / 2;
    /* 散射枪（G 道具，8s）：整段「覆盖」power 分支 —— 前方 7 发宽扇 + 后方 1 发，
     * 到期自然回落到下面的 power 分支，无需额外清理。
     * ★ addBullet 的真实签名是 (x, y, vy, r, vx)：第 4 参是半径、第 5 参才是横向
     *   速度。扇形的横向分量必须落在第 5 位、半径固定 4（与全部玩家子弹一致）。
     *   若把 vx 误传进第 4 位，会得到负半径 —— hit() 判定恒假（打不中任何东西），
     *   同时绘制层拿到负 lineWidth，是 NaN 红线的隐患。 */
    if (now < game.spreadUntil) {
      const spread = Math.PI * 0.55, half = spread / 2, speed = 10;
      for (let i = 0; i < 7; i++) {
        const th = -half + (spread * i) / 6;
        addBullet(bx, by, -Math.cos(th) * speed, 4, Math.sin(th) * speed, bk, bo);
      }
      addBullet(bx, by, 9, 4, undefined, bk, bo);   // 后方 1 发：vy 为正 = 朝屏幕下方
      const ocS = optionCount();
      for (let i = 0; i < ocS; i++) {
        addBullet(player.x + OPTION_OFFS[i][0], player.y + OPTION_OFFS[i][1] - 12, -11, 4, undefined, bk, bo);
      }
      return;
    }
    const p = game.power;
    // 僚机齐射：与主火力同频，各补一发直射弹，吃同一个 bullets 池。
    // 放在主火力之前发射，保证 power 提升的瞬间玩家先看到"翼下多了一道光"。
    // bk 在常规路径恒为 '' ⇒ 僚机永远是 dot（见函数头的取舍说明）。
    const oc = optionCount();
    for (let i = 0; i < oc; i++) {
      addBullet(player.x + OPTION_OFFS[i][0], player.y + OPTION_OFFS[i][1] - 12, -11, 4, undefined, bk, bo);
    }
    /* P2b · 皮肤武器派发。只有「没有显式指定 kind」时才查 profile；
     * dot 以外的 pattern 全部交给 firePattern 并 return，
     * dot 则原样穿过去落到下面那段与 P2a 前逐位相同的 power 分支。 */
    if (!bk) {
      const prof = game.weapon || SKIN_WEAPONS.cyan_knight;
      if (prof.pattern !== 'dot') { firePattern(prof, bx, by, p); return; }
    }
    if (p <= 1) {
      // Tier 1（平衡）：cyan dot 火力 1 → 2（±6 双发），提升起手 DPS，p3+ 冻结不动。
      addBullet(bx - 6, by, -11, 4, undefined, bk, bo);
      addBullet(bx + 6, by, -11, 4, undefined, bk, bo);
    } else if (p === 2) {
      // Tier 1（平衡）：cyan dot 火力 2 → 3（正中 + ±9），p3+ 冻结不动。
      addBullet(bx, by, -11, 4, undefined, bk, bo);
      addBullet(bx - 9, by, -11, 4, undefined, bk, bo);
      addBullet(bx + 9, by, -11, 4, undefined, bk, bo);
    } else if (p === 3) {
      addBullet(bx, by, -12, 4, undefined, bk, bo);
      // cyan dot 侧发弹：vx 恒为 undefined（竖直直飞），仅保留 bx 横向偏移 → 多列竖直光束。
      // 绘制层强制竖直（aligned 不含 dot），给横向速度会造成「斜飞却被竖直画」的一列不同。
      addBullet(bx - 10, by, -9, 4, undefined, bk, bo);
      addBullet(bx + 10, by, -9, 4, undefined, bk, bo);
    } else if (p === 4) {
      addBullet(bx, by, -12, 4, undefined, bk, bo);
      addBullet(bx - 9, by, -11, 4, undefined, bk, bo);
      addBullet(bx + 9, by, -11, 4, undefined, bk, bo);
      addBullet(bx - 18, by, -8, 4, undefined, bk, bo);
      addBullet(bx + 18, by, -8, 4, undefined, bk, bo);
    } else {
      for (let i = -2; i <= 2; i++) {
        addBullet(bx, by, -12, 4, undefined, bk, bo);
      }
    }
  }

  // ---- 敌机生成（12 种，按关卡解锁新机型） ----
  // straight 直冲 / weaver 蛇行 / shooter 瞄准炮手 / elite 重装扇形弹
  // spinner 回旋环形弹(S2+) / diver 锁定俯冲(S2+) / sniper 悬停狙击(S3+) / splitter 分裂母体(S4+)
  // turret 悬停炮台三连爆发(S2+) / kamikaze 自爆冲锋(S3+) / curver 弧线机抛弯曲弹(S4+)
  // rock 漂移陨石(S2/S5 关卡障碍，不开火)
  const ENEMY_STATS = {
    // 方向 B 敌机色相：全部避开「危险色带」(12-24 敌弹专属) 与「玩家色带」(175-200)，
    // 机体走低饱和靛/紫/玫/苔色系 —— 机体不再和自己发射的弹同色，弹才是威胁本身。
    // 注意：straight 保留一次 Math.random() 调用，RNG 消耗次序与改动前完全一致（种子测试依赖）。
    straight: { hp: 1,   score: 10, size: 30, vy: [1.5, 2.7], hue: () => 232 + Math.random() * 16 },
    weaver:   { hp: 1,   score: 12, size: 30, vy: [1.5, 2.7], hue: () => 276 },
    shooter:  { hp: 1.5, score: 15, size: 30, vy: [1.2, 1.8], hue: () => 318 },
    spinner:  { hp: 2,   score: 20, size: 32, vy: [1.1, 1.5], hue: () => 212 },
    diver:    { hp: 1,   score: 18, size: 28, vy: [2.2, 2.8], hue: () => 350 },
    sniper:   { hp: 1.5, score: 25, size: 30, vy: [0.7, 0.9], hue: () => 262 },
    splitter: { hp: 2.5, score: 30, size: 42, vy: [0.9, 1.2], hue: () => 148 },
    elite:    { hp: 3,   score: 50, size: 48, vy: [0.9, 0.9], hue: () => 88 },
    /* 扩容期三款。hue() 一律返回常量 —— 只有 straight 允许消耗 Math.random()，
     * 多一次 RNG 调用就会把种子化冒烟里所有实体的轨迹整体平移（S16 纪律）。
     *
     * 值得记一笔的约束：可用色相盘已经很挤了（禁 12-24 敌弹带、禁 175-200 玩家带、
     * 避让 ~45 道具金，剩下的还要跟已有 8 款拉开距离）。所以这三款的辨识度
     * 主要压在「剪影」上而不是颜色上 —— 炮台是方底座、冲锋机是尖锥、弧线机是弯翼。
     * 后续再加机型时应当优先考虑造型语言，色相已经接近饱和。 */
    turret:   { hp: 2.5, score: 28, size: 34, vy: [0.9, 1.1], hue: () => 118 },
    kamikaze: { hp: 1,   score: 22, size: 26, vy: [3.4, 4.2], hue: () => 300 },
    curver:   { hp: 1.5, score: 24, size: 32, vy: [1.0, 1.4], hue: () => 246 },
    /* 漂移陨石：不是"敌机"而是"地形"，复用 enemies 池纯粹是为了不新开一条池
     * （S18 零扩容门）。hue 34 是暖岩褐 —— 落在敌弹危险带 12-24 之外、也避开
     * 道具金 ~45，玩家不会把石头误读成"能吃的"或"会打你的"。
     * hp 6 / score 40：够硬到必须绕，又不至于逼玩家停火硬啃。 */
    rock:     { hp: 6,   score: 40, size: 52, vy: [0.8, 1.4], hue: () => 34 },
  };
  function spawnEnemy() {
    const v = Math.min(1, game.score / 500 + game.wave * 0.05);
    const st = game.stage;
    const w = {
      straight: 40, weaver: 18, shooter: 12 + 10 * v, elite: 3 + st,
      spinner: st >= 2 ? 11 : 0, diver: st >= 2 ? 9 : 0,
      sniper: st >= 3 ? 8 : 0, splitter: st >= 4 ? 7 : 0,
      turret: st >= 2 ? 8 : 0, kamikaze: st >= 3 ? 9 : 0, curver: st >= 4 ? 8 : 0,
      // 陨石只在 S2「陨石带」/ S5「相位回廊」出现：权重 7 ⇒ 同屏平均 2~3 块。
      // Boss 波不调用 spawnEnemy，天然不会和 Boss 抢画面（GDD §3.6 边缘情况 1）。
      rock: (st === 2 || st === 5) ? 7 : 0,
    };
    let type = 'straight';
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    for (const k in w) { pick -= w[k]; if (pick <= 0) { type = k; break; } }
    const stt = ENEMY_STATS[type];
    const baseX = Math.random() * (W - 70) + 35;
    const waveHp = 1 + (game.wave - 1) * 0.06;
    // 字段赋值顺序 == 改动前对象字面量的求值顺序，保证 Math.random() 调用次序不变
    const en = POOL.enemies.get();
    en.type = type; en.x = baseX; en.baseX = baseX; en.y = -stt.size;
    en.w = stt.size; en.h = stt.size;
    en.vy = (stt.vy[0] + Math.random() * (stt.vy[1] - stt.vy[0])) * game.diff.speedMul;
    en.hp = Math.max(1, Math.round(game.diff.hp * stt.hp * waveHp));
    en.hue = stt.hue();
    en.score = stt.score;
    en.phase = Math.random() * Math.PI * 2;
    en.fireT = 0;
    en.lockT = 0; en.diving = false; en.dvx = 0; en.dvy = 0; en.hover = false;
    en.flash = 0;
    en.minion = 0; en.spin = 0;
    en.px = en.x; en.py = en.y;
    game.enemies.push(en);
  }

  /* ---- Boss 召唤 ----------------------------------------------------
   * 召唤类 Boss（巨蝎 / 母舰）是最容易把敌机池撑爆的路径：一次多召几只、
   * 玩家又清不掉，几分钟就能叠出几百个实体。所以这里卡两道：
   *   ① 硬上限 MAX_MINIONS，在场召唤物满了就直接不召（宁可弱一点也不许突破）；
   *   ② 只召 hue() 返回常量的机型 —— straight 的 hue() 会消耗一次 Math.random()，
   *      Boss 招式若走它，种子化冒烟里所有实体的轨迹都会被整体平移。
   * ------------------------------------------------------------------- */
  const MAX_MINIONS = 6;
  function countMinions() {
    let c = 0;
    for (let i = 0; i < game.enemies.length; i++) if (game.enemies[i].minion) c++;
    return c;
  }
  function spawnMinion(type, x, y) {
    const stt = ENEMY_STATS[type] || ENEMY_STATS.shooter;
    const en = POOL.enemies.get();
    en.type = type; en.x = x; en.baseX = x; en.y = y;
    en.w = stt.size; en.h = stt.size;
    // 速度取区间中点：召唤路径全程零 RNG
    en.vy = (stt.vy[0] + stt.vy[1]) * 0.5 * game.diff.speedMul;
    en.hp = Math.max(1, Math.round(game.diff.hp * stt.hp));
    en.hue = stt.hue();
    en.score = stt.score;
    en.phase = 0; en.fireT = 0;
    en.lockT = 0; en.diving = false; en.dvx = 0; en.dvy = 0; en.hover = false;
    en.flash = 0;
    en.minion = 1; en.spin = 0;
    en.px = en.x; en.py = en.y;
    game.enemies.push(en);
  }
  function subFire(b, type, n) {
    let room = MAX_MINIONS - countMinions();
    if (room <= 0) return;
    if (n > room) n = room;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? (i / (n - 1)) : 0.5;
      spawnMinion(type, b.x + (t - 0.5) * b.w * 1.05, b.y + b.h * 0.30);
    }
    audio.boss();
  }

  // ---- M6 道具 ----
  /* 掉落表。★ RNG 纪律：顶部这一次 Math.random() 是本函数唯一的随机源，
   * 加 C/G 只改「r → type」的映射，调用次数不变（S16 种子化冒烟依赖调用次序）。
   * 总掉率 17.5% → 21.5%：多出来的 4pt 主要是分数（C）而非能力，难度曲线不动。 */
  function dropItem(x, y, force) {
    const r = Math.random();
    let type = null;
    if (force) type = r < 0.42 ? 'P' : (r < 0.66 ? 'S' : (r < 0.86 ? 'B' : 'C'));
    else if (r < 0.15) type = 'P';   // Tier 2（平衡）：P 掉率 0.09 → 0.15（本构建无难度档，取 normal 档）
    else if (r < 0.19) type = 'S';
    else if (r < 0.22) type = 'B';
    else if (r < 0.235) type = 'L';
    else if (r < 0.265) type = 'C';   // 金币 3%
    else if (r < 0.275) type = 'G';   // 散射 1%
    if (!type) return;
    const hue = type === 'P' ? 200 : type === 'S' ? 155 : type === 'B' ? 40
              : type === 'L' ? 0   : type === 'C' ? 46  : 285;
    const it = POOL.items.get();
    it.x = x; it.y = y; it.vy = 2.2; it.type = type; it.hue = hue; it.r = 11; it.dead = false;
    it.px = x; it.py = y;
    game.items.push(it);
  }
  function applyItem(type, now) {
    if (type === 'P') game.power = Math.min(5, game.power + 1);
    else if (type === 'S') player.shieldUntil = now + 8000;
    else if (type === 'B') game.bombs = Math.min(9, game.bombs + 1);
    else if (type === 'L') game.lives = Math.min(9, game.lives + 1);
    /* C 金币：即时分数，吃当前连击倍率（与 onEnemyKilled 同一条公式）。
     * 偏差备案：GDD §3.7 原式还乘了 focusMul = (now < game.focusUntil) ? 1.5 : 1，
     * 但本代码库没有 focus（集中射击）机制、game.focusUntil 字段不存在。
     * 不臆造机制 —— 此处只取 combo 项，focus 项待 focus 系统落地后再补。 */
    else if (type === 'C') {
      const cm = 1 + Math.min(game.combo - 1, 30) * 0.1;
      game.score += Math.round((80 + game.stage * 40) * cm);
    }
    // G 散射枪：8 秒形态变化，覆盖（而非叠加）power 分支，到期自动恢复
    else if (type === 'G') game.spreadUntil = now + 8000;
    explode(player.x, player.y, type === 'L' ? 0 : 200);
    audio.power();
  }
  function onEnemyKilled(en, now) {
    explode(en.x, en.y, en.hue);
    addRing(en.x, en.y, en.hue, en.w * 1.8);
    audio.explosion();
    // 连击：3 秒内连续击杀累积，得分按倍率加成（最高约 4 倍）
    game.combo = (now < game.comboUntil) ? game.combo + 1 : 1;
    game.comboUntil = now + 3000;
    if (game.combo > game.maxCombo) game.maxCombo = game.combo;
    let mult = 1 + Math.min(game.combo - 1, 30) * 0.1;
    // 擦弹加成：乘在连击倍率之后（叠乘不叠加）。
    // 顺序有意义 —— 连击奖励"打得快"，擦弹奖励"站得险"，两者是独立维度，
    // 相乘才能让"边贴弹边连杀"这个最高难度的打法拿到应得的峰值收益。
    if (now < game.grazeBoostUntil) mult *= GRAZE_SCORE_MUL;
    game.score += Math.round(en.score * mult);
    addSkillCharge(0.028);              // 2c-1 · 技能充能：击杀 +0.028 × 连击修正
    dropItem(en.x, en.y, en.type === 'elite');
    // 分裂母体：死亡产出 3 架小无人机
    if (en.type === 'splitter') {
      for (let i = -1; i <= 1; i++) {
        const d = POOL.enemies.get();
        d.type = 'straight'; d.x = en.x + i * 30; d.baseX = en.x + i * 30; d.y = en.y;
        d.w = 24; d.h = 24;
        d.vy = (1.6 + Math.random()) * game.diff.speedMul;
        d.hp = 1; d.hue = 120; d.score = 8;
        d.phase = Math.random() * Math.PI * 2;
        d.fireT = 0; d.lockT = 0; d.diving = false; d.dvx = 0; d.dvy = 0; d.hover = false; d.flash = 0;
        d.px = d.x; d.py = d.y;
        game.enemies.push(d);
      }
    }
  }

  // ---- 炸弹 ----
  function triggerBomb() {
    if (game.bombs <= 0) return;
    game.bombs--;
    for (let i = 0, n = game.enemies.length; i < n; i++) {
      const en = game.enemies[i];
      explode(en.x, en.y, en.hue); dropItem(en.x, en.y, false);
    }
    clearList(game.enemies, POOL.enemies);
    clearList(game.ebullets, POOL.ebullets);
    game.score += 50;
    audio.bomb();
    game.shake = 18;
    addRing(player.x, player.y, 200, Math.max(W, H) * 0.6);
  }

  // ---- 2c-1 · 技能释放框架（六款效果在 2c-2 接入，此处只留桩）----
  // 释放后防连点锁(ms)。任务建议 4000ms 安全默认；GDD §1.0 记 SKILL_LOCK=500ms。
  // 取值待主理人确认（⚠ 决策点）—— 因充能需 ~20-30s 重满，锁定时长对玩法无实质影响。
  const SKILL_CD = 4000;
  // ready：充能满(>=1) 且 不在冷却锁内。now 用逻辑时钟，与 startGame 同源。
  function ready(now) {
    return game.skillCharge >= 1 && now >= game.skillCdUntil;
  }
  // 充能累加（确定性，零 RNG）。base 为单次增量，乘连击修正（上限 ×1.30），封顶 1.0。
  function addSkillCharge(base) {
    if (game.state !== STATE.PLAYING) return;
    const cm = Math.min(1.30, 1 + Math.min(game.combo, 30) * 0.01);
    game.skillCharge = Math.min(1, game.skillCharge + base * cm);
  }
  // useSkill：框架（守卫 + 扣充能 + 冷却）已就绪，此处按当前皮肤 id 分发六款效果（2c-2）。
  // 全部零 RNG、零新建池：发弹走 bullets 池、环爆走 rings 池、波次走 game.skillWaves 定长数组。
  function useSkill(now) {
    if (!ready(now)) return false;            // 充能未满 / 冷却中 → 不释放
    game.skillCharge = 0;                       // 一次性消费，禁止囤积
    game.skillCdUntil = now + SKILL_CD;
    // 皮肤 id → 招牌技能（自定义皮肤 c_* 无 skill 字段，兜底 overdrive，与 GDD §1.4-A 一致）
    const sid = (DJFE.skins && DJFE.skins.currentId) ? DJFE.skins.currentId() : 'cyan_knight';
    switch (sid) {
      case 'cyan_knight':                        // 超载齐射：2.0s 内 shoot 间隔 ×0.6（只加快节拍）
        game.overdriveUntil = now + 2000;
        break;
      case 'crimson_falcon':                     // 灼焰突刺：0.6s 穿透射流 + 0.6s 无敌
        game.dashUntil = now + 600;
        player.invulnUntil = Math.max(player.invulnUntil, now + 600);
        break;
      case 'emerald': {                          // 蜂群锁定：瞬发 12 颗强追踪弹（目标由 homingSteer 按最近敌分配）
        const sx = player.x, sy = player.y - 20;
        for (let i = 0; i < 12; i++) addBullet(sx, sy, -8, 4, 0, 'homing', { turn: 0.12, ttl: 150, dmg: 1.0 });
        break;
      }
      case 'violet':                             // 贯穿光矛：瞬发 1 道驻留竖向光柱（vy=0 全屏纵向，每拍结算）
        addBullet(player.x, player.y - 20, 0, 15, 0, 'beam', { ttl: 48, pierce: 99, dmg: 0.80 });
        break;
      case 'stealth':                            // 幽影潜行：3.0s 潜行（豁免伤害 + 擦弹翻倍），出潜环爆由 step 结算
        game.cloakUntil = now + 3000;
        player.invulnUntil = Math.max(player.invulnUntil, now + 3000);
        break;
      case 'golden': {                           // 圣裁连爆：5 波延迟环爆（每 12 步一波 / r100 / 5 伤），波次坐标释放时确定
        const tgt = game.boss || game.enemies[0];
        const tx = tgt ? tgt.x : player.x;
        const ty = tgt ? tgt.y : player.y - 200;
        for (let i = 0; i < game.skillWaves.length; i++) {
          const w = game.skillWaves[i];
          w.atX = tx; w.atY = ty; w.fireAt = now + i * 12 * STEP; w.used = false;
        }
        break;
      }
      default:                                   // 自定义皮肤兜底：超载齐射
        game.overdriveUntil = now + 2000;
    }
    return true;
  }

  // ---- 粒子 & 冲击波环 ----
  function explode(x, y, hue) {
    /* 方向 B 的爆炸走「分层」而不是「更亮」：
     *   高速线性火花（前 5 颗，拖尾明显）→ 火芯余烬（中 6 颗）→ 慢速沉降烟尘（尾 7 颗）。
     *   三层拉开速度 / 寿命差，才读得出「炸开 → 散去」的过程感；
     *   原实现 18 颗同速同寿命，观感是一次性闪光，没有余韵。
     * ⚠ 两条硬约束，改动时不可破：
     *   ① 粒子总数仍为 18+1 —— 对象池零扩容门（D4/S18）按容量卡死；
     *   ② 每颗仍固定消耗 2 次 Math.random() —— 特效层不得平移种子序列。 */
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;       // RNG ①
      const r = Math.random();                       // RNG ②
      const spark = i < 5;                           // 前 5 颗：高速线性火花
      const mid = i < 11;                            // 中段：火芯余烬
      const spd = spark ? (4 + r * 5) : (mid ? (0.8 + r * 3) : (0.4 + r * 1.6));
      const life = spark ? 0.5 : (mid ? 0.9 : 1);
      const hu = spark ? hue + 20 : (mid ? hue + 6 : hue - 14);   // 内暖外沉
      addParticle(x, y, Math.cos(a) * spd, Math.sin(a) * spd, life, hu);
    }
    // 火芯：跟随本体色相的暖芯（同样避免每次爆炸都闪同一点白）
    addParticle(x, y, 0, 0, 0.8, hue + 28);
  }
  /* 命中冲击（hit-feedback §3/§5 · 美术语言 §1）：每一次成功命中都先在这一帧出
   * 一道「武器色方向性碎片条 + 近白闪核（+ 仅 L 档微冲击环）」的锋利 tick，再判致命。
   * 根除「有的战机打到敌机无特效 / 非致命才出火花 / 特效太水就一个圈」三类 bug。
   *
   * 三条硬纪律（与 GDD 约束逐字对齐）：
   *   ① S16 零渲染 RNG —— 角度全由确定性黄金角相位推导（ei × G），速度按奇偶取上下限，
   *      全程不调用 Math.random()，不平移全局随机种子（explode 的 RNG 保持原样不变）。
   *   ② S18 零扩容 —— 碎片条/闪核复用 particles 池（cap 7000），微环复用 rings 池（cap 96）；
   *      微环仅当 game.rings.length < RING_FX_BUDGET(80) 才出，超预算只丢环、不丢粒子、不掉伤害。
   *   ③ §6 尺寸守区间 —— sz₀∈[4,9]、微环 maxR∈[12,30]、碎片条 ar≥4（不退化回圆）。
   *
   * 档位按 b.kind 推导（§3.4）：dot/homing/arc→M，fan→S，laser/ring→L（ring 直击）。
   * beam（violet 技能变体）不适用离散命中档（§9 未决 3），强制轻量档、低频 tick。 */
  let _beamRingFrame = -999;   // S2：beam 周期微环全局节流锚（runFrames 单调、跨局连续，无需随 startGame 复位）
  function spawnHitImpact(b, en, ei, now, mode) {
    const kind = b.kind || '';
    let N, spdMin, spdMax, sz0, microRing, life, ar;
    if (mode === 'beam') {
      // beam 强制轻量档（§9 未决 3）：淡火花，由命中循环每 3 逻辑步节流一次。
      // sz0 取 4 以对齐 GDD §6 硬下限 sz₀≥4（复核后由主理人拍板，原 3 低于下限）。
      N = 1; spdMin = 0.8; spdMax = 1.2; sz0 = 4; microRing = 0; life = 0.4; ar = 3;
    } else {
      switch (kind) {
        case 'fan':   N = 4; spdMin = 1.6; spdMax = 2.8; sz0 = 4.5; microRing = 0;  life = 0.62; ar = 4; break; // S 轻击
        case 'homing':
        case 'arc':
        case '':      N = 6; spdMin = 2.4; spdMax = 4.0; sz0 = 5.8; microRing = 0;  life = 0.70; ar = 5; break; // M 标准
        case 'laser':
        case 'ring':  N = 8; spdMin = 3.0; spdMax = 5.2; sz0 = 7.5; microRing = 24; life = 0.80; ar = 7; break; // L 重击
        default:      N = 6; spdMin = 2.4; spdMax = 4.0; sz0 = 5.8; microRing = 0;  life = 0.70; ar = 5; break; // M 兜底
      }
    }
    // 确定性角度（S16 禁 RNG）：黄金角相位，按受击敌机下标错开，零种子平移、跨帧率逐位一致
    const G = 2.399963;
    const phase = (ei * G) % (2 * Math.PI);
    const invN = N > 0 ? 1 / N : 0;
    for (let k = 0; k < N; k++) {
      const ak = k * invN * 2 * Math.PI + phase;
      // 速度确定性：偶数取下限、奇数取上限（无 Math.random）
      const spd = (k % 2 === 0) ? spdMin : spdMax;
      addParticle(b.x, b.y, Math.cos(ak) * spd, Math.sin(ak) * spd, life, b.hue, 'streak', sz0, ar);
    }
    // 闪核：近白高亮小核（走普通圆绘制，a>0.5 出白热芯 → 读成「咬到了」）
    addParticle(b.x, b.y, 0, 0, 0.55, b.hue, '', sz0 * 0.42, 0);
    // 微冲击环（仅 L 档 + 非 beam）：复用 rings 池，受 RING_FX_BUDGET 水位守护（S18）
    if (microRing > 0 && mode !== 'beam') {
      if (game.rings.length < RING_FX_BUDGET) addRing(b.x, b.y, b.hue, microRing);
    }
    // 周期微环（beam 专用，✅ S2 已拍板启用）：每 24 逻辑步出一道淡环，给连续 beam 可见"连接"脉冲。
    // 全局节流（_beamRingFrame）不随单帧命中敌数放大；纯 FX、零行为差，受 RING_FX_BUDGET 守护。
    if (mode === 'beam') {
      if (game.runFrames - _beamRingFrame >= 24) {
        _beamRingFrame = game.runFrames;
        if (game.rings.length < RING_FX_BUDGET) addRing(b.x, b.y, b.hue, 16, 0.22);
      }
    }
  }
  /* T3-7 · Boss 崩落：死亡瞬间按舰体几何碎裂成板片，铺在 60 发 explode 之上。
   * 与 explode() 的分工：explode 是「火」（随机爆散的高温火花），崩落是「壳」
   * （沿轮廓等角脱落、偏冷偏暗的板片）。两层叠起来才读得出"炸开 + 解体"，
   * 只有火的话 Boss 死得像个大号杂兵。
   *
   * 三条硬约束：
   *   ① 零 RNG —— 虽然这里在 step() 内、用 Math.random() 并不违反 S16，但那会
   *      平移全局随机序列，让六款既有 Boss 的爆炸形状全部改样。几何驱动既守住
   *      "不破坏既有 Boss"，又顺带让崩落方向在六档刷新率下逐位一致。
   *   ② 24 颗，落在 particles 池（cap 7000）现有预算内。同帧 explode 已经吃掉
   *      60×19=1140 颗，再加 24 颗离上限还有一大截 —— 不调 cap（S18 grown===0）。
   *   ③ life ≤ 1 —— 粒子绘制拿 life 直接当 globalAlpha，超过 1 会把混合打爆。 */
  const COLLAPSE_N = 24;
  function bossCollapse(b) {
    const kseed = (b.kind || '').length * 0.37;       // 款别决定碎裂朝向：同款每次一致，异款各碎各的
    const rx = (b.w || 60) * 0.42, ry = (b.h || 60) * 0.46;
    const hue = Number.isFinite(b.hue) ? b.hue : 10;
    for (let i = 0; i < COLLAPSE_N; i++) {
      const a = (i / COLLAPSE_N) * Math.PI * 2 + kseed;
      const ring = i % 3;                              // 0 内 / 1 中 / 2 外：三层依次脱壳
      const rr = 0.34 + 0.33 * ring;
      const spd = 1.5 + 1.15 * ring;                   // 外层板片飞得更远，解体才有层次
      const ca = Math.cos(a), sa = Math.sin(a);
      addParticle(
        b.x + ca * rx * rr, b.y + sa * ry * rr,
        ca * spd, sa * spd - 0.5,                      // -0.5 略微上抛：随后 vy+=0.03 的重力把它压回来，读得出抛落感
        0.72 + 0.09 * ring,                            // ≤0.90，守住 life≤1
        hue - 16 + ring * 12                           // 壳片比火焰冷一档，和 explode 的暖芯分得开
      );
    }
  }
  function addRing(x, y, hue, maxR, alpha) {
    const rg = POOL.rings.get();
    rg.x = x; rg.y = y; rg.r = 8; rg.maxR = maxR; rg.life = 1; rg.hue = hue;
    rg.alpha = (alpha != null) ? alpha : null;   // S2：beam 周期微环淡环(alpha=0.22)；其余环回落旧行为
    rg.pr = rg.r;
    game.rings.push(rg);
  }

  // ---- 输入回调 (由 core.js 在手势/按键时触发) ----
  DJFE._onPointerDown = () => { if (game.state === STATE.PLAYING) triggerBomb(); };
  // 2c-1 · 技能触发入口：输入(Shift/右键/#btnSkill)只置标志，step 内消费（S16 确定性）。
  DJFE._onSkill = () => { if (game.state === STATE.PLAYING) game.skillQueued = true; };
  DJFE._onEscape = () => {
    if (game.state === STATE.PLAYING) setState(STATE.PAUSED);
    else if (game.state === STATE.PAUSED) setState(STATE.PLAYING);
  };

  // ---- 主循环 ----
  let last = performance.now();
  let acc = 0;              // 尚未消化的真实时间(ms)
  let _pauseLogicAt = 0;    // BUG-02：暂停起点的逻辑时刻（logicNow），恢复时据此顺延增益
  let starSteps = 0;        // 待推进的星空步数（在 drawBackground 里消化，保持 Math.random 调用次序不变）
  let renderAlpha = 0;      // 渲染外插系数 [0,1)
  let interpOn = true;      // 高刷下的运动外插；60Hz 时 alpha≈0，自动不生效

  /* ---- 性能 HUD（默认关闭；F3 或 DJFE.__debug.perfHud(true) 打开） ----
   * 只在打开时才做 performance.now() 采样，关闭状态对主循环零开销。 */
  const perf = {
    on: false,
    fps: 0, frame: 0, step: 0, render: 0, steps: 0,
    _frames: 0, _fAcc: 0, _sAcc: 0, _rAcc: 0, _stAcc: 0, _t0: 0,
  };
  function perfSample(frameDt, tStep0, tRender0, nSteps) {
    const t1 = performance.now();
    perf._frames++;
    perf._fAcc += frameDt;
    perf._sAcc += tRender0 - tStep0;
    perf._rAcc += t1 - tRender0;
    perf._stAcc += nSteps;
    if (t1 - perf._t0 >= 500) {
      const k = perf._frames || 1;
      perf.fps = Math.round((perf._frames * 1000) / (t1 - perf._t0));
      perf.frame = perf._fAcc / k;
      perf.step = perf._sAcc / k;
      perf.render = perf._rAcc / k;
      perf.steps = perf._stAcc / k;
      perf._frames = 0; perf._fAcc = 0; perf._sAcc = 0; perf._rAcc = 0; perf._stAcc = 0;
      perf._t0 = t1;
    }
  }
  function poolStats() {
    const o = {};
    for (const k in POOL) { const p = POOL[k]; o[k] = { used: p.used, peak: p.peak, cap: p.cap, grown: p.grown, gets: p.gets }; }
    return o;
  }
  function drawPerfHud() {
    const lines = [
      'FPS ' + perf.fps + '   frame ' + perf.frame.toFixed(2) + 'ms',
      'step ' + perf.step.toFixed(2) + 'ms x' + perf.steps.toFixed(2) + '/frame   render ' + perf.render.toFixed(2) + 'ms',
      'logic ' + HZ + 'Hz  tick ' + game.runFrames + '  a=' + renderAlpha.toFixed(2) + (interpOn ? '' : ' (interp off)'),
    ];
    let grown = 0;
    for (const k in POOL) {
      const p = POOL[k];
      grown += p.grown;
      lines.push('  ' + k.padEnd(10) + String(p.used).padStart(4) + ' / peak ' + String(p.peak).padStart(4) + ' / cap ' + String(p.cap).padStart(4) + (p.grown ? '  GROWN ' + p.grown : ''));
    }
    ctx.save();
    ctx.setTransform((DJFE.dpr && DJFE.dpr()) || 1, 0, 0, (DJFE.dpr && DJFE.dpr()) || 1, 0, 0);   // 不受屏震 translate 影响（按 DPR 缩放保持清晰）
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let wMax = 0;
    for (const l of lines) wMax = Math.max(wMax, ctx.measureText(l).width);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(6, 6, wMax + 14, lines.length * 14 + 10);
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = (i >= 3 && grown > 0 && lines[i].indexOf('GROWN') >= 0) ? '#ff6b6b' : (i === 0 ? '#7dff9b' : '#cfe3ff');
      ctx.fillText(lines[i], 13, 11 + i * 14);
    }
    ctx.restore();
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F3') { perf.on = !perf.on; perf._t0 = performance.now(); e.preventDefault(); }
  });

  // 记下本步之前的位置，供渲染外插使用（不参与任何逻辑判定）
  function snapMark(list) {
    for (let i = 0; i < list.length; i++) { const o = list[i]; o.px = o.x; o.py = o.y; }
  }
  /* ===================================================================
   * P2a · BULLET_KINDS 子弹形态库（design/gdd/variety-v2.md §2）
   * -------------------------------------------------------------------
   * 一套形态库，玩家弹与敌弹共享；形态只回答「弹长什么样 + 怎么飞」，
   * 「一次发几发 / 怎么铺角度」属于 pattern，是 profile 的另一维（§2.5）。
   *
   * 下表是 **Phase 2b 的数据源**（皮肤 weapon profile → kind + 数值），
   * 本阶段只用它做 kind 合法性校验；发射参数一律由调用方经 addBullet 的
   * opt 显式传入，表里的数值不会被自动套用 —— 所以本阶段行为零变化。
   * 数值取自 GDD §7.1 / §6.2 的 DPS 校准矩阵。
   * =================================================================== */
  const BULLET_KINDS = {
    // kind      r   dmg   pierce  av      ttl  blastR turn     语义
    dot:    { r: 4,  dmg: 1.00, pierce: 0, av: 0,     ttl: 0,   blastR: 0,  turn: 0 },
    laser:  { r: 4,  dmg: 1.40, pierce: 2, av: 0,     ttl: 0,   blastR: 0,  turn: 0 },
    arc:    { r: 4,  dmg: 1.00, pierce: 0, av: 0.014, ttl: 0,   blastR: 0,  turn: 0 },
    homing: { r: 4,  dmg: 1.00, pierce: 0, av: 0,     ttl: 90,  blastR: 0,  turn: 0.035 },
    fan:    { r: 4,  dmg: 0.75, pierce: 0, av: 0,     ttl: 0,   blastR: 0,  turn: 0 },
    pulse:  { r: 5,  dmg: 1.20, pierce: 0, av: 0,     ttl: 26,  blastR: 55, turn: 0 },
    ring:   { r: 5,  dmg: 1.20, pierce: 0, av: 0,     ttl: 26,  blastR: 55, turn: 0 },
    beam:   { r: 15, dmg: 1.00, pierce: 0, av: 0,     ttl: 48,  blastR: 0,  turn: 0 },
  };
  /* ===================================================================
   * P2b · SKIN_WEAPONS 皮肤武器配装表（design/gdd/variety-v2.md §1.3 / §6.2）
   * -------------------------------------------------------------------
   * 「皮肤 = 机型 + 武器 profile」。武器**由皮肤 id 确定性推导**：
   * 表以 id 为键，查不到（自定义 c_* 皮肤 / 旧存档 / 拼错）一律兜底
   * cyan_knight（GDD §1.4-A 保底方案）。因此**零新增存档字段** ——
   * localStorage 里仍然只有 djfe_skins.selected 这一个 id。
   *
   * 字段：
   *   kind    形态标识，直接进 addBullet 的第 6 参。
   *           ⚠ cyan_knight 刻意是空串而不是 'dot' —— addBullet 里
   *           `b.kind = kind || ''`，只有空串才能让「弹对象逐字段」与 P2a 前
   *           完全相同（向后兼容硬门：cyan 的 2D 绘制指纹必须逐位一致）。
   *   pattern 发射方式，决定走 firePattern 的哪条分支；'dot' 是唯一
   *           **不进** firePattern 的值 —— 它原样落回下面 shoot() 里那段
   *           一字未动的 power 分支。
   *   dmg/sp/r 单发伤害 / 初速(px per step，正数，发射时取负) / 半径。
   *   turn/ttl/blastR 由各 pattern 分支按需取用。
   *
   * p1~5 的发数与角度全部来自 GDD §1.3 的 pattern 行；DPS 校准见 §6.2
   * （p3 单目标全部落在 [17.0, 22.0] 的 C1 收敛带内）。
   * =================================================================== */
  const SKIN_WEAPONS = {
    // id                kind      pattern   dmg   sp  r   备注（p3 单目标理论 DPS）
    cyan_knight:    { kind: '',       pattern: 'dot',    dmg: 1.00, sp: 11, r: 4, hue: 190 },                      // 21.42 基线
    crimson_falcon: { kind: 'fan',    pattern: 'fan',    dmg: 0.75, sp: 11, r: 4, hue: 354 },                      // 21.42（贴脸全中）
    emerald:        { kind: 'homing', pattern: 'para',   dmg: 1.00, sp: 9,  r: 4, hue: 152, turn: 0.035, ttl: 150 }, // 21.42
    violet:         { kind: 'laser',  pattern: 'pierce', dmg: 1.40, sp: 14, r: 3, hue: 259 },                      // 20.00
    stealth:        { kind: 'arc',    pattern: 'arc',    dmg: 1.00, sp: 11, r: 4, hue: 194 },                      // 21.42
    golden:         { kind: 'ring',   pattern: 'blast',  dmg: 1.20, sp: 9,  r: 7, hue: 44, ttl: 25 },             // 17.14（C1 下沿）
  };
  function weaponOf(id) {
    return (id && SKIN_WEAPONS[id]) ? SKIN_WEAPONS[id] : SKIN_WEAPONS.cyan_knight;
  }
  DJFE.weaponOf = weaponOf;   // 皮肤面板 / 排障用只读查询，不暴露可写句柄

  /* ---- 各 pattern 的 power 分档表（索引 = power 1~5，第 0 位占位不使用）----
   * 全部是模块级常量数组：发射热路径上零分配、零 RNG、逐位可复现（S16）。 */
  const DEG = Math.PI / 180;
  // fan（红隼）：发数 + 半张角(°)。GDD §1.3：2/±6 · 3/±10 · 4/±14 · 6/±18 · 7/±22
  // Tier 1（平衡）：p1 2→3(±10)、p2 3→4(±14)；p3+ 冻结不动。
  const FAN_N    = [0, 3, 4, 4, 6, 7];
  const FAN_HALF = [0, 10, 14, 14, 18, 22];
  // homing（游隼）：一律平行直发，追踪本身负责覆盖（§1.3「不做扇形」）
  // Tier 1（平衡）：p1 1→2([±8])、p2 2→3([0,±10])；p3+ 冻结不动。
  const PARA_OFFS = [null, [-8, 8], [-10, 0, 10], [-10, 0, 10], [-16, -6, 6, 16], [-19, -9, 0, 9, 19]];
  // laser（紫电）：发数少、穿透多。pierce 语义 = 本发可命中的目标总数上限（P2a 口径）
  // Tier 1（平衡）：p1 1→2(穿3)、p2 1→2(穿3)；p3+ 冻结不动。
  const LASER_OFFS = [null, [-9, 9], [-9, 9], [-9, 9], [-9, 9], [-11, 0, 11]];
  const LASER_PC   = [0, 3, 3, 2, 3, 3];
  /* arc（幽灵）：每项是 |av| 的绝对值 —— 0 表示「中路 1 发直射」，
   * 非 0 表示「左右各 1 发，av 取 ∓」。发数 = 0 的个数 + 非 0 的个数×2。
   * p1→2 · p2→2 · p3→3 · p4→4 · p5→5，与 GDD §1.3 逐档对齐。
   * Tier 1（平衡）：p1 1→3([0,±0.014])、p2 2→4([±0.014,±0.020])；p3+ 冻结不动。 */
  const ARC_AV = [null, [0, 0.014], [0.014, 0.020], [0, 0.014], [0.014, 0.020], [0, 0.014, 0.020]];
  // ring（金翼）：发数 + 环爆半径。爆开半径随档位跳变，不是线性放大（§1.3）
  // Tier 1（平衡）：p1 1→2([±10])、p2 1→2([±10])；p3+ 冻结不动。
  const RING_OFFS = [null, [-10, 10], [-10, 10], [-10, 10], [-10, 10], [-13, 0, 13]];
  const RING_R    = [0, 55, 70, 55, 85, 70];
  /* 发射参数 scratch：addBullet 内部把 opt 的字段**同步拷进**池对象后就不再持有引用，
   * 因此整局复用同一个对象是安全的，且避免了每发一次的对象分配。
   * ⚠ 纪律：每次进 firePattern 必须把全部 7 个字段显式写满（哪怕写 0），
   * 漏一个就会让本发继承上一种武器的残留参数 —— 与 addBullet 的「无条件重置」同源。 */
  const _wopt = { dmg: 1, pierce: 0, av: 0, ttl: 0, blastR: 0, turn: 0 };

  /* 按 profile 发射一轮主武器。零 RNG、零分配、纯逻辑步驱动（S16）。
   * dot 不会走到这里 —— 它留在 shoot() 里那段原始代码上，保证逐位兼容。 */
  function firePattern(prof, bx, by, p) {
    const pw = p < 1 ? 1 : (p > 5 ? 5 : p);      // 夹紧：power 越界不许索引出 undefined
    const kind = prof.kind, sp = prof.sp, r = prof.r;
    const o = _wopt;
    o.dmg = prof.dmg; o.pierce = 0; o.av = 0; o.ttl = 0; o.blastR = 0; o.turn = 0;
    if (prof.pattern === 'fan') {
      // 扇散：按半张角均匀铺开；n=1 时退化为正前方（除零护栏）
      const n = FAN_N[pw], half = FAN_HALF[pw] * DEG;
      for (let i = 0; i < n; i++) {
        const th = n > 1 ? (-half + (2 * half * i) / (n - 1)) : 0;
        addBullet(bx, by, -Math.cos(th) * sp, r, Math.sin(th) * sp, kind, o);
      }
    } else if (prof.pattern === 'para') {
      // 微追踪蜂群：平行直发，制导交给 homingSteer（转向上限 turn，ttl 到点转直线）
      o.turn = prof.turn; o.ttl = prof.ttl;
      const offs = PARA_OFFS[pw];
      for (let i = 0; i < offs.length; i++) addBullet(bx + offs[i], by, -sp, r, undefined, kind, o);
    } else if (prof.pattern === 'pierce') {
      o.pierce = LASER_PC[pw];
      const offs = LASER_OFFS[pw];
      for (let i = 0; i < offs.length; i++) addBullet(bx + offs[i], by, -sp, r, undefined, kind, o);
    } else if (prof.pattern === 'arc') {
      /* 弧波：av>0 让速度向量向右旋（vx = 11·sin(av) 由 vy 转出来），
       * 所以左侧那发取 -av。中路直射发 av=0，命中条件与 dot 一致。 */
      const avs = ARC_AV[pw];
      for (let i = 0; i < avs.length; i++) {
        const a = avs[i];
        if (a === 0) { o.av = 0; addBullet(bx, by, -sp, r, undefined, kind, o); }
        else {
          o.av = -a; addBullet(bx - 6, by, -sp, r, undefined, kind, o);
          o.av = a;  addBullet(bx + 6, by, -sp, r, undefined, kind, o);
        }
      }
    } else if (prof.pattern === 'blast') {
      // 环爆：ttl 到点自爆或命中即爆，由 blastBullet 一次性结算（直击目标不叠伤）
      o.blastR = RING_R[pw]; o.ttl = prof.ttl;
      const offs = RING_OFFS[pw];
      for (let i = 0; i < offs.length; i++) addBullet(bx + offs[i], by, -sp, r, undefined, kind, o);
    }
  }

  // 穿透弹命中后的判定冷却步数（§2.2 陷阱：弹速 14px/步 vs 敌机判定半径 13~24px，
  // 不设冷却一颗弹会连续 2~4 步打中同一架敌机，一发打出 4 次伤害）。
  const PIERCE_HIT_CD = 3;
  /* beam 是持续存在的光柱（ttl 48 步），若每步都结算就是 48 段伤害 ——
   * 必须给它一个显式的「伤害节拍」。8 步一跳 ⇒ 单目标全程最多 6 跳。
   * 这个数值是工程侧的安全缺省，不是策划标定值，Phase 2b 接皮肤时需主策复核。 */
  const BEAM_TICK_CD = 8;
  // 环爆视觉复用 rings 池（cap 96）。超过这条水位就只结算伤害不出环 ——
  // 宁可少一圈特效，也不许把池顶穿（S18 grown===0）。
  const RING_FX_BUDGET = 80;

  /* 竖条 AABB：beam 是整个形态库里唯一不用圆判定的例外（§2.7）。
   * 光柱自炮口 b.y 向屏幕上方贯穿，所以只判「横向落在带宽内」+「在炮口上方」。 */
  function beamHits(b, ex, ey, ew, eh) {
    if (ey - (eh || 0) * 0.5 > b.y) return false;
    const dx = ex - b.x;
    return (dx < 0 ? -dx : dx) < (b.r + (ew || 0) * 0.45);
  }

  /* 一次性环爆（§2.6）。硬约束三条：
   *   ① 只在触发的那一逻辑步遍历一次目标列表，之后环纯粹是视觉 —— 零新增持续判定实体；
   *   ② 直击已计伤的目标本次跳过（skip），否则贴脸射击拿双倍伤害，主导策略成立；
   *   ③ 零 RNG、零分配（skip 走模块级 scratch 数组）。 */
  const _blastSkip = [];
  function blastBullet(b, now, skip) {
    const rr = b.blastR;
    if (!(rr > 0)) return;
    const r2 = rr * rr;
    const bdmg = (b.dmg > 0) ? b.dmg : 1;
    for (let ei = 0, ne = game.enemies.length; ei < ne; ei++) {
      const en = game.enemies[ei];
      if (en.hp <= 0) continue;
      if (skip && skip.indexOf(en) >= 0) continue;
      const dx = en.x - b.x, dy = en.y - b.y;
      if (dx * dx + dy * dy > r2) continue;
      en.hp -= bdmg; en.flash = 1;
      if (en.hp <= 0) onEnemyKilled(en, now);
    }
    const bs = game.boss;
    if (bs && bs.invulnT <= 0 && !(skip && skip.indexOf(bs) >= 0)) {
      const dx = bs.x - b.x, dy = bs.y - b.y;
      if (dx * dx + dy * dy <= r2) {
        bs.hp -= (bs.dmgMul > 0 ? bs.dmgMul : 1) * bdmg;
        if (bs.hp <= 0) onBossKilled(bs);
        else {
          const K = BOSS_KINDS[bs.kind];
          if (K && K.onDamage) K.onDamage(bs);
          checkBossPhase(bs);
        }
      }
    }
    if (game.rings.length < RING_FX_BUDGET) addRing(b.x, b.y, 190, rr * 2);
  }

  /* 2c-2 · 技能范围伤害（圣裁连爆 / 幽影出潜环爆 共用）。
   * 零 RNG、零分配：遍历一次敌机 + Boss，命中即结算、不二次叠加（环爆只触发一次）。
   * 视觉复用 rings 池（addRing，受 RING_FX_BUDGET 水位保护），不新建任何池（S18）。 */
  function aoeDamage(x, y, radius, dmg, hue, now) {
    const r2 = radius * radius;
    for (let ei = 0, ne = game.enemies.length; ei < ne; ei++) {
      const en = game.enemies[ei];
      if (en.hp <= 0) continue;
      const dx = en.x - x, dy = en.y - y;
      if (dx * dx + dy * dy <= r2) {
        en.hp -= dmg; en.flash = 1;
        if (en.hp <= 0) onEnemyKilled(en, now);
      }
    }
    const bs = game.boss;
    if (bs && bs.invulnT <= 0) {
      const dx = bs.x - x, dy = bs.y - y;
      if (dx * dx + dy * dy <= r2) {
        bs.hp -= (bs.dmgMul > 0 ? bs.dmgMul : 1) * dmg;
        if (bs.hp <= 0) onBossKilled(bs);
        else { const K = BOSS_KINDS[bs.kind]; if (K && K.onDamage) K.onDamage(bs); checkBossPhase(bs); }
      }
    }
    if (game.rings.length < RING_FX_BUDGET) addRing(x, y, hue, radius * 2);
  }

  /* 微追踪转向（§2.4）。S16 三条纪律：
   *   ① 目标选择零 RNG、零不稳定排序 —— 按 game.enemies 数组序号遍历取最近，
   *      平局取序号小者（严格 `<` 比较自然满足）；
   *   ② **每步重新选目标**，绝不跨步缓存对象引用 —— 目标一旦被击杀归还池，
   *      缓存引用读到的就是下一颗实体的残留坐标（比 NaN 更难查，因为它不报错）；
   *   ③ 速度退化为 0 时兜底「朝上」，照抄 splitEbullet 的 sp0 > 1e-4 模式，杜绝 atan2 除零。 */
  function homingSteer(b) {
    let tx = 0, ty = 0, ti = -1, best = Infinity;
    for (let ei = 0, ne = game.enemies.length; ei < ne; ei++) {
      const en = game.enemies[ei];
      if (en.hp <= 0) continue;
      const dx = en.x - b.x, dy = en.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; tx = en.x; ty = en.y; ti = ei; }
    }
    if (ti < 0) {
      const bs = game.boss;
      if (!bs) { b.target = -1; return; }
      tx = bs.x; ty = bs.y; ti = -2;   // -2 = Boss（诊断口径，不参与任何计算）
    }
    b.target = ti;
    const vx0 = b.vx || 0, vy0 = b.vy || 0;
    const sp0 = Math.sqrt(vx0 * vx0 + vy0 * vy0);
    const sp = sp0 > 1e-4 ? sp0 : 11;
    const cur = sp0 > 1e-4 ? Math.atan2(vy0, vx0) : -Math.PI / 2;   // 兜底朝屏幕上方
    let d = Math.atan2(ty - b.y, tx - b.x) - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const t = b.turn;
    if (d > t) d = t; else if (d < -t) d = -t;
    const na = cur + d;
    b.vx = Math.cos(na) * sp;
    b.vy = Math.sin(na) * sp;
  }

  function snapshot() {
    snapMark(game.bullets); snapMark(game.enemies); snapMark(game.ebullets);
    snapMark(game.particles); snapMark(game.items);
    for (let i = 0; i < game.rings.length; i++) { const rg = game.rings[i]; rg.pr = rg.r; }
    player.px = player.x; player.py = player.y;
    const b = game.boss; if (b) { b.px = b.x; b.py = b.y; }
  }

  // 一个逻辑步。now/dt 来自逻辑时钟，与改动前 60fps 下的取值逐位相同，
  // 因此下面这段是从原主循环原样搬过来的，公式一个字都没动。
  function step(now, dt) {
    if (game.state === STATE.PLAYING) {
      updatePlayer(now, dt);

      // 2c-2 · 技能效果定时器（S16：全部在 step 内驱动，零 RNG）。
      // ① crimson_falcon 灼焰突刺：dashUntil 窗口内每步从机首发 1 颗穿透弹
      if (now < game.dashUntil) {
        addBullet(player.x, player.y - 20, -18, 12, 0, 'laser', { pierce: 99, dmg: 0.35, ttl: 10 });
      }
      // ② stealth 幽影潜行：cloakUntil 到期瞬间触发一次出潜环爆（r220/12 伤），清零避免重复触发
      if (game.cloakUntil > 0 && now >= game.cloakUntil) {
        aoeDamage(player.x, player.y, 220, 12, 210, now);
        game.cloakUntil = 0;
      }
      // ③ golden 圣裁连爆：skillWaves 5 波到点各触发一次环爆（r100/5 伤）
      for (let i = 0; i < game.skillWaves.length; i++) {
        const w = game.skillWaves[i];
        if (!w.used && w.fireAt > 0 && now >= w.fireAt) {
          aoeDamage(w.atX, w.atY, 100, 5, 45, now);
          game.flash = Math.min(1, game.flash + 0.15);
          w.used = true;
        }
      }

      // 2c-2 · cyan_knight 超载齐射：overdriveUntil 窗口内 shoot 间隔 ×0.6（只加快节拍，不改弹型/伤害/pattern）
      const shootIv = (now < game.overdriveUntil) ? game.shootInterval * 0.6 : game.shootInterval;
      if (now - game.lastShot > shootIv) { shoot(); game.lastShot = now; }
      // 引擎尾迹火花
      if (game.runFrames % 2 === 0) {
        addParticle(player.x + (Math.random() - 0.5) * 8, player.y + player.h * 0.4, (Math.random() - 0.5) * 0.6, 1.4 + Math.random() * 1.2, 0.5, 195);
      }

      // 波次调度
      if (game.betweenWaves) {
        if (now >= game.nextWaveAt) { beginWave(game.wave + 1, now); game.betweenWaves = false; }
      } else {
        if (game.waveRemaining > 0 && now - game.spawnTimer > game.spawnInterval) {
          spawnEnemy(); game.waveRemaining--; game.spawnTimer = now;
        }
        if (game.waveRemaining <= 0 && game.enemies.length === 0) {
          if (game.isBossWave && game.boss) {
            // Boss 未死，等待
          } else {
            game.score += game.wave * 100;
            if (game.isBossWave && game.stage >= STAGES.length) {
              setState(STATE.VICTORY);
            } else {
              game.betweenWaves = true;
              game.nextWaveAt = now + 1500;
            }
          }
        }
      }

      /* 玩家子弹推进。形态字段全 0 / 缺失时这段等价于改动前的 `y+=vy; if(vx) x+=vx`，
       * 所有形态行为一律按「逻辑步」驱动（不读 performance.now、不乘 dt、零 RNG），
       * 因此 30/60/144/240Hz 各档逐位一致（S16 帧率解耦门）。
       * 判空一律走 truthy 而不是 `!== 0`：冒烟用例会往 bullets 里塞不带扩展字段的
       * 裸标记对象（tests/run-smoke.js S16 measureBulletTravel），`undefined !== 0`
       * 会成立并把速度算成 NaN。 */
      for (let i = 0, n = game.bullets.length; i < n; i++) {
        const b = game.bullets[i];
        if (b.hitCd > 0) b.hitCd--;                 // 穿透弹命中冷却（步末置位，此处递减）
        if (b.turn) homingSteer(b);                 // homing：每步朝最近敌转 turn 上限
        if (b.av) {                                 // arc：每步旋转速度向量（与敌弹 av 同一套数学）
          const bvx = b.vx || 0;
          const c = Math.cos(b.av), sn = Math.sin(b.av);
          const nvx = bvx * c - b.vy * sn;
          b.vy = bvx * sn + b.vy * c;
          b.vx = nvx;
        }
        b.y += b.vy; if (b.vx) b.x += b.vx;
        if (b.ttl > 0 && --b.ttl === 0) {
          /* ttl 到点的语义按形态分岔：
           *   homing —— 失去制导转直线（§2.4 护栏：任何时刻都存在"跑出制导范围"这个解法）
           *   pulse/ring —— 挂环爆 latch，由下面的判定相位统一结算（与直击互斥）
           *   其余（beam / 定时消散的 laser、arc） —— 直接熄弹 */
          if (b.turn) { b.turn = 0; b.target = -1; }
          else if (b.blastR > 0) b.blast = 1;
          else b.y = -999;
        }
      }
      sweep(game.bullets, POOL.bullets, keepBulletInPlay);

      // 敌机移动 + 行为
      for (let ei = 0, en_ = game.enemies.length; ei < en_; ei++) {
        const en = game.enemies[ei];
        if (en.flash > 0) en.flash = Math.max(0, en.flash - dt * 0.012);
        /* 漂移陨石：只下落 + 横向漂移，不开火 / 不追踪 / 不俯冲（GDD §3.6）。
         * continue 跳过整条机型行为链。
         * 注意 en.y += en.vy 必须留在分支内 —— keepEnemyInPlay 只在 y > H+40
         * 时回收，若这里直接 continue 掉下落，陨石会永远停在出生点 y=-52，
         * 既进不了屏幕也永远不被 sweep，enemies 池（cap 256）会被慢慢灌满，
         * 直接踩爆 S18 零扩容门。分支内零 RNG（相位在 spawnEnemy 里已随机）。 */
        if (en.type === 'rock') {
          en.y += en.vy;
          en.phase += dt * 0.0012;
          en.x = en.baseX + Math.sin(en.phase) * 34;
          continue;
        }
        // 俯冲 / 冲锋中：沿锁定方向高速冲刺（两款共用同一段推进）
        if (en.diving && (en.type === 'diver' || en.type === 'kamikaze')) {
          en.x += en.dvx * dt * 0.06; en.y += en.dvy * dt * 0.06;
          continue;
        }
        en.y += en.vy;
        if (en.type === 'weaver') {
          en.phase += dt * 0.004;
          en.x = en.baseX + Math.sin(en.phase) * 70;
        } else if (en.type === 'shooter') {
          en.fireT += dt;
          if (en.fireT > 1300 && en.y > 0 && en.y < H * 0.7) {
            en.fireT = 0;
            const ang = Math.atan2(player.y - en.y, player.x - en.x);
            addEbullet(en.x, en.y + 10, Math.cos(ang) * 4.2, Math.sin(ang) * 4.2, 5, 'aim');
          }
        } else if (en.type === 'elite') {
          // 重装精英：3 向扇形弹（朝下扩散）
          en.fireT += dt;
          if (en.fireT > 2100 && en.y > 0 && en.y < H * 0.6) {
            en.fireT = 0;
            for (let i = -1; i <= 1; i++) {
              const a = Math.PI / 2 + i * 0.42;
              addEbullet(en.x, en.y + en.h * 0.4, Math.cos(a) * 3.6, Math.sin(a) * 3.6, 5, 'fan');
            }
          }
        } else if (en.type === 'spinner') {
          // 回旋机：旋转 + 周期性 8 向环形弹
          en.phase += dt * 0.004;
          en.fireT += dt;
          if (en.fireT > 1650 && en.y > 0 && en.y < H * 0.65) {
            en.fireT = 0;
            for (let i = 0; i < 8; i++) {
              const a = i * Math.PI / 4 + en.phase;
              addEbullet(en.x, en.y, Math.cos(a) * 3.0, Math.sin(a) * 3.0, 4, 'ring');
            }
          }
        } else if (en.type === 'diver') {
          // 俯冲机：到位→闪白锁定→高速俯冲
          en.phase += dt * 0.004;
          if (!en.diving) {
            if (en.lockT > 0) {
              en.lockT -= dt;
              if (en.lockT <= 0) {
                en.diving = true;
                const ang = Math.atan2(player.y - en.y, player.x - en.x);
                en.dvx = Math.cos(ang) * 7.5 * game.diff.speedMul;
                en.dvy = Math.sin(ang) * 7.5 * game.diff.speedMul;
              }
            } else if (en.y > H * 0.22) {
              en.lockT = 480;
            }
          }
        } else if (en.type === 'sniper') {
          // 狙击机：到高空悬停，周期发射高速狙击弹
          en.phase += dt * 0.004;
          if (!en.hover && en.y > H * 0.16) { en.hover = true; en.vy = 0; }
          if (en.hover) {
            en.x = en.baseX + Math.sin(en.phase) * 90;
            en.fireT += dt;
            if (en.fireT > 2300) {
              en.fireT = 0;
              const ang = Math.atan2(player.y - en.y, player.x - en.x);
              addEbullet(en.x, en.y + en.h * 0.5, Math.cos(ang) * 9.2, Math.sin(ang) * 9.2, 3.5, 'sniper');
            }
          }
        } else if (en.type === 'turret') {
          /* 悬停炮台：降到 1/4 屏就钉死，之后周期性三连爆发。
           * 三发是「同一次瞄准 + hold 错峰」，不是每发重新瞄准 ——
           * 后者玩家横移也躲不掉，那是不讲理，不是难。错峰后三发排成一条
           * 沿瞄准线的弹链，玩家看得出它指向哪，横穿就能过。 */
          en.phase += dt * 0.004;
          if (!en.hover && en.y > H * 0.24) { en.hover = true; en.vy = 0; }
          if (en.hover) {
            en.fireT += dt;
            if (en.fireT > 2000) {
              en.fireT = 0;
              const ang = Math.atan2(player.y - en.y, player.x - en.x);
              const vx = Math.cos(ang) * 4.6, vy2 = Math.sin(ang) * 4.6;
              for (let i = 0; i < 3; i++) {
                addEbulletEx(en.x, en.y + en.h * 0.36, vx, vy2, 5, 'aim', { hold: i * 8 });
              }
            }
          }
        } else if (en.type === 'kamikaze') {
          /* 自爆冲锋：入场即锁定一次方向，然后直线全速冲到底。
           * 只锁一次 —— 全程追踪的敌人无法用走位破解、只能靠火力清掉，
           * 那种"你躲不掉，认命吧"的设计是伪难度。锁一次，玩家侧移就能让它扑空。 */
          if (!en.diving && en.y > -en.h * 0.2) {
            en.diving = true;
            const ang = Math.atan2(player.y - en.y, player.x - en.x);
            en.dvx = Math.cos(ang) * 6.6 * game.diff.speedMul;
            en.dvy = Math.sin(ang) * 6.6 * game.diff.speedMul;
          }
        } else if (en.type === 'curver') {
          /* 弧线机：大幅正弦走位 + 抛射「会拐弯」的弹。
           * av 让弹每步整体旋转速度向量，玩家不能只按当前弹道做直线外推，
           * 必须读出曲率 —— 这是本作第一个要求"预判弯道"的杂兵。
           * 左右两发曲率相反、向内合拢成网；ttl 兜底防止弯出屏外还占着池子。 */
          en.phase += dt * 0.0035;
          en.x = en.baseX + Math.sin(en.phase) * 96;
          en.fireT += dt;
          if (en.fireT > 1800 && en.y > 0 && en.y < H * 0.62) {
            en.fireT = 0;
            for (let k = -1; k <= 1; k += 2) {
              const a = Math.PI / 2 + k * 0.55;
              addEbulletEx(en.x, en.y + en.h * 0.35, Math.cos(a) * 3.2, Math.sin(a) * 3.2, 5, 'fan',
                { av: -k * 0.012, ttl: 300 });
            }
          }
        }
      }
      // 漏怪（敌机飞出底部/侧面）直接消失，不扣命——惩罚只靠撞弹/撞机。
      // （原设计漏怪扣命过于硬核，与"零门槛"定位不符）
      sweep(game.enemies, POOL.enemies, keepEnemyInPlay);

      /* 玩家子弹 vs 敌机（P2a · 形态分支）
       * 内层长度按「每颗子弹」重新取 —— 与改动前 forEach 嵌套的语义一致：
       * 分裂母体死亡新生成的小机，不会被当前这颗子弹判定，但会被后续子弹判定。
       *
       * 形态字段全 0 时（dot / 本阶段全部皮肤）执行路径与改动前逐条等价：
       *   dmg 缺省 1 ⇒ `en.hp -= 1` 与 `en.hp--` 同一次浮点运算；
       *   pierce/blastR/hitCd 全 0 ⇒ 走 else 分支 `b.y = -999`；
       *   break 是安全的：置 -999 后 hit() 对任何在场敌机恒假（|Δy| ≥ 1000 ≫ r+w），
       *   原来的「继续空转内层」与直接 break 结果完全相同。
       *
       * 判定口径（§2.7）：beam 竖条 AABB，其余（dot/laser/arc/homing/fan/pulse/ring）
       * 一律圆判定 —— 环爆的「半径范围」不是飞行期判定，是 ttl 到点那一步的一次性结算。 */
      for (let bi = 0, nb = game.bullets.length; bi < nb; bi++) {
        const b = game.bullets[bi];
        /* ① 环爆 latch：pulse/ring 的 ttl 已在推进相位到点。在这里统一结算，
         *    保证「直击结算」与「到点自爆」永远互斥，同一颗弹只结算一次。 */
        if (b.blast) { b.blast = 0; blastBullet(b, now, null); b.y = -999; continue; }
        // ② 穿透/光柱的判定冷却：整颗弹本步不参与判定（dot 恒为 0，不受影响）
        if (b.hitCd > 0) continue;
        const bdmg = (b.dmg > 0) ? b.dmg : 1;
        const isBeam = b.kind === 'beam';
        let struck = 0;
        for (let ei = 0, ne = game.enemies.length; ei < ne; ei++) {
          const en = game.enemies[ei];
          if (en.hp <= 0) continue;
          const ok = isBeam ? beamHits(b, en.x, en.y, en.w, en.h)
                            : hit(b.x, b.y, b.r, en.x, en.y, en.w * 0.45);
          if (!ok) continue;
          // 命中冲击：每一次成功命中都先出这一帧武器色冲击（tick），再判致命（boom）。
          // 根除「弱敌一发带走无特效 / 非致命才出火花」两类 bug（hit-feedback §5）。
          en.hp -= bdmg; en.flash = 1;
          const hiMode = isBeam ? 'beam' : '';
          // beam 是持续光柱、非离散命中，按 §9 未决 3 每 3 逻辑步节流一次出淡 tick；
          // 用整数 runFrames 做节流（now 是浮点 ms 时间戳，now%3 永不为 0，会静默关掉光柱冲击）
          if (!isBeam || (game.runFrames % 3 === 0)) spawnHitImpact(b, en, ei, now, hiMode);
          if (en.hp <= 0) onEnemyKilled(en, now);
          struck++;
          if (isBeam) continue;                       // 光柱贯穿：同一步吃满带宽内所有敌机
          if (b.pierce > 0) {
            // 穿透：pierce = 本发可命中的目标总数上限（laser pierce=2 ⇒ 穿 2 架后熄）
            b.hits++;
            if (b.hits >= b.pierce) { b.y = -999; break; }
            continue;
          }
          if (b.blastR > 0) {
            /* pulse/ring 直击引爆：直击目标压进 skip，环爆不再对它二次结算。
             * 不做这一步，贴脸射击就能拿「直击 + 环爆」双份伤害，最优解退化成怼脸（§2.6 陷阱）。 */
            _blastSkip.length = 0; _blastSkip.push(en);
            blastBullet(b, now, _blastSkip);
            _blastSkip.length = 0;
            b.y = -999; break;
          }
          b.y = -999; break;                          // dot：原样熄弹
        }
        // ③ 命中冷却在步末统一置位：同一步内允许打穿一排，跨步再打同一架要等冷却
        if (struck && (isBeam || b.pierce > 0)) b.hitCd = isBeam ? BEAM_TICK_CD : PIERCE_HIT_CD;
      }
      sweep(game.bullets, POOL.bullets, keepBulletAlive);
      sweep(game.enemies, POOL.enemies, keepEnemyAlive);

      /* 敌弹推进。扩展字段全 0 时这段等价于改动前的 `x+=vx; y+=vy`，
       * 所有扩展行为一律按「逻辑步」驱动（不读 performance.now、不乘 dt），
       * 因此 30/60/144/240Hz 各档结果逐位一致（S16 帧率解耦门）。
       * 分裂新生的弹不会被本步遍历（n 已缓存），与分裂母体敌机的语义保持一致。 */
      for (let i = 0, n = game.ebullets.length; i < n; i++) {
        const eb = game.ebullets[i];
        // 判空一律走 truthy 而不是 `!== 0`：外部（冒烟用例 / 控制台）可能塞进
        // 不带扩展字段的裸敌弹对象，`undefined !== 0` 会成立并把速度算成 NaN。
        if (eb.hold > 0) { eb.hold--; continue; }   // 延迟启动：悬停定格，作预警
        if (eb.av) {                                // 角速度：整体旋转速度向量（弯曲弹 / 漩涡）
          const c = Math.cos(eb.av), sn = Math.sin(eb.av);
          const nvx = eb.vx * c - eb.vy * sn;
          eb.vy = eb.vx * sn + eb.vy * c;
          eb.vx = nvx;
        }
        if (eb.ax) eb.vx += eb.ax;
        if (eb.ay) eb.vy += eb.ay;
        eb.x += eb.vx; eb.y += eb.vy;
        /* ttl 到点：带 blastR 的（敌方 ring/pulse）挂环爆 latch，交给下面的判定相位
         * 统一结算；不带的照旧直接熄。blastR 缺省 0 ⇒ 与改动前逐条等价。 */
        if (eb.ttl > 0 && --eb.ttl === 0) { if (eb.blastR > 0) eb.blast = 1; else eb.dead = true; }
        if (eb.split > 0 && --eb.split === 0) splitEbullet(eb);
      }
      /* 敌弹 vs 玩家 + 擦弹 Graze。
       *
       * 擦弹 = 敌弹从身边"蹭"过去但没打中，攒槽换 6 秒 1.5 倍分。
       * 甜蜜带外沿 26px，内沿就是玩家判定半径 14 —— 换句话说「再近一点就死」。
       * 这条机制存在的全部意义：把「躲远点」从最优解降成次优解，逼玩家往弹幕里钻，
       * 让风险和收益挂在同一个动作上。没有它，弹幕游戏的最优策略是贴着屏幕边角苟。
       *
       * 四条实现约束：
       *   ① eb.gz 一发只记一次 —— 否则一颗慢速弹贴着飞过就能刷满整条槽；
       *   ② 无敌 / 护盾期间不计 —— 复活后的 2 秒无敌不该是白嫖擦弹槽的窗口；
       *   ③ 命中优先于擦弹：打中了就不是"擦"，continue 掉；
       *   ④ 只比平方距离不开根号 —— 这是 O(敌弹数) 的每帧热路径，峰值 400+ 发。
       */
      const cloaked = now < game.cloakUntil;   // 2c-2 · stealth 潜行期：放行擦弹 + 翻倍（见下方 gmul）
      const grazeOn = (now >= player.invulnUntil && now >= player.shieldUntil) || cloaked;
      for (let i = 0, n = game.ebullets.length; i < n; i++) {
        const eb = game.ebullets[i];
        // hold 中的弹是「预警虚影」，只画不伤 —— 否则尾刺的预警线会变成一堵秒杀墙。
        // 预警虚影同样不该给擦弹分：它还没"飞过"，蹭它没有任何风险。
        if (eb.hold > 0 || eb.dead) continue;
        /* 敌方环爆（§2.6 的敌弹侧同构实现）。三条与玩家侧一致的纪律：
         *   ① 只在 ttl 到点那一逻辑步结算一次，之后环纯粹是视觉 —— 零新增持续判定实体；
         *   ② 零 RNG、零分配（目标只有玩家一个，连 skip 数组都不需要）；
         *   ③ 环爆判定独立于圆判定：弹体本身没碰到玩家也可能被炸到，这正是它的存在意义
         *      —— 逼玩家在「弹落点」而不是「弹轨迹」上做走位。 */
        if (eb.blast) {
          eb.blast = 0; eb.dead = true;
          const brr = eb.blastR;
          const bdx = player.x - eb.x, bdy = player.y - eb.y;
          if (bdx * bdx + bdy * bdy <= brr * brr) {
            explode(player.x, player.y, 200);
            if ((now >= player.invulnUntil && now >= player.shieldUntil) && now >= game.cloakUntil) loseLife(now);
          }
          // hue 18 = 敌弹危险带（12-24）中心，复用既有色槽，不新增色键（P-8 辉光图集门）
          if (game.rings.length < RING_FX_BUDGET) addRing(eb.x, eb.y, 18, brr * 2);
          continue;
        }
        /* 注：敌弹的 eb.pierce 只为「玩家/敌方共用一张 profile 表」而存在，判定相位
         * 刻意不消费它 —— 碰到玩家一律熄弹。能穿透玩家的敌弹会在 2 秒无敌窗口里
         * 贴着机体连续判定，一发直接带走整条命，那不是难度，是 bug 观感。 */
        if (hit(eb.x, eb.y, eb.r, player.x, player.y, 14)) {
          eb.dead = true; explode(player.x, player.y, 200);
          if ((now >= player.invulnUntil && now >= player.shieldUntil) && now >= game.cloakUntil) loseLife(now);
          continue;
        }
        if (!grazeOn || eb.gz) continue;
        const gdx = eb.x - player.x, gdy = eb.y - player.y;
        const gd2 = gdx * gdx + gdy * gdy;
        if (gd2 > GRAZE_IN2 && gd2 < GRAZE_OUT2) {
          eb.gz = 1;
          game.graze++;
          /* T3-3/T3-8 统计双写。位置有讲究：紧跟在 graze++ 之后、满槽清零之前 ——
           * 清零发生在下面几行的 if 里，那时 game.graze 已经被打回 0，
           * 在那之后取 max 只会永远拿到 0。这是本次改动最容易踩的一脚。 */
          game.grazeTotal++;
          if (game.graze > game.maxGraze) game.maxGraze = game.graze;
          const gmul = cloaked ? 2 : 1;   // 2c-2 · 潜行期擦弹贡献翻倍（grazeMeter 与 skillCharge 同翻倍）
          game.grazeMeter = Math.min(1, game.grazeMeter + GRAZE_GAIN * gmul);
          addSkillCharge(0.010 * gmul);   // 2c-1 · 技能充能：擦弹 +0.010 × 连击修正（潜行期 ×2）
          if (game.grazeMeter >= 1) {
            // 满槽：进入 6 秒 1.5 倍分窗口。给足反馈（环 + 震屏），
            // 否则玩家攒了 84 次擦弹却完全不知道自己赚到了什么。
            game.grazeBoostUntil = now + GRAZE_BOOST_MS;
            game.graze = 0;
            game.grazeMeter = 0;
            addRing(player.x, player.y, 190, 120);
            game.shake = Math.max(game.shake, 6);
            audio.power();
          }
        }
      }
      sweep(game.ebullets, POOL.ebullets, keepEbullet);

      // 敌机撞玩家
      for (let i = 0, n = game.enemies.length; i < n; i++) {
        const en = game.enemies[i];
        if (hit(en.x, en.y, en.w * 0.4, player.x, player.y, 14)) {
          en.hp = 0; explode(en.x, en.y, en.hue);
          if ((now >= player.invulnUntil && now >= player.shieldUntil) && now >= game.cloakUntil) {
            explode(player.x, player.y, 200); loseLife(now);
          }
        }
      }
      sweep(game.enemies, POOL.enemies, keepEnemyAlive);

      // Boss
      if (game.boss) {
        const b = game.boss;
        const K = BOSS_KINDS[b.kind] || BOSS_KINDS.sentinel;
        if (b.y < b.ty) {
          b.y += 1.4;
        } else {
          if (b.invulnT > 0) b.invulnT = Math.max(0, b.invulnT - dt);
          K.move(b, dt, now);
          b.fireT += dt;
          // 相位爆的无敌窗口同时也是「静默窗口」：不开火，让玩家真的能喘一口
          if (b.fireT > b.fireGap && b.invulnT <= 0) { b.fireT = 0; bossFire(b); }
        }
        /* Boss vs 玩家子弹（P2a · 形态分支）。
         * 环爆 latch 不在这里处理 —— 它已在上面「玩家子弹 vs 敌机」相位被消费，
         * 而 blastBullet 内部本来就一并结算 Boss，重复一遍会打出双份伤害。
         * 伤害口径两层缺省叠乘：Boss 的 dmgMul 与弹的 dmg 各自缺省 1，
         * 全 0 场景下等价于改动前的单层 `b.hp -= dmgMul`。 */
        for (let i = 0, n = game.bullets.length; i < n; i++) {
          const bu = game.bullets[i];
          if (bu.hitCd > 0) continue;
          const isBeam = bu.kind === 'beam';
          const ok = isBeam ? beamHits(bu, b.x, b.y, b.w, b.h)
                            : hit(bu.x, bu.y, bu.r, b.x, b.y, b.w * 0.42);
          if (!ok) continue;
          if (b.invulnT <= 0) {
            b.hp -= (b.dmgMul > 0 ? b.dmgMul : 1) * (bu.dmg > 0 ? bu.dmg : 1);
            if (b.hp <= 0) onBossKilled(b);
            else { if (K.onDamage) K.onDamage(b); checkBossPhase(b); }
          }
          // 弹的存亡与 Boss 无敌无关 —— 「无敌期照样吃弹」是护盾可读性的来源，保留原口径
          if (isBeam) { bu.hitCd = BEAM_TICK_CD; continue; }
          if (bu.pierce > 0) {
            bu.hits++; bu.hitCd = PIERCE_HIT_CD;
            if (bu.hits >= bu.pierce) bu.y = -999;
            continue;
          }
          if (bu.blastR > 0) {
            _blastSkip.length = 0; _blastSkip.push(b);
            blastBullet(bu, now, _blastSkip);
            _blastSkip.length = 0;
          }
          bu.y = -999;
        }
        sweep(game.bullets, POOL.bullets, keepBulletAlive);
        if ((now >= player.invulnUntil && now >= player.shieldUntil) && now >= game.cloakUntil &&
            hit(b.x, b.y, b.w * 0.38, player.x, player.y, 14)) {
          explode(player.x, player.y, 200); loseLife(now);
        }
      }

      // 道具
      for (let i = 0, n = game.items.length; i < n; i++) {
        const it = game.items[i];
        it.y += it.vy;
        if (!it.dead && hit(it.x, it.y, it.r, player.x, player.y, 16)) {
          it.dead = true; applyItem(it.type, now);
        }
      }
      sweep(game.items, POOL.items, keepItem);

      // 粒子 + 冲击波环 + 屏震衰减
      for (let i = 0, n = game.particles.length; i < n; i++) {
        const p = game.particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.life -= 0.04;
      }
      sweep(game.particles, POOL.particles, keepParticle);
      for (let i = 0, n = game.rings.length; i < n; i++) {
        const rg = game.rings[i];
        rg.r += (rg.maxR - rg.r) * 0.12; rg.life -= 0.04;
      }
      sweep(game.rings, POOL.rings, keepRing);
      // 衰减放缓（0.88→0.905）：幅度已经压低，让它多晃两帧收得柔一点，
      // 快收会变成「咔」的一下硬顿挫，与柔调基调冲突
      if (game.shake > 0) game.shake *= 0.905;

      if (game.flash > 0) game.flash = Math.max(0, game.flash - 0.04);

      // 2c-1 · 技能触发消费（S16）：输入只置标志(game.skillQueued)，在此固定步内统一结算，
      // 保证充能/冷却逻辑全在 step、零 RNG。自动释放开关命中满槽也在此触发。
      if (game.skillQueued) { game.skillQueued = false; useSkill(now); }
      if (game.skillAuto && ready(now)) useSkill(now);

      scoreEl.textContent = game.score;
      livesEl.textContent = game.lives;
      bombsEl.textContent = game.bombs;
      if (bombCntEl) bombCntEl.textContent = game.bombs;
      waveEl.textContent = game.wave;
      powerEl.textContent = game.power;
      stageEl.textContent = game.stage;
      // 连击显示（x2 起）
      if (comboWrapEl && comboEl) {
        const ca = game.combo >= 2 && now < game.comboUntil;
        comboWrapEl.classList.toggle('hidden', !ca);
        if (ca) comboEl.textContent = game.combo;
      }
      /* 擦弹槽：加成窗口内挂 .boost（CSS 接管成余烬色满条 + 脉动），
       * 窗口外才按 grazeMeter 写宽度。这样"正在吃加成"和"正在攒槽"两种
       * 状态在同一条上不会互相顶掉。DOM id 一律 if(el) 守卫。 */
      if (grazeBarEl && grazeFillEl) {
        const boosting = now < game.grazeBoostUntil;
        grazeBarEl.classList.toggle('boost', boosting);
        if (!boosting) grazeFillEl.style.width = (game.grazeMeter * 100).toFixed(1) + '%';
      }
      /* T3-1 · 增益指示（照抄 comboWrap 的 hidden 切换模式）。
       * 当前唯一增益源是 G 道具散射窗口 game.spreadUntil。倒计时读的是主循环这
       * 同一个 now —— 与 shoot() 里 `now < game.spreadUntil` 的判定严格同源，
       * 不会出现"HUD 还剩 1s 但弹型已经收回去了"的漂移。
       * ⚠ 只读不写：本段不碰 game.power，散射与火力等级是两套东西。 */
      if (buffWrapEl && buffEl) {
        const rem = game.spreadUntil - now;
        const on = rem > 0;
        buffWrapEl.classList.toggle('hidden', !on);
        if (on) {
          const sec = Math.max(1, Math.ceil(rem / 1000));   // 向上取整：显示 0s 却还能打是更糟的谎
          buffEl.textContent = DJFE.t('buff.spread') + ' ' + sec + 's';
        }
      }
      /* 2c-2 · 技能 HUD（独立 #skillWrap，D9）。主理人裁决口径：充能 >= 50% 即显示进度条；
       * 满槽(rd)挂 .ready 金色类；#skillFill 宽度 = skillCharge*100%。全部 if(el) 守卫。 */
      if (skillWrapEl && skillFillEl && skillLabelEl) {
        const rd = ready(now);
        const show = game.skillCharge >= 0.5;
        skillWrapEl.classList.toggle('hidden', !show);
        if (show) {
          skillFillEl.style.width = (Math.min(1, game.skillCharge) * 100).toFixed(1) + '%';
          skillWrapEl.classList.toggle('ready', rd);
        }
      }
    }
  }

  /* 帧驱动：把真实经过的时间累进 acc，够一整步就跑一整步。
   * 逻辑步频恒为 60Hz，与显示器刷新率彻底解耦（D8）。 */
  function loop(now) {
    // BUG-02 修复见 setState()：暂停/恢复经唯一入口 setState，限时增益的顺延在跃迁时
    // 同步完成（S6 探针在恢复按键后立即读取，不经过下一帧 pump）。此处 loop 保持纯净。
    let frameDt = now - last;
    last = now;
    if (!(frameDt > 0)) frameDt = 0;                                  // 首帧 / 时钟回拨
    if (frameDt > STEP * MAX_CATCHUP) frameDt = STEP * MAX_CATCHUP;   // 卡顿或切后台：丢弃多余时间，不做追帧雪崩
    acc += frameDt;

    const tStep0 = perf.on ? performance.now() : 0;
    let n = 0;
    // ACC_EPS 吸收 rAF 时间戳的浮点噪声：差 1 纳秒也算够一步，否则会周期性漏步
    while (acc >= STEP - ACC_EPS && n <= MAX_CATCHUP) {
      // 命中定格（hit-stop）：重击瞬间跳过若干逻辑步、冻结世界制造"分量感"。
      // 按 STEP 扣减、与刷新率无关 —— 各档刷新率定格的逻辑步数完全一致（S16 不破）。
      if (game.hitStop > 0) {
        game.hitStop -= STEP;
        acc -= STEP;
        n++;
        continue;
      }
      const prevT = stepTime(game.runFrames);
      game.runFrames++;
      const tNow = stepTime(game.runFrames);
      snapshot();
      step(tNow, Math.min(tNow - prevT, 50));
      starSteps++;
      acc -= STEP;
      n++;
    }
    if (acc >= STEP) acc = 0;   // 兜底：真跟不上就丢弃，宁可掉速也不卡死

    renderAlpha = interpOn ? Math.min(1, Math.max(0, acc / STEP)) : 0;
    // 渲染时刻 = 最后一步的逻辑时刻 + 帧内余量。60Hz 下 alpha≈0，与改动前的 now 等价。
    const rt = T_ORIGIN + ((game.runFrames + renderAlpha) * 1000) / HZ;

    const tRender0 = perf.on ? performance.now() : 0;
    render(rt);
    if (perf.on) perfSample(frameDt, tStep0, tRender0, n);
    requestAnimationFrame(loop);
  }

  /* ---- 渲染外插 ----------------------------------------------------
   * 逻辑固定 60Hz，显示器可能是 144Hz —— 若直接画当前步的位置，同一帧状态会
   * 被重复显示 2~3 次，出现规律性抖动。这里按帧内余量 alpha 沿「上一步位移」
   * 向前外插：x + (x - px) * alpha。
   * 为什么是外插而不是教科书式插值：插值要拿 (px, x) 往回取样，会凭空引入
   * 整整一步(16.7ms)的显示延迟——本期是「手感」工作流，红线是手感不许变。
   * 外插则在 alpha=0（即 60Hz）时恒等于当前位置，零延迟、且与改动前逐位一致。
   * 代价：实体骤然变向的那一帧会有不足一步的过冲，短促不可察。
   * 做法是渲染前把插值写进 x/y、渲染后还原，避免改动 entities.js 的绘制函数。
   * ------------------------------------------------------------------ */
  function exBegin(list, a) {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      o.sx = o.x; o.sy = o.y;
      o.x = o.x + (o.x - o.px) * a;
      o.y = o.y + (o.y - o.py) * a;
    }
  }
  function exEnd(list) {
    for (let i = 0; i < list.length; i++) { const o = list[i]; o.x = o.sx; o.y = o.sy; }
  }
  function extrapolateIn(a) {
    exBegin(game.bullets, a); exBegin(game.enemies, a); exBegin(game.ebullets, a);
    exBegin(game.particles, a); exBegin(game.items, a);
    for (let i = 0; i < game.rings.length; i++) {
      const rg = game.rings[i]; rg.sr = rg.r; rg.r = rg.r + (rg.r - rg.pr) * a;
    }
    player.sx = player.x; player.sy = player.y;
    player.x += (player.x - player.px) * a;
    player.y += (player.y - player.py) * a;
    const b = game.boss;
    if (b) { b.sx = b.x; b.sy = b.y; b.x += (b.x - b.px) * a; b.y += (b.y - b.py) * a; }
  }
  function extrapolateOut() {
    exEnd(game.bullets); exEnd(game.enemies); exEnd(game.ebullets);
    exEnd(game.particles); exEnd(game.items);
    for (let i = 0; i < game.rings.length; i++) { const rg = game.rings[i]; rg.r = rg.sr; }
    player.x = player.sx; player.y = player.sy;
    const b = game.boss;
    if (b) { b.x = b.sx; b.y = b.sy; }
  }

  /* ---- 2.5D 渲染分发（3D 重平台 Phase 1 · ENG-3D-P1）------------------
   * 逻辑/碰撞/弹幕**始终**跑在 2D 平面（step() 一行未改），渲染层可换。
   * r3dActive 每帧算一次：只有「render3d.js 已加载 + window.THREE 存在 +
   * WebGL 可用 + 渲染器初始化成功」四者同时满足才为 true。
   * 无头冒烟环境三者皆不成立（stubs 的 getContext 只认 '2d'，THREE 恒 undefined，
   * 且 render3d.js 根本不在测试的 SCRIPTS 里）→ 恒为 false → 全量走原 2D 路径，
   * S16/S17/S18 口径分毫不动。
   * r3dShip 是**复用**的传参对象，热路径零分配（D4 池纪律的延伸）。 */
  let r3dActive = false;
  const r3dShip = { player, playerVisible: false, playerAlpha: 1 };
  function r3dCheck() {
    const r = DJFE.render3d;
    return !!(r && r.available() && r.init(DJFE.canvas));
  }

  // ---- 渲染 ----
  function render(now) {
    const a = renderAlpha;
    r3dActive = r3dCheck();
    if (a > 0) extrapolateIn(a);
    try {
      drawScene(now);
      // 3D 通道放在外插窗口**内**：与 2D 场景吃同一份坐标，两层不会错位一帧
      if (r3dActive) DJFE.render3d.draw(game, now, r3dShip);
    } finally {
      if (a > 0) extrapolateOut();   // 无论如何都要还原，绝不让插值坐标污染逻辑状态
    }
    if (perf.on) drawPerfHud();
  }

  function drawScene(now) {
    ctx.save();
    /* 屏震：方向 B 要的是「闷响」不是「电流」。
     * 纯随机抖动每帧跳到不相干的位置，读起来像信号故障；这里让 65% 的位移
     * 走一条连续的正弦轨迹（X/Y 频率错开，避免走成一条直线），
     * 只留 35% 给随机做毛刺，观感就从「抖」变成「晃」。
     * ⚠ 仍然固定消耗 2 次 Math.random() —— 特效层不得平移种子序列（见 explode 注释）。 */
    if (game.shake > 0.3) {
      const r1 = Math.random() - 0.5, r2 = Math.random() - 0.5;
      const s = game.shake, ph = (now || 0) * 0.045;
      // 系数刻意凑成 0.32+0.36*0.5 = ±0.5·s，与旧的 (rand-0.5)*s 峰值完全一致：
      // 这次只改「位移的形状」，不偷偷加大晃动量
      ctx.translate(
        (Math.sin(ph) * 0.32 + r1 * 0.36) * s,
        (Math.cos(ph * 1.37) * 0.32 + r2 * 0.36) * s * 0.82);
    }
    // 当前皮肤（菜单里改了立即生效）
    game.skin = (DJFE.skins ? DJFE.skins.current() : (game.skin || { trail: '#8fd4e0' }));
    const stg = STAGES[game.stage - 1] || STAGES[0];
    drawBackground(now);

    // 玩家弹：发光能量束（芯 + 辉光 + 速度拖尾，颜色随皮肤弹道色）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const tr = game.skin && game.skin.trail ? game.skin.trail : '#8fd4e0';
    /* P2a 形态分支。三条纪律：
     *   ① 零 RNG —— 渲染层一次 Math.random() 都不许有（S16 帧率解耦门），
     *      所有"抖动/脉动"一律拿 b 自身的状态量（ttl / hits / 速度）推；
     *   ② P-8 辉光图集：本段所有 glow/glowLine 只传 tr（皮肤弹道色，既有色槽），
     *      新增的只有 fill/stroke 颜色 —— 它们走 hexA(tr,·) 派生，不占图集槽位，
     *      144 槽水位与改动前完全一致；
     *   ③ dot（kind '' / 'dot'）落到最后的 else，一个像素都没动 —— 本阶段全部
     *      皮肤都发 dot，所以实际画面与改动前逐帧相同。 */
    game.bullets.forEach(b => {
      const k = b.kind;
      // ---- beam：整屏竖光柱（唯一的竖条形态，与竖条 AABB 判定同宽）----
      if (k === 'beam') {
        const bw = b.r;
        const g2 = ctx.createLinearGradient(b.x - bw, 0, b.x + bw, 0);
        g2.addColorStop(0, hexA(tr, 0));
        g2.addColorStop(0.5, hexA(tr, 0.55));
        g2.addColorStop(1, hexA(tr, 0));
        glowLine(ctx, tr, b.x, b.y, b.x, 0, bw * 2.2, 0.30, 8);
        ctx.fillStyle = g2;
        ctx.fillRect(b.x - bw, 0, bw * 2, b.y);
        ctx.fillStyle = hexA(tr, 0.9);
        ctx.fillRect(b.x - bw * 0.16, 0, bw * 0.32, b.y);   // 白热芯线
        return;
      }
      // ---- pulse / ring：临爆脉冲球，半径随 ttl 收紧、亮度随之上抬（预警可读性）----
      if (k === 'ring' || k === 'pulse') {
        const t = b.ttl > 0 ? b.ttl : 0;
        const pr = b.r + 3 + (t % 8) * 0.5;               // 纯 ttl 驱动的脉动，零 RNG
        glow(ctx, tr, b.x, b.y, pr + 14, 0.42);
        ctx.strokeStyle = hexA(tr, 0.75); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, pr, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = hexA(tr, 0.9);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.6, 0, Math.PI * 2); ctx.fill();
        return;
      }
      // ---- 其余形态：沿速度方向画能量束 ----
      // laser 拉长收窄（"一道光"），arc/homing/fan 随速度方向转向（弯曲才看得出来），
      // dot 保持严格竖直（不读 vx）—— 这是与改动前逐像素一致的关键。
      const vy = b.vy || 0, vx = b.vx || 0;
      const sp = Math.abs(vy || 11);
      const aligned = (k === 'arc' || k === 'homing' || k === 'fan');
      const isLaser = (k === 'laser');
      const len = isLaser ? (16 + sp * 2.2) : (9 + sp);
      const wMul = isLaser ? 0.42 : 1;
      // save/restore 只在真的要转画笔时才付出 —— dot 路径连一次状态栈操作都不多花
      const rot = aligned && (vx * vx + vy * vy) > 1e-8;
      if (rot) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(vy, vx) + Math.PI / 2);   // +PI/2：下面那套几何是按"朝上"写的
        ctx.translate(-b.x, -b.y);
      }
      const grad = ctx.createLinearGradient(b.x, b.y + len, b.x, b.y - len * 0.4);
      grad.addColorStop(0, hexA(tr, 0));
      grad.addColorStop(0.5, hexA(tr, 0.85));
      grad.addColorStop(1, '#eaffff');
      glowLine(ctx, tr, b.x, b.y + len * 0.8, b.x, b.y - len * 0.3, b.r * 2.6 + 7, 0.34, 3);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(b.x - b.r * 0.7 * wMul, b.y + len);
      ctx.lineTo(b.x + b.r * 0.7 * wMul, b.y + len);
      ctx.lineTo(b.x + b.r * 0.4 * wMul, b.y - len * 0.4);
      ctx.lineTo(b.x - b.r * 0.4 * wMul, b.y - len * 0.4);
      ctx.closePath(); ctx.fill();
      if (rot) ctx.restore();
    });
    ctx.restore();

    // 敌弹：高可见度三层（外晕 + 橙红环 + 白热核心）+ 运动拖尾
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    game.ebullets.forEach(eb => {
      const r = eb.r || 6;
      const sp = Math.hypot(eb.vx || 0, eb.vy || 0);
      // 拖尾
      if (sp > 0.5) {
        ctx.strokeStyle = 'rgba(232,110,55,0.34)';
        ctx.lineWidth = r * 0.9;
        ctx.beginPath();
        ctx.moveTo(eb.x, eb.y);
        ctx.lineTo(eb.x - (eb.vx || 0) * 2.4, eb.y - (eb.vy || 0) * 2.4);
        ctx.stroke();
      }
    });
    ctx.restore();
    // ---- 危险色通道（可访问性核心约定）----------------------------------
    // 旧配色用「色相」区分弹型（aim 橙红 / ring 青 / fan 品红），后果是 ring 的青色
    // 和玩家弹道青色撞在一起 —— 高密度弹幕下敌我不分，这是审计里最致命的一条。
    // 方向 B 的修法：**所有敌弹统一收进 hue 12-24 的琥珀红「危险带」**，改用
    //   ① 形状（实心 / 空心环 / 小菱 / 长条）
    //   ② 明度（越亮 = 威胁越高，狙击弹最亮）
    // 来区分弹型。色相只回答「这东西会不会弄死我」，形状才回答「它是哪一种」。
    // 该色带为敌弹独占：任何皮肤、道具、UI 都不得进入，玩家弹一律偏冷青。
    // 另外每颗敌弹都描一圈暗色 rim（玩家弹永远没有）——即使全色盲，
    // 也能靠「亮芯 + 暗边」的双重轮廓从星云背景里把敌弹拣出来。
    const EB_RIM = 'rgba(26,10,4,0.85)';   // 敌弹专属暗色描边（危险信号的形状签名）
    const EB_STYLE = {
      aim:    { glow: '#ff5a2a', halo: 'rgba(255,110,60,0.26)', body: '#e8632e', core: '#ffe6c8' },
      ring:   { glow: '#ff7a3a', halo: 'rgba(255,140,80,0.24)', body: '#f07a3a', core: '#fff0dc' },
      fan:    { glow: '#ff4a1e', halo: 'rgba(255,90,40,0.26)',  body: '#d9552e', core: '#ffdcc0' },
      sniper: { glow: '#ffd9a0', halo: 'rgba(255,220,170,0.32)', body: '#fff', core: '#fff' },
    };
    game.ebullets.forEach(eb => {
      const r = eb.r || 6;
      const st2 = EB_STYLE[eb.kind] || EB_STYLE.aim;
      ctx.save();
      /* 环爆预告圈（P2a）。范围伤害不画出范围就是不公平死亡 —— 玩家必须能在
       * 弹落地前读出"哪一圈会疼"。用虚线而不是实色填充：实色在高密度弹幕里会
       * 糊成一片，虚线在任何背景上都保持"这是提示、不是弹体"的语义。
       * 颜色沿用该弹型自己的 st2.glow（既有图集色槽，零新增色键，P-8）；
       * 透明度只由 ttl 推，零 RNG。blastR 缺省 0 ⇒ 既有敌弹一像素不变。 */
      if (eb.blastR > 0) {
        const near = eb.ttl > 0 && eb.ttl < 14;           // 临爆 14 步内加亮
        ctx.strokeStyle = st2.halo;
        ctx.lineWidth = near ? 2.4 : 1.4;
        ctx.setLineDash([6, 7]);
        ctx.beginPath(); ctx.arc(eb.x, eb.y, eb.blastR, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (eb.kind === 'sniper') {
        // 狙击弹：沿速度方向的白亮能量长条 + 尾迹
        const sp = Math.hypot(eb.vx, eb.vy) || 1;
        const nx = eb.vx / sp, ny = eb.vy / sp;
        glowLine(ctx, '#ffe9a8', eb.x - nx * 26, eb.y - ny * 26, eb.x, eb.y, 15, 0.34, 6);
        ctx.strokeStyle = 'rgba(255,220,160,0.5)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(eb.x - nx * 26, eb.y - ny * 26); ctx.lineTo(eb.x, eb.y); ctx.stroke();
        glowLine(ctx, '#ffffff', eb.x - nx * 16, eb.y - ny * 16, eb.x, eb.y, 10, 0.30, 4);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(eb.x - nx * 16, eb.y - ny * 16); ctx.lineTo(eb.x, eb.y); ctx.stroke();
        ctx.restore();
        return;
      }
      // 外晕（图集辉光）
      glow(ctx, st2.glow, eb.x, eb.y, r + 18, 0.40);
      ctx.fillStyle = st2.halo;
      ctx.beginPath(); ctx.arc(eb.x, eb.y, r + 4, 0, Math.PI * 2); ctx.fill();
      // 暗色 rim（敌弹专属）：即使背景星云很亮，也保证一圈硬轮廓把弹从背景里切出来
      ctx.strokeStyle = EB_RIM; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(eb.x, eb.y, r + 1.6, 0, Math.PI * 2); ctx.stroke();
      // 主体：同一危险色带内，用「形状」区分弹型
      glow(ctx, st2.glow, eb.x, eb.y, r + 8, 0.34);
      ctx.fillStyle = st2.body;
      if (eb.kind === 'ring') {
        ctx.strokeStyle = st2.body; ctx.lineWidth = Math.max(2, r * 0.5);
        ctx.beginPath(); ctx.arc(eb.x, eb.y, r * 0.78, 0, Math.PI * 2); ctx.stroke();
      } else if (eb.kind === 'fan') {
        ctx.beginPath();
        ctx.moveTo(eb.x, eb.y - r); ctx.lineTo(eb.x + r, eb.y);
        ctx.lineTo(eb.x, eb.y + r); ctx.lineTo(eb.x - r, eb.y);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(eb.x, eb.y, r, 0, Math.PI * 2); ctx.fill();
      }
      // 白热核心
      ctx.fillStyle = st2.core;
      ctx.beginPath(); ctx.arc(eb.x, eb.y, Math.max(2, r * 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    game.items.forEach(DJFE.draw.item);
    game.enemies.forEach(DJFE.draw.enemy);
    if (game.boss && !r3dActive) DJFE.draw.boss(game.boss, now, player);

    const invuln = now < player.invulnUntil;
    const blink = invuln && (Math.floor(now / 100) % 2 === 0);
    const shipShown = (game.state !== STATE.MENU && !blink);
    if (shipShown) {
      ctx.globalAlpha = invuln ? 0.55 : 1;
      // 3D 接管机体时跳过 2D 机体，其余（背景/弹幕/敌机/Boss/粒子/HUD）照旧走 2D。
      // Phase 1 只让出这一处；后续 Phase 每接管一类实体就在对应处加同款开关。
      if (!r3dActive) DJFE.draw.player(now, player, game);
      ctx.globalAlpha = 1;
    }
    // 把可见性/透明度口径交给 3D 层，保证两条路径的闪烁表现完全一致
    r3dShip.playerVisible = shipShown;
    r3dShip.playerAlpha = invuln ? 0.55 : 1;

    // 粒子：加法混合 + 柔光 + 运动拖尾 + 软芯（余烬感，不再是硬方块）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    game.particles.forEach(p => {
      const a = Math.max(0, p.life);
      ctx.globalAlpha = a;
      const col = `hsl(${p.hue},66%,${54 + 22 * a}%)`;
      // 尺寸与寿命解耦（hit-feedback §9 未决 4 / 美术 §6）：baseSz>0 时以武器档 sz₀ 为出生半径，
      // 既有粒子 baseSz=0 → 等价于旧 `1.6+4.2*a`，零回归。
      const sz = (p.baseSz && p.baseSz > 0 ? p.baseSz : 1.6) + 4.2 * a;
      const sp = Math.hypot(p.vx || 0, p.vy || 0);
      if (p.kind === 'streak') {
        // 方向性碎片条：头亮尾淡的细长锥形（取代纯圆）。确定性角度由 spawnHitImpact 给定，
        // 此处只按速度方向对齐，不引入任何 RNG（S16）。
        const ang = Math.atan2(p.vy || 0, p.vx || 0);
        const L = sz * (p.ar || 5);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        const grd = ctx.createLinearGradient(0, 0, -L, 0);
        grd.addColorStop(0, `hsla(${p.hue},75%,${60 + 20 * a}%,${a})`);
        grd.addColorStop(1, `hsla(${p.hue},70%,55%,0)`);
        ctx.strokeStyle = grd;
        ctx.lineWidth = sz;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-L, 0);
        ctx.stroke();
        ctx.restore();
        glowHue(ctx, p.hue, 70, 64, p.x, p.y, sz * 2.4 + 6, 0.4 * a);
      } else {
        // 普通粒子 / 闪核：原样柔光 + 实心软芯 + 白热芯（explode / bossCollapse 视觉不变）
        // 运动拖尾（高速火花更明显）
        if (sp > 1.6) {
          ctx.strokeStyle = col;
          ctx.lineWidth = sz * 0.7;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 1.8, p.y - p.vy * 1.8);
          ctx.stroke();
        }
        // 图集柔光（扩散晕）
        glowHue(ctx, p.hue, 66, 64, p.x, p.y, sz * 2.4 + 6, 0.40 * a);
        // 实心软芯（圆 → 余烬）
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
        // 高亮白芯（最亮的核心，让火花有"烫"的感觉）
        if (a > 0.5) {
          ctx.fillStyle = `hsla(${p.hue},82%,${82 + 12 * a}%,${a * 0.7})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.8, sz * 0.42), 0, Math.PI * 2); ctx.fill();
        }
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    // 冲击波环：柔调下改「双环」——外圈薄而透，内圈稍实，边缘不再是一根硬线
    game.rings.forEach(rg => {
      const aOut = rg.alpha != null ? rg.alpha : rg.life * 0.42;
      const aIn  = rg.alpha != null ? rg.alpha : rg.life * 0.62;
      ctx.strokeStyle = `hsla(${rg.hue},70%,74%,${aOut})`;
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `hsla(${rg.hue},80%,82%,${aIn})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2); ctx.stroke();
    });

    /* ---- 受击闪红（damage flash）------------------------------------------
     * 原实现是一层高饱和红把整屏糊掉（rgba(255,40,60,.28)）：在弹幕里最需要
     * 看清的一瞬间，反而把敌弹和玩家一起盖住了 —— 既伤可读性也伤观感。
     * 方向 B 改成「边缘受创」：中心几乎透明，红只压在四周，
     * 既保住中央战场的可读性，又比全屏红更像「机体受损」而不是「屏幕坏了」。 */
    if (game.flash > 0) {
      const f = game.flash;
      const fg2 = ctx.createRadialGradient(
        W / 2, H / 2, Math.min(W, H) * 0.20,
        W / 2, H / 2, Math.max(W, H) * 0.72);
      fg2.addColorStop(0, `rgba(198,74,58,${f * 0.05})`);
      fg2.addColorStop(0.55, `rgba(198,74,58,${f * 0.16})`);
      fg2.addColorStop(1, `rgba(178,52,44,${f * 0.42})`);
      ctx.fillStyle = fg2;
      ctx.fillRect(0, 0, W, H);
    }

    if (game.state === STATE.PLAYING && now < game.stageBannerUntil) {
      const sa = Math.min(1, (game.stageBannerUntil - now) / 500);
      ctx.save();
      ctx.globalAlpha = sa;
      ctx.textAlign = 'center';
      ctx.fillStyle = stg.accent;
      ctx.font = 'bold 20px -apple-system, "PingFang SC", sans-serif';
      // 上移一档（H*0.30 / 0.40），给下方波次提示让出空间，避免每关首波两者重叠
      ctx.fillText(DJFE.t('banner.stagePrefix') + ' ' + game.stage + ' / ' + STAGES.length, W / 2, H * 0.30);
      ctx.font = 'bold 40px -apple-system, "PingFang SC", sans-serif';
      glowLine(ctx, stg.accent, W / 2 - 90, H * 0.40 - 12, W / 2 + 90, H * 0.40 - 12, 46, 0.20 * sa, 7);
      ctx.fillText(DJFE.t(stg.nameKey), W / 2, H * 0.40);
      ctx.restore();
    }

    if (game.state === STATE.PLAYING && now < game.waveBannerUntil) {
      const a = Math.min(1, (game.waveBannerUntil - now) / 400);
      // 每关首波时关卡横幅(stageBannerUntil)与波次横幅同时出现：把波次提示下移到 H*0.54，
      // 与上方关卡名(H*0.40)错开；非首波则保持 H*0.44 居中显示
      const stageActive = now < game.stageBannerUntil;
      const waveY = stageActive ? H * 0.54 : H * 0.44;
      ctx.save();
      ctx.globalAlpha = a;
      // BOSS 横幅走危险色带（与敌弹同族的暖赭红），普通波次走暖砂金 —— 与 DOM UI 次色同源
      ctx.fillStyle = game.isBossWave ? '#d9765a' : '#dcb87a';
      ctx.font = 'bold 46px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      glowLine(ctx, game.isBossWave ? '#e0724a' : '#dcb87a',
        W / 2 - 100, waveY - 14, W / 2 + 100, waveY - 14, 52, 0.22 * a, 7);
      ctx.fillText(game.isBossWave ? DJFE.t('banner.bossWave') : (DJFE.t('banner.wavePrefix') + ' ' + game.wave + DJFE.t('banner.waveSuffix')), W / 2, waveY);
      ctx.restore();
    }

    if (game.boss) {
      const b = game.boss;
      const bw = Math.min(W * 0.62, 540), bx = (W - bw) / 2, by = 16, bh = 13;
      const r = Math.max(0, b.hp / b.maxHp);
      const bh2 = (b.hue != null) ? b.hue : 10;
      const rr = (x, y, w, h, rad) => {
        rad = Math.min(rad, h / 2, w / 2);
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.arcTo(x + w, y, x + w, y + h, rad);
        ctx.arcTo(x + w, y + h, x, y + h, rad);
        ctx.arcTo(x, y + h, x, y, rad);
        ctx.arcTo(x, y, x + w, y, rad);
        ctx.closePath();
      };
      // 底板（圆角 + 玻璃底）
      ctx.save();
      // 软阴影用外扩暗板替代（加法辉光图集画不出暗影）
      ctx.fillStyle = 'rgba(2,5,14,.26)';
      rr(bx - 8, by - 7, bw + 16, bh + 16, 13); ctx.fill();
      ctx.fillStyle = 'rgba(3,7,18,.34)';
      rr(bx - 6, by - 5, bw + 12, bh + 12, 11); ctx.fill();
      ctx.fillStyle = 'rgba(6,10,24,.62)';
      rr(bx - 4, by - 4, bw + 8, bh + 8, 9); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(120,160,220,.35)'; ctx.lineWidth = 1;
      rr(bx - 4, by - 4, bw + 8, bh + 8, 9); ctx.stroke();
      // 空血槽
      ctx.fillStyle = `hsla(${bh2},45%,18%,.85)`;
      rr(bx, by, bw, bh, 6); ctx.fill();
      // 血量（按关卡色相渐变 + 发光；低血量转警示金）
      if (r > 0) {
        const low = r <= 0.3;
        const h1 = low ? 45 : bh2, s1 = low ? 95 : 85;
        const fg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        fg.addColorStop(0, `hsl(${h1},${s1}%,72%)`);
        fg.addColorStop(1, `hsl(${h1},${s1}%,48%)`);
        ctx.save();
        const fw = Math.max(bh, bw * r);
        glowLine(ctx, `hsl(${h1},95%,60%)`, bx + 4, by + bh / 2, bx + fw - 4, by + bh / 2, bh + 12, 0.26, 10);
        ctx.fillStyle = fg;
        rr(bx, by, fw, bh, 6); ctx.fill();
        ctx.restore();
        // 顶部高光条
        ctx.fillStyle = 'rgba(255,255,255,.28)';
        rr(bx + 1, by + 1, Math.max(0, bw * r - 2), bh * 0.4, 4); ctx.fill();
      }
      // Boss 名（描边字 + 发光）—— 下移避开血条底板，并按血条宽度截断防溢出/重叠
      ctx.save();
      ctx.font = 'bold 13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      // 血条底板底沿在 by+bh+9(=38)，名签下移到底板之下（nameY=by+bh+14=43）杜绝重叠
      const nameY = by + bh + 14;
      let label = b.name || DJFE.t('boss.default');
      const maxW = bw - 12;                 // 不超出血条左右留白
      if (ctx.measureText(label).width > maxW) {
        while (label.length > 1 && ctx.measureText(label + '…').width > maxW) label = label.slice(0, -1);
        label = label + '…';
      }
      glowHue(ctx, bh2, 90, 60, W / 2, nameY + 7, 44, 0.20);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,8,20,.85)';
      ctx.strokeText(label, W / 2, nameY);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(label, W / 2, nameY);
      ctx.restore();
    }

    // 电影感暗角（边缘压暗，中心保持通透，menu 不影响文字）
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.max(W, H) * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  // ---- 暴露给 bootstrap (main.js) ----
  function setMute(btn) {
    btn.addEventListener('click', () => {
      const m = audio.toggleMute();
      btn.textContent = m ? '音效 关' : '音效 开';
    });
  }
  DJFE.Game = {
    init() { applySens(parseInt(sensEl.value, 10)); refreshBestUI(); setState(STATE.MENU); requestAnimationFrame(loop); },
    start() { input.initAudio(); startGame(); },
    setDifficulty(d) { selectedDiff = d; },
    toMenu() { setState(STATE.MENU); },
    resume() { setState(STATE.PLAYING); },
    bomb() { if (game.state === STATE.PLAYING) triggerBomb(); },
    // 2c-1 · 技能键（触屏 #btnSkill 等调用）：只置标志，step 内结算
    skill() { if (game.state === STATE.PLAYING) game.skillQueued = true; },
    // 2c-1 · 实时切换自动释放（设置开关调用，立即生效，无需重开）
    setSkillAuto(v) { game.skillAuto = !!v; },
    togglePause() {
      if (game.state === STATE.PLAYING) setState(STATE.PAUSED);
      else if (game.state === STATE.PAUSED) setState(STATE.PLAYING);
    },
    setMute,
  };

  // 调试句柄（仅供自动化测试 / 控制台使用，不影响玩法）
  DJFE.__debug = {
    get game() { return game; },
    get player() { return player; },
    get STATE() { return STATE; },
    // Phase 6 新增：固定步长 / 对象池的观测与开关
    get HZ() { return HZ; },
    get STEP() { return STEP; },
    get alpha() { return renderAlpha; },
    poolStats,
    perfHud(v) { perf.on = v === undefined ? !perf.on : !!v; perf._t0 = performance.now(); return perf.on; },
    setInterp(v) { interpOn = !!v; return interpOn; },
    get perf() { return perf; },
    // 关卡总数与每关波数：冒烟用例据此推导「最终关」，避免把 4 关/6 关写死在测试里
    get stageCount() { return STAGES.length; },
    get stageWaves() { return STAGE_WAVES; },
    // 自动化验证专用：装配指定种类的 Boss（forceKind 走 spawnBoss 的种类覆盖分支）。
    // 不影响任何生产路径；仅用于 Playwright 截各款 Boss 的独立 3D billboard。
    spawnBoss(kind) { return spawnBoss(game.stage, logicNow(), kind); },
  };

})(window.DJFE);
