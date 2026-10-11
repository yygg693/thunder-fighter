# 收口 + 优化构建计划（Plan A）

> **文档定位**：本计划由 design-strategist（文策渊）产出，是**纯规格文档**，不修改 `src/` 任何文件。
> 上游依据：`design/gdd/content-backlog.md`（内容盘点与冲刺规划，已确认 6 份 GDD ~95% 已落地）。
> 方向：主理人拍板为 **(a) 收口剩余 10% + 针对性优化，不新立项**。
> 读者：engineering-lead（在 Task #3 卫生项修复后，经 quality 独立复验通过，由 team-lead 路由认领）。

> ## 🔒 文档状态：定稿 v1（locked）
> 主理人已拍板两项决策，文档进入定稿：① 缺口 C 周期微环**启用**（§3.2 locked）；② §2.2 英文译法**采用建议稿**（locked，itch.io 微调非阻塞）。
> 后续路由：Sprint 1→3 待 engineering-lead 的 Task #3 全绿、且经 quality 独立复验通过后，由 team-lead 认领。本计划未修改 `src/`。

## 0. 范围与边界（Scope & Boundaries）

- **方向 (a)**：收口剩余 10% + 针对性优化，**不新立项**。所有内容均在已落地 GDD 框架内做收尾与打磨。
- **本计划纯规格**：design-strategist 不修改 `src/` 任何文件；落地由 engineering-lead 在卫生项（Task #3）修复后认领。
- **前置依赖（硬）**：engineering-lead 的 Task #3 —— 修 `verify.js` 崩溃（缺口 A：`DJFE.t` 桩）、M-07（通关结算错分）、M-08（暂停偷增益）**必须先行完成**。否则 parity / refresh 回归门全灭，本计划任何改动都无法证明"无回归"。本计划**不触碰**缺口 A / M-07 / M-08，也不改 `src/`。
- **设计红线（任何一步都须守住）**：
  1. **零行为差**：i18n 与 feel 优化是纯表现层；任何改动经 `verify.js parity` 必须**逐帧逻辑状态一致**。i18n 若改变了任何逻辑状态，就是做错了。
  2. **不推 golden 出带**：DPS 收敛带 `[17.0, 22.0]`（variety-v2 §6.2 C1）；golden 主武器 17.14 位于下沿（−19.9%，"反群体特化"定价）。任何改动不得让 golden 从"下沿特化"退化为"数值劣势策略"。
  3. **不引入主导策略 / 不认知过载 / 不支柱漂移**（设计理论红线）。

## 1. 冲刺总览（Sprint Overview）

| 冲刺 | 一句话范围 | 负责 | 准入门（gate） |
|---|---|---|---|
| **0** | 修 `verify.js` 崩溃 + M-07 + M-08（卫生项保底，非本计划） | eng / Task #3 | `verify.js` 不崩 + parity 绿 |
| **1** | 缺口 B：关卡名 / Boss 名 / HUD 串 i18n 外置（唯一真正内容缺口） | eng | A5/A6/A7 + parity 零差 |
| **2** | 缺口 C：beam 命中反馈定档（含周期微环，✅已拍板启用） | eng | rings 预算探针 + parity |
| **3** | 定向优化 + 验证门（perf / balance / accessibility，多为验证型） | eng | `run-smoke` 全绿 + parity |

> **每冲刺铁律**：提交前 `node tools/verify.js`（parity/refresh/perf）必须全绿，且 `node tests/run-smoke.js` 全绿；任一改动保持零行为差。**Sprint 0 是 Sprint 1–3 的前置条件**——未过则后续不可开工。


## 2. 缺口 B · i18n 收口（implementation-ready mini-spec）

> 现状（`content-backlog.md` Gap B）：`game.js:565–581` 的 7 个关卡名 + 7 个 Boss 名全是中文字面量；另有 `'第'/'关'`（`game.js:551`）、`'散射 '`（`game.js:2781`）等 HUD 串。英文玩家在已公开 Demo 上看到中英混排。这也是缺口 A 的诱因——i18n 做了一半却没做完，还顺手炸了工具链。A 与 B 应作一件事处理，但 A 已由 eng 在 Task #3 修复（桩已加），本计划只收 B。

