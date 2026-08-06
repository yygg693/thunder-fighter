# 雷霆战机 · 冒烟测试计划（Phase 6 质量门打底）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 负责人 | 严守真（quality-lead） |
| 适用版本 | `src/core.js` / `entities.js` / `game.js` / `main.js` 当前主干（2031 行） |
| 测试类型 | 无头冒烟（Headless Smoke） |
| 实现位置 | `tests/stubs.js` + `tests/run-smoke.js` |
| 执行命令 | `node tests/run-smoke.js` |
| 当前状态 | **PASS** — 122 / 122 质量门通过，0 异常 / 0 NaN / 0 console 错误 |
| 硬约束 | 零依赖、不引入 Vite/ESM、不破坏 `index.html` 双击即玩（file://） |

---

## 1. 背景与目标

`docs/commercialization-refactor-plan.md` 中 **D5** 记录的债务是：

> **无测试框架**：靠一次性无头脚本人工验证，用完即删 → 回归靠手测，迭代越快越危险。

本轮要把这条债务的**底座**补上：用纯 Node + DOM/Canvas 桩固化一套**可长期保留**的冒烟测试，
让"菜单 → 开局 → 战斗 → 暂停 → 死亡 → 重开"这条主链路从今往后**每次改动都能一秒验证**。

**范围内（本期交付）**

- 4 个 `src` 脚本能在无浏览器环境下按 `index.html` 顺序加载并跑通
- 全状态机链路（menu / playing / paused / gameover / victory）自动化断言
- 运行时健康度哨兵：未捕获异常、NaN/undefined 绘制参数、console.error、DOM 元素缺失
- 长跑稳定性与实体池增长观测
- 确定性（可复现、无 flaky）

**范围外（明确不做，二期再说）**

- 单元测试框架（Vitest）、E2E（Playwright）、视觉基线、真机性能采样
- 任何构建工具链的引入
- 修改游戏逻辑代码

---

## 2. 桩环境说明

### 2.1 为什么需要桩

游戏是经典 `<script>` + `window.DJFE` 命名空间，**没有任何模块导出**，且强依赖
`document` / `canvas.getContext('2d')` / `requestAnimationFrame` / `localStorage` /
`AudioContext` / `performance.now` / `window` 事件。
在不引入 ESM 改造（本期禁止）的前提下，唯一可行路径是：
**Node `vm` 沙箱 + 手写浏览器 API 桩 + 按 index.html 顺序 `runInContext`**。

### 2.2 桩清单

| 浏览器能力 | 桩实现 | 关键行为 |
|---|---|---|
| `window` | 沙箱全局自引用（`sandbox.window = sandbox`） | `window.DJFE` 赋值即成为沙箱全局，与浏览器一致 |
| `document` | 由 **真实 `index.html` 正则解析** 构建 | `getElementById` 只认 HTML 中存在的 id；缺失 → 返回 `null` 并记 `missing-element-id` 告警 |
| `querySelectorAll` | 支持 `[data-i18n]` / `#menu .diff button` / `#settings .seg button` | 其余选择器返回空集并记 `unhandled-selector` 告警（可见、不静默） |
| Element | `classList`(含 `toggle(name, force)`) / `dataset` / `textContent` / `innerHTML` / `value` / `appendChild` / `getBoundingClientRect` / 事件收发 | 显隐断言基于 `classList.contains('hidden')` |
| Canvas 2D | 全方法桩 + **NaN 哨兵** | 数值参数出现 NaN/Infinity，或颜色串含 `"NaN"/"undefined"/"null"` → 记录来源；渐变对象 `addColorStop` 同样受检 |
| `requestAnimationFrame` | 虚拟队列，由测试手动泵帧 | 避免主循环自递归导致栈溢出；同时可精确控制帧数与 `dt` |
| `setTimeout / setInterval` | 虚拟定时器，挂在同一虚拟时钟 | BGM 音序器（`setInterval(tick, 25)`）真实参与调度，不会挂住 Node 进程 |
| `performance.now` | 虚拟时钟 | 与 rAF 的 `now` 同源，波次调度时间线一致 |
| `AudioContext` | 完整节点图桩（gain/osc/buffer/filter/bufferSource） | `currentTime` 跟随虚拟时钟；`osc.start/stop` 参数受 NaN 哨兵检查 |
| `localStorage` | Map 实现，可 `__dump()` | 用于断言最高分 / 排行榜 / 设置 / 皮肤落盘 |
| `matchMedia` | `(pointer: coarse)` 默认 false | `createEnv({touch:true})` 可切到触屏分支（本期未编用例） |
| `Math.random` | **可播种 mulberry32** | 消灭 flaky，同种子输出逐字节一致 |
| `console` | 捕获 `error` / `warn` 计入失败 | `SMOKE_VERBOSE=1` 时透传 `log` |

