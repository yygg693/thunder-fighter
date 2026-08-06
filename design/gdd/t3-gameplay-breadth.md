# T3 玩法广度扩展设计文档（Gameplay Breadth）

> **文档属性**
> - **文档 ID**：`t3-gameplay-breadth`
> - **定位**：原 GDD `design/gdd/boss-gameplay-expansion.md`（下称「母本」）的**兄弟文档**，**不修改母本**。
> - **作者**：文策渊（design-strategist）
> - **状态**：设计稿 · 待主理人拍板
> - **覆盖 Task**：`DES-T3-BREADTH`（高优）
> - **产出边界**：仅设计 + 文档（GDD / 系统拆解 / UX 流程 / 文案 / i18n 键）。**不写实现代码**；由主理人后续派 engineering-lead 落地。
> - **硬约束（贯穿全文）**：
>   - 复用既有结构 `BOSS_KINDS` / `STAGES` / `enemies` 池 / `mkEbullet` 默认字段 / 弹幕原语库。**禁止新池、禁止新输入方式**（支柱 P1：一根手指的芭蕾）。
>   - 所有新增逻辑须落在既有质量门下：**S1**（DOM-id 差集扫描）、**S10**（Boss 全链路）、**S13**（旧档兼容）、**S15**（通关）、**S16**（六档确定性）、**S17**（环境诊断）、**S18**（对象池零扩容 `grown===0`）。
>   - 渲染层**零 RNG**：用渲染时钟 `rt`（= `T_ORIGIN + (runFrames+α)·1000/HZ`，确定性）与 `b.phase` / `hash01(i)`，绝不用 `performance.now()` 或新的 `Math.random()`。唯一 sanctioned 的 RNG 汇点是 `explode()`（18+1 粒子，每颗 2 次 `Math.random()`，**不可改、不可复制**）。

---

## 0. 代码事实基线（所有设计均锚定此处，未读取处一律标注「待主理人补全」）

本稿在动笔前已通读 `src/game.js` / `src/core.js` / `src/entities.js` / `src/main.js` / `index.html` / `tests/run-smoke.js`，提取下列**已核实事实**（括号内为 `file:line`）：

### 0.1 关卡与 Boss 注册表
- `STAGE_WAVES = 3`（`game.js:451`，**const**）。`STAGES` 数组（`game.js:457-463`）当前 **6 项**，实际 `bossHp` 为：

  | stage | name | bossKind | bossHue | bossHp(代码现状) | 母本 §4.3 建议值 |
  |---|---|---|---|---|---|
  | 1 | 近地轨道 | sentinel | 198 | **290** | 290–300 |
  | 2 | 陨石带 | scorpion | 32 | **430** | 430 |
  | 3 | 电离层 | carrier | 150 | **580** | 580 |
  | 4 | 深空要塞 | core | 338 | **460** | 460(保持) |
  | 5 | 相位回廊 | phaser | 288 | **500** | 760 |
  | 6 | 终末虚空 | void | 262 | **640** | 980 |

  > ⚠ **代码与母本偏移（需主理人知悉，非错误）**：phaser / void 实际采用母本 §2.5 原值（500 / 640），**未**采用母本 §4.3 建议上调（760 / 980）。本稿 weaverqueen 的 HP 校准**以代码现状（void=640 为当前最难关卡基线）推算**，而非纯母本建议值。

- `spawnBoss(n, now)`（`game.js:803`）：`hp = STAGES[game.stage-1].bossHp`；Boss 对象**显式置 0** 全部扩容字段（`pi/patIdx/seq/beamPhase/invulnT/dmgMul/subT/minions/anchorT/anchor/tele/teleX/teleY/form/ovr/ghostT/echo[4]`）。`ty = H*0.16`。
- Boss 段 step（`game.js:1866-1895`）：`b.y<ty` 时下沉（`b.y+=1.4`）；否则 `K.move + fireT+=dt`，仅当 `fireT>fireGap && invulnT<=0` 开火；受击 `b.hp -= (b.dmgMul>0?b.dmgMul:1)`，`onBossKilled` 立即置 `game.boss=null`。
- 相位系统：`checkBossPhase`（`game.js:1106`）`r=hp/maxHp`，取最高满足 `r<=ph[i].at` 的相位；阈值约定 **1.00 / 0.66 / 0.33**。`enterBossPhase`（`game.js:1085`）`i>0` 时清屏+8 explode+环+震屏+hitStop+`score+=200*i`+`invulnT=1200`。`onBossKilled`（`game.js:1152`）：**60 explode + 2 ring + score+=600+wave*150 + 3 dropItem + game.boss=null**（即 Boss 一死，绘制对象立即消失，仅留粒子）。

