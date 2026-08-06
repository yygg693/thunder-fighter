/* =====================================================================
 * 打飞机 · Fighter Shooter — render3d.js
 * 2.5D 渲染层（Three.js / WebGL）· 3D 重平台 Phase 1 · ENG-3D-P1
 * ---------------------------------------------------------------------
 * 架构契约（改这个文件前先读完）：
 *
 *  1) 【逻辑层零侵入】游戏逻辑、碰撞、弹幕**全部**仍跑在 2D 平面上。
 *     本模块是纯粹的「只读渲染器」：只读 game/player 的 x/y/w/h，
 *     **绝不回写任何实体字段**。step() 的行为因此在构造上不可能被改变
 *     —— 这是 S16（帧率解耦）/ S18（池零扩容）/ S15（通关路径）保持
 *     不变的根本保证。
 *
 *  2) 【特性探测，永不抛错】无 window.THREE、无 WebGL、无 document
 *     （无头冒烟环境）时，available() 恒为 false，调用方原样回落到
 *     Canvas2D 路径。本文件在**加载期不做任何有副作用的事**，
 *     即使被 headless 加载也只是定义几个函数。
 *
 *  3) 【双 canvas 分层，不是单 canvas 双上下文】
 *     ⚠ 关键约束：同一个 <canvas> 元素**不能同时**持有 '2d' 和 'webgl'
 *     上下文——第二次 getContext 只会返回 null。#game 已经在 core.js
 *     里被 getContext('2d') 占用，所以 3D 必须画在**另一块**
 *     canvas 上，以 CSS 分层叠在 #game 之上、HUD(.overlay z=10) 之下。
 *     该 canvas 由 JS 动态创建、**不带任何 DOM id**（S1/S17 的 DOM-id
 *     门本 Phase 不新增 id），且只在 available() 为真时才创建
 *     —— headless 下永远不会进入 DOM。
 *
 *  4) 【坐标口径 1:1】正交相机俯视 -Z，视口 = (W, H) 像素，
 *     游戏坐标 (gx, gy) → 世界坐标 (gx - W/2, H/2 - gy, 0)。
 *     即 3D 世界 1 单位 == 屏幕 1 像素，且 Y 轴翻转（canvas 的 y 向下、
 *     Three 的 y 向上）。mapXY() 是**纯函数**，不依赖 WebGL，
 *     可在无头环境直接断言 —— 这是 P-7 给 S17 留的可测试检查点。
 *
 *  5) 【Phase 1→3 范围】玩家机（Phase 1）与 Boss（Phase 3）走 3D billboard
 *     贴片（AI sprite，base64 Data URI 纹理，file:// 双击打开仍 WebGL 干净）；
 *     敌机 / 子弹 / 粒子 / 背景 / HUD 仍全部走 2D。每接管一类就在 drawScene
 *     里加一个 `if (!r3dActive)` 开关，2D 实现一律保留作降级路径。
 *
 *  6) 【Option A · AI sprite billboard】6 款皮肤各用独立的 AI 精灵
 *     （player_<id>.png），7 款 Boss 各用独立的 AI 精灵（boss_<kind>.png）。
 *     每款各建一个 billboard 网格/材质，init 阶段一次性预建并 idle 于场景
 *     （visible=false）；draw() 只切显 + 写 transform/uniform（位置/缩放/姿态/
 *     透明度），几何体/纹理永不重建（S16/S18/S15 纪律）。零 Math.random。
 * ===================================================================== */
