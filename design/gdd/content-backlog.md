# 内容待办与冲刺规划 · Content Backlog & Sprint Plan

> 文档定位：对 `design/gdd/` 下 6 份 GDD 做就绪度盘点，给出推荐构建顺序与第一冲刺切片。
> 状态：待主理人拍板（v1）
> 作者：文策渊（design-strategist）
> 盘点基准：`git HEAD = de68475`，工作区 `src/` 无未提交改动
> 校验手段：`node tests/run-smoke.js`（125/125 GATE PASS）、`node tools/verify.js`（**当前崩溃，见 §5**）

---

## 0. 结论摘要（先读这段）

盘点得到一个**与任务前提不符的结论，必须先纠偏**：

> **这 6 份 GDD 不是「待办清单」，而是「已基本交付的规格」。绝大部分内容已经写进 `src/` 并提交。**

逐项核实（grep + 冒烟实跑）：

| GDD 里被认为"待做"的东西 | 代码实况 |
|---|---|
| `BOSS_KINDS` 注册表取代 `bossPattern%3` | ✅ 已存在 `game.js:708`，7 款 Boss 全注册 |
| 7 关战役（含 EX·织网） | ✅ `STAGES` 已 7 项，`weaverqueen` HP 1500 已接入 |
| 六款招牌技能（overdrive/lance/swarm/beam/cloak/judgment） | ✅ 已实现，`game.js:1800-1833` |
| 擦弹 Graze 系统 | ✅ `graze/grazeMeter/maxGraze/grazeTotal` 全在 |
| 僚机 Option | ✅ `optionCount()` `game.js:1479` |
| 命中反馈分级 + 武器身份色 | ✅ `SKIN_WEAPONS` 六款均有 `hue`，`b.hue` 已写入，`baseSz` 尺寸解耦已做 |
| T3-3 战果结算面板 | ✅ `renderResultPanel()` `game.js:630` |
| T3-7 Boss 破损态/崩落/吸积盘 | ✅ `entities.js:1493-1600` |
| T3-8 排行榜擦弹列 | ✅ `core.js:37` 含旧存档兜底 |
| 皮肤面板 v2（`#skinDetail` + 中英文案） | ✅ `main.js:37-78`、`index.html:640` |
| 漂移陨石 / 道具 C·G | ✅ `rock` 敌型、`dropItem` 已含 C/G |
| **对象池**（任务书称"属未启动重构"） | ✅ **已存在** `POOL` `game.js:219`，S18 `grown===0` 冒烟已卡死 |

**重要纠偏**：任务书把「对象池」列为 `commercialization-refactor-plan.md` 的未启动产物。实际上对象池**早已落地**并被冒烟门保护。未启动的只有 **Vite / TypeScript / ESM / 关卡 JSON 化 / Tauri-Steam**。这一点影响范围判断，请主理人确认。

因此本轮真正的产出不是"排内容优先级"，而是：**识别出剩余的 4 个真实缺口**，其中 1 个是**阻塞级工具链故障**。

---

## 1. 六份 GDD 逐份盘点

评分口径：**就绪度** = 规格可执行程度；**落地度** = 代码已实现比例（本轮新增维度，因为多数已实现）。
工作量 S/M/L 指**剩余**工作量，不是原始规模。

### 1.1 `boss-gameplay-expansion.md`（2043 行）

| 维度 | 结论 |
|---|---|
| 就绪度 | ★★★★★ 规格极完整（八节齐全、含数值总表 §8.1、弹数预算 §8.2、12 步构建清单 §7.6） |
| 落地度 | **~95% 已实现**。T1/T2 全落地；T3 的陨石、道具 C/G 也已落地 |
| 依赖未启动重构 | **否**。文中 §6.2 引用的「对象池零扩容」指的是**已存在**的 `POOL`，非重构产物 |
| 玩法价值 | 高（已兑现：Boss 从换色变成 7 款独立机制） |
| 风险 | 低。残留 `bossPattern%3` legacy 分支（`game.js:1379`）作为未注册 phases 的兜底基线保留，**无害但是死代码** |
| 剩余工作量 | **S**（仅清理 legacy 分支，且非必须） |

### 1.2 `hit-feedback.md`（247 行，最新一份）