### 2.1 Key 命名规则

| 类别 | 主键（primary key） | key 形态 | 示例 |
|---|---|---|---|
| 关卡名 | `game.stage`（1-indexed） | `stage.{n}.name` | `stage.1.name` … `stage.7.name` |
| Boss 名 | `bossKind`（取自 `STAGES[i].bossKind`，比关卡序更稳） | `boss.{kind}.name` | `boss.sentinel.name` |
| 增益 HUD | 固定 | `buff.spread` | `buff.spread` |
| 排行榜关标 | 固定 | `result.stagePrefix` / `result.stageSuffix` | `result.stagePrefix`=`第` / `result.stageSuffix`=`关` |

> Boss 以 `bossKind` 而非 `stage` 作主键：Boss 种类由 `BOSS_KINDS` 注册表驱动（`game.js:708`），与关卡序解耦，未来加关/加 Boss 不牵动 key。kind 集合 = `{sentinel, scorpion, carrier, core, phaser, void, weaverqueen}`（7 款，与 `STAGES` 一一对应）。

### 2.2 需新增的 I18N keys（`core.js` 的 `I18N.zh` / `I18N.en`，**两套 key-set 必须全等** → A5）

**关卡名 `stage.{n}.name`**

| key | zh | en |
|---|---|---|
| `stage.1.name` | 近地轨道 | LOW ORBIT |
| `stage.2.name` | 陨石带 | ASTEROID BELT |
| `stage.3.name` | 电离层 | IONOSPHERE |
| `stage.4.name` | 深空要塞 | DEEP FORTRESS |
| `stage.5.name` | 相位回廊 | PHASE CORRIDOR |
| `stage.6.name` | 终末虚空 | TERMINUS VOID |
| `stage.7.name` | EX·织网 | EX·WEAVER |

**Boss 名 `boss.{kind}.name`**

| key | zh | en |
|---|---|---|
| `boss.sentinel.name` | 哨戒机甲 | SENTINEL |
| `boss.scorpion.name` | 采矿巨蝎 | SCORPION |
| `boss.carrier.name` | 雷云母舰 | CARRIER |
| `boss.core.name` | 歼灭核心 | ANNIHILATOR CORE |
| `boss.phaser.name` | 相位幻影 | PHASE PHANTOM |
| `boss.void.name` | 终末虚空 | TERMINUS VOID |
| `boss.weaverqueen.name` | 织网者 | WEAVER QUEEN |

**HUD / 排行榜**

| key | zh | en | 替代的原硬编码 |
|---|---|---|---|
| `buff.spread` | 散射 | SPREAD | `game.js:2781` 的 `'散射 '` |
| `result.stagePrefix` | 第 | STAGE | `game.js:551` 的 `'第'` |
| `result.stageSuffix` | 关 | （空串） | `game.js:551` 的 `'关'` |

> 注：`banner.stagePrefix` / `banner.wavePrefix` / `banner.waveSuffix` / `banner.bossWave` 已由 eng 在 Task #3 一并补入 `core.js`（见 `core.js:73` / `:107`），本计划不复述，仅复用。

> ✅ **已拍板 / locked**：§2.2 英文译法（含 `ANNIHILATOR CORE` / `WEAVER QUEEN` / `EX·WEAVER`）全部采用建议稿。若与 itch.io 商店文案有更顺的微调空间，可在定稿里顺手调，但**不得阻塞** Sprint 1。


### 2.3 `game.js` 修改点（精确行号，行为零差）