### 0.2 玩家火力与擦弹（HP 校准基线）
- `shoot()`（`game.js:1235`）：散射枪（`now<game.spreadUntil`）覆盖 power 分支，前方 7 发宽扇 + 后方 1 发。`power` 分支：p≤1→1 发、p=2→2 发、p=3→3 发、p=4→5 发、p≥5→5 发（中 5 路）。每发 1 伤。
- 真实射速 `shootInterval` 在 `beginWave` 为 `max(95, 150 - n*3)`，母本 §4.3 取 **140ms** 为校准基准 ⇒ 每发/秒 ≈ 7.14。
- **DPS 基线**（每发 1 伤，dmgMul 缺省 1）：

  | power | 弹/发 | DPS(非增压) | DPS(擦弹增压 ×1.5) |
  |---|---|---|---|
  | p1 | 1 | 7.1 | 10.7 |
  | p2 | 2 | 14.3 | 21.4 |
  | **p3** | **3** | **21.4** | **32.1** |
  | p4 | 5 | 35.7 | 53.6 |
  | p5 | 5 | 35.7 | 53.6 |

- 擦弹（`game.js:1822-1851`）：`GRAZE_IN2=14²`、`GRAZE_OUT2=26²`、`GRAZE_GAIN=0.012`、`GRAZE_BOOST_MS=6000`。**关键事实**：`game.graze` 是**每增压周期计数器**，满槽时 `game.graze=0`（`game.js:1844`）——它**不是**整局累加值。⚠ 这直接决定 T3-3 / T3-8 的「最高擦弹」必须另设累加/峰值字段（见 §4、§6）。

### 0.3 弹幕原语库（weaverqueen 模式锚点）
> ⚠ **母本所说的 `BOSS_PATS` 注册表在代码中不存在**。模式是 `BOSS_KINDS[kind].phases[].pats` 内的**内联闭包**，调用下列原语。故本稿「引用 pattern 名序列」一律指向**原语函数名**（括号内为 `game.js:line`）：
> `fanShot`(860) · `aimShot`(871) · `ringShot`(880) · `spiralShot`(890) · `wallShot`(899) · `crossRainShot`(908) · `curveShot`(918) · `holdRing`(929) · `stingerShot`(943) · `splitVolley`(954) · `beamChain`(964) · `rotorBeam`(978) · `pulseRings`(984) · `vortexShot`(997) · `aimBurst`(1009)。

- `holdRing(cx,cy,n,spd,off,r,kind,hold)`：`hold+i` 逐发错峰（`game.js:933`）——「定格→齐射」压迫感。
- `pulseRings(cx,cy,layers,n,spd0,dspd,gapSteps,off,r,kind)`：`hold = L*gapSteps` 层间错峰（`game.js:991`）。
- `vortexShot(cx,cy,n,spd,off,r,kind,av,ttl)`：**带 `av` 必带 `ttl` 兜底**（螺旋弹未必飞出屏，`game.js:997`）。
- `rotorBeam`/`beamChain`：角度由 `b.beamPhase`（move 里按 dt 累加）推出，**绝不**给每颗弹挂 `av`（`game.js:936-981`，S16 红线）。
- `mkEbullet()` 字段（`game.js:134`）：`ax/ay/av/hold/ttl/split/splitN/gz` 全默认 0；`addEbulletEx` 无条件重置（`game.js:193`）。
- **hold 语义**（`game.js:1796` step / `game.js:1827` graze）：`eb.hold>0` 时**只画不伤不给擦弹**（预警虚影）。这正是「织网」机制的物理基础。

### 0.4 池 / 渲染 / 持久化 / i18n / 冒烟门
- 池 cap（`game.js:155-162`）：bullets 512 / **ebullets 1600** / particles 3000 / enemies 256 / items 128 / rings 96。⚠ 高于母本 §6.2 建议值，S18 余量更大（织网 40 弹无压力）。
- `drawBoss(b, now, player)`（`entities.js:1232`）：`p.r = (maxHp>0)?clamp(hp/maxHp):0`（**NaN 护栏**，`entities.js:1274`）；`p.pulse = 0.6+0.4*sin(now/180)`（`now` 为确定性渲染时钟 `rt`，**非** `performance.now()`）；`BOSS_SHAPES[b.kind]` 分发，无 shape 且 sprite 就绪→sentinel 走精灵，否则矢量或 `bossHullGeneric`；`invulnT>0` 叠护盾涟漪。
- `BOSS_SHAPES`（`entities.js:853`）：scorpion 等已定义，sentinel 走精灵；**weaverqueen 须补一项**。
- 排行榜（`core.js:36-45`）：`LB_KEY='djfe_leaderboard'`；`addLeaderboard(entry)` push→按 `score` 降序→`slice(0,8)`→`lsSet`。当前 entry 形状 `{score, stage, date, win?}`。**无 `graze` 字段**。
- i18n（`main.js:12-60`）：`I18N.zh/en` 均**无** `hud.buff`、无 `result.*` 键；`hud.graze` 存在。
- 通关门（`game.js:1623`）：`if(game.isBossWave && game.stage>=STAGES.length) setState(VICTORY)`。
- S15（`run-smoke.js:565`）：`finalStage = D.__debug.stageCount`；`finalWave = (finalStage-1)*stageWaves + stageWaves`。**从 `stageCount` 派生 ⇒ 追加 Stage 7 自动跟随，不破坏 S15**。
- S1（`run-smoke.js:137`）：自动扫 `getElementById` 与 `index.html` 差集（`missing-element-id` 告警）。新增 DOM id 必须写入 `index.html`。
- 同步：`scripts/sync-web.js` 存在，改 `src/` 后须重跑以刷新 `www/` 副本。