| 维度 | 结论 |
|---|---|
| 就绪度 | ★★★★★ 本次盘点中规格质量最高：三档 S/M/L 参数表、六款取色表、确定性黄金角公式、尺寸上下限、拒绝清单一应俱全 |
| 落地度 | **~95% 已实现**。§9 列的 4 项前置依赖**全部已补齐**：`SKIN_WEAPONS` 六款 `hue` ✅、`addBullet` 写 `b.hue` ✅、`baseSz` 尺寸/寿命解耦 ✅（`game.js:3125`）、`microRing` 走 `RING_FX_BUDGET` 守护 ✅（`game.js:1905`） |
| 依赖未启动重构 | **否** |
| 玩法价值 | 高（直接回应"打上去没特效/太水"三条玩家投诉） |
| 风险 | 低。§9 未决 3（`beam` 低频 tick 档位）仍未定档，属细节抛光 |
| 剩余工作量 | **S**（`beam` 档位补规格 + 实测） |

### 1.3 `skills-and-boss-identity.md`（399 行）

| 维度 | 结论 |
|---|---|
| 就绪度 | ★★★★★ 字段级实现就绪包（§0 命名唯一真源、§3.8 七款拓扑区分度 21 对自检） |
| 落地度 | **~90% 已实现**。六款技能、`#skillWrap` 独立 HUD、`skillAuto` 持久化、七款 Boss 造型全在 |
| 依赖未启动重构 | **否** |
| 玩法价值 | 高（皮肤从涂装变成机型，是当前最大的 build variety 来源） |
| 风险 | **中 —— 发现一处真实 bug**：§0.1 规定技能字段落在 `game` 对象；`setState` 的暂停补偿却写到 `player` 上（详见 §5 M-08） |
| 剩余工作量 | **S**（4 行修复） |

### 1.4 `skin-panel-v2.md`（206 行）

| 维度 | 结论 |
|---|---|
| 就绪度 | ★★★★☆ 交接清单具体到函数与行号（C-1~C-5） |
| 落地度 | **~90% 已实现**。`#skinDetail` DOM、`renderSkinCards()` 改造、中英双字典 `skin.*.name/tagline/weapon/flavor` 全在 |
| 依赖未启动重构 | **否** |
| 玩法价值 | 中（转化率/理解成本，非玩法本体） |
| 风险 | 低 |
| 剩余工作量 | **S**（B-2 预览图方案落地情况需 eng 复核） |

### 1.5 `t3-gameplay-breadth.md`（392 行）

| 维度 | 结论 |
|---|---|
| 就绪度 | ★★★★★ 每条目自带 DO/DEFER/不做 决策，罕见的好习惯 |
| 落地度 | **~85%**。T3-1 HUD 增益 ✅、T3-3 战果面板 ✅、T3-7 Boss 视觉 ✅、T3-8 擦弹排行 ✅、weaverqueen ✅ |
| 依赖未启动重构 | **T3-2「每关自定义波数」= 是**。它本质是关卡数据外置，正是 refactor-plan 的「关卡 JSON 化」。GDD 自己已判 **DEFER**，判断正确，**维持延后** |
| 玩法价值 | 中高（已兑现大部分） |
| 风险 | 低。T3-5 hydra 已明确不做 |
| 剩余工作量 | **S**（仅剩 T3-2，且应继续延后） |

### 1.6 `variety-v2.md`（884 行）

| 维度 | 结论 |
|---|---|
| 就绪度 | ★★★★★ 母本文档，DPS 校准矩阵 §6.2 收敛带 [17,22] 是全项目数值锚 |
| 落地度 | **~90%**。六款机型 + 武器 profile + 弹型 taxonomy + 七款 Boss 全落地，DPS 与注释标注一致（21.42 基线 / golden 17.14 下沿） |
| 依赖未启动重构 | **否**（§5.1 已主动划清与 3D 重平台的边界） |
| 玩法价值 | 高（项目多样性底座） |
| 风险 | 中 —— **golden 17.14 贴在收敛带 [17,22] 下沿**，若后续再削会跌出带外形成劣势策略；属需要盯的平衡位 |
| 剩余工作量 | **S** |

---

## 2. 真实剩余缺口（本轮核心产出）