### 2.3 虚拟时钟

所有时间源（`performance.now` / rAF 回调参数 / 定时器到期 / `AudioContext.currentTime`）
共用一条虚拟时间轴。测试用 `env.frame(dt)` 推进一帧：

```
clock.now += dt  →  触发到期定时器  →  出队并执行本帧 rAF 回调
```

带来三个好处：

1. **零真实等待**：50 秒游戏长跑在 1.8 秒内跑完。
2. **完全可复现**：`dt` 由测试给定，不受机器负载影响。
3. **可做帧率实验**：同样 600ms 虚拟时长，分别用 `dt=1000/60` 和 `dt=1000/144` 跑，
   直接量化帧率耦合程度（见 §5 BUG-03）。

---

## 3. 流程断言（主链路）

冒烟测试共 **17 组 / 122 条质量门 + 3 条缺陷探针**。核心链路断言如下：

### 3.1 菜单 → 开局

```
加载 4 脚本 → main.js 自动 Game.init() → state == 'menu'
  ├ DJFE.Game / draw / audio / input / skins / __debug 六个门面齐全
  ├ 主循环 rAF 已注册
  ├ index.html 无缺失元素 id
  ├ 空转 120 帧：状态不漂移、有实际绘制、不生成任何实体
  └ Game.start() → state == 'playing'
      ├ 分 0 / 命 3 / 火力 1 / 波次 0
      ├ normal 难度 bombs == 1（easy 2 / hard 1，血量系数 1/2/3 分别校验）
      ├ HUD 显示、menu 隐藏
      └ 音频上下文由用户手势解锁（BGM 音序器定时器已挂载）
```

### 3.2 战斗与波次

```
700ms 内 beginWave(1) → wave==1, stage==1, isBossWave==false
  ├ 敌机按 spawnInterval 生成
  ├ 玩家自动开火产生子弹
  ├ 自动瞄准机器人驱动 400 帧 → score > 0、产生爆炸粒子、连击累积
  ├ 玩家坐标被夹在 [w/2, W-w/2] × [0.4H, H-h/2]
  └ 全实体（bullets/ebullets/enemies/items/particles/rings/boss/player）数值均为有限数
```

> **测试设计要点**：弹道是竖直的，玩家不动几乎打不到任何敌机（命中概率 ≈ 4%），
> 早期版本因此出现"score 一直是 0"的假阴性。故内置极简"自动瞄准机器人"——
> 每帧把虚拟指针挪到最近的可击目标 x 上，从而真实覆盖击杀 → 掉落 → 连击 → 加分链路。

### 3.3 暂停（重点）

```
ESC → state == 'paused'，#pause 浮层显示
  ├ 继续泵 180 帧：主循环仍在运行（保持渲染）
  ├ 但 score / wave / enemies.length / bullets.length / player.x / player.y / lastShot 全部冻结
  ├ 「继续」按钮 → playing，逻辑重新推进
  └ ESC 可反复切换 playing ⇄ paused
```

### 3.4 死亡 → 重开