---

## 1. 设计支柱回顾 & T3 与既有 6 Boss 心流衔接

### 1.1 三根支柱
- **P1 一根手指的芭蕾**：禁止新增输入方式 / 新池。weaverqueen 的「织网」只用 `hold` 字段（既有 ebullets 池）表达，零新输入。
- **P2 读得懂的弹幕**：预警虚影（`hold`）让织网在激活前 1.5s 可见可判；网弹统一 kind 保证配色一致、缝可辨。
- **P3 贪婪有代价有回报**：擦弹增压（×1.5 / 6s）奖励贴脸走位；T3-3 / T3-8 把擦弹量化成「战果 + 排行榜维度」，强化回报感。

### 1.2 MDA / SDT / 心流
- **MDA**：机制（hold 预警、擦弹槽、每关波数）→ 动态（玩家学会「读网→穿缝→贴网擦弹」）→ 美学（紧张而可控的编织感）。
- **SDT**：自主（织网留可读缝，玩家自选穿法）/ 胜任（相位爆喘息窗 + 增压反馈）/ 关联（EX 关作为战役收尾的「额外挑战」叙事钩子）。
- **心流曲线**：既有 6 Boss 难度递增（sentinel 教学宽缝 → void 漩涡高压）。weaverqueen 作为 **Stage 7「EX·织网」** 是曲线的「额外尖峰」——不取代 void 的叙事高潮，而是其后的「余波 Boss」，把「可读弹幕」推到极限（网+追踪+漩涡三重叠加），但每个相位仍留缝，避免心流断裂。

### 1.3 T3 与 6 Boss 心流衔接表
| 维度 | 既有 6 Boss | T3 增量如何衔接 |
|---|---|---|
| 教学→高压 | sentinel 宽缝 → void 漩涡 | weaverqueen 在 void 后，用「网」综合 fan/aim/vortex，但 P0 先 solo 织网教学 |
| 视觉破损反馈 | 仅靠 `p.r` 变色，无逐 Boss 崩落演出 | T3-7 给 7 Boss 统一破损态 + 崩落动画 + 氛围层 |
| 战果回报 | 仅 finalScore/best/combo | T3-3 补 Boss 击破清单 + 擦弹峰值 |
| 长期目标 | 排行榜仅 score | T3-8 加 graze 维度 |
| HUD 信息 | score/lives/bomb/stage/wave/power/graze/combo | T3-1 补 buff 增益指示（低认知负荷） |

---

## 2. T3-1（剩余）HUD 增益指示 —— 决策：**做（DO）**

### 2.1 设计
- **DOM 方案**：在 `#hud` 内 `comboWrap` 之后插入 `buffWrap` / `buff`（仿 `comboWrap` 模式，`index.html:472`）。
  ```html
  <span id="buffWrap" class="hidden"> · <span data-i18n="hud.buff">增益</span> <b id="buff">散射 8s</b></span>
  ```
- **i18n 键**（加入 `main.js` `I18N.zh/en`）：
  - `hud.buff`：zh「增益」/ en「BUFF」
- **显示逻辑**（由 engineering-lead 在 HUD 刷新处实现，读 `logicNow()` 与 `game.spreadUntil` 同源，避免与 8s 计时漂移）：
  - `remain = (game.spreadUntil - now)/1000`；`remain>0` 时显示 `buffWrap` 且 `buff.textContent = '散射 ' + ceil(remain) + 's'`（en: `'SPREAD ' + ceil(remain) + 's'`）；否则隐藏。
  - 当前唯一增益源是 G 道具散射（`game.spreadUntil`，`game.js:1246` 起）。若未来新增增益（护盾延长等），`buffWrap` 可容纳多条 `<b>`。

### 2.2 做 / 不做的推荐与理由
| 选项 | 结论 | 理由 |
|---|---|---|
| **做** | ✅ 推荐 | ① 成本极低（2 个 DOM id + 1 个 i18n 键 + 1 段 textContent，照抄 comboWrap）；② 满足 P2「状态可读」——当前散射生效与否玩家只能靠「弹变宽扇」反推，缺少明确 HUD 信号；③ 不新增输入 / 不破坏 S16（纯 view 文本，且读 `logicNow()` 一致性）；④ S1 自动门：补 id 即过。 |
| 不做 | ❌ | 失去低成本的信息透明度提升，与 P2 相悖。 |

> ⚠ 红线自检：**认知过载**——只显示 1 个增益图标 + 倒计时，不堆叠数值条，符合 P2。无主导策略风险（增益来自掉落，不可控）。

---

## 3. T3-2 每关自定义波数 —— 决策：**延后（DEFER），不阻塞 weaverqueen**

### 3.1 现状与风险
- 当前 `STAGE_WAVES = 3` 是 **const**（`game.js:451`），`beginWave`（`game.js:507-509`）用 `STAGE_WAVES` 推导 `stage` / `stageWave` / `isBossWave`。
- **`WAVE_OFS` 在代码中不存在**（grep 确认）。本稿将其定义为**待新增机制**：每关波数前缀和偏移表。
- **S15 强耦合**（`run-smoke.js:565`）：`finalWave = (finalStage-1)*stageWaves + stageWaves`。若各关波数不齐，`finalWave` 公式失效，通关判定错位。
- **S10 耦合**：Boss 全链路依赖 `game.stage` 正确映射到 `STAGES[stage-1]`，波数映射一改须重跑 S10。