盘完 6 份 GDD，真正没做完的只有 4 项。按严重度排序：

### 缺口 A · `tools/verify.js` 完全崩溃 —— 🔴 阻塞级

```
TypeError: DJFE.t is not a function
    at drawScene (game.js:3208:25)
    at Object.frame (tools/headless-harness.js:214:15)
```

**根因**：`DJFE.t()`（i18n 取词函数）定义在 `src/main.js:93`，但 `tools/headless-harness.js` **只加载 core.js / entities.js / game.js，不加载 main.js**。此前有人把 `DJFE.t('banner.stagePrefix')` 加进了 `game.js` 的渲染路径（`drawScene:3208`），于是无头环境一跑就炸。

**影响**：`verify.js` 的三条回归门（行为 parity / refresh 六档 / 性能）**全部无法运行**。任务书要求"验收标准要能被 `tests/run-smoke.js` 与 `tools/verify.js` 覆盖"——**这条现在物理上做不到**。

**这是任何内容冲刺的前置条件**：没有 parity 门，改动是否引入行为回归无从判断。

**修法（二选一，建议 eng 拍板）**：
- 方案 A（推荐，改动最小）：`headless-harness.js` 里补一个 `DJFE.t = k => k` 的桩，与它已有的 DOM 桩同规格。
- 方案 B：harness 也加载 `main.js`。风险高——`main.js` 带 DOM 绑定与 localStorage 副作用，会污染 parity 基线。

### 缺口 B · i18n 硬编码 19 处 —— 🟠 内容级，且是唯一真正的"内容缺口"

`game.js:570-580` 的 7 个关卡名 + 7 个 Boss 名全是中文字面量；另有 `'第'/'关'`（`:551`）、`'散射 '`（`:2781`）等 HUD 串。英文玩家在 itch.io Demo 上看到中英混排。

这同时是**缺口 A 的诱因**——i18n 改造做了一半（`DJFE.t` 已被 `game.js` 引用），却没做完，还顺手炸了工具链。**A 和 B 应当作一件事处理。**

### 缺口 C · `beam` 命中反馈档位未定（hit-feedback §9-3）—— 🟡 抛光级

`kind='beam'`（violet 技能光柱）是持续光柱、每步 0.8 伤，S/M/L 三档不适用。GDD 建议"每 3 逻辑步出 1 次淡火花 + 周期微环"，但未定参数。属细节，不阻塞。

### 缺口 D · T3-2 每关自定义波数 —— ⬜ 维持延后

依赖关卡数据外置（= refactor-plan 的「关卡 JSON 化」，未启动）。GDD 自判 DEFER，**同意维持**。当前 `STAGE_WAVES` 均匀波数在 7 关下仍能工作。

---

## 3. 发布侧已知 bug（单列 · 与内容范围无关）

> 按任务书要求单列。这三项**不属于内容扩充**，是无论先做哪块都该顺手清掉的独立修复。
> 盘点后**有两项与任务书描述不符**，请主理人注意。

### M-07 · 通关结算显示错分 —— 🔴 仍然存活，且**冒烟测试是假绿**

`game.js:652-657`：

```js
const raw = game.score;
game.score = DJFE.commitBest(game.score);   // commitBest 返回的是「历史最高」
...
fv.textContent = game.score;                // 于是显示 max(本局, 历史最高)
```

`core.js:27` 的 `commitBest` 返回 `bestScore`（取大者）。所以本局分低于历史最高时，结算面板显示历史最高分。**bug 属实。**

**但更值得警惕的是测试假绿**：`tests/run-smoke.js:577` 特意设 `score = 10`（注释写"故意设一个远低于历史最高分的本局得分"），可是**通关波次奖励 `+finalWave*100 = +2100`** 把它推到 2110，反超种子最高分 1234 —— 于是探针输出 `OK`：

```
OK  通关结算「本局得分」应显示本局分数而非历史最高分
    → finalScoreV=2110，本局实际得分=2110，历史最高=1234
```

**这条探针永远抓不到这个 bug。** 修 M-07 时必须同步把种子 best 抬到 2110 以上（建议 9999），否则修完也证明不了。
`raw` 变量已经存在且未被使用——修复就是把 `fv.textContent = game.score` 改成 `raw`。