```
lives 重置为 3 → 逐次注入贴脸敌弹（每次先清零 invuln/shield）
  ├ 生命轨迹严格为 [2, 1, 0]（验证"一次伤害只扣一条命"）
  ├ lives 归零 → state == 'gameover'，命数不为负
  ├ #gameover 显示 / #hud 隐藏
  ├ finalScore 文本 == 本局得分
  ├ localStorage['djfe_best_score'] 已写入
  ├ localStorage['djfe_leaderboard'] 含本局记录，且带 stage / date 字段
  └ GAMEOVER 下持续渲染 180 帧不崩
「再来一局」→ state == 'playing'
  ├ 分 0 / 命 3 / 火力 1 / 波次 0 / 关卡 1 完全复位
  ├ enemies / ebullets / items / boss 残留全部清空
  └ 波次调度与敌机生成恢复正常、无 NaN
```

### 3.5 扩展链路

- **Boss**：第 3 波触发 → 入场下落到位 → 三种弹幕 → 血量削减 → 击杀清场 + 加分 + 强制掉落 → 推进第 2 关
- **通关**：最终关清场 → `state == 'victory'`，通关面板显示
- **长跑**：3000 帧（≈50s）实体池峰值 —— 子弹 6 / 敌弹 20 / 敌机 3~6 / 粒子 44 / 道具 4 / 环 2，均远低于阈值；rAF 队列恒为 1（无泄漏）
- **resize**：400×800 与 2560×1080 切换不崩、无 NaN
- **设置/皮肤/存档**：6 个预设缩略图渲染、自定义皮肤保存落盘并自动选中、音量与设置持久化、灵敏度联动、静音开关、中英文 i18n 切换、三档难度参数
- **键盘**：WASD / 方向键位移与边界夹取

---

## 4. 通过 / 失败标准

### 4.1 判定规则

| 类别 | 数量 | 失败后果 |
|---|---|---|
| **GATE 质量门** | 122 | 任一失败 → 退出码 `1`，判定 **未达 QA**，禁止合入/发布 |
| **PROBE 探针** | 3 | 仅记录缺陷与工程指标，**不影响退出码** |
| **运行时诊断** | — | 未捕获异常 / NaN 绘制参数 / console.error / 缺失元素 id 任一非零 → S17 对应 GATE 失败 |

设计 PROBE 层的目的：**防止"已知缺陷让 CI 永远红灯"导致团队对红灯脱敏**。
已知问题登记在 §5，修复后必须把对应 PROBE **升级为 GATE**，否则会静默回归。

### 4.2 冒烟门控（Smoke Gate）

```
node tests/run-smoke.js   →  exit 0  →  PASS  →  可进入下一阶段评审
                          →  exit 1  →  FAIL  →  阻塞，必须先修复
```

**建议接入时机**

1. 每次 `src/*.js` 或 `index.html` 改动后，本地必跑。
2. `.github/workflows/` 增加一步 `node tests/run-smoke.js`（零依赖，无需 `npm ci`）。
3. 发布前（Web / Capacitor / Electron 三端打包前）跑一次，作为签字前置条件。

### 4.3 稳定性（防 flaky）验收

已完成的验证：

| 验证项 | 结果 |
|---|---|
| 6 个随机种子（1 / 7 / 42 / 99 / 20250728 / 987654） | 全部 122/122 PASS |
| 同种子两次运行输出 | **MD5 逐字节一致** |
| 单次运行耗时 | 约 1.8 秒 |
| 遗留真实定时器 / 句柄 | 无（全部虚拟化，进程正常退出） |

### 4.4 变异测试（证明质量门不是空转）

把 `src/` 复制到临时目录人为植入缺陷，验证能否被抓到：

| 植入缺陷 | 是否被捕获 | 捕获情况 |
|---|---|---|
| 注释掉 `if (game.lives <= 0) gameOver();` | ✅ | 8 条 GATE 失败（S7 全组） |
| 禁用 `Escape` 键回调 | ✅ | 5 条 GATE 失败（S6 暂停组） |
| 玩家子弹 `x` 置为 `NaN` | ✅ | 7 条 GATE 失败（S4 + S10） |
| 冲击波环 `r` 置为 `NaN` | ✅ | 4 条 GATE 失败 + 40 条 NaN 绘制参数记录 |