### 3.2 推荐方案（若未来确需非均匀波数）
> 仅作**规格预案**，本迭代不实施。

- 新增 `STAGE_WAVE_COUNTS = [3,3,3,3,3,3,3]`（与 `STAGES` 等长），`STAGE_WAVE_OFS = prefixSum(STAGE_WAVE_COUNTS)`（每项=前几关波数累计）。
- `beginWave` 改为：由 `n` 在 `STAGE_WAVE_OFS` 中二分定位 `stage`；`stageWave = n - STAGE_WAVE_OFS[stage-1]`；`isBossWave = (stageWave === STAGE_WAVE_COUNTS[stage-1])`。
- S15 改为：`finalWave = STAGE_WAVE_OFS[last] + STAGE_WAVE_COUNTS[last]`（即总波数）。
- `__debug.stageWaves` 调整为返回数组或保持 3（仅当全关=3 时兼容）。

### 3.3 为何延后
- **weaverqueen 采用 Stage 7 + 统一 3 波**（见 §7），**不依赖** `WAVE_OFS`——因此 T3-2 与 EX Boss 解耦，可独立延后。
- 改动波数映射触及 S10 + S15 + 调度核心，属**高风险**，须独立 commit + 全量冒烟（S1/S10/S15/S16/S18）。性价比低于其余 T3 项。
- **锁定决策**：T3-2 = DEFER。仅当某关确实需要 ≠3 波时才启用 §3.2，且必须重跑全量冒烟。

---

## 4. T3-3 战果结算面板 —— 决策：**做（DO）**

### 4.1 新增 DOM（置于 `#victory` 内，`index.html:548` 之后）
```html
<div id="resultWrap" class="hidden">
  <div class="score-label" data-i18n="result.bossBreak">击破 Boss</div>
  <div id="resultBossWrap"><ul id="resultBossList"></ul></div>
  <div class="best"><span data-i18n="result.graze">擦弹</span> <b id="resultGraze">0</b></div>
  <div class="best"><span data-i18n="result.grazeMax">最高擦弹</span> <b id="resultGrazeMax">0</b></div>
  <div class="best"><span data-i18n="result.stage">抵达关卡</span> <b id="resultStage">7</b></div>
</div>
```
> `finalScoreV` / `bestV` / `maxComboV` 已存在，复用；`resultCombo` 不新增（复用 `maxComboV`）。

### 4.2 i18n 键（加入 `I18N.zh/en`）
| key | zh | en |
|---|---|---|
| `result.title` | 战果 | RESULTS |
| `result.bossBreak` | 击破 Boss | BOSSES DOWN |
| `result.graze` | 擦弹 | GRAZE |
| `result.grazeMax` | 最高擦弹 | MAX GRAZE |
| `result.stage` | 抵达关卡 | STAGE |

### 4.3 数据字段（须由 engineering-lead 加，均落在既有 `game` 对象，不新池）
- **`game.maxGraze`**（峰值每周期擦弹）：`startGame` 置 0；擦弹处（`game.js:1838`）加 `game.maxGraze = Math.max(game.maxGraze, game.graze)`；满槽重置前（`game.js:1844`）再取一次 `Math.max`。即「每个增压窗口内的最高擦弹数」——这是「最高擦弹」的竞技含义（你最秀的一波贴了多少）。
  > ⚠ **致命陷阱**：绝不可直接把 `game.graze` 当整局总量写进排行榜/战果——它每增压周期归零。T3-8 的 `graze` 字段必须取自 `game.maxGraze`（或下方 `grazeTotal`）。
- **`game.grazeTotal`**（整局累加，可选，供 `result.graze` 展示）：擦弹处 `game.grazeTotal = (game.grazeTotal||0) + 1`；`startGame` 置 0。`result.graze` 显示它，`result.grazeMax` 显示 `game.maxGraze`。
- **按 bossKind 记录击破时刻**：`onBossKilled`（`game.js:1152`）内，在 `game.boss=null` 之前 push：
  ```js
  game.bossBreaks = game.bossBreaks || [];
  game.bossBreaks.push({ kind: b.kind, name: b.name, wave: game.wave, hp: b.maxHp });
  ```
  `startGame` 置 `game.bossBreaks = []`。`victory()`（`game.js:491`）渲染 `resultBossList`：遍历 `game.bossBreaks` 输出「中文名 · 第 N 波击破」。

### 4.4 红线自检
- 认知过载：面板仅在通关/结算时显示，不干扰对局，安全。
- S1：新增 id 写入 `index.html` 即过自动差集扫描。
- S13：无持久化，纯运行时，无旧档问题。

---

## 5. T3-7 Boss 矢量视觉细化（7 款）

> 统一原则：**破损态由 `p.r`（=hp/maxHp）驱动，渲染零 RNG**；**崩落动画复用 `explode()` 的 sanctioned RNG，不新增 `Math.random()`**；**氛围层用确定性渲染时钟 `rt`（即 `drawBoss` 的 `now` 参数）驱动旋转/呼吸，绝不用 `performance.now()`**。