### M-08 · 暂停偷走增益时间 —— 🟠 **只修好了 2/6，仍存活**

`setState()` `game.js:495-508` 已加暂停补偿，但**字段挂错对象**：

```js
const p = player;
if (_pauseLogicAt < p.shieldUntil)     p.shieldUntil     += pausedDur;  // ✅ player 确有此字段
if (_pauseLogicAt < p.invulnUntil)     p.invulnUntil     += pausedDur;  // ✅ player 确有此字段
if (_pauseLogicAt < p.cloakUntil)      p.cloakUntil      += pausedDur;  // ❌ 空转
if (_pauseLogicAt < p.dashUntil)       p.dashUntil       += pausedDur;  // ❌ 空转
if (_pauseLogicAt < p.overdriveUntil)  p.overdriveUntil  += pausedDur;  // ❌ 空转
if (_pauseLogicAt < p.skillCdUntil)    p.skillCdUntil    += pausedDur;  // ❌ 空转
```

grep 实证（`src/game.js` 引用计数）：

| 字段 | `game.X` | `player.X` | 真实归属 |
|---|---|---|---|
| `shieldUntil` | 0 | 7 | player ✅ |
| `invulnUntil` | 0 | 10 | player ✅ |
| `cloakUntil` | 9 | 0 | **game** ❌ |
| `dashUntil` | 3 | 0 | **game** ❌ |
| `overdriveUntil` | 4 | 0 | **game** ❌ |
| `skillCdUntil` | 3 | 0 | **game** ❌ |

`player` 定义（`game.js:102`）只有 `invulnUntil / shieldUntil`。后 4 个是 `skills-and-boss-identity.md §0.1` 明确规定"落在 `game` 对象"的技能字段。
于是 `_pauseLogicAt < undefined` 恒为 `false`，四条分支从不执行——**暂停仍然偷走全部 4 个技能类增益的时间**。

**修复**：把这 4 行的 `p.` 改成 `game.`（4 字符改动）。并补一条冒烟门覆盖技能类增益（现有 S6 探针只覆盖 shield/invuln）。

### B-02 · `sw.js` 缓存版本号 —— ✅ **已修复，可从待办移除**

`sw.js:9` 与 `www/sw.js:9` 均为 `const CACHE = 'djfe-v1.3.4'`，两份副本一致。
⚠️ 附带发现：`package.json` 仍是 `"version": "1.2.0"`，与 sw 的 `v1.3.4` 不一致。不影响缓存失效（只要值变了就行），但建议发布前统一版本口径。

---

## 4. 推荐构建顺序

排序依据三条：① 工具链先于内容（没有回归门就没有安全网）② 修复先于新增（存量 bug 会污染新内容的验收）③ 小切片先于大切片。

| 序 | 事项 | 类型 | 量 | 为什么排这里 |
|---|---|---|---|---|
| **0** | 修 `verify.js` 的 `DJFE.t` 桩（缺口 A） | 工具链 | S | **前置条件**。不修则 parity/refresh 门全灭，之后任何改动都无法证明无回归 |
| **1** | i18n 收口：关卡名/Boss 名/HUD 串外置（缺口 B） | 内容 | M | 与 0 同源（是它的诱因），一起做才闭环；是唯一真正的内容缺口；直接影响已公开 Demo 的海外观感 |
| **2** | M-08 四字段挂错修复 + 补冒烟门 | Bug | S | 4 字符改动，风险极低，顺手清 |
| **3** | M-07 显示错分 + **修假绿探针** | Bug | S | 同上；但必须连探针一起修，否则无法验收 |
| **4** | `beam` 命中反馈档位定档（缺口 C） | 抛光 | S | 抛光级，可并入任意冲刺尾巴 |
| **5** | 清理 `bossPattern%3` legacy 死分支 | 卫生 | S | 无害，可选；建议留到有 parity 门之后再动 |
| — | T3-2 每关自定义波数（缺口 D） | — | — | **维持延后**，等关卡 JSON 化重构评审通过 |

> 序 0-3 合起来仍是一个小冲刺。**这印证了本轮的核心判断：项目内容侧已经很满，缺的是收口而不是加料。**
> 若老板确实想要"更多新内容"，那么 6 份 GDD 里已无现成规格可用，需要**新立项**（例如新机型、新 Boss、难度档、Boss Rush 模式）——请主理人回问老板确认意图。