| 行号 | 现状 | 改法 | 行为影响 |
|---|---|---|---|
| `565–581`（`STAGES`） | `name:'近地轨道'`, `bossName:'哨戒机甲'` 等 14 处中文 | 字段改名存 **ASCII key**：`nameKey:'stage.1.name'`、`bossKey:'boss.sentinel.name'`（其余 6 关同构） | **零行为差**：只改字段值/名，不改数组长度与结构，`STAGES.length` 语义不变，`__debug.stageCount` 不受影响 |
| `1031`（`spawnBoss`） | `name: st.bossName` | `name: DJFE.t(st.bossKey)`（按当前 lang 解析） | 纯显示层；`b.name` 仍为中文/英文字符串，下游 `measureText` 截断逻辑照常 |
| `3211`（关卡横幅） | `ctx.fillText(stg.name, ...)` | `ctx.fillText(DJFE.t(stg.nameKey), ...)` | 纯显示层 |
| `551`（排行榜） | `'第' + e.stage + '关'` | `DJFE.t('result.stagePrefix') + ' ' + e.stage + DJFE.t('result.stageSuffix')` | 纯显示层；en 下显示 `STAGE 3`，zh 下 `第 3 关` |
| `2781`（增益 HUD） | `(lang==='en'?'SPREAD ':'散射 ') + sec + 's'` | `DJFE.t('buff.spread') + ' ' + sec + 's'` | 纯显示层；去掉内联 lang 分支 |
| `3286`（Boss 名签） | `b.name \|\| DJFE.t('boss.default')` | **无需改**（`b.name` 已在 `1031` 解析为本地化串）；仅验证 | — |

> **关键约束**：`STAGES` 是模块顶层 `const`，其 `nameKey`/`bossKey` 为 ASCII 字面量 → A6 对 `STAGES` 扫描中文为 0。取词在**运行时**按 `DJFE.settings.lang` 解析（横幅/排行榜/Boss 名签均走 `DJFE.t`），lang 切换即时生效，无需重载。

### 2.4 验收门 A5 / A6 / A7（具体可落地）

- **A5 · 双语 key-set 全等**：脚本比对 `Object.keys(I18N.zh)` 与 `Object.keys(I18N.en)` 集合相等（含本次新增的全部 key）。任一 key 单边缺失 → 门红。可放进 `tests/run-smoke.js` 作为 `gate`。
- **A6 · 中文字面量清零**：对 `STAGES` 源码做正则 `[\u4e00-\u9fa5]` 扫描，结果必须为 0（Boss 名/关卡名已改为 ASCII key）。**扩散扫描**：对 `game.js` + `main.js` 所有"显示用"字符串字面量做同一正则扫描，除注释与既有 `DJFE.t` 已覆盖处外，不得残留未外置的中文显示串。建议写成 `tools/verify.js` 的 `refresh` 子门或独立 `grep` 断言。
- **A7 · en 实跑零泄漏**：在 `tests/run-smoke.js` 中设 `DJFE.settings.lang='en'`，跑一条覆盖 Boss 生成 + 关卡横幅 + 排行榜 + 增益 HUD 的路径；断言 `byId`（见 `tests/stubs.js` 的 `byId` Map）所有 `textContent`：
  1. 不含字面量 `'undefined'`；
  2. 不等于任何 i18n key（裸 key 泄漏：如某 `textContent==='stage.1.name'` 表示取词失败）。
  > 利用 `stubs.js` 的 `missingIds` Set + `byId` Map 可直接扫描，无需真实 DOM。

### 2.5 风险 / 取舍

- **R（低）**：`STAGES` 改字段名若遗漏某处取词，会出现 `undefined` 或裸 key——由 A5/A6/A7 三重门兜死。
- **R（低，来自 backlog R5）**：只改 `name`/`bossName` 字段值，不改数组长度/结构，`STAGES.length` 与 `__debug.stageCount` 语义不变，冒烟 S15 的 `finalWave` 派生不受影响。
- **取舍**：Boss 名以 `bossKind` 主键，意味着同一 Boss 在任意关卡显示同名（当前即如此，无回归）；若未来需要"同名 Boss 分关别称"再扩 key，不在本计划。


## 3. 缺口 C · beam 命中反馈档位定档

> 依据：`hit-feedback.md` §3.3（beam 不适用离散命中档，见 §9 未决 3）、§6（sz₀∈[4,9]，microRing maxR∈[12,30]）。当前 `game.js` 已实现 beam 轻量档基线。

### 3.1 现状（已合并基线，eng 在 Task #2 期间落地）