### 5.1 ① 破损态（通用规则，逐 Boss 调参）
- `p.r` 分三档映射：
  - `r > 0.66`：完整舰体，仅 `pulse` 微光。
  - `0.33 < r ≤ 0.66`：剥落 1 块装甲板（`p.dark` 缺口，位置由 `hash01(b.kind.length*7+1)` 确定，零 RNG），核心 `lite` 区外露。
  - `r ≤ 0.33`：再剥落 1–2 块，舰体 `col→dark` 渐变（`lerp` 由 `1-r` 加权），裂缝线用确定性角度 `TAU*hash01(i)` 排布。
- 崩落裂缝颜色：`hsl(hh, 30%, 18%)`（暗裂），与 `p.lite` 高光形成破损对比。

### 5.2 ② 崩落动画（统一方案）
- 现状：`onBossKilled` 立刻 `game.boss=null`，舰体瞬灭，仅 60 explode 粒子。
- 改进（可选、低风险）：`onBossKilled` 改为置 `b.dying=1; b.dieT=30`（帧），**延迟** `game.boss=null` 至 `dieT<=0`；`drawBoss` 在 `b.dying` 时 `globalAlpha = dieT/30` 并让装甲板按 `dieT` 序脱落（确定性偏移）。死亡粒子仍用既有 `explode()`（60 发，sancationed）。
- **S18 护栏**：崩落不新增 ebullets / 不新增 particles 池对象（仅复用 `explode()` 既有的 60+2 ring）；不改 `POOL` cap。

### 5.3 ③ 吸积盘 / 氛围层（仅 void / phaser / weaverqueen）
- 在 `shape(b, now, player, p)` 最前绘制，用 `now`（确定性 `rt`）：
  - **void**：2–3 圈同心淡环（`hsla(hh,40%,60%,0.10)`），整体旋转角 `= now/2600`，半径随 `p.r` 收缩（血量越低盘越紧）。
  - **phaser**：残影/回声环——用 `b.ghostT` / `b.tele` 画半透明拖影（`globalAlpha = 0.12+0.18*b.tele`），旋转由 `now` 驱动。
  - **weaverqueen**：织网母题的「背景织机」——一组由 `now` 驱动的双向斜线格（`lineDash` + `alpha 0.08`），缓慢交错，呼应招牌机制。
- **零 RNG 护栏**：以上旋转/相位全部 `now` / `b.phase` / `hash01` 驱动；`entities.js:1243` 已有 `rotate(now/1400)` 先例，照搬。

### 5.4 Boss × 处理矩阵表
| Boss | 破损态处理（驱动 `p.r`） | 崩落动画 | 氛围层 | 依赖/护栏 |
|---|---|---|---|---|
| sentinel | 装甲板 `hash01(3)` 定位剥落 | 延迟 null + 现有 60 explode | 无（走精灵，保留能量冠） | 精灵路径不变（S1 无关） |
| scorpion | 尾针/双螯随 `r` 下垂 | 同通用 | 无 | `BOSS_SHAPES.scorpion` 已存在 |
| carrier | 舰桥分段脱落 | 同通用 | 无 | 母舰弹射 `splitVolley` 照旧 |
| core | 过载 `ovr` 驱动核心炽白 | 同通用 | 无 | `rotorBeam` 角度走 `beamPhase`（S16） |
| phaser | 残影分身随 `r` 减淡 | 同通用 | 残影环（`b.tele/ghostT`） | 瞬移锚点表 `PHASER_ANCHORS` 写死（S16） |
| void | 晶体块 `form` 随 `r` 崩落 | 同通用 | 同心吸积盘（`now` 旋转） | `vortexShot` 必带 `ttl`（S18） |
| **weaverqueen** | 织机臂随 `r` 断股 | 同通用 | 背景织机格（`now` 交错） | 网弹 `hold` 预警（P2）；`BOSS_SHAPES.weaverqueen` 须补 |

---

## 6. T3-8 排行榜「最高擦弹」 —— 决策：**做（DO）**

### 6.1 扩展持久化（core.js）
- `addLeaderboard(entry)`（`core.js:38`）entry 形状新增 `graze`：`victory()`（`game.js:494`）改为
  `DJFE.addLeaderboard({ score: raw, stage: game.stage, date: ..., win: true, graze: game.maxGraze })`。
  > ⚠ 取 `game.maxGraze`（峰值每周期），**非** `game.graze`（周期归零值）。见 §4.3 陷阱。
- **S13 旧档兼容**：`refreshLeaderboard`（`game.js:429`）渲染每条时一律 `entry.graze || 0` 兜底——旧存档无 `graze` 字段显示 0，不报错。

### 6.2 排行榜渲染
- `refreshLeaderboard`（`game.js:429`）对每条 entry 增加一列「擦弹」：`(entry.graze||0)`。菜单/通关/死亡三处排行榜共用此函数，一次改全过。
- 排序仍按 `score` 降序（`core.js:41`），`graze` 仅展示维度，不改排名逻辑（避免主导策略：为刷擦弹放弃得分）。