---

## 5. 推荐第一冲刺切片

### 切片名：**「无头回归门修复 + i18n 收口」**

选它的理由（一句话）：**它是唯一同时解决「工具链阻塞」和「唯一真实内容缺口」的连贯切片，且这两件事本来就是同一次半成品改造的正反面——分开做等于把同一个坑踩两遍。**

为什么不选别的：
- 不选"加新 Boss/新机型"：6 份 GDD 已无现成规格，属新立项，不符合"低风险小切片"。
- 不选"先修 M-07/M-08"：它们更小更独立，但**在 parity 门修好前无法证明没引入回归**，应排在切片之后（或作为切片尾部搭车）。

### 涉及系统

| 文件 | 改动性质 |
|---|---|
| `tools/headless-harness.js` | 新增 `DJFE.t` 桩（与既有 DOM 桩同规格） |
| `src/main.js` | `I18N.zh` / `I18N.en` 各补 `stage.*` / `boss.*` / `hud.*` 键 |
| `src/game.js` | `STAGES` 的 `name`/`bossName` 由字面量改为 i18n key；取词处走 `DJFE.t()` |
| `tests/run-smoke.js` | 新增 i18n 完整性门 |

### 需要的新状态 / 数据

**不新增任何运行时状态、不新增池、不新增 DOM id。** 纯粹是字面量 → key 的替换。

建议 key 命名（沿用既有 `skin.*.name` 风格）：

```
stage.1.name … stage.7.name          // 近地轨道 … EX·织网
boss.sentinel.name … boss.weaverqueen.name   // 按 bossKind 取，比按序号稳
hud.stagePrefix / hud.stageSuffix    // 替代 '第' / '关'
buff.spread                          // 替代 '散射 '
```

> 设计决策：Boss 名建议按 **`bossKind`** 而非关卡序号取键。因为 `bossKind` 是 `BOSS_KINDS` 注册表的稳定主键，将来若调整关卡顺序或复用 Boss，键不会错位。

### 粗略工作量

**M（约半天～1 天）**。拆解：`DJFE.t` 桩 S；14 个名字 + 4 个 HUD 串双语 S；取词处改造 S；冒烟门 S。

### 验收标准（可被现有测试套件覆盖 / 扩展）

| # | 断言 | 载体 |
|---|---|---|
| A1 | `node tools/verify.js` **能跑完不抛异常** | `tools/verify.js`（当前红，修完转绿） |
| A2 | 行为 parity：baseline vs current @60Hz 逐帧全量状态一致 | `verify.js parity`（i18n 是纯显示层，**必须零行为差**） |
| A3 | 六档刷新率逻辑步数一致（30/60/72/120/144/240Hz） | `verify.js refresh` + 冒烟 S16（现已绿，不得转红） |
| A4 | 对象池 `grown === 0` | 冒烟 S18（现已绿，不得转红） |
| A5 | **新增**：`I18N.zh` 与 `I18N.en` 键集合完全相同（无单边缺键） | 扩展 `tests/run-smoke.js` |
| A6 | **新增**：`STAGES` 中不存在中文字面量（正则 `[\u4e00-\u9fa5]` 扫描） | 扩展 `tests/run-smoke.js` |
| A7 | **新增**：切到 `en` 跑完一局，零 `undefined` / 零裸 key 泄漏到 DOM | 扩展 `tests/run-smoke.js`（复用既有 DOM 桩） |
| A8 | 零 NaN 绘制参数、零 console.error、零缺失 DOM id | 冒烟 S17（现已绿，不得转红） |

> A2 是本切片最关键的门：**i18n 改造若改变了任何逻辑状态，就是做错了。**

### 可选搭车项（若切片提前完成）

M-08 四字段修复 + M-07 显示错分修复 + 两条探针加固。三项合计 < 10 行代码，但**必须在 A1 转绿之后做**，这样才有 parity 门兜底。

---