- `game.js:1876–1879`：`mode==='beam'` → `N=1; spdMin=0.8; spdMax=1.2; sz0=4; microRing=0; life=0.4; ar=3`。`sz0=4` 已对齐 GDD §6 硬下限（代码注释确认原 3 低于下限、经主理人拍板改 4）。
- `game.js:2532`：命中循环 `if (!isBeam || (game.runFrames % 3 === 0)) spawnHitImpact(...)` —— beam **每 3 逻辑步**节流一次（≈20 火花/s @60Hz）。
- `game.js:1904–1905`：微冲击环守卫 `if (microRing > 0 && mode !== 'beam') { if (game.rings.length < RING_FX_BUDGET) addRing(...) }` —— **显式排除 beam**，故当前 beam **无**周期微环。

### 3.2 定档参数 ✅ 已拍板 / locked（启用周期微环）

**确认项（已是合并基线，保持不变）**
- 连续 beam：`N=1` 淡火花 / 每 `3` 逻辑步一次；`spd 0.8–1.2`、`sz0=4`、`life=0.4`、角度确定性（黄金角相位，按受击敌机下标 `ei` 错开，S16 零 RNG）。

**周期微环（✅ 主理人拍板启用；收口 `hit-feedback.md` §9 未决 3，给连续 beam 可见"连接"脉冲；纯 FX，零行为差）**
- 周期微环：`period = 24` 逻辑步（≈400ms @60Hz），在 beam 命中节流点基础上额外每 24 步出一道微环。
- 半径：`r0=8 → rMax=16`（扩张，落于 §6 maxR∈[12,30] 内）。
- 透明度：`alpha=0.22`；色相：`hue = b.hue`（与受击弹同色，强化"咬到了"）。
- **守卫**：`if (game.rings.length < RING_FX_BUDGET)`（`RING_FX_BUDGET=80`，`game.js:1905`）—— 预算满则跳过出环，绝不报错/越界。
- **代码改动**：放开 `game.js:1904` 的 `mode !== 'beam'` 限制，使 beam 也能走微环分支（beam 专用 `period` 节流在调用处叠加，避免与 M/L 档共用频率）。

> **已拍板（locked）**：缺口 C 周期微环**启用**，作为 Sprint 2 的 feel 增强纳入；受 `RING_FX_BUDGET` 守护、纯 FX、零行为差。无需再议。

### 3.3 边界情况（edge cases）

| 场景 | 处理 |
|---|---|
| beam 同一帧命中多敌 | 每个受击敌按各自 `ei` 相位错开出火花（`game.js:1893`）；微环按 24 步全局节流，不随敌数放大 |
| `rings` 池达 `RING_FX_BUDGET` 水位 | 跳过 `addRing`，无异常、无 NaN（`game.js:1905` 守卫） |
| 切换语言 | 纯显示层，`b.hue` 取色不受影响，零行为差 |
| beam 中途被 Bomb 清屏打断 | 命中循环随 `state` 退出，残留粒子按既有生命周期自然消亡，无悬挂引用 |

### 3.4 验收

- **smoke 探针**：beam 技能激活期间，断言 `game.rings.length <= RING_FX_BUDGET` 恒成立；断言所有 `ring` 字段（x/y/hue/r/alpha）无 `NaN`。
- **verify.js parity（en 跑）**：beam 是纯 FX，逻辑状态逐帧必须与 zh 基准一致（零行为差）。


## 4. 定向优化清单（Targeted Optimizations）

> 原则：优先**行为中性 / 低风险高价值**；需动数值的一律只"验证不改参"，严守红线（不推 golden 出 [17,22]、不引入主导策略）。每项给出：动机 / 改动点(file:line) / 风险 / 验收。

### OPT-FX-1 · beam 周期微环（feel，合并缺口 C）
- **动机**：收口 `hit-feedback.md` §9 未决 3，给连续 beam 可见连接反馈。
- **改动点**：`game.js:1876` / `:1904`（放开 beam 微环守卫）+ `:2532`（叠加 24 步周期节流）。
- **风险**：纯 FX，零行为差；受 `RING_FX_BUDGET` 守护。
- **验收**：§3.4 探针 + parity。（已在 §3 详述）