### 6.3 红线自检
- 主导策略：擦弹不影响排名，且擦弹本身有风险（贴脸），符合 P3「有代价有回报」。
- S13：旧档 `||0` 兜底，零破坏性。
- S16：排行榜为 localStorage，不在确定性循环内，无影响。

---

## 7. EX Boss · weaverqueen（织网者）完整规格

> 扩自母本 §2.6。中文名**织网者**，id `weaverqueen`，hue **172**（teal-green，紧贴玩家色带 175-200 下缘——属 Boss 本体可接受；其网弹配色须避开玩家色带，见 §7.5）。

### 7.1 外观锚点
- 母题：织机 / 蛛形母舰。中央菱形核心 + 4–6 条径向「纺锤臂」缓慢自转（`b.phase` 驱动，零 RNG）+ 背景织机格（§5.3）。
- `BOSS_SHAPES.weaverqueen`（须补，`entities.js:853` 追加）：用 `p.s/p.hh/p.r/p.lite/p.dark` 复用既有 hsl 体系；破损态按 §5.1（`p.r` 断股）。

### 7.2 移动模式
```js
move(b, dt) {
  b.phase += dt * 0.0012;                       // 慢速自转相位
  b.x = W/2 + Math.sin(b.phase) * (W * 0.30);   // 横向织摆（贴合「weaver」母题）
  b.y = b.ty + Math.sin(b.phase * 0.5) * (H * 0.04); // 轻微上下浮动
}
```
- 入场：`spawnBoss` 通用下沉至 `ty=H*0.16`（`game.js:810`），无需改。
- 确定性：`b.phase` 累加，无 RNG，S16 安全。

### 7.3 三阶段弹幕表（模式名 = 原语函数；弹数 / gap 见列）
> 阈值沿用 1.00 / 0.66 / 0.33。cx0/cy0 = `b.x` / `b.y + b.h*0.4`（`bossFire` 传入）。

| 相位 | at | gap(ms) | 模式序列（原语 + 弹数） | 设计意图 |
|---|---|---|---|---|
| **P0** | 1.00 | 900 | `pulseRings(cx,cy, layers=2, n=10, spd0=2.4, dspd=0.8, gapSteps=24, r=6, kind)` → `fanShot(cx,cy, n=7, spread=π·0.6, base=π/2, spd=3.4, r=6, kind, gapIdx=-1)` | 教学：先「织机呼吸」预警，再宽扇留缝，让玩家适应节奏 |
| **P1** | 0.66 | 720 | **招牌 `weaveNet(b,cx,cy)`（40 发 hold=90 网格）** → `aimShot(cx,cy, n=5, jitter=0.12, spd=4.2, r=5, kind, seq=b.seq)` | 织网登场 + 追踪逼走位 |
| **P2** | 0.33 | 560 | `weaveNet` ×2 错峰（`hold` 偏移 30） → `vortexShot(cx,cy, n=14, spd=2.6, off=hash01(b.seq), r=5, kind, av=0.012, ttl=240)` → `aimBurst(cx,cy, n=6, gapSteps=10, spd=4.0, r=5, kind, seq=b.seq)` | 三重叠加（网+漩涡+追踪）推到 P2 极限，但每发留缝 |

- 模式轮转：沿用 `bossFire` 的 `ph.pats[idx]` 游标（`game.js:1122`），无需改调度。

### 7.4 招牌机制「织网」（`weaveNet`，内联闭包，复用 `hold`）
```js
// 8 列 × 5 行 = 40 发；hold=90（≈1.5s @60Hz）预警虚影，只画不伤不给擦弹
// 激活后整体下推 spd=2.4，列向交替 ±0.5 横移形成「编织」错位（零 RNG，用列奇偶）
function weaveNet(b, cx, cy) {
  const cols = 8, rows = 5, hold = 90, spd = 2.4;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = W * (0.10 + 0.80 * c / (cols - 1));
      const y = H * (0.18 + 0.42 * r / (rows - 1));
      const drift = (c % 2 ? 1 : -1) * 0.5;          // 列奇偶决定横移方向
      addEbulletEx(x, y, drift, spd, 6, 'web', { hold }); // hold 期间悬停预警
    }
  }
}
```
- **物理基础**：`hold>0` 时 step 仅 `hold--` 不移动（`game.js:1796`），graze 跳过（`game.js:1827`）⇒ 预警期零伤零擦弹，激活后正常。
- **P2 红线性**：网格下推时**必须保留可读缝**（列间距由 `0.80*W/7` 决定，约 1 个机身宽），否则违反 P2 → 退化为「秒杀墙」。
- **S18 护栏**：单次 40 弹 ≪ ebullets cap 1600；P2 双网 80 弹仍安全。

### 7.5 网弹配色（P2 可读性）
- `addEbulletEx(..., 'web', ...)` 的 `'web'` kind 须确认 `entities.js` 的 ebullet 配色映射已含（若未含，复用既有 kind 如 `'ring'` 以保证零新增资产 / 支柱 P1）。**待 engineering-lead 核对 EKIND 映射**；若需专属色，仅调色不新增池。