## 6. 风险与取舍

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| R1 | **盘点前提被推翻**：6 份 GDD 已基本落地，"内容扩充"若指"加新东西"，则现有 GDD 供不出料 | 高 | **需主理人回问老板**：要的是"收口现有内容"还是"新立项加料"？两者路径完全不同 |
| R2 | `verify.js` 崩溃期间已合入的改动，其行为回归**从未被验证过** | 中高 | 修好 A1 后，建议先跑一次 parity 对 `de68475` 建基线，确认当前状态干净 |
| R3 | 冒烟探针存在**假绿**（M-07 已证实一例） | 中 | 建议 quality 复查另一条探针的判据是否也被业务逻辑架空 |
| R4 | golden 皮肤 DPS 17.14 贴收敛带 [17,22] 下沿 | 中 | 平衡红线：后续任何削弱都会跌出带外形成劣势策略，改动前须回看 `variety-v2 §6.2` |
| R5 | i18n 改 `STAGES` 可能触碰 `__debug.stageCount` 等测试依赖 | 低 | 只改 `name`/`bossName` 字段值，不改数组长度与结构，`STAGES.length` 语义不变 |
| R6 | `package.json 1.2.0` 与 `sw.js v1.3.4` 版本口径不一致 | 低 | 发布前统一，非本切片范围 |

### 明确记录的取舍

1. **不碰 T3-2 每关自定义波数** —— 它依赖关卡 JSON 化（未启动重构）。GDD 自判 DEFER，本盘点同意。
2. **不清理 `bossPattern%3` legacy 分支** —— 死代码无害，且在 parity 门恢复前动它得不偿失。
3. **不把 M-07/M-08 混入内容范围** —— 按任务书要求单列（§3），作为可搭车的独立修复。
4. **不假设任何重构产物** —— 本文所有建议均基于当前经典 `<script>` + `window.DJFE` 架构，无 Vite / TS / ESM 依赖。（注意：对象池**不是**重构产物，它已存在。）

---

## 7. 待主理人 / 老板拍板项

1. **【最重要】"内容扩充"的确切含义？** 现有 6 份 GDD 已 ~90% 落地。是要 (a) 收口这剩下的 10% + 修 bug，还是 (b) 新立项做全新内容（新机型 / 新 Boss / Boss Rush / 难度档）？本文按 (a) 给了切片；若是 (b)，我需要另起一轮概念孵化。
2. **确认对象池认知纠偏** —— 任务书称其属未启动重构，实为已落地。请确认后续范围判断以本文为准。
3. **第一冲刺切片是否采纳**「无头回归门修复 + i18n 收口」？还是优先清 M-07/M-08 这类玩家可见 bug？（我推荐前者，因为后者缺验收手段。）
4. **`verify.js` 修法选 A 还是 B？** 建议 A（加桩），但这属工程判断，建议转 engineering-lead 定夺。
5. **M-07 探针修法**：种子 best 抬到 9999，还是改用"不给通关奖励"的路径构造？前者更简单。

---

## 8. 附录 · 本次盘点的核查证据

```
git HEAD              de68475（src/ 与 index.html 无未提交改动）
node tests/run-smoke.js   GATE 125/125 PASS，PROBE 2/2「正常」（其中 1 条经查为假绿）
node tools/verify.js      CRASH — TypeError: DJFE.t is not a function @ game.js:3208

关键行号（供 engineering-lead 直接跳转）
  POOL 对象池定义          game.js:219-225
  BOSS_KINDS 注册表        game.js:708
  STAGES 七关表            game.js:565-581
  legacy bossPattern%3     game.js:1377-1392
  victory() M-07           game.js:652-657
  setState() M-08          game.js:495-508
  player 字段定义          game.js:102
  game 技能字段定义        game.js:70-80
  SKIN_WEAPONS（含 hue）   game.js:2071-2078
  addBullet 写 b.hue       game.js:266-267
  命中冲击 + microRing     game.js:1890-1905
  粒子 baseSz 尺寸解耦     game.js:3123-3125
  renderResultPanel        game.js:630-650
  drawScene 的 DJFE.t 调用 game.js:3208
  DJFE.t 定义（main.js）   main.js:93
  commitBest               core.js:27
  T3-7 破损态/氛围层       entities.js:1493-1600
  M-07 假绿探针            tests/run-smoke.js:577-595
```

---

*（本文档为设计盘点与规划，不含实现代码；未改动 `src/` 任何文件。）*