window.DJFE = window.DJFE || {};
(function (DJFE) {
  'use strict';

  // ---- 探测缓存 ----------------------------------------------------
  // _glProbe: null=未探测 / true / false。WebGL 能力一个会话内不会变，探一次即可。
  let _glProbe = null;
  // _failed: 初始化过程中抛过错（驱动异常 / 上下文创建失败）就永久降级，不每帧重试。
  let _failed = false;

  // ---- 运行时状态（只在真实浏览器里被填充）--------------------------
  let R = null;   // { canvas, renderer, scene, camera, ships, bosses, w, h, dpr }

  /* WebGL 能力探测。
   * 用一块**一次性**的探测 canvas，绝不碰 #game —— #game 已被 2D 上下文占用，
   * 在它上面调 getContext('webgl') 恒为 null，会把 available() 永久钉死在 false。 */
  function hasWebGL() {
    if (_glProbe !== null) return _glProbe;
    _glProbe = false;
    try {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return _glProbe;
      const probe = document.createElement('canvas');
      if (!probe || typeof probe.getContext !== 'function') return _glProbe;
      const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
      _glProbe = !!gl;
    } catch (e) {
      _glProbe = false;
    }
    return _glProbe;
  }

  /* 本帧是否该走 3D。
   * 注意 window.THREE 故意**不缓存**：允许 <script> 晚到；也保证 headless
   * （THREE 恒为 undefined）每次都干脆利落地返回 false。 */
  function available() {
    if (_failed) return false;
    if (typeof window === 'undefined' || !window.THREE) return false;
    return hasWebGL();
  }

  /* 【纯函数】游戏坐标 → 3D 世界坐标（z=0 平面）。
   * 不依赖 THREE / WebGL / DOM —— 无头环境可直接调用做断言（P-7 检查点）。
   * out 可选，传入则原地写入（热路径零分配）。 */
  function mapXY(gx, gy, w, h, out) {
    const o = out || { x: 0, y: 0 };
    o.x = gx - w * 0.5;
    o.y = h * 0.5 - gy;
    return o;
  }

  // =====================================================================
  // Option A · AI sprite billboard —— 着色器 + 工具（模块级，IIFE 内）
  // =====================================================================

  // billboard 顶点：无骨骼、无光照，纯平面贴片（PlaneGeometry 自带 uv/position）
  const BILLBOARD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

  // billboard 片元：采样 sprite，按 uHue 旋转色相（罗德里格旋转绕灰度轴），
  // uAlpha 控制整体透明度（无敌闪烁等与 2D 路径口径一致）。
  const BILLBOARD_FRAG = `
uniform sampler2D map;
uniform float uHue;
uniform float uAlpha;
uniform vec3 uGlow;
uniform float uGlowAmt;
varying vec2 vUv;

vec3 hueRotate(vec3 color, float angle) {
  const vec3 k = vec3(0.57735026919);
  float c = cos(angle);
  float s = sin(angle);
  return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
}

void main() {
  vec4 tex = texture2D(map, vUv);
  vec3 rgb = hueRotate(tex.rgb, uHue);
  // 自发光：按皮肤 accent 染色，对暗部加成更强（保留高光细节），
  // 提升 stealth/violet/crimson 等暗色机体的可读性，不改动精灵资产。
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb += uGlow * uGlowAmt * (1.0 - lum);
  gl_FragColor = vec4(rgb, tex.a * uAlpha);
}
`;

  function degToRad(d) { return d * Math.PI / 180; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Boss 底衬辉光相对本体的放大倍数（辉光几何按 1:1 建，draw 里再乘 boss 缩放）
  const BOSS_GLOW_SCALE = 1.7;

  // 玩家底衬辉光相对机体的放大倍数（与 BOSS_GLOW_SCALE 同构，辉光几何按 1:1 建）
  const SHIP_GLOW_SCALE = 1.85;

  // 用 base64 Data URI 加载纹理：file:// 下 WebGL 无法上传 file:// 图像
  // （跨源/tainted），Data URI 同源且 WebGL-clean，双击 index.html 即可生效。
  function loadTexture(THREE, dataURI) {
    const tex = new THREE.TextureLoader().load(dataURI, function (t) {
      t.colorSpace = THREE.SRGBColorSpace;
    });
    return tex;
  }

  /* 通用辉光贴图（白心→透明边）：作 Boss 底衬，让深色(void)/稀疏(phaser/weaverqueen)
   * 精灵在暗星云背景上始终有轮廓可读。一次性构建并缓存（128² 小图，零热路径分配）。
   * 仅在真实浏览器 init 时构建——headless 冒烟不加载本文件，且 available() 已先拦截。 */
  let _glowTex = null;
  function glowTexture(THREE) {
    if (_glowTex) return _glowTex;
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    _glowTex = new THREE.CanvasTexture(cv);
    _glowTex.colorSpace = THREE.SRGBColorSpace;
    return _glowTex;
  }

  /* 6 款 AI sprite billboard：每款皮肤使用独立的 player_<id>.png 纹理，
   * init 阶段一次性预建并 idle 于场景（visible=false）；draw() 只按当前皮肤 id
   * 切显（几何体/纹理/材质永不重建，S16/S18/S15 纪律）。
   * 返回 { group, mat }：group 即该贴片 Mesh（承载 position/scale/rotation），
   * mat 即 ShaderMaterial（承载 uAlpha uniform）。
   * 坐标口径：Plane 面朝 +Z、本地 +Y 朝上，sprite 顶部（机首）映射到 +Y。 */
  function buildShip(THREE, w, h, kind) {
    const b64 = (typeof window !== 'undefined' && window.DJFE_SPRITE_B64) || {};
    const dataURI = b64['player_' + kind] || b64.player || '';
    const tex = loadTexture(THREE, dataURI);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uHue: { value: 0 }, uAlpha: { value: 1 },
                 uGlow: { value: new THREE.Color(0, 0, 0) }, uGlowAmt: { value: 0 } },
      vertexShader: BILLBOARD_VERT,
      fragmentShader: BILLBOARD_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    // Plane faces +Z, +Y up, image top (nose) maps to +Y — exactly what the sprite expects.
    return { group: mesh, mat: mat };
  }

  /* 7 款 AI sprite billboard（Boss）：每款 Boss 使用独立的 boss_<kind>.png
   * 纹理，与机型同构——init 一次性预建 idle 于场景（visible=false），draw() 只按
   * game.boss.kind 切显，几何体/纹理/材质永不重建。
   * 返回 { group, mat }：group 即该贴片 Mesh，mat 即 ShaderMaterial。 */
  function buildBoss(THREE, w, h, kind) {
    const b64 = (typeof window !== 'undefined' && window.DJFE_SPRITE_B64) || {};
    const dataURI = b64['boss_' + kind] || b64.boss || '';
    const tex = loadTexture(THREE, dataURI);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uHue: { value: 0 }, uAlpha: { value: 1 },
                 uGlow: { value: new THREE.Color(0, 0, 0) }, uGlowAmt: { value: 0 } },
      vertexShader: BILLBOARD_VERT,
      fragmentShader: BILLBOARD_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    return { group: mesh, mat: mat };
  }

  /* Boss 底衬辉光：一张白径向渐变贴片，加法混合 + 按 Boss 色相染色，作本体背后的轮廓衬。
   * 与本体同构预建于 init（visible=false），draw() 只切显 + 写位置/缩放/染色，
   * 几何/材质永不重建（S16/S18）。renderOrder=-1 保证在本体(renderOrder=0)之前绘制。 */
  function buildBossGlow(THREE) {
    const mat = new THREE.MeshBasicMaterial({
      map: glowTexture(THREE),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.36,
      color: new THREE.Color(0.6, 0.7, 1.0),
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat);
    mesh.renderOrder = -1;
    return mesh;
  }

  /* 玩家底衬辉光：与 Boss 辉光同构——一张白径向渐变贴片，加法混合 + 按皮肤 accent 染色，
   * 作机体背后的轮廓衬，让深色(stealth)/稀疏精灵在暗星云背景上始终有轮廓可读。
   * init 一次性预建 idle 于场景（visible=false），draw() 只切显 + 写位置/缩放/染色，
   * 几何/材质永不重建（S16/S18）。renderOrder=-1 保证在本体(renderOrder=0)之前绘制。
   * 比 Boss 辉光更淡（opacity 0.22）且放大倍率更小（SHIP_GLOW_SCALE），避免抢本体焦点。 */
  function buildPlayerGlow(THREE) {
    const mat = new THREE.MeshBasicMaterial({
      map: glowTexture(THREE),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
      color: new THREE.Color(0.6, 0.7, 1.0),
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(42, 50), mat);
    mesh.renderOrder = -1;
    return mesh;
  }

  /* 建 / 复用渲染器。幂等：成功后重复调用直接返回 true（每帧都会被调，必须便宜）。
   * canvas2d 参数只用来读尺寸口径，**不会**在它上面创建 WebGL 上下文。 */
  function init(canvas2d) {
    if (R) return true;
    if (_failed) return false;
    if (!available()) return false;

    try {
      const THREE = window.THREE;
      const W = (DJFE.W ? DJFE.W() : 0) || (canvas2d && canvas2d.width) || 0;
      const H = (DJFE.H ? DJFE.H() : 0) || (canvas2d && canvas2d.height) || 0;
      if (!(W > 0 && H > 0)) return false;   // 尺寸还没就绪，下一帧再试（不算失败）

      // 3D 覆盖层 canvas：无 id（S1/S17 DOM-id 门），不吃指针事件（输入仍归 2D 层）
      const cv = document.createElement('canvas');
      cv.className = 'r3d-layer';
      cv.style.cssText =
        'position:fixed;left:0;top:0;width:100%;height:100%;' +
        'z-index:1;pointer-events:none;display:block;';

      const renderer = new THREE.WebGLRenderer({
        canvas: cv, alpha: true, antialias: true, powerPreference: 'high-performance',
      });
      const dpr = Math.min((window.devicePixelRatio || 1), 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);          // false = 不让 Three 改写 CSS 尺寸
      renderer.setClearColor(0x000000, 0);    // 全透明：2D 背景/弹幕从下面透上来
      renderer.outputColorSpace = THREE.SRGBColorSpace; // 显式 sRGB 输出（r160 默认，显式更稳）

      const scene = new THREE.Scene();

      // 正交相机俯视 -Z：世界 1 单位 == 屏幕 1 像素（见文件头契约 4）
      const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 4000);
      camera.position.set(0, 0, 1000);
      camera.lookAt(0, 0, 0);

      // billboard 不受光照影响（ShaderMaterial 自管着色），但保留极淡环境光无副作用；
      // 此处不再加灯——billboard 用的是自包含 ShaderMaterial，灯光对 ShaderMaterial 无效。

      // 6 款 AI sprite billboard：init 阶段一次性预建，全部 idle 于场景（visible=false）。
      // draw() 仅按当前皮肤切显，几何体/材质永不重建 —— 守住 S16/S18/S15 纪律。
      const SHIP_KINDS = ['cyan_knight', 'crimson_falcon', 'emerald', 'violet', 'stealth', 'golden'];
      const ships = {};
      for (let ki = 0; ki < SHIP_KINDS.length; ki++) {
        const sk = SHIP_KINDS[ki];
        const s = buildShip(THREE, 42, 50, sk);
        s.group.visible = false;
        scene.add(s.group);
        const glow = buildPlayerGlow(THREE);
        glow.visible = false;
        scene.add(glow);
        // 底衬辉光按皮肤 accent 预计算染色（加法混合，亮白晕偏色），draw() 直接 copy 不重算。
        let glowColor = new THREE.Color(0.6, 0.7, 1.0);
        if (DJFE.skins && DJFE.skins.presets) {
          const sp = DJFE.skins.presets.find(s2 => s2.id === sk);
          if (sp && sp.accent) {
            const tmp = new THREE.Color(sp.accent);
            const hsl = {}; tmp.getHSL(hsl);
            glowColor = new THREE.Color().setHSL(hsl.h, 0.45, 0.72);
          }
        }
        ships[sk] = { group: s.group, mat: s.mat, glow: glow, glowColor: glowColor };
      }

      // 7 款 AI sprite billboard（Boss）：init 一次性预建，全部 idle 于场景（visible=false）。
      // 与机型同构——draw() 仅按 game.boss.kind 切显 + 按 boss.hue 旋转色相，几何永不重建。
      const BOSS_KINDS_LIST = ['sentinel', 'scorpion', 'carrier', 'core', 'phaser', 'void', 'weaverqueen'];
      const bosses = {};
      for (let bi = 0; bi < BOSS_KINDS_LIST.length; bi++) {
        const bs = buildBoss(THREE, 80, 80, BOSS_KINDS_LIST[bi]);
        bs.group.visible = false;
        scene.add(bs.group);
        const glow = buildBossGlow(THREE);
        glow.visible = false;
        scene.add(glow);
        bosses[BOSS_KINDS_LIST[bi]] = { group: bs.group, mat: bs.mat, glow: glow };
      }

      document.body.appendChild(cv);

      R = {
        canvas: cv, renderer, scene, camera,
        ships: ships,                 // { id: { group, mat, glow, glowColor } }
        bosses: bosses,               // { kind: { group, mat } }
        cur: null, lastSkin: null,    // 当前显示机体 / 上一帧皮肤（切显缓存）
        lastBoss: null,               // 上一帧显示的 Boss kind（切显缓存）
        baseW: 42, baseH: 50,
        w: W, h: H, dpr,
        scratch: { x: 0, y: 0 },
      };
      return true;
    } catch (e) {
      // 上下文创建失败 / 驱动异常：永久降级到 2D，绝不让渲染层拖垮游戏
      _failed = true;
      R = null;
      return false;
    }
  }

  /* 视口变化跟随。core.js 的 resize() 会改 #game 的 width/height，
   * 这里每帧比对一次（两次整数比较，可忽略不计），比挂 resize 监听更不容易漏。 */
  function syncViewport() {
    const W = (DJFE.W ? DJFE.W() : R.w) || R.w;
    const H = (DJFE.H ? DJFE.H() : R.h) || R.h;
    if (W === R.w && H === R.h) return;
    if (!(W > 0 && H > 0)) return;
    R.w = W; R.h = H;
    R.renderer.setSize(W, H, false);
    const cam = R.camera;
    cam.left = -W / 2; cam.right = W / 2;
    cam.top = H / 2; cam.bottom = -H / 2;
    cam.updateProjectionMatrix();
  }

  /* 每帧 3D 通道。
   * @param game 游戏状态（只读）
   * @param now  渲染时刻（已含帧内外插余量，与 2D 同一口径）
   * @param opts { player, playerVisible, playerAlpha } —— 由 game.js 算好可见性/
   *             闪烁并把 player 引用递进来；本模块不需要知道 STATE 枚举，
   *             与逻辑层保持解耦。
   *             ⚠ player 走 opts 而不是 game.player：game.js 里 game 和 player
   *             是**两个平级的闭包变量**，game 对象上并没有 player 字段。
   * 任何异常都被吞掉并永久降级：渲染层不许成为崩溃源。 */
  function draw(game, now, opts) {
    if (!R || _failed) return false;
    try {
      syncViewport();

      const player = (opts && opts.player) || (game && game.player) || null;
      const vis = !!(player && (!opts || opts.playerVisible !== false));

      // 当前皮肤 id（game.js 每帧把 game.skin 设为 DJFE.skins.current()；
      // 这里直接走 currentId() 取 id 做切显，与 2D 剪影分支同一真源）。
      const sid = (typeof DJFE.skins === 'object' && DJFE.skins && typeof DJFE.skins.currentId === 'function')
        ? DJFE.skins.currentId() : 'cyan_knight';

      // 皮肤切换：隐藏旧机、切换到目标机体的 billboard 网格（几何/材质预建于 init，永不重建）
      if (sid !== R.lastSkin) {
        if (R.lastSkin && R.ships[R.lastSkin]) {
          R.ships[R.lastSkin].group.visible = false;
          const og = R.ships[R.lastSkin].glow; if (og) og.visible = false;
        }
        R.lastSkin = sid;
      }

      const ship = R.ships[sid] || R.ships.cyan_knight;
      ship.group.visible = vis;
      const pgHide = ship.glow; if (pgHide) pgHide.visible = false;  // 默认隐藏，vis 时再点亮
      if (!vis) {
        // 玩家不可见（重生闪烁/暂停）：仅机体隐藏，场景照渲染保持管线活跃
        R.renderer.render(R.scene, R.camera);
        return true;
      }
      R.cur = ship;

      const pw = player.w || R.baseW;
      const ph = player.h || R.baseH;

      // 位置：逻辑 2D 坐标 → z=0 平面（唯一的坐标真源仍是 step() 算出来的 x/y）
      const p = mapXY(player.x, player.y, R.w, R.h, R.scratch);
      ship.group.position.set(p.x, p.y, 0);

      // 尺寸：用 scale 贴合 player.w/h，billboard 的 z-scale 恒为 1（平面贴片）
      ship.group.scale.set(pw / R.baseW, ph / R.baseH, 1);

      // 姿态：bank(横速) + pitch/yaw(纵速)，由 2D 速度驱动，零 Math.random
      const vx = (typeof player.px === 'number') ? (player.x - player.px) : 0;
      const vy = (typeof player.py === 'number') ? (player.y - player.py) : 0;
      ship.group.rotation.z = clamp(-vx * 0.055, -0.5, 0.5);  // bank
      ship.group.rotation.x = clamp(vy * 0.03, -0.25, 0.25);  // pitch
      ship.group.rotation.y = clamp(vx * 0.03, -0.2, 0.2);    // yaw

      // 无敌闪烁的半透明，与 2D 路径 ctx.globalAlpha 口径一致
      const alpha = (opts && typeof opts.playerAlpha === 'number') ? opts.playerAlpha : 1;
      ship.mat.uniforms.uAlpha.value = alpha;

      // 色相：每款皮肤已使用独立纹理，无需再通过 hueRotate 换色。
      ship.mat.uniforms.uHue.value = 0;

      // 玩家机体自发光（按皮肤 accent 染色）——暗色机体(stealth/violet/crimson)可读性增强。
      // 纯渲染层，不改动精灵资产、不碰逻辑（S16/S18/S15 守恒）。
      ship.mat.uniforms.uGlow.value.copy(ship.glowColor);
      ship.mat.uniforms.uGlowAmt.value = 0.22;

      // 玩家底衬辉光：与 Boss 辉光同构，按皮肤 accent 预计算色染色，加法混合 + renderOrder=-1。
      // 纯渲染层增强，不改动精灵资产、不碰逻辑（S16/S18/S15 守恒）。
      const pg = ship.glow;
      if (pg) {
        pg.visible = true;
        pg.position.set(p.x, p.y, 0);
        pg.scale.set((pw / R.baseW) * SHIP_GLOW_SCALE, (ph / R.baseH) * SHIP_GLOW_SCALE, 1);
        pg.material.color.copy(ship.glowColor);
      }

      // ---- Boss billboard（与 ship 同构：按 kind 切显 + 按 boss.hue 旋转色相）----
      // 逻辑层零侵入：只读 game.boss 的 x/y/w/h/hue/kind，绝不回写任何实体字段。
      // Boss 是纯渲染对象，不入 bullets/enemies 池（S18 不受影响，grown 守恒）。
      // 绘制参数全部由 game.boss 提供，安全默认（|| 80 / || 0）保证无 NaN。
      if (game.boss) {
        const bk = game.boss.kind;
        const bs = R.bosses[bk];
        const bm = bs || R.bosses.sentinel;
        if (R.lastBoss !== bk) {
          if (R.lastBoss && R.bosses[R.lastBoss]) {
            R.bosses[R.lastBoss].group.visible = false;
            const pg = R.bosses[R.lastBoss].glow; if (pg) pg.visible = false;
          }
          bm.group.visible = true;
          R.lastBoss = bk;
        }
        const p = mapXY(game.boss.x, game.boss.y, R.w, R.h, R.scratch);
        bm.group.position.set(p.x, p.y, 0);
        const bw = game.boss.w || 80, bh = game.boss.h || 80;
        bm.group.scale.set(bw / 80, bh / 80, 1);

        const bvx = (typeof game.boss.px === 'number') ? (game.boss.x - game.boss.px) : 0;
        const bvy = (typeof game.boss.py === 'number') ? (game.boss.y - game.boss.py) : 0;
        bm.group.rotation.z = clamp(-bvx * 0.02, -0.2, 0.2);
        bm.group.rotation.x = clamp(bvy * 0.015, -0.15, 0.15);
        bm.group.rotation.y = clamp(bvx * 0.015, -0.15, 0.15);

        // 每款 Boss 已使用独立纹理，无需再通过 hueRotate 换色。
        bm.mat.uniforms.uHue.value = 0;
        bm.mat.uniforms.uAlpha.value = 1;

        // 底衬辉光：让深色(void)/稀疏(phaser/weaverqueen)精灵在暗星云背景上始终有轮廓可读。
        // 加法混合 + 跟随 Boss 色相；纯渲染层增强，不改动精灵资产、不碰逻辑（S16/S18/S15 守恒）。
        const bg = bs && bs.glow;
        if (bg) {
          bg.visible = true;
          bg.position.set(p.x, p.y, 0);
          bg.scale.set((bw / 80) * BOSS_GLOW_SCALE, (bh / 80) * BOSS_GLOW_SCALE, 1);
          const hue = (typeof game.boss.hue === 'number') ? game.boss.hue : 210;
          const hh = ((hue % 360) + 360) % 360;
          // 低饱和 + 高亮度：辉光偏「亮白晕」而非纯色，确保对暗星云(任何色相)都有高对比，
          // 呼应 review 的「强制高对比测试色」；Boss 主题色由 sprite 本体承载，不靠辉光染色。
          bg.material.color.setHSL(hh / 360, 0.42, 0.72);
        }
      } else {
        if (R.lastBoss && R.bosses[R.lastBoss]) {
          R.bosses[R.lastBoss].group.visible = false;
          const pg = R.bosses[R.lastBoss].glow; if (pg) pg.visible = false;
        }
        R.lastBoss = null;
      }

      R.renderer.render(R.scene, R.camera);
      return true;
    } catch (e) {
      _failed = true;
      try { if (R && R.canvas && R.canvas.parentNode) R.canvas.parentNode.removeChild(R.canvas); } catch (e2) { /* noop */ }
      R = null;
      return false;
    }
  }

  /* ---- TODO(Phase 2b) 子弹 3D 通道预留钩子 -------------------------------
   * P2a 已把玩家弹的形态字段落到位（b.kind ∈ BULLET_KINDS，见 src/game.js
   * 「BULLET_KINDS 子弹形态库」一节），3D 侧接管弹幕时从这里进。
   *
   * 接入前必须先满足的四条，缺一条都不许打开这个开关：
   *   ① 实例化渲染 —— 弹数峰值 512，一弹一 Mesh 会把 draw call 打爆。
   *      按 kind 分桶，每桶一个 InstancedMesh，count 用 setDrawRange 收；
   *   ② 几何体在 init 阶段一次性建好并常驻，draw 里只写矩阵 ——
   *      逐帧 new BufferGeometry 会把 GC 压力顶到主线程，帧时间直接抖成锯齿；
   *   ③ 与 2D 层互斥 —— 参照机体的 r3dActive 开关，3D 接管后 2D 那段 forEach
   *      必须跳过，否则两层叠画，弹幕亮度翻倍、可读性归零；
   *   ④ 只读 —— 与 render3d 的全局纪律一致：这里一个字段都不许写回 game，
   *      逻辑与判定永远只活在 2D 平面上（2.5D 的边界就是这一条）。
   *
   * 现在故意留成显式空实现而不是不存在的方法：调用方可以无条件 optional-call，
   * 不用到处写 `if (r.drawBullets3D)`；返回 false = 本帧没接管，2D 照画。 */
  function drawBullets3D(/* game, now, opts */) {
    return false;
  }

  // 释放（目前只在手动排障时用；游戏内不会走到）
  function dispose() {
    if (!R) return;
    try {
      if (R.canvas && R.canvas.parentNode) R.canvas.parentNode.removeChild(R.canvas);
      R.renderer.dispose();
    } catch (e) { /* noop */ }
    R = null;
  }

  DJFE.render3d = {
    available, init, draw, drawBullets3D, dispose, mapXY,
    // 排障 / 测试用只读句柄
    _state: () => R,
    _reset: () => { _glProbe = null; _failed = false; R = null; },
  };

})(window.DJFE);