### 7.6 HP 校准（母本 §8.5.4 方法，p3 DPS≈21.4 基线）
- 方法：目标击破时间 × DPS。EX Boss 定位于「战役收尾额外尖峰」，玩家通常 p5 + 擦弹增压（DPS≈53.6）。
- 推荐 **`bossHp = 1500`**（Stage 7）。情景估算：

  | 情景 | DPS | 预计击破时长 |
  |---|---|---|
  | p3 非增压 | 21.4 | ~70s |
  | p3 增压 | 32.1 | ~47s |
  | p5 增压（典型） | 53.6 | ~28s |
  | p5 增压 + 僚机 | 更高 | ~22–25s |

- **调参带**：`[1200, 1800]`。低于 1200 失去 EX 分量感；高于 1800 在 p5 增压下仍 >33s，有 P3 支柱漂移（冗长）风险。
- ⚠ **难度不缩放 HP**：代码 `hp=st.bossHp`（`game.js:808`）无难度乘子，1500 在 easy/normal/hard 固定。hard 的额外挑战来自炸弹数 / 刷怪压力（与既有 6 Boss 一致）。

### 7.7 入场位置决策 —— **锁定：新增 Stage 7「EX·织网」**
- **方案 A（锁定）**：在 `STAGES` 数组追加第 7 项：
  ```js
  { name: 'EX·织网', bg:'#0a1410', accent:'#7fbfa6', accent2:'#bfa06f',
    bossName:'织网者', bossHue:172, bossHp:1500, bossKind:'weaverqueen' },
  ```
  - **零调度改动**：`beginWave` / `spawnBoss` / `victory` 全复用。`STAGES.length` 变 7，`__debug.stageCount` 自动派生。
  - **S15 自动跟随**：`finalWave = (7-1)*3+3 = 21`（`stageWaves` 仍 3），设 `wave=21` 后清掉第 7 Boss 即 VICTORY，**不破坏 S15**。
  - **叙事钩子**：终末虚空（Stage 6）崩解后，「织网者」自虚空残缕中浮现——自然的「余波 Boss」，不抢 void 的叙事高潮。
  - **EX 通关标记**（可选）：`victory()` 的 leaderboard entry 加 `ex:true`（`game.stage===7` 时）；`victory.sub` 可据 `ex` 切「额外挑战肃清」文案。不改通关逻辑。
- **方案 B（备选，延后）Boss-Rush 模式**：仅派发 Boss 波（`STAGE_WAVES` 式覆盖 + 新 UI/状态）。需新菜单入口 + 波调度分支，**性价比低**，列为未来可选，本迭代不做。
- **锁定结论**：**方案 A**。方案 B 不实施（见决策包 §8.1）。

---

## 8. 实现就绪决策包

### 8.1 ① 锁定决策表
| 决策点 | 结论 | 关键理由 |
|---|---|---|
| weaverqueen 入场 | **追加 Stage 7「EX·织网」** | 零调度改动；S15 自动派生 finalWave=21；叙事作 void 余波 |
| HUD buff（T3-1） | **做** | 低成本、仿 comboWrap、P2 状态可读、S1 自动过 |
| T3-2 自定义波数 | **延后（DEFER）** | 触 S10/S15 高风险；weaverqueen 用统一 3 波不依赖；独立 commit + 全量冒烟才启用 |
| 战果面板（T3-3） | **做** | 加 `maxGraze`/`grazeTotal`/`bossBreaks` + DOM，S1/S13 安全 |
| 排行榜 graze（T3-8） | **做** | `graze:game.maxGraze` + 旧档 `||0`；S13 兼容 |
| Boss 矢量视觉（T3-7） | **做（7 款矩阵）** | 破损态= `p.r` 驱动零 RNG；崩落复用 `explode()`；氛围层用 `now` |
| **T3-5 hydra 分裂双 Boss** | **不做（DO NOT）** | 母本 §8.5.1 Q5=B；双 Boss 对象/双碰撞体/相位同步/池峰值翻倍，架构侵入大、性价比最低 |

### 8.2 ② weaverqueen HP 矩阵（校准依据）
| Boss | bossHp(代码) | 设计定位 | p3 非增压击破 | p5 增压击破 |
|---|---|---|---|---|
| sentinel | 290 | 教学 | ~14s | ~5s |
| scorpion | 430 | 进阶 | ~20s | ~8s |
| carrier | 580 | 中段 | ~27s | ~11s |
| core | 460 | 机制 | ~21s | ~9s |
| phaser | 500 | 诡谲 | ~23s | ~9s |
| void | 640 | 高潮 | ~30s | ~12s |
| **weaverqueen** | **1500**（推荐，带 [1200,1800]） | **EX 尖峰** | **~70s** | **~28s** |

> 注：phaser/void 实际采用母本 §2.5 原值（非 §4.3 建议 760/980）；weaverqueen 以 void=640 为当前最难关卡基线，按 §8.5.4 推至 1500。