结论：**质量门具备真实的回归拦截能力**，非摆设。

---

## 5. 本轮发现的真实缺陷

冒烟测试实测发现 **3 个真实缺陷**，均以 PROBE 形式登记，不阻塞本期冒烟门。
**未修改任何游戏逻辑代码**，仅给出最小修复建议供程基岩评估。

---

### BUG-01 · 通关结算把"本局得分"显示成"历史最高分"

| 项 | 内容 |
|---|---|
| **严重度** | **Major**（玩家可见的结算数据错误，直接影响通关成就感与信任） |
| **位置** | `src/game.js` `victory()` 第 222–227 行 |
| **发现方式** | S15 探针 |

**复现步骤**

1. 环境：任意浏览器双击 `index.html`（或 `node tests/run-smoke.js` 看 S15）
2. 前置：`localStorage['djfe_best_score']` 已有一个较高的历史最高分（例如 1234）
3. 步骤：打一局并通关（清掉第 4 关 Boss），本局实际得分低于历史最高（例如 1210）
4. **预期**：通关面板「本局得分」显示 **1210**
5. **实际**：显示 **1234**（历史最高分）

**测试证据**

```
BUG   通关结算「本局得分」应显示本局分数而非历史最高分
      finalScoreV=1234，本局实际得分=1210，历史最高=1234
```

**根因**

```js
function victory() {
  const raw = game.score;
  game.score = DJFE.commitBest(game.score);        // ← game.score 被覆写成"历史最高分"
  const fv = document.getElementById('finalScoreV');
  if (fv) fv.textContent = game.score;             // ← 于是这里回填的是历史最高分
  ...
}
```

对照 `setState(STATE.GAMEOVER)` 分支（第 153–158 行），那里是**先**
`finalScoreEl.textContent = game.score` **再** `commitBest`，所以死亡结算是对的——
两条结算路径的语句顺序不一致，属于典型的复制粘贴走样。

**最小修复建议**（未实施，待授权）

```js
if (fv) fv.textContent = raw;   // 用 raw，而不是被覆写后的 game.score
```

更彻底的做法是**不要把 `commitBest` 的返回值写回 `game.score`**——
`game.score` 语义应始终是"本局得分"，最高分单独用 `DJFE.getBest()` 取。
`setState(GAMEOVER)` 里同样存在这个语义污染（只是恰好没造成显示错误）。

**回归测试**：修复后把 S15 的 PROBE 升级为 GATE。

---

### BUG-02 · 暂停不冻结限时增益，护盾/无敌在暂停期间被"偷走"

| 项 | 内容 |
|---|---|
| **严重度** | **Minor**（可感知的体验不一致，非阻塞） |
| **位置** | `src/game.js` — `player.shieldUntil` / `player.invulnUntil` / `game.comboUntil` / `game.nextWaveAt` / `game.waveBannerUntil` / `game.stageBannerUntil` |
| **发现方式** | S6 探针 |

**复现步骤**

1. 开局，吃到一个护盾道具 S（护盾时长 8 秒）
2. 立刻按 ESC 暂停，等待 12 秒
3. 再按 ESC 恢复
4. **预期**：护盾剩余约 8 秒（暂停不应消耗增益时间）
5. **实际**：护盾已完全失效

**测试证据**

```
BUG   暂停不应消耗护盾/无敌等限时增益
      暂停 12s 后 shieldUntil - now = -4000ms
```

**根因**

暂停时主循环只是**跳过更新分支**，但 `performance.now()` 仍在走。
所有限时状态都是**绝对时间戳**（`now + 8000`），因此暂停时长会被算进增益时长里。
同类受影响项：受击无敌 1.2s、连击 3s 窗口、下一波倒计时 `nextWaveAt`、
波次/关卡横幅显示时长。

**最小修复建议**（未实施，待授权）

引入一条**游戏内时间轴**：维护 `pausedAccum`（累计暂停毫秒），
所有逻辑改用 `gameNow = now - pausedAccum`。
在 `setState(PAUSED)` 记录 `pauseStartedAt`，在恢复时 `pausedAccum += now - pauseStartedAt`。
这也是后续接入"离线挂机 / 后台标签页回来"的必要前置。