### OPT-PERF-1 · Boss 名 `measureText` 每帧缓存（perf，行为中性，低优）
- **动机**：`game.js:3288–3290` 每帧对 `b.name` 做 `measureText` 截断 `while` 循环；`b.name` 在 `spawnBoss` 时已定、战斗内不变，可一次性缓存避免每帧 canvas 调用。
- **改动点**：`game.js:3288` 改为在 `spawnBoss`（`~1031`）或首次渲染时计算 `b.nameShown` 一次，渲染只读缓存。
- **风险**：行为中性（截断结果与现算法逐字一致）；低优——headless 下无真实 `measureText`，benefit 主要体现在真机长 Boss 战。
- **验收**：`run-smoke` 全绿；可加"同输入同输出"断言；真机帧时抽样对照（手动）。

### OPT-BAL-1 · DPS 收敛回归门（balance，验证型，零改参）
- **动机**：守住 variety-v2 §6.2 C1 收敛带，防未来任何改动把 golden 推成劣势策略。
- **改动点**：**不改任何数值**；仅在 `tests/run-smoke.js` 加 `metric('dps.golden', ...)` + 断言 `∈ [17.0, 22.0]`，并覆盖全 6 机型 p3 单目标 DPS 均落带。
- **风险**：零（纯探针）；若门红说明别处已越界，回头修源头而非松带。
- **验收**：`run-smoke` 中 golden=17.14 在带内、极差 [18.0,22.4]（Boss 战）达标（variety-v2 §6.2 末表）。

### OPT-ACC-1 · 命中反馈尺寸/色相边界断言（accessibility，验证型）
- **动机**：`hit-feedback.md` §6 给出 sz₀∈[4,9]、microRing maxR∈[12,30]、总外扩≤60px 的可访问性包络；防未来编辑把尺寸/色相漂出包络（"太小看不见"或"糊过敌机"）。
- **改动点**：**不改渲染**；在 `run-smoke` 加探针读取 `spawnHitImpact` 解析后的 `sz0`/`microRing` 等参数，断言 S/M/L 各档 ∈ §6 区间、beam `sz0=4` 达下限。
- **风险**：零；仅当别处改坏参数时门红。
- **验收**：`run-smoke` 全档位尺寸/微环断言通过。

### OPT-FEEL-1 · 增益 HUD 可读性复核（feel/accessibility，合并缺口 B）
- **动机**：`'散射 '` 内联 lang 分支已并入 §2.3（走 `DJFE.t('buff.spread')`）；顺带复核倒计时 `ceil` 秒显示与弹型收回同源（代码注释已确认 `game.js:2772` 同源 now）。
- **改动点**：无新增（B 已覆盖）；仅验证 en 下显示 `SPREAD Ns` 无裸串。
- **风险**：零。
- **验收**：A7 覆盖。

> **明确不做的优化**：任何上调/下调 DPS、HP、掉率等数值的"平衡优化"——一律归入验证门（OPT-BAL-1）监控，不在本计划动参。详见 §6 排除项。


## 5. 优先级与冲刺切分（Priority & Sprints）

**前置**：Sprint 0（eng / Task #3）必须全绿，否则后续不可开工。

### Sprint 1 · i18n 收口（缺口 B）— 优先级最高
- 范围：§2.2 新增 17 关卡/Boss 名 + 3 HUD/排行榜 key（zh+en）→ §2.3 改 `STAGES`/`spawnBoss`/`banner`/`leaderboard`/`buff HUD` → §2.4 过 A5/A6/A7。
- 为什么先：它是唯一真正的"内容缺口"，直接影响已公开 Demo 的海外观感；且与缺口 A 同源，闭环后工具链与显示层一次干净。
- 门：`A5`（双语 key 全等）+ `A6`（STAGES 中文扫描=0，扩散扫描无残留）+ `A7`（en 实跑零 undefined/裸 key）+ `verify.js parity` 零差。

### Sprint 2 · beam 命中反馈定档（缺口 C）✅ 已拍板
- 范围：§3.2 确认基线 + 周期微环（✅已拍板启用）；§3.3 边界 + §3.4 验收。
- 门：`run-smoke` rings 预算探针（≤`RING_FX_BUDGET`、无 NaN）+ `verify.js parity`（en 跑零差）。
- ✅ 周期微环已拍板启用（§3.2 locked），Sprint 2 无待决项。