### 8.3 ③ 7 款 Boss 陷阱清单（S16/S18/NaN/DOM-id）
| Boss | 陷阱 | 护栏 |
|---|---|---|
| core | `rotorBeam` 给每颗弹挂 `av` 自转 | 角度必走 `b.beamPhase`（move 累加），禁逐弹 `av`（S16） |
| void | `vortexShot` 螺旋弹绕圈永生 | 必带 `ttl` 兜底（`game.js:997`，S18 零扩容） |
| phaser | 瞬移用 `Math.random()` 选锚点 | 锚点表写死 + `hash01(seq)` 散列（S16 六档一致） |
| **weaverqueen** | 网弹 `hold` 预警期误判碰撞/擦弹 | step/graze 已 `hold>0` 跳过（已核实 `game.js:1796/1827`） |
| **weaverqueen** | 背景织机格用 `performance.now()` | 用 `drawBoss` 的 `now`（确定性 `rt`） |
| 全部 | `p.r` 除零 → `hsl(NaN)` 静默不画 | `maxHp>0?...:0` 护栏（`entities.js:1274`）已就位 |
| 全部（崩落） | 新增 `Math.random()` 粒子 | 仅复用 `explode()`（sanctioned RNG），不新增 |
| 全部（T3-3/1） | 新 DOM id 未进 `index.html` | S1 自动差集扫描；补 id 即过 |

### 8.4 ④ T3 分步构建清单（标冒烟门）
| 序 | 任务 | 冒烟门 | 依赖 |
|---|---|---|---|
| 1 | `BOSS_KINDS.weaverqueen` 注册（move/phases/weaveNet 闭包） | **S10**（Boss 全链路） | §7 |
| 2 | `STAGES` 追加 Stage 7 | **S15**（finalWave=21 自动） | 任务 1 |
| 3 | `BOSS_SHAPES.weaverqueen` 矢量造型 + 破损态 + 背景织机 | **S16**（六档一致）/ S1 | 任务 1 |
| 4 | `game.maxGraze` / `grazeTotal` / `bossBreaks` 采集 | 无（运行时） | §4.3 |
| 5 | 战果面板 DOM + i18n `result.*` | **S1**（missing-element-id） | 任务 4 |
| 6 | 排行榜 `graze` 字段 + `||0` 兜底 | **S13**（旧档） | 任务 4 |
| 7 | HUD `buffWrap/buff` + i18n `hud.buff` | **S1** | §2 |
| 8 | 7 Boss 崩落动画（延迟 null + dissolve） | **S18**（grown===0） | §5.2 |
| 9 | （延后）T3-2 `STAGE_WAVE_COUNTS/OFS` | **S10+S15** 全量重跑 | 不阻塞 1–8 |

> 改 `src/` 后须跑 `node scripts/sync-web.js` 刷新 `www/`，再跑 `tests/run-smoke.js`（S1/S10/S13/S15/S16/S17/S18）。

### 8.5 ⑤ T3-5 hydra 分裂双 Boss：**明确不做**
- 母本 §8.5.1 Q5 决策 = **B（不做）**。
- 理由：分裂双体需两个 Boss 对象并存、双碰撞体、相位/血量同步逻辑、同时段弹幕峰值翻倍（S18 池压力骤增）、`spawnBoss` 须重构支持「一对」——架构侵入远超其余 T3 项，而玩法增益（双目标走位）可由 weaverqueen 的「网+追踪」近似覆盖。
- **锁定**：本迭代及可预见后续均**不做 hydra**。若未来重议，须单独立项评估池扩容与调度重构成本。

---

## 9. 需主理人拍板的风险点（原 GDD 未覆盖 / 设计灰色区）

1. **`game.graze` 周期归零的语义**：母本未明示「最高擦弹」取峰值周期（`maxGraze`）还是整局累加（`grazeTotal`）。本稿默认 **`maxGraze`（峰值每周期）** 入排行榜、`grazeTotal` 入战果面板。若主理人更想要「整局总擦弹」作为排行榜维度，则排行榜改取 `grazeTotal`——请拍板。
2. **weaverqueen HP 1500 是否越过「冗长」红线**：p5 增压下 ~28s、p3 非增压 ~70s。若主理人认为 EX 应更短促（如 1000–1200），请在 `[1200,1800]` 带内定档。
3. **EX 关是否计入「战役通关」**：本稿默认 Stage 7 即新最终关，清之触发 VICTORY（方案 A）。若主理人希望 EX 是「通关后的可选挑战」、不触发最终 VICTORY 演出，则需方案 B 的 Boss-Rush 雏形（更高成本）——请拍板是否接受 Stage 7 直接作终关。
4. **T3-2 是否本期启动**：本稿建议 DEFER。若某关（如教学关）确需 ≠3 波，请指示启用 §3.2 并承担全量冒烟成本。
5. **网弹专属配色 `'web'`**：须 engineering-lead 核对 `entities.js` ebullet 配色映射；若缺，本稿倾向复用既有 kind（如 `'ring'`）以守 P1 零新增资产。是否接受「网弹与某既有 kind 同色」请拍板（影响 P2 可读性微调）。
6. **代码与母本 HP 偏移**：phaser(500)/void(640) 未采用母本 §4.3 建议(760/980)。本稿以代码现状为准校准 weaverqueen。若主理人希望先把 phaser/void 提到建议值再校准 EX，则 weaverqueen 基线须重算——请拍板是否同步调整。