**回归测试**：修复后把 S6 的 PROBE 升级为 GATE，并补一条"暂停 12s 后波次倒计时不提前触发"。

---

### BUG-03 · 帧率耦合：高刷屏下游戏整体加速 2.4 倍（量化确认 D8）—— ✅ 已修复（D8 固定时间步长已落地）

| 项 | 内容 |
|---|---|
| **状态** | **✅ 已修复（验证于 Phase 6 质量门复测）** —— D8 固定时间步长累加器已落地于 `src/game.js` 主循环（约 line 873-903），逻辑步频恒为 60Hz，与刷新率彻底解耦 |
| **位置** | `src/game.js` 主循环 —— 子弹 `b.y += b.vy`、敌机 `en.y += en.vy`、敌弹 `eb.x += eb.vx`、粒子、星空、Boss 下落 `b.y += 1.4`、环扩散、`game.shake *= 0.88` 等 |
| **发现方式** | S16 探针（把 `refactor-plan` D8 从"定性描述"变成"可量化数字"） |

**复现步骤（修复前）**

1. 在 60Hz 显示器上开局，观察敌机下落速度与整体难度
2. 换到 144Hz 显示器（或浏览器强制高刷）开同样难度
3. **预期**：两者速度一致
4. **修复前实际**：144Hz 下所有物体移动速度约为 60Hz 的 **2.4 倍**

**测试证据**

修复前（S16 探针，600ms 虚拟时长，注入一枚 `vy=-1` 的标记子弹测位移）：

```
INFO  600ms 内标记子弹位移 @60Hz   → 36.0px (36 帧)
INFO  600ms 内标记子弹位移 @144Hz  → 86.0px (86 帧)
BUG   144Hz / 60Hz 位移比 = 2.39x
```

修复后复测（同探针，2000ms 窗口，覆盖子弹/敌机/敌弹三类位移；详见实测记录）：

```
INFO  标记子弹位移 @60Hz → 119px (119 步)   @144Hz → 120px (120 步)   位移比 = 1.008x
INFO  敌机基础位移 @60Hz → 88px  (119 步)   @144Hz → 88px  (120 步)   位移比 = 1.000x
INFO  敌弹位移     @60Hz → 357px (119 步)   @144Hz → 360px (120 步)   位移比 = 1.008x
OK    游戏速度应与刷新率解耦（144Hz 位移 ≈ 60Hz 位移） → 位移比 ∈ [1.000, 1.008]
```

> 119 vs 120 步的 1 步差来自 2000ms / 16.67ms ≈ 119.9 步的浮点取整，属预期余量，非耦合。

**根因**

主循环虽然算出了 `dt`，但只有**部分**逻辑用了它（敌机 `fireT += dt`、
玩家键盘位移 `kx * 0.62 * dt`、相位 `phase += dt * 0.004`），
**位移主体仍是"每帧固定像素"**。于是刷新率越高，游戏跑得越快。
更棘手的是这属于**半耦合**——开火频率、Boss 开火间隔是按真实时间走的，
而弹速、敌机速度按帧走，导致高刷屏下"敌人冲得快但开火不变快"，难度曲线整体扭曲。

**修复（已实施，无需再排 Story）**

采用**固定时间步长（fixed timestep）**累加器，逻辑步频恒为 60Hz（落地代码见 `src/game.js` 主循环）：

```js
let last = performance.now();
let acc = 0;                       // 尚未消化的真实时间(ms)
const STEP = 1000 / 60;            // 逻辑步长
function loop(now) {
  let frameDt = now - last; last = now;
  if (!(frameDt > 0)) frameDt = 0;
  if (frameDt > STEP * MAX_CATCHUP) frameDt = STEP * MAX_CATCHUP; // 切后台/卡顿：丢弃多余时间
  acc += frameDt;
  while (acc >= STEP - ACC_EPS && n <= MAX_CATCHUP) { step(...); acc -= STEP; }
  render(now);
  requestAnimationFrame(loop);
}
```