### Sprint 3 · 定向优化 + 验证门
- 范围：`OPT-PERF-1`（Boss 名 measureText 缓存，低优）、`OPT-BAL-1`（DPS 收敛门）、`OPT-ACC-1`（命中反馈边界断言）。均为行为中性/验证型，零数值变更。
- 门：`run-smoke` 全绿（新增 metric/断言）+ `verify.js parity` 零差。

> 每冲刺保持"零行为差"：任何一步若 `verify.js parity` 出现逐帧差异，即证明误动了逻辑层，须回退到纯表现层改法。


## 6. 明确排除项（Exclusions）

| 排除项 | 原因 |
|---|---|
| **T3-2 每关自定义波数** | 本质是关卡数据外置 = 重构计划"关卡 JSON 化"，**未启动**。`content-backlog.md` 已判 DEFER，当前 `STAGE_WAVES=3` 均匀波数在 7 关下仍工作。维持延后。 |
| **新战机 / 新 Boss / Boss Rush** | 需要新 GDD，超出方向 (a)"不新立项"。 |
| **`bossPattern%3` 旧清理** | 与 `BOSS_KINDS` 注册表已安全并存；parity 恢复前**不动**旧路径，避免引入未知回归。待 parity 稳定后再单列清理任务。 |
| **任何 DPS / HP / 掉率数值调整** | 严守红线：不得推 golden 出 [17,22]，不得引入主导策略。此类"平衡优化"只进验证门（OPT-BAL-1）监控，不在本计划改参。 |
| **重构产物（Vite/TS/ESM/关卡 JSON 化/Tauri/Steam）** | `docs/commercialization-refactor-plan.md` **待评审、一字未动**；本计划全部假设当前经典 `<script>` + `window.DJFE` 架构。任何依赖重构的 GDD 项维持延后。 |
| **缺口 A / M-07 / M-08** | 由 engineering-lead 在 Task #3 并行处理，本计划不触碰、不重复。 |


## 7. 验收汇总矩阵（Acceptance Matrix）

| 项 | 类型 | gate | 覆盖工具 |
|---|---|---|---|
| A5 双语 key 全等 | 内容 | `gate` | `run-smoke.js`（集合比对） |
| A6 STAGES 中文清零 + 扩散扫描 | 内容 | `gate` | `run-smoke.js` / `verify.js refresh` / `grep` |
| A7 en 实跑零 undefined/裸 key | 内容 | `gate` | `run-smoke.js`（lang='en' 路径 + `byId` 扫描） |
| parity 零行为差（B/C/优化） | 行为 | `gate` | `verify.js parity`（zh/en 逐帧比对） |
| beam rings 预算 + 无 NaN | feel | `probe`/`gate` | `run-smoke.js` + `verify.js` |
| OPT-BAL-1 golden∈[17,22] | balance | `metric`+断言 | `run-smoke.js` |
| OPT-ACC-1 尺寸/微环边界 | accessibility | `probe`+断言 | `run-smoke.js` |
| OPT-PERF-1 同名缓存一致性 | perf | 手动+断言 | `run-smoke.js` / 真机抽样 |

## 8. 给 engineering-lead 的认领说明

1. **本计划纯规格**：design-strategist 未改 `src/`。落地请按 **Sprint 1 → 2 → 3** 顺序，且 **Sprint 0（Task #3）必须先绿**。
2. **每步零行为差**：i18n 与 feel 是纯表现层；提交前 `node tools/verify.js` 与 `node tests/run-smoke.js` 必须全绿。任一 parity 差异 = 误动逻辑层，回退。
3. **行号基准**：本文行号取自 2025-06 当前 `src/game.js`、`src/core.js`；若并行提交导致偏移，以"函数名/语义锚点"（`STAGES`、`spawnBoss`、`DJFE.t`、`RING_FX_BUDGET`）为权威定位。
4. ✅ **已拍板（locked）的两项小决策**：① 缺口 C 周期微环**启用**（§3.2 locked）；② §2.2 英文译法**采用建议稿**（locked，itch.io 微调非阻塞）。无需再议。

---
*文档状态：🔒 定稿 v1（locked，design-strategist 产出，主理人已拍板两项决策）。未修改 `src/`。*