好处：不用逐条改 `+= vy` 为 `+= vy * dt`，逻辑保持"每步固定像素"语义不变，
同时彻底解耦刷新率。`MAX_CATCHUP` 防止切后台回归前台时的"追帧雪崩"。

**回归测试（质量门）**：S16 探针已可升级为 GATE，阈值设为位移比 ∈ [0.85, 1.15]；
建议二期补 30Hz / 60Hz / 120Hz / 144Hz 四档矩阵（参见 §8 二期质量门）。

---

### 附：本轮未发现的问题（阴性结论，同样是结论）

- 状态机 **无卡死**：menu ⇄ playing ⇄ paused → gameover → playing → menu 全链路可反复往返
- **无内存/实体池泄漏**：3000 帧长跑后各实体池峰值均在个位数到数十量级，rAF 队列恒为 1
- **无 NaN 污染**：全程 300 万次 canvas 调用，零 NaN/undefined 绘制参数
- **无 DOM 契约破损**：`src/*.js` 引用的所有元素 id 在 `index.html` 中均真实存在
- **命数不会为负**、**炸弹数不会为负**、**一次伤害只扣一条命**
- 存档（最高分 / 排行榜 / 设置 / 皮肤）**四类均正确落盘**

---

## 6. 未覆盖项

| 未覆盖 | 原因 | 计划 |
|---|---|---|
| **视觉正确性** | Canvas 是桩，只验证"调用了、参数合法"，不验证画面 | 二期 Playwright 截图基线 |
| **真实性能 / 掉帧** | 虚拟时钟下 `dt` 由测试喂入 | 二期 Playwright + `performance` 采样 |
| **真实音频输出** | Web Audio 全桩，只保证调用链不抛 | 人工 Playtest |
| **CSS 布局 / 响应式 / 安全区** | 无样式引擎 | 二期 Playwright 视觉测试 |
| **触屏与手势分支** | `createEnv({touch:true})` 开关已预留，用例未写 | 二期补（含 `#btnBomb` / `#btnPause` / `touchUI.ingame`） |
| **浏览器差异** | vm 沙箱 ≠ Chrome / Safari / WebView | 二期 Playwright 多浏览器矩阵 |
| **Capacitor(Android) / Electron(Win) 壳** | 只覆盖 `src/` | 发布前人工端到端冒烟 |
| **`sw.js` / PWA 离线** | 未加载 | 二期 |
| **存档迁移 / 损坏容错** | 目前只测正常写入读出 | 二期 Vitest 单测（见 §7） |
| **平衡性 / 难度曲线** | 属于设计验证，不是功能验证 | Playtest 报告 |

---

## 7. 二期质量门提议

> 前提：二期若引入 Vite/ESM 与构建，必须**保留 file:// 可玩性**
> （例如 build 产物仍输出单文件 `index.html` + 经典 `<script>`），否则本提议需重新评估。

### 7.1 第 1 层 · 单元测试（Vitest）

保留本期冒烟不动，在其之上补纯逻辑单测。**优先级从高到低**：

| 模块 | 用例要点 | 为什么优先 |
|---|---|---|
| **碰撞** `DJFE.hit` | 相切 / 内含 / 相离边界值；半径为 0；坐标为负；大坐标精度 | 全游戏最底层，错一点全盘皆错；纯函数，测试成本最低 |
| **波次调度** `beginWave` | wave→stage/stageWave 映射（含 `STAGE_WAVES` 边界 3/4/6/7/12/13）；`isBossWave` 判定；`spawnInterval`/`shootInterval` 下限夹取（220 / 95） | 关卡推进的算术核心，改数值极易连带出错 |
| **存档迁移** | 无存档冷启动默认值；旧版本字段缺失时的补齐；**损坏 JSON 不崩**（`lsGet` 已有 try/catch，但 `skinState.custom` 非数组等半损坏情况需覆盖）；排行榜截断到 8 条并降序 | 对应 D6「存档裸奔」，换设备丢档 = 差评 |
| **难度与敌机权重** | `DIFFS` 三档参数；`spawnEnemy` 权重表随 stage 解锁（spinner/diver S2+、sniper S3+、splitter S4+）；权重和为 0 时的兜底 | 数值改动的回归网 |
| **计分与连击** | 连击窗口 3s 边界；倍率上限（30 连击 → 4.0x）；受击清零 | 排行榜公平性 |
| **皮肤系统** | 预设/自定义查找；删除当前使用的皮肤后回落 `cyan_knight`；自定义 id 唯一性 | 已有用户数据，回归成本高 |

**质量门**：Vitest 行覆盖率 ≥ 70%（`core.js` + `game.js` 的纯逻辑部分 ≥ 85%），分支覆盖 ≥ 60%。

### 7.2 第 2 层 · E2E（Playwright）

| 场景 | 断言 |
|---|---|
| 真实浏览器冷启动 | Chromium / WebKit / Firefox 三引擎下页面无 console.error，`DJFE.Game` 就绪 |
| 主链路 E2E | 点击「开始游戏」→ HUD 出现 → ESC 暂停 → 恢复 → 死亡 → 结算 → 重开（与冒烟同链路，但在真浏览器里） |
| 视觉基线 | 菜单 / 战斗中 / Boss 战 / 结算 四张截图基线比对（容差 ≤ 0.3%） |
| 响应式 | 360×640(手机竖屏) / 768×1024(平板) / 1920×1080 / 2560×1080(超宽) 四档布局不破 |
| 触屏 | 移动端模拟：拖拽操控、`#btnBomb`、`#btnPause` 可用 |
| 性能 | 战斗 30 秒平均帧耗时 < 8ms，长帧（>50ms）占比 < 1% |
| **高刷回归** | 强制 120Hz 下 30 秒内的波次进度与 60Hz 差异 < 10%（BUG-03 的守门人） |
| 存档持久化 | 刷新页面后最高分 / 排行榜 / 设置 / 皮肤仍在 |
| PWA | `sw.js` 注册成功；离线后仍可加载 |

**质量门**：E2E 全绿 + 视觉基线无未审批差异，作为**发布签字前置**。

### 7.3 三层门控总览

| 层 | 工具 | 触发时机 | 耗时 | 阻塞级别 |
|---|---|---|---|---|
| L1 冒烟 | 纯 Node（本期） | 每次提交 / pre-push | ~2s | 硬阻塞 |
| L2 单测 | Vitest | 每次 PR | ~10s | 硬阻塞 |
| L3 E2E + 视觉 | Playwright | 合入主干 / 发布前 | ~3min | 发布签字前置 |
| L4 Playtest | 人工 | 每个里程碑 | — | 建议性（advisory） |

---

## 8. 质量门判定（本期）

| 项 | 判定 |
|---|---|
| 冒烟脚手架可运行、可保留 | **PASS** |
| 主链路（菜单→开局→暂停→死亡→重开）覆盖 | **PASS** |
| 确定性 / 无 flaky | **PASS**（6 种子全绿 + 同种子输出逐字节一致） |
| 质量门有效性（变异测试） | **PASS**（4/4 变异被捕获） |
| 代码健康度（异常 / NaN / console / DOM 契约） | **PASS**（全零） |
| **发现的真实缺陷** | **CONCERNS** —— 1 Major（BUG-01 通关结算显示历史最高分）/ 1 Minor（BUG-02 暂停消耗限时增益）；**BUG-03 帧率耦合已由 D8 修复** |

**综合判定：PASS with CONCERNS**

冒烟质量门本身达标并可立即接入 CI；BUG-03（帧率耦合）已由 D8 固定时间步长改造修复，
S16 探针现测得位移比 ≈ 0.97–1.01x（OK），建议直接把 S16 升级为质量门作为高刷回归守门人。
剩余开放缺陷：BUG-01（Major，通关结算显示历史最高分）、BUG-02（Minor，暂停消耗限时增益）。

> 质量门为**建议性门控（advisory）**：本文档给出判定与证据，是否放行由用户决定。
> 发布签字属高影响动作，须人工审批。
