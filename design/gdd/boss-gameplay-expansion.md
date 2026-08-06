# GDD · Boss 阵容重构与玩法扩容

> 项目：打飞机 / Thunder Fighter（纯 Canvas2D 纵版弹幕射击，零依赖，file:// 双击即玩）
> 基线版本：v1.2.0
> 文档版本：v1.0（2026-08-01）
> 作者：文策渊（设计策展人）
> 目标读者：**主程序（程基岩）** —— 本文档按「可直接开工」标准撰写，所有数值、字段名、函数名、
> 池容量、DOM id 均已对齐现有代码事实，可逐条实现。

---

## 0. 阅读指引与代码事实基线

本文档的每一条设计都锚定在下列**已核实的代码事实**上（读自 `src/game.js` / `src/entities.js` / `index.html` / `src/main.js`）。
如果实现时发现与下列事实不符，**以代码为准并回头修文档**，不要凭文档硬改代码。

| 事实 | 位置 | 对设计的约束 |
|---|---|---|
| 逻辑步 60Hz 固定，`step(now, dt)`，`dt≈16.667ms` | `game.js:67-68, 816` | 所有新计时器要么 `+= dt`（ms），要么用**逻辑步计数**，绝不用 `performance.now()` |
| `bossFire(b)` 用模块级 `bossPattern % 3`，4 关共用 | `game.js:54, 481-502` | **这就是「Boss 只有一款」的根因**，本次核心重构对象 |
| `spawnBoss` 只读 `st.bossName/bossHue/bossHp` | `game.js:467-480` | 扩成 `BOSS_KINDS` 注册表，`STAGES` 加 `bossKind` 字段 |
| `drawBoss` 单一 `boss.png` + hue-rotate + 矢量降级 | `entities.js:615-727` | 新 Boss **全部走矢量**（矢量降级段已足够丰富，可作模板）；仅 `sentinel` 继续用 `boss.png` |
| Boss 更新：`y<ty` 下沉 → `phase+=dt*0.0016` → `x=W/2+sin*W*0.26` → `fireT>fireGap` | `game.js:973-995` | 移动逻辑要抽成 `kind.move(b, now, dt)` |
| 敌弹更新只有 `eb.x+=eb.vx; eb.y+=eb.vy` | `game.js:947-950` | **无加速度 / 无曲率 / 无延迟启动 / 无寿命** → 本次要扩 ebullet 字段 |
| `mkEbullet()` 字段固定 `{x,y,vx,vy,r,dead,kind,px,py,sx,sy}` | `game.js:125` | 加字段必须在 `addEbullet` 里**无条件重置**（见 §6.5 脏值红线） |
| 池 cap：bullets 256 / ebullets 640 / particles 2048 / enemies 128 / items 64 / rings 64 | `game.js:136-143` | 调大 cap 允许；`grown>0` 会被 S18 判红 |
| `Pool.get()` 取空时 `grown++` 并**自动扩容** | `game.js:92-100` | 所以「爆池」不会崩，但**会翻红 S18**，等价于交付失败 |
| `explode()` 固定 18+1 粒子、每颗恰好 2 次 RNG | `game.js:700-720` | **不可改**（S16 种子序列 + S18 预算双重依赖） |
| `onBossKilled` 连爆 60 次 = 1140 粒子 | `game.js:503-520` | 粒子池的峰值就卡在这，新特效不许再叠大批量 explode |
| HUD 是单行 `#hud`，`comboWrap/combo` 用 `hidden` class 切换 | `index.html:450` | 擦弹 UI **照抄这个模式**（`grazeWrap` + `graze`） |
| i18n 字典 `I18N.zh / I18N.en`，`data-i18n` 属性驱动 | `main.js:12-60` | 新 UI 必须**同时**加 zh + en 两条 |
| `www/` 是 `src/` 的生成副本 | `MEMORY.md` 铁律 1 | 改完 `src/` + `index.html` 必须跑 `node scripts/sync-web.js` |
| 冒烟门：S1 启动 / S10 Boss 全链路 / S15 通关 / S16 六档帧率 / S17 环境诊断 / S18 池零扩容 | `tests/run-smoke.js` | 每层 Scope 的验收都挂在这些门上 |

**单位约定（全文通用）**

- 弹速 / 机速：**px per logic step**（每逻辑步位移），60Hz 下 `1 px/step = 60 px/s`。现有 Boss 弹速 3.4 px/step = 204 px/s。
- 计时：模式间隔用 **ms**（沿用 `fireGap`）；一次齐射内部的子时序用 **step 数**（更抗未来改动）。
- 角度：弧度；角速度 **rad/step**。
- 画布尺寸估算基准：`W≈460, H≈780`（竖屏窗口典型值）。所有「同屏弹数」估算按此计算，实际随窗口浮动 ±25%，冗余已计入。

---

## 1. 设计支柱与 MDA 分析

### 1.1 现状诊断：乐趣内核在哪，漏在哪

现有内核是四件事的叠加：**触摸板绝对定位微操**（1:1 手感，零学习成本）、**自动开火**（解放注意力给走位）、**弹幕躲避**、**连击计分**。
这四件事本身是成立的 —— 问题出在**内核之上没有「变奏」**：

| 症状 | 玩家感知 | 设计学解释 |
|---|---|---|
| 4 个 Boss 共用 3 段弹幕 | 「打第 4 关跟第 1 关一样」 | **动态层贫瘠**：机制没变，玩家的最优策略从头到尾是同一套（贴下方小幅横移）→ **主导策略**已成立 |
| 自动开火 + 无风险收益选择 | 「只有躲，没有赌」 | 缺少**主动风险机制**，胜任感只能靠「活得久」，没有「打得漂亮」的表达出口 |
| 火力 P 只加弹数 | 「变强 = 屏幕变亮」 | 成长缺少**形态变化**，自主感（build 选择）为零 |
| 8 种杂兵但行为都在「向下飘 + 偶尔开火」 | 「敌人是背景板」 | 威胁语法单一，Boss 战与杂兵战之间没有**教学-考试**的结构 |

### 1.2 三条设计支柱（本次扩展的判据）

> 任何新机制，若不能被下列三条中的至少一条正向支撑，就砍掉。

**支柱 P1 · 一根手指的芭蕾（不新增输入）**
本作唯一输入是「手指位置 + 点击放炸弹」。**所有新机制必须通过「位置」这一个变量表达**：
僚机跟随位置、擦弹靠贴近、Boss 弱点靠站位、障碍靠绕行。
❌ 反例（明令禁止）：聚焦键、切换武器键、格挡键、长按蓄力。
✅ 判据：新机制能不能只用「我把手指放在哪」来完整表达？不能就砍。

**支柱 P2 · 读得懂的弹幕（每次死亡必须可归因）**
弹幕的美不在密，在**可解**。每个模式必须满足：
1. **有预告**（充能高亮 / 预警线 / 舱门打开 / 尾刺白热），预告时长 ≥ 500ms；
2. **有解法**（缺口、间隙、安全区、时间窗），且解法在弹幕生成瞬间就已存在（不许「发射后才决定能不能躲」）；
3. **死了知道为什么**（「我贪了那 3 秒 DPS」而不是「屏幕突然全红」）。
❌ 反例：无预警的全屏瞬发；追踪到底的必中弹；随机落点覆盖全部安全区。

**支柱 P3 · 贪婪要有代价，也要有回报**
给玩家一个**自愿承担风险换收益**的旋钮 —— 这是本次扩展最重要的新增维度（擦弹）。
判据：任何「更靠近危险」的行为，都应该有可见的正反馈；任何正反馈，都应该有真实的翻车概率。

### 1.3 MDA 三层展开

**M（Mechanics · 机制层）—— 我们往系统里加了什么**

| 新机制 | 类别 | 支柱 |
|---|---|---|
| `BOSS_KINDS` 注册表 + 6 款差异化 Boss | 内容扩容 | P2 |
| Boss 阶段系统（66% / 33% 阈值） | 节奏结构 | P2 |
| ebullet 扩展字段（`ax/ay/av/hold/ttl/split/gz`） | 表达力底座 | P2 |
| 擦弹 Graze + 集中 Focus | 风险收益 | P3 |
| 僚机 Option（power≥3 / =5） | 成长形态 | P1 P3 |
| Boss 召唤 / 舰载机 | 空间压迫 | P2 |
| 新敌种 turret / kamikaze / curver | 威胁语法 | P2 |
| 漂移陨石 rock | 空间约束 | P1 |
| 道具 C 金币 / G 散射 | 目标多样 | P3 |

**D（Dynamics · 动态层）—— 玩家实际会长出什么行为**

1. **「贴脸擦弹 vs 保守站位」的持续决策**
   擦弹圈 26px、受击圈 14px，中间只有 12px 的「甜蜜带」。玩家每一秒都在问：这颗弹我要不要蹭一下？
   → 把原本单调的「躲」变成了**有梯度的躲**。这是本次扩展的**核心动态**。
2. **火力等级的意义从「数值」变成「形态」**
   power 3 和 power 5 不再只是弹多几发，而是「有 1 个僚机」vs「有 2 个僚机」—— 站位形状不同、覆盖角度不同。
   玩家会主动为了保住 power 而躲得更凶（**因为死亡不掉 power，但掉命；而 power 影响体验形态**）。
3. **Boss 阶段跨越 = 明确的胜任感锚点**
   66% / 33% 两次「相位爆」（清屏 + 定格 + 屏震）把一场 60~90 秒的 Boss 战切成 3 个可感知的乐章，
   每跨一段就是一次「我推进了」的确认 —— 解决现在「打 Boss 像在磨血条」的问题。
4. **威胁语法的「先教后考」**
   杂兵波先单独出现 turret（教「悬停三连爆发要横向拉开」），Boss 波母舰再成批弹射 —— 玩家已有肌肉记忆，
   压力来自「量」而非「不认识」。这是心流曲线不断裂的关键。
5. **陨石带来的「空间被剥夺」**
   在只有 460px 宽的战场里放 2~3 块 60px 的移动障碍，等于动态压缩安全区，
   逼迫玩家提前规划路线而不是纯反应 —— 引入**空间前瞻**这一新技能维度。

**A（Aesthetics · 美学层）—— 玩家会得到什么体验**

按 LeBlanc 八美学分类，本作的目标配比：

| 美学 | 现状 | 扩展后 | 由什么支撑 |
|---|---|---|---|
| **Challenge**（挑战） | ★★★☆ | ★★★★★ | 6 款差异化 Boss + 阶段跃迁 + 擦弹的自愿加压 |
| **Sensation**（感官） | ★★★★ | ★★★★★ | 相位爆的清屏定格、旋转光束的视觉压迫、僚机的编队感 |
| **Discovery**（发现） | ★☆ | ★★★★ | 每款 Boss 3 阶段 = 18 段未知弹幕；招牌机制各不相同 |
| **Expression**（表达） | ★ | ★★★ | 擦弹分数 = 玩家风格的量化表达（保守打法 vs 极限打法分差可达 2x） |
| **Fantasy**（幻想） | ★★ | ★★★ | Boss 造型/命名/招式构成一条「从近地到虚空」的敌人生态叙事 |
| Submission（消遣） | ★★★★ | ★★★★ | 保持 —— 不许把门槛推高到「必须会擦弹才能通关」 |

### 1.4 自我决定论（SDT）映射

| 需求 | 现状缺口 | 本次如何补 | 反面护栏 |
|---|---|---|---|
| **自主 Autonomy** | 玩家只能选难度和皮肤，局内无选择 | ① 擦弹 = 自愿的风险开关（不擦也能通关，擦了分数翻倍）② 打不打 Boss 的装甲/舱门 = 战术分支 ③ 陨石打掉还是绕过 = 路线选择 | **不许**用引力场强拉玩家（剥夺移动自主）→ void 的引力默认只作用于**敌弹**，玩家牵引降级为 T3 可选项 |
| **胜任 Competence** | 只有「过关」和「分数」两个粗粒度反馈 | ① 阶段跃迁的即时视听爆点 ② 擦弹槽的连续可视进度（0→30 的填充）③ Focus 激活的全屏色调变化 ④ 击破 Boss 部件（装甲/舱门）的独立反馈 | 反馈必须**即时**（同一逻辑步内出效果），延迟反馈等于没反馈 |
| **关联 Relatedness** | 单机无社交 | ① 本地排行榜已有，新增「最高擦弹数」字段 ② Boss 命名与关卡叙事形成可讨论的「战例」（玩家会说「我卡在巨蝎的尾刺」）③ 每款 Boss 有一句战术提示文案（首次遭遇时显示） | 不引入联网 |

### 1.5 心流：挑战-技能平衡曲线

心流通道要求「挑战随技能同步爬升」。本次的爬升节奏设计如下：

```
难度
 ↑                                                    ┌── void P3（峰值）
 │                                          ┌─ phaser ┤
 │                              ┌─ core ────┘
 │                  ┌─ carrier ─┘
 │        ┌─ scorpion
 │  ┌─ sentinel                        ← 每关 Boss 之间的落差用「新语法」而非「纯数值」拉开
 │──┘
 └──────────────────────────────────────────────────────→ 玩家技能
    S1        S2        S3        S4       S5       S6
   横移      读预警    管小怪    走位穿隙  抗欺骗   综合
```

**关键设计：每关只引入 1 个新「威胁语法」，且在 Boss 前的杂兵波先教。**

| 关 | 新语法 | 杂兵波预教 | Boss 考试 |
|---|---|---|---|
| S1 | 扇形弹的缺口读法 | 现有 elite 3 向扇 | sentinel 的 `fan9gap` |
| S2 | 「预警 → 高速直线」的时间窗 | 现有 sniper 高速狙击弹 | scorpion 尾刺穿刺（预警 900ms） |
| S3 | 同时管理小怪与弹幕的注意力分配 | 新增 turret 悬停爆发 | carrier 舰载机弹射 |
| S4 | 在缓慢旋转的弹阵中穿行 | 现有 spinner 环形弹 | core 旋转光束 |
| S5 | 对抗「位置欺骗」（Boss 不在你以为的地方） | 新增 kamikaze 弱追踪 | phaser 瞬移 + 残影爆散 |
| S6 | 综合 + 记忆（回响弹幕） | 前 5 关全部 | void 三形态 + Echo |

### 1.6 Bartle 玩家类型映射（单机 shmup 转译）

| 类型 | 在本作里的对应 | 扩展提供的钩子 |
|---|---|---|
| **Achiever**（成就） | 刷高分、通关、全 Boss 击破 | 擦弹计分（分数上限提高 ~2x）、金币道具 C、最高擦弹数进排行榜、Boss 部件全破的额外掉落 |
| **Explorer**（探索） | 想看到所有 Boss 招式、想知道机制怎么运作 | 18 段阶段弹幕、Boss 部件（装甲/舱门/晶体）的隐藏交互、EX Boss（T3） |
| **Killer**（挑战/征服） | 极限操作、无伤、速杀 | 擦弹 Focus 的连锁维持（高手可以全程挂着 1.5x）、打掉部件的速杀路线、hard 难度 |
| **Socializer**（社交） | 分享战绩、讨论战术 | Boss 有名有招（可命名讨论）、排行榜条目带「卡在第几关的哪个 Boss」 |

> **配比判断**：本作是单机街机型，Achiever + Killer 是主力（约 70%），
> 所以**擦弹系统（给 Killer）+ 金币/排行榜（给 Achiever）优先级高于叙事文案（给 Explorer/Socializer）**。
> 这直接决定了 §5 的 Scope 分层顺序。

---

## 2. Boss 阵容（核心）

### 2.1 架构重构：从 `bossPattern%3` 到 `BOSS_KINDS` 注册表

#### 2.1.1 现状的问题

```js
// game.js:481-502 —— 全部 4 个 Boss 共用
function bossFire(b) {
  const pat = bossPattern % 3;   // ← 模块级全局变量，与 b 无关
  bossPattern++;
  if (pat === 0) { /* 7 路扇形 */ }
  else if (pat === 1) { /* 双反向弹 */ }
  else { /* 3 路瞄准 */ }
}
```

Boss 的「身份」只体现在 `name / hue / hp` 三个装饰性字段上。**这是内容量为 1 的系统。**

#### 2.1.2 目标架构

```js
/* ---- Boss 注册表：一款 Boss = 一条 kind 记录 ---- */
const BOSS_KINDS = {
  sentinel: {
    name: '哨戒机甲',
    hue: 198, w: 140, h: 92, hp: 170,
    sprite: 'boss',                 // 仅此款用贴图，其余为 null → 走矢量
    entrySpeed: 1.4,                // 下沉速度 px/step（沿用现值）
    move: moveSweep,                // (b, now, dt) => void
    draw: null,                     // null = 用通用 drawBoss；否则 (b, now, player) => void
    onSpawn: null,                  // (b, now) => void，初始化 kind 私有字段
    onPhase: null,                  // (b, idx, now) => void，进入新阶段的额外处理
    phases: [
      { at: 1.00, gap: 900, pats: ['fan7', 'aim3'] },
      { at: 0.66, gap: 720, pats: ['fan9gap', 'crossSpin', 'aim3'] },
      { at: 0.33, gap: 540, pats: ['wallGap', 'spiral2', 'aim5'] },
    ],
  },
  scorpion: { /* ... */ },
  carrier:  { /* ... */ },
  core:     { /* ... */ },
  phaser:   { /* ... */ },
  void:     { /* ... */ },
};
```

**弹幕模式（pat）本身是一张独立的原语表**，Boss 只是「引用模式名的编排」：

```js
/* ---- 弹幕原语库：所有 Boss 共享，一次实现处处复用 ---- */
const BOSS_PATS = {
  fan7:      (b, cx, cy) => { fanShot(cx, cy, 7,  Math.PI*0.60, Math.PI/2, 3.4, 6, 'fan'); },
  fan9gap:   (b, cx, cy) => { fanShot(cx, cy, 9,  Math.PI*0.72, Math.PI/2, 3.2, 6, 'fan', 4); }, // 抽掉第 4 格
  aim3:      (b, cx, cy) => { aimShot(cx, cy, 3, 0.18, 4.0, 6, 'aim'); },
  aim5:      (b, cx, cy) => { aimShot(cx, cy, 5, 0.16, 4.0, 6, 'aim'); },
  ring24:    (b, cx, cy) => { ringShot(cx, cy, 24, 2.6, b.spinA, 5, 'ring'); },
  spiral2:   (b, cx, cy) => { b.subN = 6; b.subT = 0; b.subPat = 'spiral2'; },  // 多段：交给 subStep
  // ... 详见 §2.3 原语规格
};
```

#### 2.1.3 改造后的 `spawnBoss`（不破坏既有波次调度）

```js
function spawnBoss(n, now) {
  const st = STAGES[game.stage - 1] || STAGES[STAGES.length - 1];
  const K  = BOSS_KINDS[st.bossKind] || BOSS_KINDS.sentinel;   // ← 唯一新增的查表
  const tier = Math.floor(n / 3);
  // STAGES 里的值优先（向后兼容：老 STAGES 没有 bossKind 时行为与今天完全一致）
  const hp = st.bossHp != null ? st.bossHp : K.hp;
  game.boss = {
    // ---- 既有字段：一个不动 ----
    x: W / 2, y: -90, ty: H * 0.16,
    hp, maxHp: hp, w: K.w, h: K.h,
    hue: st.bossHue != null ? st.bossHue : K.hue,
    name: st.bossName || K.name,
    phase: 0, fireT: 0,
    fireGap: K.phases[0].gap,           // ← 由 kind 的 P1 决定，不再用 900-tier*120
    px: W / 2, py: -90, sx: 0, sy: 0,
    // ---- 新增字段（boss 不是池对象，加字段零风险）----
    kind: st.bossKind || 'sentinel',
    phaseIdx: 0,       // 当前阶段下标
    patIdx: 0,         // 当前阶段内的模式轮转下标（取代全局 bossPattern）
    subT: 0, subN: 0, subPat: null,   // 多段齐射：剩余段数 / 段间步数倒计时 / 段类型
    spinA: 0,          // 环形/螺旋的累计相位（rad）
    mobT: 0,           // 移动子状态计时（急停、瞬移倒计时等）
    summonT: 0,        // 召唤计时（ms）
    invulnUntil: 0,    // 阶段切换/瞬移期间的无敌截止（逻辑时钟 ms）
    tellUntil: 0,      // 预警显示截止（渲染读它画预警线，不参与逻辑判定）
    tellX: 0, tellY: 0,// 预警指向（尾刺穿刺的目标点）
    dmgMul: 1,         // 本体受伤倍率（装甲存活时 0.5）
    parts: null,       // 部件血量数组（sentinel 装甲 / carrier 舱门 / void 晶体）
    minions: 0,        // 当前存活的召唤物计数（硬上限护栏）
    echo: null,        // void 回响队列
    ghost: null,       // phaser 残影点（渲染用 + 残影爆散逻辑用）
    difficulty: tier,  // 保留 tier 概念，供 kind 内部微调
  };
  if (K.onSpawn) K.onSpawn(game.boss, now);
  audio.boss();
  audio.music.setIntensity('boss'); audio.music.setStage(game.stage);
}
```

> **兼容性保证**：`STAGES` 前 4 项若不加 `bossKind`，`|| BOSS_KINDS.sentinel` 会让它们退回哨戒机甲行为，
> S10（Boss 波全链路）/ S15（VICTORY 路径）冒烟不会因为查表失败而红。**建议实现时先跑一次「只加注册表、
> STAGES 不动」的中间态，确认 125/125 全绿，再逐关挂 `bossKind`。**

#### 2.1.4 改造后的 `bossFire`

```js
function bossFire(b) {
  const K   = BOSS_KINDS[b.kind] || BOSS_KINDS.sentinel;
  const ph  = K.phases[b.phaseIdx] || K.phases[0];
  const pats = ph.pats;
  const name = pats[b.patIdx % pats.length];
  b.patIdx++;
  const cx = b.x, cy = b.y + b.h * 0.4;
  const fn = BOSS_PATS[name];
  if (fn) fn(b, cx, cy, ph);
  bossPattern++;   // ← 保留全局自增：老逻辑/测试若引用它不至于失效（只读不用于分支）
}
```

#### 2.1.5 `step()` 内 Boss 段的改造（`game.js:973-995`）

```js
if (game.boss) {
  const b = game.boss;
  const K = BOSS_KINDS[b.kind] || BOSS_KINDS.sentinel;

  if (b.y < b.ty) {
    b.y += K.entrySpeed;                       // 入场：原样，只是速度可配
  } else {
    // ① 阶段跃迁检查（先于移动与开火）
    const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 0;         // ← NaN 护栏
    while (b.phaseIdx + 1 < K.phases.length && ratio <= K.phases[b.phaseIdx + 1].at) {
      b.phaseIdx++;
      enterBossPhase(b, K, now);
    }
    // ② 移动（由 kind 决定）
    K.move(b, now, dt);
    // ③ 多段齐射的子时序（按逻辑步递减，与刷新率无关）
    if (b.subN > 0) {
      if (b.subT > 0) b.subT--;
      else { subFire(b); }                      // 内部自减 subN、重置 subT
    }
    // ④ 主弹幕节拍
    if (now >= b.invulnUntil) {                 // 阶段切换/瞬移期间不开火
      b.fireT += dt;
      if (b.fireT > b.fireGap) { b.fireT = 0; bossFire(b); }
    }
    // ⑤ 召唤（若该 kind 有）
    if (K.summon) { b.summonT += dt; if (b.summonT > K.summonGap) { b.summonT = 0; K.summon(b, now); } }
  }

  // 玩家子弹 vs Boss（+ 部件优先判定 + 无敌门）
  for (let i = 0, n = game.bullets.length; i < n; i++) {
    const bu = game.bullets[i];
    if (now < b.invulnUntil) break;             // 无敌期：子弹不判定（也不消失，穿过去）
    if (b.parts && hitBossPart(b, bu)) continue; // 命中部件（内部已置 bu.y=-999）
    if (hit(bu.x, bu.y, bu.r, b.x, b.y, b.w * 0.42)) {
      bu.y = -999;
      b.hp -= b.dmgMul;                          // ← 原为 b.hp--，现支持减伤（默认 dmgMul=1 行为不变）
      if (b.hp <= 0) onBossKilled(b);
    }
  }
  sweep(game.bullets, POOL.bullets, keepBulletAlive);
  if (now >= player.invulnUntil && now >= player.shieldUntil &&
      hit(b.x, b.y, b.w * 0.38, player.x, player.y, 14)) {
    explode(player.x, player.y, 200); loseLife(now);
  }
}
```

#### 2.1.6 阶段跃迁 `enterBossPhase`（全 Boss 共用）

```js
function enterBossPhase(b, K, now) {
  const ph = K.phases[b.phaseIdx];
  b.fireGap = ph.gap;
  b.fireT = 0;
  b.patIdx = 0;
  b.subN = 0; b.subPat = null;                 // 中断进行中的多段齐射
  b.invulnUntil = now + 1200;                  // 1.2s 无敌 + 停火（给玩家喘息 + 明确「换乐章」）
  // 相位爆：清空敌弹 → 转成分数（正反馈），粒子有硬上限
  const cleared = game.ebullets.length;
  let fxBudget = 24;                            // ★ 池护栏：最多 24 颗弹产生视觉粒子
  for (let i = 0; i < game.ebullets.length; i++) {
    const eb = game.ebullets[i];
    if (fxBudget > 0) { addParticle(eb.x, eb.y, 0, -0.6, 0.5, 46); fxBudget--; }
    eb.dead = true;
  }
  game.score += cleared * 5;                    // 清屏转分：擦弹之外的第二个「贪婪回报」
  addRing(b.x, b.y, b.hue, Math.max(W, H) * 0.55);
  game.shake = Math.max(game.shake, 14);
  game.hitStop = Math.max(game.hitStop, 80);
  game.flash = Math.max(game.flash, 0.6);
  audio.bomb();                                 // 复用既有音效，不新增音频资产
  if (K.onPhase) K.onPhase(b, b.phaseIdx, now);
}
```

> **设计理由（胜任感）**：把「血条过了个阈值」这种不可感知的事件，翻译成**清屏 + 定格 + 屏震 + 加分**
> 四重同步反馈。这是整个 Boss 系统里性价比最高的一处改动 —— 一次实现，6 款 Boss × 2 次 = 12 个高光时刻。
>
> **平衡护栏**：清屏是**有利于玩家**的，所以阶段切换不能变成「送安全」。
> 对策：切换后的新阶段 `gap` 明显更短、模式更密，净效果是**先松一口气，再立刻加压**（呼吸节奏）。

### 2.2 六款 Boss 详规

> 所有新 Boss **走矢量绘制**，不依赖新贴图。`drawBoss` 的矢量降级段（`entities.js:645-726`）
> 已包含「旋转能量冠 / 渐变舰体 / 脉动核心 / 充能预告 / 追踪眼」五个可复用零件，
> 新 kind 的 `draw` 直接组合这些零件 + 各自的标志性部件即可。
>
> **唯一例外**：`sentinel` 继续用 `boss.png`（保留玩家对 v1.2.0 的视觉记忆锚点）。

---

#### Boss 1 · `sentinel` 哨戒机甲

| 项 | 值 |
|---|---|
| **关卡** | S1 近地轨道（沿用现有） |
| **hue** | 198（雾青，沿用） · 建议区间 190~210 |
| **体量** | w 140 / h 92（沿用） |
| **HP** | 170（沿用） —— 本体 122 + 双肩装甲 2×24 |
| **贴图** | `boss.png`（唯一保留贴图的 Boss） |
| **定位** | 教学 Boss。玩家在这里学会「读扇形缺口」和「打部件」 |

**外观概念**
沿用现有战舰贴图，**新增双肩装甲板**（矢量叠加在贴图之上）：
左右各一块梯形护甲，位于 `(±0.42w, -0.05h)`，尺寸约 `0.20w × 0.34h`，
颜色 `hsl(hue, 40%, 34%)`，边缘一道 `hsl(hue, 55%, 72%)` 的高光。
受击闪白，血量 <50% 时出现两道裂纹（用两条固定折线，**不用随机**——渲染层禁止 RNG）。
被击破时该侧爆一次 `explode()` 并永久消失。

**移动模式**
- P1：横扫 —— `b.phase += dt * 0.0016; b.x = W/2 + sin(phase) * W*0.26`（**与现状完全一致**）
- P2：横扫加速加幅 —— `dt * 0.0022`，幅度 `W*0.30`
- P3：**急停突进** —— 每 3.2s 停顿 0.6s（`mobT` 计时，停顿期间核心白热 = 预警），
  之后 1.0s 内以 `sin` 的 2.2 倍角速度横向掠过。制造「读节拍」的压力。

**分阶段弹幕**

| 阶段 | HP 区间 | `gap` | 模式轮转 | 每次弹数 | 说明 |
|---|---|---|---|---|---|
| **P1** | 100%~66% | 900ms | `fan7` → `aim3` | 7 / 3 | **原样保留现有弹幕** —— 老玩家的熟悉锚点 |
| **P2** | 66%~33% | 720ms | `fan9gap` → `crossSpin` → `aim3` | 8 / 4 / 3 | `fan9gap`：9 路扇形 spread 0.72π 抽掉第 4 格；`crossSpin`：4 向十字，每次整体旋转 0.5 rad |
| **P3** | 33%~0% | 540ms | `wallGap` → `spiral2` → `aim5` | 11 / 12 / 5 | `wallGap`：11 发横排弹墙（x 均分 W/11，vy 2.6），**缺口位置每次由 step 内 RNG 决定**；`spiral2`：双臂螺旋，6 段 × 2 发，段间 6 步，步进 0.32 rad |

**招牌机制 · 双肩装甲（Armor Plates）**
```js
b.parts = [{ hp: 24, ox: -0.42, oy: -0.05, r: 0.16 },   // ox/oy/r 为 w/h 的比例
           { hp: 24, ox:  0.42, oy: -0.05, r: 0.16 }];
b.dmgMul = 0.5;   // 装甲存活时本体减伤 50%
```
- 子弹优先判定装甲板（`hitBossPart`），命中装甲不伤本体；
- 两块都破 → `b.dmgMul = 1`，并 `dropItem(b.x, b.y, true)` 掉 1 个道具；
- **战术分支（自主感）**：先拆装甲（前期慢、后期快）vs 硬顶本体（全程慢但不用换位置）。
  数值上两条路线总耗时差 < 8%，**不构成主导策略**（见 §6.2 的平衡验算）。

**峰值弹数估算**：P3 最密时段 —— 弹速 2.6~3.4 px/step，屏内驻留 ≈ 675/3.0 ≈ 225 步 ≈ 3.75s；
`gap` 540ms ≈ 32 步 → 同屏约 7 波 × 平均 9.3 发 ≈ **65 发**。

---

#### Boss 2 · `scorpion` 采矿巨蝎

| 项 | 值 |
|---|---|
| **关卡** | S2 陨石带 |
| **hue** | 32（暖橙金，沿用） · 建议区间 24~44 |
| **体量** | w 150 / h 96 |
| **HP** | 240（沿用） |
| **贴图** | 无 —— 纯矢量 |
| **定位** | 「预警 → 高速直线」的时间窗教学；引入召唤 |

**外观概念（矢量）**
- **躯干**：倒梯形甲壳，上宽 `0.62w` 下窄 `0.40w`，高 `0.55h`，
  竖直渐变 `hsl(32,58%,66%)` → `hsl(32,46%,26%)`，甲壳上刻 3 道横向分节线。
- **双螯**：躯干两侧各一组 2 段多边形（上螯 + 下钳），
  钳口开合角随 `sin(b.phase*2)` 在 0.10~0.42 rad 之间变化 —— **确定性动画，不用 RNG**。
- **尾巴（标志性部件）**：从躯干后上方伸出 **5 节递减圆**，
  第 i 节：`r = 0.10w * (1 - i*0.13)`，沿曲线 `angle_i = -1.35 + i*0.30 + sin(b.phase)*0.16` 依次偏移排布。
  末端 **尾刺**：一个 `0.09w` 长的锐角三角形。蓄力时尾刺从 `hsl(32,60%,60%)` 线性插值到 `hsl(45,95%,92%)`（白热），
  同时在尾刺前方画一条**预警虚线**（`setLineDash([8,10])`，指向 `b.tellX/b.tellY`，alpha 随蓄力进度 0→0.7）。
- **配色关键**：躯干走暖橙，但**弹幕仍用 `EB_STYLE` 的危险色带（hue 12~24）** —— 机体与弹不同色，
  威胁读得清（沿用 MEMORY 里的方向 B 配色纪律）。

**移动模式**
8 字（Lissajous）—— **本作首次出现 y 轴移动的 Boss**：
```js
b.phase += dt * 0.0015;
b.x = W/2 + Math.sin(b.phase) * (W * 0.28);
b.y = b.ty + Math.sin(b.phase * 2) * (H * 0.05);
```
P3 时 `dt*0.0021`、y 幅度 `H*0.07`。

**分阶段弹幕**

| 阶段 | HP | `gap` | 模式轮转 | 弹数 |
|---|---|---|---|---|
| **P1** | 100%~66% | 820ms | `fan5wide` → `aim3` | 5 / 3 |
| **P2** | 66%~33% | 700ms | `tailLance` → `ringGap16` → `aim3` | 14 / 16 / 3 |
| **P3** | 33%~0% | 560ms | `tailLance` → `ringGap20` → `tailLance` → `aim5` | 14 / 20 / 14 / 5 |

- `fan5wide`：5 发大弹（r 7，spd 2.8），spread 0.90π —— 覆盖侧翼，逼玩家往中间走
- `ringGap16`：16 发环（spd 2.6），起始相位 `b.spinA`（每次 += 0.22 rad），**抽掉相邻 2 格留缺口**
- `ringGap20`：同上，20 发，抽 2 格，spd 2.8

**招牌机制 ① · 尾刺穿刺（Tail Lance）**
本作最重要的「可读高威胁」样板：
```
t=0ms      尾刺开始白热，预警虚线出现，锁定【此刻】玩家坐标 → b.tellX/tellY
t=0~900ms  蓄力（Boss 正常移动，但预警线角度锁死不再跟随 ← 关键公平性设计）
t=900ms    发射：沿锁定角度连发 14 颗大弹（r 9，spd 7.5 px/step = 450 px/s），段间 2 步
t≈1050ms   弹链全部出膛，形成一条穿透全屏的「矛」
```
- **公平性**：角度在 t=0 锁定，玩家有整整 900ms 横向撤离。躲避成本 ≈ 移动 40px。
- **惩罚**：不撤离必吃 —— 弹速 7.5 px/step 无法反应躲避。
- **教学价值**：这是玩家第一次被迫「看预警而不是看子弹」。

**招牌机制 ② · 召唤矿工（Summon）**
```js
K.summonGap = 5500;   // ms
K.summon = (b, now) => {
  if (b.minions >= 4) return;                    // ★ 硬上限护栏
  const kinds = b.phaseIdx >= 2 ? 'kamikaze' : 'diver';
  for (let s = -1; s <= 1; s += 2) {             // 两螯各放 1 只
    spawnMinion(kinds, b.x + s * b.w * 0.40, b.y + b.h * 0.10, b);
  }
};
```
- P1 不召唤（先让玩家熟悉尾刺）；P2 放 `diver`×2；P3 放 `kamikaze`×2。
- 召唤物计入 `b.minions`，死亡时 `b.minions--`（在 `onEnemyKilled` 里判 `en.fromBoss`）。

**峰值弹数**：P3 最坏 —— 尾刺 14×2 + 环 20 + 瞄准 5 = 53/轮，同屏 ≈ 4 轮 × 平均 13 ≈ **175 发**（尾刺速度快、驻留短）。

---

#### Boss 3 · `carrier` 雷云母舰

| 项 | 值 |
|---|---|
| **关卡** | S3 电离层 |
| **hue** | 150（苔绿，沿用） · 建议区间 140~162 |
| **体量** | **w 190 / h 76**（宽扁 —— 本作最宽的 Boss，视觉上像一堵墙） |
| **HP** | 330（沿用） —— 本体 250 + 双舱门 2×40 |
| **贴图** | 无 —— 纯矢量 |
| **定位** | 注意力分配训练。压力来源从「弹」转向「屏幕上的实体数量」 |

**外观概念（矢量）**
- **舰体**：宽扁圆角矩形（`0.92w × 0.55h`），横向渐变（左右暗、中间亮），
  表面 5 条纵向装甲缝（细线 `hsla(150,40%,80%,0.25)`）。
- **指挥塔**：舰体上方居中的梯形（`0.22w × 0.30h`），顶端一颗慢速闪烁的红色航行灯
  （`0.5 + 0.5*sin(now/420)`，确定性）。
- **舱门（标志性部件）**：舰体左右各一个矩形舱口（`0.18w × 0.34h`，位于 `±0.30w`）。
  关闭时是与舰体同色的门板 + 一道缝；开启时门板向两侧滑开（`openT` 0→1 的插值），
  露出内部橙色内舱光（`hsla(28,80%,60%, 0.55*openT)`）+ 一架待发舰载机的剪影。
  舱门被打爆后永久敞开、内部变黑焦、冒 2 颗慢速烟尘粒子/秒。
- **底部挂点**：4 个小圆（`±0.30w, ±0.12w` 处），投弹时依次闪白。

**移动模式**
**缓慢悬停**（本作最"稳"的 Boss，因为它不靠走位威胁人）：
```js
b.phase += dt * 0.0008;                            // 比 sentinel 慢一半
b.x = W/2 + Math.sin(b.phase) * (W * 0.18);
```
P3：`b.ty = H * 0.21`（下压 5%，制造逼近感），横幅 `W*0.22`。

**分阶段弹幕**

| 阶段 | HP | `gap` | 模式轮转 | 弹数 |
|---|---|---|---|---|
| **P1** | 100%~66% | 1100ms | `bombDrop4` → `aim3` | 4（→分裂 20）/ 3 |
| **P2** | 66%~33% | 950ms | `bombDrop4` → `sweepRain7` → `aim3` | 4（→20）/ 7 / 3 |
| **P3** | 33%~0% | 800ms | `bombDrop6` → `sweepRain9` → `sweepRain9`（错半格） → `aim5` | 6（→30）/ 9 / 9 / 5 |

- **`bombDrop`（二段分裂弹）**：从底部挂点各投 1 发**慢速大弹**（r 8，spd 1.8，`kind:'fan'`），
  给该弹设 `split = 66`（步数）；倒计时归零时该弹 `dead=true` 并在原地生成 **5 发扇形**（spd 3.0，spread 0.55π）。
  → 玩家学会「大弹不是威胁，大弹落地的位置才是」，引入**空间前瞻**。
  → 一次 4 发母弹 = 4 + 20 = 24 颗弹的总生成量。
- **`sweepRain`**：沿舰体宽度均分 N 点，同时垂直下落（spd 2.2）。P3 连发两次，第二次 x 偏移半格
  → 形成「交错雨」，安全区在两次之间不断左右横跳。

**招牌机制 · 舰载机弹射（Hangar Launch）**
```js
K.summonGap = 4200;
K.summon = (b, now) => {
  if (b.minions >= 8) return;                     // ★ 硬上限 8
  const doors = [];
  if (b.parts[0].hp > 0) doors.push(-1);
  if (b.parts[1].hp > 0) doors.push(1);
  if (!doors.length) return;                      // 两门皆破 → 不再弹射（打部件的回报）
  b.doorOpen = 1;                                 // 渲染层播 0.5s 开门动画
  for (const s of doors) {
    const t = b.phaseIdx === 0 ? 'straight'
            : b.phaseIdx === 1 ? (s < 0 ? 'shooter' : 'straight')
            : 'kamikaze';
    spawnMinion(t, b.x + s * b.w * 0.30, b.y + b.h * 0.30, b);
  }
};
```
- **舱门 = 可关闭的水龙头**：这是本作第一个「打部件改变 Boss 行为」的设计，
  给玩家一个**明确的战术目标**（Explorer + Killer 双吃）。
- 单门被破 → `dropItem(门位置, true)`。

**峰值**：弹 ≈ 30（分裂后）+ 18（双层雨）+ 5 ≈ 53/轮 × 3 轮 ≈ **145 发** + 最多 8 架小怪。

---

#### Boss 4 · `core` 歼灭核心

| 项 | 值 |
|---|---|
| **关卡** | S4 深空要塞（沿用现有 bossName「歼灭核心」） |
| **hue** | 338（玫红，沿用） · 建议区间 330~350 |
| **体量** | **w 132 / h 132**（正圆 —— 唯一的等比 Boss） |
| **HP** | 460（沿用） |
| **贴图** | 无 —— 纯矢量 |
| **定位** | 静态高压炮台。考「在缓慢移动的弹阵中穿行」，与前三款的「反应型」形成对位 |

**外观概念（矢量）**
- **核心**：中心大圆（`r = 0.26w`），脉动明暗（沿用现有 `pulse` 公式），
  内嵌一圈散热纹（现有代码已有）。
- **六片旋转花瓣（标志性部件）**：绕核心等分 60° 的 6 个梭形（长 `0.44w`、宽 `0.13w`），
  整体旋转 `b.spinA += 0.012 /step`。
  - P2：反向 + 加速（`-0.019`）；
  - P3：**花瓣张开** —— 每片沿径向外移 `0.10w`，露出内环的橙色能量环（视觉上「装甲解除」）。
- **外圈能量冠**：沿用现有虚线环，但改成**双环反向旋转**（内环 `now/1400`，外环 `-now/2100`）。
- 血量 <20% 时核心色相从 338 偏移到 **12**（转成危险橙红），暗示「过载」。

**移动模式**
**几乎不动** —— 小半径圆周悬停：
```js
b.phase += dt * 0.0013;
b.x = W/2 + Math.cos(b.phase) * (W * 0.10);
b.y = b.ty  + Math.sin(b.phase) * (H * 0.03);
```
> 设计理由：这款 Boss 的威胁是**弹幕的几何**，不是它的位置。让它站定，玩家才有余裕读几何。
> （若它同时乱跑，旋转臂就从「可解谜题」退化成「随机噪声」，违反支柱 P2。）

**分阶段弹幕**

| 阶段 | HP | `gap` | 模式轮转 | 弹数 |
|---|---|---|---|---|
| **P1** | 100%~66% | 1000ms | `ring24` → `aim3` | 24 / 3 |
| **P2** | 66%~33% | 780ms | `rotorBeam4` → `ringGap24` → `aim5` | 72 / 21 / 5 |
| **P3** | 33%~0% | 620ms | `rotorBeam6` → `pulse3` → `aim5` | 84 / 72（3×24） / 5 |
| **过载** | <15% | 每 2000ms 额外 | `overload32` | 32 |

**招牌机制 ① · 旋转光束（Rotor Beam）—— 不引入新实体的「假光束」**

这是全文档技术含量最高的一处设计，请仔细读：

> **不要**做真正的 beam 实体（会引入新碰撞类型、新渲染路径、新池，风险高）。
> **改用「弹链 + 角速度」模拟**：一条臂 = 沿同一角度排布的 N 颗低速弹，每颗都带相同的角速度 `av`，
> 于是整条臂绕 Boss 缓慢旋转，视觉上就是一根扫过屏幕的光柱，而碰撞完全复用现有的圆-圆判定。

```js
// rotorBeam4：4 臂，每臂 18 颗
function rotorBeam(b, cx, cy, arms, per) {
  for (let a = 0; a < arms; a++) {
    const ang = b.spinA + a * (Math.PI * 2 / arms);
    for (let i = 0; i < per; i++) {
      const d = 26 + i * 15;                      // 沿臂的间距 15px（比弹径 4 稍大 → 有缝隙感）
      addEbulletEx(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d,
                   Math.cos(ang) * 1.5, Math.sin(ang) * 1.5,   // spd 1.5 px/step（慢）
                   4, 'ring',
                   { av: (b.phaseIdx >= 2 ? -0.009 : 0.009), ttl: 300 });  // ★ ttl 5s 自动清除
    }
  }
  b.spinA += 0.38;
}
```
- **`ttl`（寿命，步数）是必须的** —— 1.5 px/step 的弹飞完 675px 要 450 步（7.5s），
  不设寿命会长期占池。设 300 步（5s）刚好让臂扫过 ~2.7 圈后消散。
- **同时最多存在 1 组臂**：`gap`（780/620ms）远短于 ttl，会叠 —— 所以要加计数护栏：
  ```js
  if (b.beamAlive > 0) { /* 改发 aim5 */ } else { b.beamAlive = 1; rotorBeam(...); }
  // beamAlive 在 ttl 步后由计时器归零（b.beamT 递减）
  ```
- **玩家解法**：臂之间的扇区是安全的，玩家沿着扇区**同向旋转**移动即可（学会「跟着转」）。

**招牌机制 ② · 环脉冲（Pulse Ring）**
`pulse3`：3 层同心环，间隔 45 步依次发射，每层 24 发，速度递增 2.2 / 2.6 / 3.0。
→ 三层环之间的径向间距逐渐拉大，形成「呼吸」；玩家要在层与层之间的空档穿过去。

**招牌机制 ③ · 核心过载（Overload）**
hp < 15% 时，每 2s 额外发射 32 发**随机方向**散射（spd 2.4~3.6，`Math.random()` 在 step 内调用）。
这是唯一一处「不完全可读」的弹幕 —— **有意为之**：它出现在 Boss 濒死的最后 ~10 秒，
作为「收尾的混乱」而非「主要考核」。密度控制在能靠站位概率通过的水平。

**峰值弹数（全局最高之一）**：
P3 最坏叠加 = 旋转臂 84 + 三层脉冲 72 + 过载 32 + 瞄准 5 + 上一轮残留 ≈ **约 260 发**。

---

#### Boss 5 · `phaser` 相位幻影

| 项 | 值 |
|---|---|
| **关卡** | **S5 相位回廊**（新增关卡） |
| **hue** | 288（紫罗兰） · 建议区间 278~300 |
| **体量** | **w 120 / h 100**（最小的 Boss —— 难打中是它的防御） |
| **HP** | 500 |
| **贴图** | 无 —— 纯矢量 |
| **定位** | 位置欺骗。考「不要追着 Boss 跑」「预判它会去哪」 |

**外观概念（矢量）**
- **双三角嵌套**：外框三角（描边 2px，`hsla(288,60%,78%,0.85)`）逆时针自转 `-now/1900`；
  内实心三角（渐变填充，尺寸 0.62 倍）顺时针自转 `now/1200`。两个三角的相对旋转产生持续的莫尔感。
- **中心菱形核**：`0.16w` 的菱形，白紫渐变，脉动。
- **残影（标志性）**：`b.ghost` 保存最近 3 次瞬移的离开点 `{x, y, t}`。
  渲染时按 `t` 的衰减画 3 个半透明外框三角（alpha 0.30 / 0.18 / 0.09），不参与逻辑判定。
- **相位中**（瞬移的 0.35s）：本体 `globalAlpha 0.18`，只画外框，核暗掉。

**移动模式 · 瞬移（Blink）**
```js
// 锚点表（固定，不随机生成 —— 保证玩家能学会它的活动范围）
const PHASER_ANCHORS = [
  [0.18, 0.14], [0.50, 0.12], [0.82, 0.14],
  [0.22, 0.26], [0.50, 0.28], [0.78, 0.26],
];
// 每 1800ms：进入相位（0.35s 无敌+不可见）→ 选新锚点 → 现身
```
**公平性护栏（必须实现）**：
```js
// 落点不得贴玩家脸：|anchorX - player.x| < 60 时重选，最多重试 2 次，仍冲突则取索引+3 的备选
```
> 违反这条 → 玩家会被「凭空出现的 Boss」撞死，直接击穿支柱 P2。

**招牌机制 ① · 残影爆散（Ghost Burst）**
每次瞬移，在**离开点**留下的残影会在 **0.5s 后爆成 12 发环形弹**（spd 2.8）。
→ 教学意义：玩家的本能是「追着 Boss 打」，这个机制惩罚追击、奖励**预判落点**。
→ P3 升级为 16 发。

**招牌机制 ② · 双子分身（Twin）**
P2 起，Boss **同时从「本体」和「上一个残影点」两处发射同一个弹幕**。
视觉上像同时存在两个 Boss，但**只有本体可被击中**（残影不可打，且残影处会有明显的半透明差异）。
→ 弹数翻倍但几何不变，压力上升而可读性不降。

**分阶段弹幕**

| 阶段 | HP | `gap` | 模式轮转 | 弹数 |
|---|---|---|---|---|
| **P1** | 100%~66% | 800ms | `aimBurst4` → `fan7` | 4 / 7（+ 每次瞬移的 ghostBurst 12） |
| **P2** | 66%~33% | 660ms | `fan7`×2处 → `aimBurst4`×2处 → `spiral3` | 14 / 8 / 18 |
| **P3** | 33%~0% | 520ms | `crossRain` → `fan9gap`×2处 → `aim5`×2处 | 14 / 16 / 10（+ ghostBurst 16） |

- `aimBurst4`：4 连瞄准，段间 5 步（**每发重新取一次玩家角度** → 玩家横移就能拉开成扇形，
  站着不动就是 4 发叠在一起 —— 奖励移动）。
- **`crossRain`（横穿雨）**：从屏幕**左右两侧边缘**各生成 7 发水平弹（vx ±3.2，vy 0），
  y 分布在 `H*0.25 ~ H*0.65` 区间内均分 + step 内 RNG 抖动 ±12px。
  → **本作首次出现「不是从 Boss 发出」的弹幕**，制造被包围的错觉。
  → 注意 `keepEbullet` 已判 `x > -20 && x < W+20`，横穿弹会正常回收，无需改。

**峰值**：P3 = 横穿 14 + 双处扇形 16 + 双处瞄准 10 + 残影爆散 16 ≈ 56/轮 × 4.5 轮 ≈ **250 发**。

---

#### Boss 6 · `void` 终末虚空（最终 Boss）

| 项 | 值 |
|---|---|
| **关卡** | **S6 终末虚空**（新增关卡，最终关） |
| **hue** | 262（深蓝紫） · 建议区间 252~272 |
| **体量** | **w 160 / h 160**（最大） |
| **HP** | 640 |
| **贴图** | 无 —— 纯矢量 |
| **定位** | 集大成 + 记忆考核。**三阶段各借用前作 Boss 的一种移动模式**（叙事 + 代码复用双赢） |

**外观概念（矢量）**
- **黑洞核**：中心近黑圆（`hsl(262,30%,8%)`，`r = 0.20w`），边缘一圈极亮的吸积边（`hsl(262,80%,88%)`，2px）。
- **吸积盘**：两圈反向旋转的椭圆弧（`ctx.ellipse`，`ry = rx * 0.32`），
  内盘 `now/900` 顺转、外盘 `-now/1500` 逆转，透明度 0.4 / 0.25。
- **六块碎裂晶体（标志性部件）**：绕核心 60° 等分的不规则五边形（**顶点用固定常量数组，禁止随机**），
  每损失 25% HP **崩落一块**（爆一次 `explode()`，并生成 1 块高速 `rock` 掉落）。
  → 血量成为**可视信息**：玩家不看血条也知道打到哪了。
- **全身外描边**：`hsla(262,70%,85%,0.5)`，2.5px，配 `glowHue` 大范围柔光 —— 唯一有「全身发光」的 Boss。

**移动模式（三阶段三形态 —— 直接复用前作的 move 函数，零新代码）**

| 阶段 | 移动 | 复用自 |
|---|---|---|
| P1 | 横扫（幅度 `W*0.24`） | `sentinel` 的 `moveSweep` |
| P2 | 8 字 | `scorpion` 的 `moveFigure8` |
| P3 | 瞬移（落点为屏幕四角区 + 中央，共 5 个锚点） | `phaser` 的 `moveBlink` |

> 这不是偷懒，是**叙事设计**：终末虚空「吞噬了前面所有敌人」，所以它会用它们的动作。
> 首次遭遇时可显示战术提示：「它记得所有你杀过的东西」。

**招牌机制 ① · 漩涡弹幕（Vortex）—— 默认方案**
void 的**所有**弹幕都带一个统一的角速度 `av = 0.005 rad/step`（P3 为 0.007），
于是任何直线弹都会缓慢弯成逆时针弧线。
- 视觉：整屏弹幕像被黑洞搅动，极具压迫感；
- 玩法：玩家必须**预判弹的弯曲方向**，「往弹来的反方向躲」不再总是对的；
- 实现成本：几乎为零 —— 只是所有 `addEbulletEx` 多传一个 `av`。

**招牌机制 ①-b · 玩家牵引（T3 可选，默认关闭）**
```js
// 仅 P3，且必须满足全部三条护栏
player.x += (W/2 - player.x) * 0.004;   // 每步最多约 0.9px（W=460 时）
```
- 护栏 1：力度上限 1.2 px/step —— 玩家的跟随速度最低档 `sensSpeed=0.06`，
  只要手指距离 >20px 每步移动就 >1.2px，**玩家永远能抵抗**；
- 护栏 2：仅 P3，且吸积盘明显扩张 + 屏幕边缘暗角脉动作为预警；
- 护栏 3：**默认关闭**，作为 T3 的可选开关。
> **SDT 风险明示**：任何直接改写 `player.x/y` 的机制都在侵蚀自主感。
> 这个机制的收益（压迫感）小于风险（「我操作不算数」的挫败），所以降级为可选。

**招牌机制 ② · 回响（Echo）**
P2 起，Boss 每次开火会把这次的 `{pat, x, y}` 压入一个**最多 4 条**的环形队列，
并在 **1.2s（72 步）后于原坐标重放一次**。
```js
b.echo = [ /* {pat, x, y, due} × 最多 4 */ ];
```
- 玩家必须记住 1.2 秒前 Boss 在哪、发了什么 —— **引入记忆维度而非纯反应**（心流的深度来源）；
- 视觉提示：即将回响的位置提前 0.3s 出现一个淡紫色的收缩圆环（用 `rings` 池，1 个/次）；
- **池护栏**：队列硬上限 4，超出丢弃最旧的。

**招牌机制 ③ · 崩落（Shatter）**
每损失 25% HP 崩掉 1 块晶体 → 生成 1 块 `rock`（vy 2.6，从 Boss 位置落下，hp 4，撞玩家扣命）。
→ 战场上永远有 0~3 块正在下落的残骸，压缩安全区。

**分阶段弹幕**

| 阶段 | HP | `gap` | 模式轮转 | 弹数 |
|---|---|---|---|---|
| **P1** | 100%~66% | 760ms | `fan9gap` → `spiral3` → `aim5` | 8 / 18 / 5 |
| **P2** | 66%~33% | 620ms | `vortex20` → `ringGap24` → `aim5` + **Echo** | 20 / 22 / 5（全部 ×2 因回响） |
| **P3** | 33%~0% | 500ms | `vortex28` → `rotorBeam4` → `crossRain` → `aim7` + **Echo** | 28 / 56 / 14 / 7（×2） |

**峰值弹数（全局最高）**：
P3 单轮 = 28 + 56 + 14 + 7 = 105，回响使其近似翻倍 → 210；
同屏并存约 2.5 轮 → **约 480~520 发**。
这是整个游戏的 ebullets 峰值，`cap 1200` 提供 **2.3x 冗余**。

---

### 2.3 弹幕原语库规格（一次实现，六款复用）

```js
/* ---- 通用原语（放在 game.js 的 Boss 段之前）----
 * 所有原语只调用 addEbulletEx，不做任何 DOM / 渲染操作，可安全在 step() 内调用。 */

// 扇形：n 发均分 spread，中心角 base；gapIdx>=0 时抽掉该格（留缺口）
function fanShot(cx, cy, n, spread, base, spd, r, kind, gapIdx) {
  const a0 = base - spread / 2;
  const dv = n > 1 ? spread / (n - 1) : 0;          // ★ n=1 时防除零
  for (let i = 0; i < n; i++) {
    if (i === gapIdx) continue;
    const a = a0 + dv * i;
    addEbulletEx(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind, null);
  }
}

// 瞄准：朝玩家 n 连，相邻夹角 jitter
function aimShot(cx, cy, n, jitter, spd, r, kind) {
  const ang = Math.atan2(player.y - cy, player.x - cx);   // atan2(0,0)=0，JS 规范安全
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const a = ang + (i - half) * jitter;
    addEbulletEx(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind, null);
  }
}

// 环形：n 发均分 2π，起始相位 off；gapFrom/gapCount 指定连续缺口
function ringShot(cx, cy, n, spd, off, r, kind, gapFrom, gapCount) {
  const step = (Math.PI * 2) / n;                   // n 由调用方保证 >0
  for (let i = 0; i < n; i++) {
    if (gapCount > 0 && i >= gapFrom && i < gapFrom + gapCount) continue;
    const a = off + step * i;
    addEbulletEx(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, r, kind, null);
  }
}

// 弹墙：屏幕宽度均分 n 列垂直下落，gapIdx 留缺口
function wallShot(y, n, spd, r, kind, gapIdx) {
  const dv = W / n;
  for (let i = 0; i < n; i++) {
    if (i === gapIdx) continue;
    addEbulletEx(dv * (i + 0.5), y, 0, spd, r, kind, null);
  }
}

// 横穿雨：左右边缘各 n 发水平弹
function crossRainShot(n, spd, r, kind) {
  const y0 = H * 0.25, y1 = H * 0.65;
  const dv = n > 1 ? (y1 - y0) / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const jy = (Math.random() - 0.5) * 24;          // ★ RNG 在 step 内，合规
    addEbulletEx(-16,    y0 + dv * i + jy,  spd, 0, r, kind, null);
    addEbulletEx(W + 16, y0 + dv * i - jy, -spd, 0, r, kind, null);
  }
}

// 多段齐射的驱动器（在 step 的 Boss 段调用，按逻辑步递减）
function subFire(b) {
  const cx = b.x, cy = b.y + b.h * 0.4;
  if (b.subPat === 'spiral2')      { ringShot(cx, cy, 2, 2.8, b.spinA, 5, 'ring', -1, 0); b.spinA += 0.32; b.subT = 6; }
  else if (b.subPat === 'spiral3') { ringShot(cx, cy, 3, 2.8, b.spinA, 5, 'ring', -1, 0); b.spinA += 0.26; b.subT = 6; }
  else if (b.subPat === 'pulse')   { ringShot(cx, cy, 24, 2.2 + (3 - b.subN) * 0.4, b.spinA, 5, 'ring', -1, 0); b.subT = 45; }
  else if (b.subPat === 'lance')   { const a = b.tellA;
                                     addEbulletEx(cx, cy, Math.cos(a) * 7.5, Math.sin(a) * 7.5, 9, 'sniper', null); b.subT = 2; }
  else if (b.subPat === 'aimBurst'){ aimShot(cx, cy, 1, 0, 4.4, 6, 'aim'); b.subT = 5; }
  b.subN--;
  if (b.subN <= 0) b.subPat = null;
}
```

### 2.4 ebullet 扩展字段（表达力底座 —— T1 的第一件事）

现有 `mkEbullet()` 只有 `{x,y,vx,vy,r,dead,kind,px,py,sx,sy}`，无法表达上面任何一种进阶弹。**必须先扩它。**

```js
function mkEbullet() {
  return { x:0, y:0, vx:0, vy:0, r:0, dead:false, kind:undefined,
           px:0, py:0, sx:0, sy:0,
           // ---- 新增 ----
           ax:0,      // 加速度 x（px/step²）
           ay:0,      // 加速度 y
           av:0,      // 角速度（rad/step）—— 每步旋转速度向量，实现弯曲弹/漩涡
           hold:0,    // 启动延迟（步）—— >0 时静止不动，用于「织网」「预置弹」
           ttl:0,     // 寿命（步）—— >0 时逐步递减，归零即 dead（旋转臂必需）
           split:0,   // 二段分裂倒计时（步）—— 归零时 dead 并生成子弹幕
           splitN:0,  // 分裂子弹数
           gz:0 };    // 擦弹已计数标记（0/1）
}
```

**⚠️ 脏值红线（最容易出的 bug，必须遵守）**

池对象是**复用**的。加了字段却不在 `addEbullet` 里重置 → 一颗新弹会继承上一颗弹的 `av/ttl/split`，
表现为「莫名其妙弯掉的直弹」「凭空消失的弹」「随机分裂的弹」，且**只在特定时序复现**，极难查。

```js
// 原签名保持不变（既有 6 处调用点一字不改）
function addEbullet(x, y, vx, vy, r, kind) {
  addEbulletEx(x, y, vx, vy, r, kind, null);
}
// 扩展入口：opt 为 null 时全部归零
function addEbulletEx(x, y, vx, vy, r, kind, opt) {
  const e = POOL.ebullets.get();
  e.x = x; e.y = y; e.vx = vx; e.vy = vy; e.r = r; e.dead = false; e.kind = kind;
  e.px = x; e.py = y;
  // ★★ 无条件重置全部扩展字段 —— 不许写成 if (opt) 才重置 ★★
  e.ax = opt && opt.ax ? opt.ax : 0;
  e.ay = opt && opt.ay ? opt.ay : 0;
  e.av = opt && opt.av ? opt.av : 0;
  e.hold = opt && opt.hold ? opt.hold : 0;
  e.ttl = opt && opt.ttl ? opt.ttl : 0;
  e.split = opt && opt.split ? opt.split : 0;
  e.splitN = opt && opt.splitN ? opt.splitN : 0;
  e.gz = 0;
  game.ebullets.push(e);
}
```

**更新逻辑改造**（`game.js:947-950`）：

```js
for (let i = 0, n = game.ebullets.length; i < n; i++) {
  const eb = game.ebullets[i];
  if (eb.hold > 0) { eb.hold--; continue; }        // 延迟启动：静止等待
  if (eb.av !== 0) {                                // 角速度：旋转速度向量（无除法 → 无 NaN）
    const c = Math.cos(eb.av), s = Math.sin(eb.av);
    const nx = eb.vx * c - eb.vy * s;
    eb.vy = eb.vx * s + eb.vy * c;
    eb.vx = nx;
  }
  if (eb.ax !== 0) eb.vx += eb.ax;
  if (eb.ay !== 0) eb.vy += eb.ay;
  eb.x += eb.vx; eb.y += eb.vy;
  if (eb.ttl > 0 && --eb.ttl === 0) eb.dead = true;
  if (eb.split > 0 && --eb.split === 0) {           // 二段分裂
    eb.dead = true;
    const base = Math.atan2(eb.vy, eb.vx);          // atan2(0,0)=0，安全
    fanShot(eb.x, eb.y, eb.splitN, Math.PI * 0.55, base, 3.0, 5, 'fan', -1);
  }
}
```

> **S16 确定性检查**：上面所有分支都由**逻辑步**驱动（`hold--` / `ttl--` / `split--`），
> 不含 `performance.now()`、不含帧数依赖 → 六档刷新率下逐位一致。✅
>
> **性能检查**：热循环里加了 4 个 `!== 0` 的短路判断。在 640→1200 规模下，
> 现代 JIT 对这种单调 branch 的开销可忽略（<0.05ms/step）。若 S11 长跑发现 step 时间上涨 >10%，
> 可退化为「按 kind 分桶」的优化，但**首版不要提前优化**。

### 2.5 Boss 阵容总表

| # | id | 中文名 | 关卡 | hue | w×h | HP | 移动 | 招牌机制 | 峰值弹数 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `sentinel` | 哨戒机甲 | S1 | 198 | 140×92 | 170 | 横扫 → 急停突进 | 双肩装甲（减伤 50%） | ~65 |
| 2 | `scorpion` | 采矿巨蝎 | S2 | 32 | 150×96 | 240 | 8 字 | 尾刺穿刺（900ms 预警）+ 召唤 | ~175 |
| 3 | `carrier` | 雷云母舰 | S3 | 150 | 190×76 | 330 | 缓慢悬停 | 舰载机弹射 + 二段分裂弹 | ~145 + 8 怪 |
| 4 | `core` | 歼灭核心 | S4 | 338 | 132×132 | 460 | 原地小圆周 | 旋转光束（弹链模拟）+ 过载 | ~260 |
| 5 | `phaser` | 相位幻影 | S5 | 288 | 120×100 | 500 | 瞬移（6 锚点） | 残影爆散 + 双子分身 + 横穿雨 | ~250 |
| 6 | `void` | 终末虚空 | S6 | 262 | 160×160 | 640 | 三阶段三形态 | 漩涡弹幕 + 回响 + 崩落 | **~520** |

**差异化验证矩阵**（确认没有两款 Boss 玩起来一样）：

| | 移动 | 主威胁来源 | 玩家主要动作 | 有部件 | 有召唤 |
|---|---|---|---|---|---|
| sentinel | 横向周期 | 扇形密度 | 横移读缺口 | ✅ 装甲 | ❌ |
| scorpion | 双轴 8 字 | 单发高速 | 看预警撤离 | ❌ | ✅ |
| carrier | 近静止 | 实体数量 | 分配注意力 | ✅ 舱门 | ✅ |
| core | 原地 | 弹幕几何 | 沿扇区旋转移动 | ❌ | ❌ |
| phaser | 离散跳跃 | 位置不确定性 | 预判落点 + 不追击 | ❌ | ❌ |
| void | 三形态轮换 | 综合 + 记忆 | 全部 + 记 1.2s 前 | ✅ 晶体 | ⚠️ 崩落物 |

✅ 六行两两不同 —— 无重复设计。

### 2.6 EX Boss（T3 加料，非必做）

**EX-1 · `weaverqueen` 织星女王**（hue 172）
招牌「织网」：一次性发射 40 发 `hold=90`（1.5s）的静止弹，在屏幕上排成 8×5 网格，
1.5 秒后**同时启动**向下推进（spd 2.4）。
- 视觉冲击极强（整屏突然「活过来」），逻辑却极简（只用 `hold` 字段）；
- 玩家在 1.5s 内必须找到并站进网格缝隙 —— 纯粹的空间解谜。
- 适合作为**隐藏 Boss / EX 关**或高难度模式的替换 Boss。

**EX-2 · `hydra` 九头巨蛇**（hue 96）
HP 到 50% 时**分裂成 2 个半血 Boss**，两个独立移动、独立弹幕、必须都杀掉。
- ⚠️ **架构侵入大**：需要把 `game.boss` 从单例改为「最多 2 元数组」，
  `step()` 的 Boss 段、`drawBoss` 调用点、`onBossKilled` 的通关判定（`game.stage >= STAGES.length`）
  以及 **S10 冒烟脚本**都要同步改。
- 明确列为 **T3 且优先级最低**，除非用户特别想要。

---

## 3. 玩法扩展机制

### 3.1 Boss 阶段系统

已在 §2.1.6 给出完整实现。补充规格：

**八节要素**

| 节 | 内容 |
|---|---|
| **概述** | Boss 血量跨越 66% / 33% 时切换弹幕组、开火节奏、移动模式与外观，并触发一次「相位爆」（清屏+定格+加分） |
| **机制** | `while (ratio <= phases[idx+1].at) { idx++; enterBossPhase() }` —— 用 `while` 而非 `if`，防止一次巨额伤害（炸弹）跨两级时漏掉中间阶段 |
| **数据** | 阈值 `[1.00, 0.66, 0.33]`；无敌 1200ms；清屏转分 5 分/颗；粒子预算 24；屏震 14；hitStop 80ms |
| **公式** | `ratio = maxHp > 0 ? hp / maxHp : 0`（**除零护栏**）<br>`clearScore = ebullets.length × 5` |
| **边缘情况** | ① 玩家在 Boss 血量 67% 时扔炸弹 → 一次跨到 30% → `while` 连跨两阶段，只播**一次**相位爆（用 `phaseIdx` 差值判断，视听不叠加）<br>② 阶段切换瞬间玩家正在被弹幕包围 → 清屏机制天然解决<br>③ Boss 在入场下沉途中不可能触发（`y<ty` 分支不进阶段检查）<br>④ `maxHp` 为 0（注册表配置错误）→ ratio 取 0 → 立刻跨到最后阶段，不产生 NaN |
| **UI 接口** | Boss 血条（现为 canvas 绘制）建议分成 3 段刻度，已过阶段的段变暗 —— **纯渲染改动，无新 DOM id** |
| **依赖** | 依赖 §2.4 的 ebullet 扩展（清屏需要遍历）；被全部 6 款 Boss 依赖 |
| **验收** | ① 六档刷新率下阶段切换发生在**相同逻辑帧**（S16）② 相位爆后 `POOL.particles.grown === 0`（S18）③ 连跨两阶段不重复播特效 ④ Boss 战全程 `ebullets.peak < 900` |

### 3.2 Boss 召唤小怪

**概述**：`carrier` / `scorpion` / （T3）`void` 周期性生成小敌，复用 `enemies` 池与既有 8 种行为。

**机制**
```js
function spawnMinion(type, x, y, boss) {
  const stt = ENEMY_STATS[type];
  if (!stt) return;                                  // ★ 配置错误护栏
  const en = POOL.enemies.get();
  en.type = type; en.x = x; en.baseX = x; en.y = y;
  en.w = stt.size; en.h = stt.size;
  en.vy = (stt.vy[0] + Math.random() * (stt.vy[1] - stt.vy[0])) * game.diff.speedMul;  // RNG 在 step 内 ✅
  en.hp = Math.max(1, Math.round(game.diff.hp * stt.hp));   // 召唤物不吃 waveHp 加成（否则后期不可杀）
  en.hue = stt.hue();
  en.score = Math.round(stt.score * 0.6);            // 召唤物只给 60% 分 —— 防「挂机刷分」主导策略
  en.phase = Math.random() * Math.PI * 2;
  en.fireT = 0; en.lockT = 0; en.diving = false; en.dvx = 0; en.dvy = 0; en.hover = false; en.flash = 0;
  en.fromBoss = 1;                                   // ★ 新增字段，需加进 mkEnemy 并在 spawnEnemy 里置 0
  en.px = en.x; en.py = en.y;
  game.enemies.push(en);
  if (boss) boss.minions++;
}
```
- `onEnemyKilled` 里：`if (en.fromBoss && game.boss) game.boss.minions--;`
- `sweep` 掉出屏幕的召唤物也要减计数 → 建议在 `keepEnemyInPlay` 的清理后统一重算，
  或更简单：**每 30 步重算一次** `boss.minions = count(en => en.fromBoss)`（O(n)，n≤200，可忽略）。
  ★ 推荐后者 —— 计数漂移是这类系统最经典的 bug 源。

**小怪行为定义**

| Boss | 阶段 | 召唤内容 | 间隔 | 上限 | 行为说明 |
|---|---|---|---|---|---|
| scorpion | P2 | `diver` ×2 | 5500ms | 4 | 沿用现有俯冲机：到位→闪白锁定 480ms→高速俯冲 |
| scorpion | P3 | `kamikaze` ×2 | 5500ms | 4 | 新敌种，弱追踪直冲 |
| carrier | P1 | `straight` ×2 | 4200ms | 8 | 纯直线，教玩家「顺手清掉」 |
| carrier | P2 | `shooter` + `straight` | 4200ms | 8 | 引入「小怪也会开火」的注意力分裂 |
| carrier | P3 | `kamikaze` ×2 | 4200ms | 8 | 高压 |
| void | 全 | `rock`（崩落，非召唤） | 每 -25% HP | 3 | 见 §3.6 |

**边缘情况**
1. Boss 被击杀但小怪还在 → **保留小怪**（继续可打可得分），`boss.minions` 随 `game.boss=null` 一起失效；
2. 玩家扔炸弹清空 `game.enemies` → `minions` 计数必须归零（`triggerBomb` 里加 `if (game.boss) game.boss.minions = 0;`）；
3. 召唤瞬间玩家正好在舱门位置 → 小怪与玩家重叠生成 → **必须**让召唤点 y 至少在 Boss 下沿（`b.y + b.h*0.3`），
   且玩家 y 被限制在 `H*0.4` 以下（`updatePlayer` 已保证），物理上不会重叠。✅

**池影响**：`enemies` 128 → **200**。
估算：Boss 波常规杂兵 0 + 舰载机 8 + 崩落 3 = 11；非 Boss 波杂兵峰值约 `5+wave*1.6 ≈ 34`，
splitter 死亡 ×3 → 最坏 ~60；加陨石 3 → ~65。200 提供 3x 冗余。

### 3.3 玩家僚机 Option（Gradius 式）

**概述**：`power ≥ 3` 时出现 1 架僚机，`power = 5` 时 2 架。僚机跟随玩家、自动开火，**不引入任何新输入**。

**机制 —— 为什么选「固定偏移 + 弹性追随」而不是「轨迹跟随」或「环绕」**

| 方案 | 手感 | 可预测性 | 实现成本 | 判定 |
|---|---|---|---|---|
| 轨迹跟随（真 Gradius） | 最正宗 | 中 | 需要 60~90 帧的位置环形缓冲，每帧写入 | ❌ 内存 + 复杂度不值 |
| 圆周环绕 | 炫 | **差**（僚机位置与玩家意图无关，还挡视线） | 低 | ❌ 违反支柱 P2（遮挡弹幕 = 降低可读性） |
| **固定偏移 + 弹性追随** | 好 | **最好**（玩家能把僚机当作火力的空间延伸） | 最低 | ✅ **采用** |

```js
// player 上挂两个常驻对象（不进池 —— 数量固定为 2，池化没有收益）
player.opts = [
  { x: 0, y: 0, px: 0, py: 0, ox: -34, oy: 18, on: false },
  { x: 0, y: 0, px: 0, py: 0, ox:  34, oy: 18, on: false },
];

// updatePlayer 末尾追加
const nOpt = game.power >= 5 ? 2 : (game.power >= 3 ? 1 : 0);
for (let i = 0; i < 2; i++) {
  const o = player.opts[i];
  o.on = i < nOpt;
  if (!o.on) { o.x = player.x; o.y = player.y; o.px = o.x; o.py = o.y; continue; }
  o.x += (player.x + o.ox - o.x) * 0.18;      // 弹性系数 0.18 → 约 5 步收敛，有拖尾感
  o.y += (player.y + o.oy - o.y) * 0.18;      // 无除法 → 无 NaN
}
```
> `o.px/o.py` 由 `snapshot()` 一并记录（加进 `snapshot()`），渲染外插复用现有机制。

**开火（在 `shoot()` 末尾追加）**
```js
game.optTick = (game.optTick + 1) | 0;
if ((game.optTick & 1) === 0) {                 // ★ 半频：每 2 次主射击才射 1 次
  for (let i = 0; i < 2; i++) {
    const o = player.opts[i];
    if (o.on) addBullet(o.x, o.y - 10, -10, 3, undefined);
  }
}
```

**数据与平衡**

| power | 主弹/次 | 僚机 | 僚机弹/次（半频均摊） | 总 DPS 相对 power1 |
|---|---|---|---|---|
| 1 | 1 | 0 | 0 | 100% |
| 2 | 2 | 0 | 0 | 200% |
| 3 | 3 | 1 | 0.5 | 350% |
| 4 | 5 | 1 | 0.5 | 550% |
| 5 | 5 | 2 | 1.0 | 600% |

> **注意 power 4→5 的提升只有 ~9%** —— 现有 power5 是 5 发平行（比 power4 的 5 发扩散**更集中**，
> 对 Boss 实际 DPS 更高）。加上第二架僚机后，5 级的价值主要体现在**覆盖宽度**而非纯 DPS。
> 这是有意的：避免 power 成为「唯一变量」，防止「吃到 5 级就无脑赢」的主导策略。

**为什么僚机弹伤害不加成？** 现有 `en.hp--` 是固定 1 点伤害。僚机弹同样 1 点，
**通过半频控制强度**，避免引入 `bullet.dmg` 字段（那会波及所有碰撞点，风险不划算）。

**边缘情况**
1. **玩家死亡/复活**：`loseLife` 不掉 power（现状如此）→ 僚机保持。但复活瞬间僚机会从旧位置弹性追过来，
   视觉上是一道拖影 —— 可接受，甚至好看。若要更干净：`loseLife` 里 `o.x = player.x + o.ox`（瞬移归位）。
2. **僚机会不会被打？** ❌ **不参与任何碰撞**（既不挡弹也不吃伤害）。
   理由：僚机可被摧毁 → 玩家要保护它 → 引入新的注意力负担和新的输入需求 → 违反支柱 P1。
3. **僚机飞出屏幕**：`o.ox = ±34`，玩家 x 被夹在 `[w/2, W-w/2]`，僚机最多超出屏幕 13px —— 视觉上仍可见，
   不做额外夹取（夹取反而会让僚机在边缘"粘"住，手感更差）。
4. **子弹池**：`bullets` 256 → **512**。
   估算：最快射速 95ms（≈10.5 次/s）× 5 发 = 52 发/s；子弹 `vy=-12`，从 `H*0.8` 飞到 -20 约 54 步（0.9s）
   → 同屏 ~47 发。加僚机 +10/s → ~57。**加上 T3 的 G 散射道具（8 发宽扇 + 后射）可达 ~110。**
   512 提供 4.5x 冗余，足够。

**验收**：① power 从 2→3 的瞬间僚机平滑出现（不闪现）② 六档刷新率下僚机位置逐位一致
③ `bullets.grown === 0` ④ 僚机不影响任何碰撞判定次序（S16 种子序列不变）

### 3.4 擦弹系统（Graze）—— 本次扩展的动态核心

**概述**：玩家贴近敌弹但未被击中时累积擦弹数并填充擦弹槽；满槽激活「集中（Focus）」，
短时间内得分 ×1.5，连续满槽额外给护盾。

**机制**
```js
const GRAZE_R    = 26;      // 擦弹判定半径（玩家中心起算）
const GRAZE_FULL = 30;      // 满槽所需擦弹数
const FOCUS_MS   = 4000;    // Focus 持续
const FOCUS_MUL  = 1.5;     // Focus 得分倍率
const GRAZE_PT   = 2;       // 每次擦弹的直接得分

// 插进「敌弹 vs 玩家」循环（game.js:951-957），在碰撞判定之后
for (let i = 0, n = game.ebullets.length; i < n; i++) {
  const eb = game.ebullets[i];
  if (eb.dead) continue;
  if (hit(eb.x, eb.y, eb.r, player.x, player.y, 14)) {
    eb.dead = true; explode(player.x, player.y, 200);
    if (now >= player.invulnUntil && now >= player.shieldUntil) loseLife(now);
    continue;                                   // 命中的弹不算擦弹
  }
  // ---- 擦弹 ----
  if (eb.gz) continue;                          // 同一颗弹只计一次
  if (now < player.invulnUntil || now < player.shieldUntil) continue;  // ★★ 无敌/护盾期不计！
  const dx = eb.x - player.x, dy = eb.y - player.y;
  const rr = GRAZE_R + eb.r;
  if (dx * dx + dy * dy <= rr * rr) {           // 平方比较：无开方、无除法 → 零 NaN 风险
    eb.gz = 1;
    game.graze++;
    game.score += GRAZE_PT;
    if (now >= game.focusUntil) {               // 未处于 Focus 时才积攒
      game.grazeFill++;
      if (game.grazeFill >= GRAZE_FULL) {
        game.grazeFill = 0;
        game.focusUntil = now + FOCUS_MS;
        game.focusStacks++;
        if (game.focusStacks >= 2) {            // 第 2 次及以后：附赠 1.5s 护盾
          player.shieldUntil = Math.max(player.shieldUntil, now + 1500);
          game.focusStacks = 0;
        }
        addRing(player.x, player.y, 46, 150);
        audio.power();
      }
    }
  }
}
```

**⚠️ 主导策略红线（必须实现，否则系统崩坏）**

| 漏洞 | 后果 | 对策 |
|---|---|---|
| 无敌/护盾期间可擦弹 | 玩家吃 S 护盾后冲进弹幕无风险刷满槽 → 无脑最优解 | ✅ 上面第 3 行的 `continue` |
| 同一颗弹反复计数 | 玩家贴着一颗慢速弹「蹭」到满槽 | ✅ `eb.gz` 标记 |
| Focus 期间继续积攒 | Focus 可无限续接 | ✅ `now >= game.focusUntil` 才积攒 |
| 擦弹分数过高 | 玩家为了刷擦弹故意不杀敌 | ✅ 每次仅 +2 分（对比杂兵 10~50 分），主收益是 Focus 倍率而非直接分 |

**数据**

| 参数 | 值 | 依据 |
|---|---|---|
| 玩家受击半径 | 14（现有） | 不改 |
| 擦弹半径 | 26 | 「甜蜜带」宽 12px ≈ 弹径 2 倍，操作上可控但要求精细 |
| 满槽擦弹数 | 30 | Boss 战中等激进打法约 12~18s 满一次；保守打法可能整场不满 |
| Focus 时长 | 4000ms | 覆盖 Boss 的 5~7 次齐射，能感知到收益 |
| Focus 倍率 | 1.5x | 与连击的最高 4x 相乘 → 峰值 6x，激进打法总分约为保守打法的 **1.8~2.2 倍**（表达空间足够，但不至于让保守打法「没法玩」） |
| 擦弹直接分 | 2 | 象征性 |
| 得分公式 | `score += round(en.score × comboMul × focusMul)`<br>`comboMul = 1 + min(combo-1, 30) × 0.1`<br>`focusMul = now < focusUntil ? 1.5 : 1` | 乘算叠加 |

**UI 规格（★ 必须同步改 index.html + main.js）**

新增 DOM（**照抄 `comboWrap` 的模式**，插在 `#hud` 内 `comboWrap` 之后）：

```html
<span id="grazeWrap" class="hidden"> · <span data-i18n="hud.graze">擦弹</span>
  <b id="graze">0</b>
  <span id="grazeBar"><i id="grazeFill"></i></span>
</span>
```

| id | 用途 | JS 侧读写 |
|---|---|---|
| `grazeWrap` | 整块容器，擦弹数 >0 时移除 `hidden` | `grazeWrapEl.classList.toggle('hidden', game.graze === 0)` |
| `graze` | 擦弹计数数字 | `grazeEl.textContent = game.graze` |
| `grazeBar` | 进度条外框（纯 CSS，宽 34px 高 6px） | 不读写 |
| `grazeFill` | 进度条填充 | `grazeFillEl.style.width = (game.grazeFill / GRAZE_FULL * 100) + '%'` |

`GRAZE_FULL` 是常量 30，**非 0**，除法安全。✅

Focus 激活时给 `grazeWrap` 加 class `focus`（CSS 里做暖金脉动），不新增元素。

**i18n（`src/main.js` 的 `I18N` 两个语种都要加）**
```js
// zh
'hud.graze': '擦弹',
'hud.focus': '集中',
// en
'hud.graze': 'GRAZE',
'hud.focus': 'FOCUS',
```

**DOM 取用护栏（S1/S17 依赖）**
```js
const grazeWrapEl = document.getElementById('grazeWrap');
const grazeEl     = document.getElementById('graze');
const grazeFillEl = document.getElementById('grazeFill');
// 使用处一律守卫（照抄现有 comboWrapEl 的写法）
if (grazeWrapEl && grazeEl) { ... }
```

**边缘情况**
1. **弹从屏幕外斜穿过玩家附近但从未接近** → `dx²+dy²` 恒大于阈值，不触发。✅
2. **一颗弹擦过后又折返（`av` 弯曲弹）** → `eb.gz=1` 已标记，不重复计数。**这正是 `gz` 存在的原因**。
3. **炸弹清屏瞬间** → `clearList` 直接归还池，不走擦弹判定；被归还的弹的 `gz` 会在下次 `addEbulletEx` 时重置为 0。✅
4. **游戏重开** → `startGame()` 必须重置 `game.graze / grazeFill / focusUntil / focusStacks = 0`
   并 `grazeWrapEl.classList.add('hidden')`。**漏掉这条 = 跨局数据串味**，是最容易忘的一处。
5. **暂停** → 已知 BUG-02（暂停吃掉护盾/无敌计时）会同样影响 `focusUntil`。
   **不在本次修复范围**，但要在 CHANGELOG 里注明「Focus 计时与护盾同源，BUG-02 修复时一并处理」。

**验收**
① 六档刷新率下同一录像的 `game.graze` 完全一致（S16）
② 护盾期间擦弹计数 **不增长**（手测：吃 S 后冲进弹幕）
③ `grazeFill` 宽度百分比永不出现 `NaN%` / `Infinity%`（S17 的 NaN 探针）
④ `getElementById('grazeWrap'/'graze'/'grazeFill')` 全部非 null（S1）
⑤ 重开一局后 HUD 擦弹归零

### 3.5 新敌种（3 种）

> `ENEMY_STATS` 的 `hue` 是**函数**，且注释明确写着「straight 保留一次 `Math.random()` 调用，
> RNG 消耗次序与改动前完全一致（种子测试依赖）」。
> **新敌种的 `hue()` 必须是常量返回**（不调 RNG），否则一旦被抽中就会平移 RNG 序列，S16 直接红。
> ✅ 下面 3 种全部返回常量。

```js
// 追加到 ENEMY_STATS
turret:   { hp: 3,   score: 35, size: 34, vy: [0.6, 0.8],  hue: () => 204 },
kamikaze: { hp: 1,   score: 22, size: 22, vy: [3.0, 3.6],  hue: () => 14  },
curver:   { hp: 2,   score: 28, size: 30, vy: [1.3, 1.7],  hue: () => 168 },
```

> ⚠️ `kamikaze` 的 hue 14 落在**敌弹危险色带（12~24）**内 —— 这是**故意的**：
> 神风机本身就是一颗「会飞的弹」，用危险色告诉玩家「这东西的威胁等级等同于子弹」。
> 这是本作配色纪律的唯一例外，请在代码注释里写明，避免后人「修正」它。

**行为定义（追加到 `step()` 的敌机行为链，`game.js:864-924`）**

```js
} else if (en.type === 'turret') {
  // 悬停炮台：降到高空即刹车悬停，周期 3 连瞄准爆发（段间 9 步）
  en.phase += dt * 0.003;
  if (!en.hover && en.y > H * 0.20) { en.hover = true; en.vy = 0; }
  if (en.hover) {
    en.x = en.baseX + Math.sin(en.phase) * 40;      // 小幅漂移（比 sniper 的 90 小 → 更"钉住"）
    if (en.lockT > 0) {                              // lockT 复用为 burst 剩余发数计时
      en.fireT += dt;
      if (en.fireT > 150) {
        en.fireT = 0; en.lockT--;
        const ang = Math.atan2(player.y - en.y, player.x - en.x);
        addEbullet(en.x, en.y + 12, Math.cos(ang) * 4.6, Math.sin(ang) * 4.6, 5, 'aim');
      }
    } else {
      en.fireT += dt;
      if (en.fireT > 2000) { en.fireT = 0; en.lockT = 3; }   // 起爆发
    }
  }
} else if (en.type === 'kamikaze') {
  // 神风：出场即朝玩家冲，每步做「有上限的转向」—— 上限是公平性的全部来源
  en.phase += dt * 0.004;
  const dx = player.x - en.x, dy = player.y - en.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 1e-4) {                                  // ★ 除零护栏
    const want = Math.atan2(dy, dx);
    let cur = en.dvx || (Math.PI / 2);                // dvx 复用为「当前朝向角」
    let d = want - cur;
    while (d >  Math.PI) d -= Math.PI * 2;            // 角度归一化到 [-π, π]
    while (d < -Math.PI) d += Math.PI * 2;
    const MAXT = 0.045;                               // ★ 每步最大转向 0.045 rad ≈ 2.6°/step
    cur += Math.max(-MAXT, Math.min(MAXT, d));
    en.dvx = cur;
    const spd = en.vy;                                // 用 vy 作为标量速度
    en.x += Math.cos(cur) * spd;
    en.y += Math.sin(cur) * spd - en.vy;              // 抵消外层已加的 en.y += en.vy
  }
} else if (en.type === 'curver') {
  // 弯月：正弦走位 + 抛射左右对称的弯曲弹
  en.phase += dt * 0.0045;
  en.x = en.baseX + Math.sin(en.phase) * 56;
  en.fireT += dt;
  if (en.fireT > 1800 && en.y > 0 && en.y < H * 0.62) {
    en.fireT = 0;
    for (let s = -1; s <= 1; s += 2) {
      const a = Math.PI / 2 + s * 0.55;
      addEbulletEx(en.x, en.y + 10, Math.cos(a) * 3.0, Math.sin(a) * 3.0, 5, 'fan',
                   { av: -s * 0.012 });               // 左右各向内弯 → 形成"合围"
    }
  }
}
```

> **`kamikaze` 转向上限 0.045 rad/step 的推导**：
> 玩家横移速度约 `sensSpeed 0.30 × 距离` ≈ 6~12 px/step；
> 神风机速度 3.3 px/step，转向上限 0.045 → 最小转弯半径 ≈ `3.3/0.045 ≈ 73px`。
> 玩家只要横向拉开 >73px 就一定能甩掉它。**这是「可躲」的数学保证**，不能调高。

**`spawnEnemy` 权重表更新**（`game.js:604-608`）
```js
const w = {
  straight: 40, weaver: 18, shooter: 12 + 10 * v, elite: 3 + st,
  spinner:  st >= 2 ? 11 : 0,  diver:    st >= 2 ? 9 : 0,
  sniper:   st >= 3 ? 8 : 0,   splitter: st >= 4 ? 7 : 0,
  // ---- 新增（注意：新增键会改变 for...in 的遍历长度，但 RNG 只消耗 1 次，次序不变）----
  turret:   st >= 3 ? 9  : 0,
  kamikaze: st >= 4 ? 10 : 0,
  curver:   st >= 5 ? 11 : 0,
  rock:    (st === 2 || st === 5) ? 14 : 0,          // 见 §3.6
};
```
> ⚠️ **RNG 影响分析**：`spawnEnemy` 里 `Math.random() * total` 只调用 **1 次**，
> 加权项增加只改变**结果分布**，不改变**调用次数** → S16 的六档一致性不破（同一 seed 下六档仍逐位相同）。
> 但**与 v1.2.0 的历史录像不再一致** —— 这是内容更新的必然，不属于回归缺陷。请在 CHANGELOG 说明。

**绘制**：`drawEnemy` 需要为 3 个新 type 加矢量分支。建议：
- `turret` → 六边形底座 + 一根短炮管（朝玩家旋转），无贴图；
- `kamikaze` → 细长箭头 + 明显的引擎拖焰（复用现有引擎辉光），无贴图；
- `curver` → 新月形（两段圆弧），无贴图。
所有新 type 在 `drawEnemy` 里 `spriteName = null` 强制矢量（照抄 `sniper` 的处理）。

### 3.6 关卡障碍：漂移陨石（T2 加料）

**概述**：S2「陨石带」与 S5「相位回廊」引入可击毁的漂移障碍，动态压缩安全区。

**机制** —— **复用 `enemies` 池**（type `'rock'`），不新建池：
```js
rock: { hp: 6, score: 40, size: 52, vy: [0.8, 1.4], hue: () => 34 },

// 行为（在敌机行为链最前面加，因为 rock 不做常规逻辑）
if (en.type === 'rock') {
  en.phase += dt * 0.0012;
  en.x = en.baseX + Math.sin(en.phase) * 34;      // 缓慢横向漂移
  continue;                                        // 不开火、不追踪
}
```

**关键取舍（务必按此实现，别自作主张加功能）**

| 问题 | 决定 | 理由 |
|---|---|---|
| 陨石挡**玩家子弹**吗？ | ✅ 挡（天然行为：`bullets vs enemies` 循环已覆盖） | 制造「射击盲区」，玩家要绕位 |
| 陨石挡**敌弹**吗？ | ❌ **不挡** | ① 需要新增 `ebullets × enemies` 的 O(n·m) 判定（640×200 = 128k 次/步，性能不可接受）② 会产生「躲石头后面无敌」的主导策略 |
| 撞玩家怎么处理？ | 石头碎裂（`en.hp = 0`）+ 玩家扣命 | 复用现有 `敌机撞玩家` 逻辑，**零代码改动**。物理上不合理（石头被战机撞碎）但游戏上干净 |
| 陨石会被炸弹清掉吗？ | ✅ 会（`triggerBomb` 清空 `game.enemies`） | 一致性 |

**数值**：hp 6（约 6 发子弹，power3 下 ~1.2s）、score 40、size 52（`en.w = 52`，碰撞半径 `52*0.45 ≈ 23`）。
同屏上限：靠权重自然控制，S2/S5 平均同屏 2~3 块。

**边缘情况**
1. 陨石与 Boss 重叠 → 视觉遮挡。对策：Boss 波**不刷陨石**（`game.isBossWave` 时 `spawnEnemy` 不被调用，天然满足），
   只有 `void` 的崩落物例外（那是有意的）。
2. 陨石卡在屏幕边缘 → `baseX ∈ [35, W-35]`，漂移 ±34 → 最多贴边 1px，`keepEnemyInPlay` 判 `x > -60` 不会误删。✅
3. 玩家被两块陨石夹住 → 同屏上限 3 + 漂移不同步，实测不会形成完全封锁。若担心，可加：
   `if (countRocks() >= 3) 权重置 0`。

### 3.7 新道具 C / G（T3 加料）

**`C` 金币（Coin）—— 给 Achiever 的即时正反馈**

| 项 | 值 |
|---|---|
| hue | 46（暖金） |
| 效果 | `game.score += (80 + game.stage * 40) × comboMul × focusMul` |
| 掉率 | 提高到普通掉落的最高频段（见下） |
| 视觉 | 沿用 `drawItem` 的字母圆章（显示 "C"），加更强的暖金辉光 |

**`G` 散射枪（Spread Gun）—— 给 Killer 的短时形态变化**

| 项 | 值 |
|---|---|
| hue | 285（紫） |
| 效果 | `game.spreadUntil = now + 8000`，期间 `shoot()` 改走宽扇分支 |
| 弹型 | 前方 7 发扇（spread 0.55π，vy -10，vx 由角度决定）+ **后方 1 发**（vy +9） |
| 与 power 关系 | **覆盖**而非叠加（散射期间忽略 power 分支），到期恢复 |
| 视觉 | 玩家机身外多一圈紫色能量环（`drawPlayer` 加一个 if 分支） |

**`dropItem` 改造（`game.js:633-647`）**
```js
function dropItem(x, y, force) {
  const r = Math.random();                       // ★ RNG 调用次数不变（仍为 1 次）
  let type = null;
  if (force) type = r < 0.42 ? 'P' : (r < 0.66 ? 'S' : (r < 0.86 ? 'B' : 'C'));
  else if (r < 0.09)  type = 'P';
  else if (r < 0.13)  type = 'S';
  else if (r < 0.16)  type = 'B';
  else if (r < 0.175) type = 'L';
  else if (r < 0.205) type = 'C';                // 金币：3% —— 最高频的新道具
  else if (r < 0.215) type = 'G';                // 散射：1%
  if (!type) return;
  const hue = type === 'P' ? 200 : type === 'S' ? 155 : type === 'B' ? 40
            : type === 'L' ? 0   : type === 'C' ? 46  : 285;
  /* ...以下不变... */
}
```
> **总掉率从 17.5% 升到 21.5%** —— 提升幅度受控（+4pt），主要给的是"分数"而非"能力"，
> 不会破坏现有难度曲线。

**`applyItem` 追加**
```js
else if (type === 'C') {
  const cm = 1 + Math.min(game.combo - 1, 30) * 0.1;
  const fm = (now < game.focusUntil) ? 1.5 : 1;
  game.score += Math.round((80 + game.stage * 40) * cm * fm);
}
else if (type === 'G') game.spreadUntil = now + 8000;
```

**T3 可选 UI**：HUD 增益指示 `#buffWrap` / `#buff`（显示 "散射 8s"），同样需要 `data-i18n="hud.buff"`。
若不做，散射状态仅靠玩家机身的紫环表达 —— **也可接受**（HUD 已经很挤）。

---

## 4. 关卡战役重组建议

### 4.1 扩展到 6 关

```js
const STAGES = [
  // ---- 前 4 关：只加 bossKind 字段，其余一字不动（最小侵入，保护 S10/S15 回归）----
  { name: '近地轨道', bg: '#0d1117', accent: '#7fb0bd', accent2: '#c98f6b',
    bossName: '哨戒机甲', bossHue: 198, bossHp: 170, bossKind: 'sentinel' },
  { name: '陨石带',   bg: '#151016', accent: '#c99a6b', accent2: '#8a6f9c',
    bossName: '采矿巨蝎', bossHue: 32,  bossHp: 240, bossKind: 'scorpion' },
  { name: '电离层',   bg: '#0e1418', accent: '#8fb89c', accent2: '#b58fa8',
    bossName: '雷云母舰', bossHue: 150, bossHp: 330, bossKind: 'carrier'  },
  { name: '深空要塞', bg: '#17101a', accent: '#b98aa0', accent2: '#7f93b5',
    bossName: '歼灭核心', bossHue: 338, bossHp: 460, bossKind: 'core'     },
  // ---- 新增 2 关 ----
  { name: '相位回廊', bg: '#12101c', accent: '#9d8ac4', accent2: '#c9a98a',
    bossName: '相位幻影', bossHue: 288, bossHp: 500, bossKind: 'phaser'   },
  { name: '终末虚空', bg: '#0b0a12', accent: '#8f93c4', accent2: '#b58fa8',
    bossName: '终末虚空', bossHue: 262, bossHp: 640, bossKind: 'void'     },
];
```

**为什么按这个顺序（而不是把 phaser 插到 core 前面）**

1. **回归风险最小**：前 4 关的 `bossName/bossHue/bossHp` 一字不改，
   S10/S15 冒烟里任何隐性依赖（关卡名、Boss 名、血量）都不会被触碰；
2. **难度语法递进仍成立**：core（静态高压 · 考几何）→ phaser（机动欺骗 · 考预判）→ void（综合 · 考记忆）
   是一条合理的上升线；
3. **配色递进**：青 → 橙 → 绿 → 玫 → 紫 → 深蓝紫，色相环走了一整圈回到冷色，最终关的「归于虚空」在视觉上成立。

**通关判定**：`game.stage >= STAGES.length` 自动跟随（`game.js:837`），无需改动。✅

### 4.2 `STAGE_WAVES` 是否调整

**T1/T2 建议：保持 `STAGE_WAVES = 3` 不变。**

理由：`beginWave` 的关卡映射是纯除法（`Math.floor((n-1)/STAGE_WAVES)+1`），
一旦改成每关不同波数就要引入前缀和数组 + 定位循环，
而 **`game.stage` 被 `spawnEnemy` 权重、背景绘制、音乐 setStage、通关判定四处依赖**，
改错一处就是难查的连锁 bug。收益（节奏微调）远小于风险。

总波数从 12 → **18**，单局时长从约 8~10 分钟 → **13~16 分钟**。
> ⚠️ 这个时长对「双击即玩」的休闲定位偏长。**缓解方案（推荐同时做）**：
> 把 `game.spawnInterval` 的衰减调快一档（`game.spawnBase - n * 22`，原 `n * 18`），
> 让后期杂兵波更快清完，把时间预算让给 Boss 战。

**T3 可选：每关自定义波数**
```js
// STAGES 每项加 waves 字段（默认 3）
// 预计算前缀和，beginWave 用它定位
const WAVE_OFS = [];   // WAVE_OFS[i] = 前 i 关的波数总和
(function () { let s = 0; for (const st of STAGES) { WAVE_OFS.push(s); s += (st.waves || 3); } })();
function stageOfWave(n) {
  for (let i = STAGES.length - 1; i >= 0; i--) if (n > WAVE_OFS[i]) return i + 1;
  return 1;
}
```
建议配置：S1-S2 = 3 波、S3-S4 = 4 波、S5-S6 = 4 波（总 22 波）。
**做这项必须同步检查 `tests/run-smoke.js` 的 S10/S15 是否硬编码了波号。**

### 4.3 难度曲线总表

| 关 | 波数 | `spawnInterval`（波1→波3） | 新杂兵解锁 | Boss | Boss HP | 预期 Boss 战时长 |
|---|---|---|---|---|---|---|
| S1 | 3 | 682 → 646 | straight/weaver/shooter/elite | sentinel | 170 | ~35s |
| S2 | 3 | 628 → 592 | + spinner / diver / **rock** | scorpion | 240 | ~45s |
| S3 | 3 | 574 → 538 | + sniper / **turret** | carrier | 330 | ~55s |
| S4 | 3 | 520 → 484 | + splitter / **kamikaze** | core | 460 | ~65s |
| S5 | 3 | 466 → 430 | + **curver** / **rock** | phaser | 500 | ~70s |
| S6 | 3 | 412 → 376 | 全部 | void | 640 | ~85s |

（`spawnInterval = max(220, spawnBase - n*18)`，normal 难度 `spawnBase=700`）

**Boss HP 校验（已按真实代码修正）**：真实火力模型为 `shootInterval = 140ms`（`game.js:44,819`），
power 1~5 每发分别为 **1 / 2 / 3 / 5 / 5** 颗（`game.js:558-582`），每颗伤害 = `b.hp--`（1 命中=1 血，`game.js:985-987`）。
故原始弹/s：p1≈7.14，p2≈14.29，p3≈21.43，p4/p5≈35.71（**非原稿误算的 32**）。
有效 DPS = 原始弹/s × 命中率 HR（Boss 战 HR 取 0.45 / 0.55 / 0.65 三档；phaser 体型小取 0.30/0.40/0.50）。

**建议 HP（起点）与微调**：

| Boss | 文档原值 | **建议实装值（起点）** | 实测微调建议 | 目标区间 |
|---|---|---|---|---|
| sentinel | 170 | **260** | **290~300** | 25~35s |
| scorpion | 240 | **380** | **430** | 40~50s |
| carrier | 330 | **520** | **580** | 50~60s |
| core | 460 | **680** | 保持 | 60~70s |
| phaser | 500 | **760** | 保持（HR 敏感） | 长 |
| void | 640 | **980** | 保持 | 80~95s |

**修正后 TTK（秒，锚点 power 3；HR=命中率）**：

| Boss | p3 @HR0.45 | p3 @HR0.55 | p3 @HR0.65 | p5 @HR0.55 |
|---|---|---|---|---|
| sentinel | 27.0 | **22.1** | 18.7 | 13.2 |
| scorpion | 39.4 | **32.2** | 27.3 | 19.3 |
| carrier | 53.9 | **44.1** | 37.3 | 26.5 |
| core | 70.5 | **57.7** | 48.8 | 34.6 |
| phaser* | 78.8* | **88.6*** | 54.6* | 53.2* |
| void | 101.6 | **83.1** | 70.4 | 49.9 |

\* phaser 用其专属 HR 档（0.30/0.40/0.50）。

> 原稿「200 有效 hp → 11s 过短」的结论方向正确，但因 DPS 误算（32 vs 真实 21.4），**建议值其实偏保守**
> —— sentinel/scorpion/carrier 在 HR0.55 下比目标短 10~20%，故上表给出微调建议（实测起点）。
> 详见 §8.5 决策包。

> ⚠️ **这是本文档最需要实测校准的一组数字。** 请程基岩先按下表值实装，
> 由严守真在 easy/normal/hard × power 1/3/5 共 9 组条件下实测击杀时长，回来再调。
> 判据：**normal + power 3 条件下，每场 Boss 战 30~90s，且随关卡单调递增。**

---

## 5. 范围分层（Scope Tiers）

### T1 · 必做 —— 「Boss 不再是换色」

**目标**：解决用户原话里的核心痛点（「boss 机得多设计几款」+ 核心玩法扩容）。

| # | 交付项 | 涉及文件 | 工作量估算 |
|---|---|---|---|
| T1-1 | **ebullet 扩展字段 + `addEbulletEx` + 更新逻辑改造** | `game.js` | 中 —— **必须第一个做**，是所有 Boss 的底座 |
| T1-2 | **弹幕原语库**（fanShot/aimShot/ringShot/wallShot/crossRainShot/subFire） | `game.js` | 中 |
| T1-3 | **`BOSS_KINDS` 注册表 + spawnBoss/bossFire/step 改造** | `game.js` | 大 |
| T1-4 | **Boss 阶段系统 + `enterBossPhase`** | `game.js` | 中 |
| T1-5 | **6 款 Boss 的 move / phases / 招牌机制** | `game.js` | 大 |
| T1-6 | **6 款 Boss 的矢量绘制 + `BOSS_KINDS[].draw` 分发** | `entities.js` | 大 |
| T1-7 | **僚机 Option**（位置 + 开火 + snapshot + 渲染） | `game.js`, `entities.js` | 中 |
| T1-8 | **擦弹 Graze + Focus + HUD** | `game.js`, `index.html`, `main.js` | 中 |
| T1-9 | **池 cap 调整**（见 §6.2） | `game.js` | 小 |
| T1-10 | **STAGES 扩到 6 关 + bossKind** | `game.js` | 小 |

**冒烟风险点与护栏**

| 风险 | 触发门 | 护栏 |
|---|---|---|
| ebullet 新字段未重置 → 脏值 | 表现为随机弹道异常，**冒烟可能测不出** | §2.4 的「无条件重置」写法 + code review 时逐字段核对 |
| Boss 峰值弹超 640 | **S18** `ebullets.grown > 0` | cap → 1200；每款 Boss 实装后单独跑一次 F3 性能 HUD 看 peak |
| 阶段切换的清屏产生大量粒子 | **S18** `particles.grown > 0` | `fxBudget = 24` 硬上限 |
| 新 RNG 落进渲染层 | **S16** 六档不一致 | 所有 `Math.random()` 只允许出现在 `step()` 调用链内；渲染层的"随机感"一律用 `now` / `b.phase` 的确定性函数 |
| 新 HUD 元素 id 缺失 | **S1 / S17** | index.html 加 4 个 id + `if (el)` 守卫 |
| `www/` 未同步 | 用户双击 `index.html` 看不到新内容（**最丢人的失败**） | 收工前必跑 `node scripts/sync-web.js` |
| Boss 血量校准偏差 | 无冒烟门（体验问题） | 交严守真实测 9 组条件 |

**T1 验收**：`node tests/run-smoke.js` → **125/125 全绿，0 NaN / 0 缺失 id / 0 console 错，
所有池 `grown === 0`**；手测 6 关全通，每款 Boss 三阶段都能看到不同弹幕。

### T2 · 推荐 —— 「战场变活」

| # | 交付项 | 涉及文件 |
|---|---|---|
| T2-1 | 新敌种 `turret` / `kamikaze` / `curver`（stats + 行为 + 矢量绘制 + 权重） | `game.js`, `entities.js` |
| T2-2 | Boss 召唤系统（`spawnMinion` + `minions` 计数 + 上限护栏） | `game.js` |
| T2-3 | 漂移陨石 `rock`（S2 / S5） | `game.js`, `entities.js` |
| T2-4 | `enemies` 池 cap → 200 | `game.js` |
| T2-5 | 首次遭遇 Boss 的战术提示文案（复用 `stageBanner` 机制） | `game.js`, `main.js` |

**风险与护栏**

| 风险 | 门 | 护栏 |
|---|---|---|
| 召唤计数漂移 → 小怪无限刷 | **S18** `enemies.grown > 0` | 每 30 步全量重算 `minions`（而非增减维护） |
| `kamikaze` 转向过强 → 不可躲 | 无自动门（体验） | 转向上限 0.045 rad/step **写死为常量并注释推导过程** |
| 新敌种 `hue()` 调 RNG | **S16** | 三种全部返回常量，code review 核对 |
| 陨石挡敌弹的诱惑 | 性能 + 主导策略 | §3.6 已明确判定为 ❌，**别做** |
| 炸弹清屏后 `minions` 未归零 | **S18** | `triggerBomb` 里显式归零 |

### T3 · 加料 —— 「玩法广度」

| # | 交付项 | 备注 |
|---|---|---|
| T3-1 | 道具 `C` 金币 / `G` 散射 + HUD 增益指示 | 掉率表见 §3.7 |
| T3-2 | 每关自定义波数（`WAVE_OFS` 前缀和） | **必须同步检查 S10/S15 是否硬编码波号** |
| T3-3 | Boss 图鉴 / 战果结算（本局各 Boss 击破时长、最高擦弹） | 新面板，需要一批 DOM id + i18n |
| T3-4 | EX Boss `weaverqueen`（织网） | 低风险，纯 `hold` 字段应用 |
| T3-5 | EX Boss `hydra`（分裂双体） | ⚠️ **架构侵入大**，需改 `game.boss` 为数组 + 改 S10 冒烟 |
| T3-6 | `void` 玩家牵引引力（默认关闭） | ⚠️ SDT 风险，见 §2.2 |
| T3-7 | Boss 矢量视觉细化（部件破损态、崩落动画、吸积盘） | 纯渲染，无逻辑风险 |
| T3-8 | 排行榜新增「最高擦弹」字段 | 需改 `DJFE.addLeaderboard` 的数据结构（注意旧存档兼容） |

**风险与护栏**

| 风险 | 门 | 护栏 |
|---|---|---|
| T3-2 改波次映射打断关卡判定 | **S10 / S15** | 改动后必须全量重跑冒烟；建议单独一个 commit 便于回滚 |
| T3-5 `game.boss` 变数组波及全局 | **S10 / S15 / S16** | 若做，先写一个「数组长度恒为 1」的中间态验证全绿，再上分裂 |
| T3-8 排行榜结构变更 | **S13**（存档持久化） | 读取旧记录时 `graze` 字段缺失要兜底为 0，不能 `undefined` 进 DOM |
| T3-1 散射覆盖 power 分支 | 无自动门 | 到期恢复的逻辑要在 `shoot()` 里用 `now < game.spreadUntil` 判断，**不要**改 `game.power` 本身（否则道具吃亏） |

---

## 6. 风险与护栏（逐条对应质量门红线）

### 6.1 S16 · 确定性（六档刷新率逐位一致）

**红线**：所有 `Math.random()` 必须在 `step()` 逻辑步内、由逻辑时钟计时触发，绝不进 render / 帧驱动代码。

**本次新增的全部 RNG 调用点清单**（实现时逐条核对位置）：

| # | 位置 | 用途 | 是否在 step 内 |
|---|---|---|---|
| 1 | `wallShot` 的 `gapIdx` 选取 | sentinel P3 弹墙缺口 | ✅ 由 `bossFire` → `step` 调用 |
| 2 | `crossRainShot` 的 y 抖动 | phaser P3 横穿雨 | ✅ 同上 |
| 3 | `core` 过载散射的角度 | core <15% HP | ✅ 同上 |
| 4 | `phaser` 瞬移锚点选取 | `moveBlink` | ✅ 由 `K.move` → `step` |
| 5 | `spawnMinion` 的 vy / phase | Boss 召唤 | ✅ 由 `K.summon` → `step` |
| 6 | `rock` 的 baseX / vy | `spawnEnemy` | ✅ 现有路径 |
| 7 | `dropItem` 的类型判定 | 新道具 | ✅ 现有路径，**调用次数不变（仍 1 次）** |

**渲染层「随机感」的替代方案**（禁止 RNG，一律用确定性函数）：

| 想要的效果 | ❌ 错误做法 | ✅ 正确做法 |
|---|---|---|
| 装甲裂纹随机分布 | `Math.random()` 生成顶点 | 固定常量数组 `SENTINEL_CRACKS = [[...]]` |
| 晶体不规则形状 | 每帧随机扰动 | 固定顶点表 + `sin(now/700 + i)` 的确定性微动 |
| 引擎火焰闪烁 | `Math.random()` | `0.6 + 0.4*sin(now/95)` |
| 残影透明度衰减 | 随机 | 按 `(now - ghost.t) / GHOST_MS` 线性插值（分母为常量，非 0） |

**自检方法**：
```bash
# 实现完成后，用 grep 检查渲染层是否混入 RNG
grep -n "Math.random" src/entities.js     # ← 期望：0 处命中
grep -n "Math.random" src/game.js         # ← 逐条核对是否都在 step 调用链内
```

### 6.2 S18 · 对象池零扩容（`grown === 0`）

**新 cap 表**

| 池 | 现 cap | **新 cap** | 峰值估算 | 冗余 | 依据 |
|---|---|---|---|---|---|
| `bullets` | 256 | **512** | ~110（含僚机 + T3 散射） | 4.6x | §3.3 |
| `ebullets` | 640 | **1200** | ~520（void P3） | 2.3x | §2.5 |
| `particles` | 2048 | **2048（不变）** | 1140（Boss 死亡 60×19） | 1.8x | 相位爆已限 24 颗，无新增大批量 |
| `enemies` | 128 | **200** | ~65（杂兵 34 + splitter 裂变 + 舰载机 8 + 陨石 3） | 3.1x | §3.2 |
| `items` | 64 | **96** | ~30（Boss 死亡 3 + 部件掉落 2 + 常规） | 3.2x | 新增 2 种道具，掉率 +4pt |
| `rings` | 64 | **96** | ~20（相位爆 + Focus + Echo 预告） | 4.8x | Echo 预告每次 1 个环 |

> **调 cap 是允许的**（S18 只判 `grown === 0`，不判 cap 大小）。
> 内存增量估算：`(512-256)×9 + (1200-640)×17 + (200-128)×20 + 32×9 + 32×6` ≈ 约 13k 个字段
> ≈ **150KB 级别**，对 file:// 单页游戏可忽略。

**最容易爆池的 5 个机制（重点盯防）**

| 机制 | 风险 | 硬护栏 |
|---|---|---|
| `core` 旋转光束（84 发 × 长 ttl） | 多组臂叠加 → 数百发滞留 | `b.beamAlive` 计数，同时最多 1 组；`ttl = 300` 步强制清除 |
| `void` 回响（弹幕翻倍） | 队列无限增长 | 队列硬上限 **4** |
| `carrier` 二段分裂弹 | 4 母弹 → 20 子弹，若母弹不 dead 会翻倍 | `split` 触发时**必须**同步 `eb.dead = true` |
| Boss 召唤 | 无上限刷怪 | `b.minions >= N` 直接 return；每 30 步全量重算计数 |
| 相位爆的清屏粒子 | N 颗弹 × 19 粒子 | `fxBudget = 24`，且用 `addParticle` 单颗而非 `explode()` |

**自检方法**：F3 打开性能 HUD，打完 6 关看每个池的 `peak / cap`，任何一项 peak > cap×0.75 就要再调。

### 6.3 NaN 红线（绝不向 ctx 喂 NaN）

**全部潜在 NaN 源与兜底**（逐条实现）：

| # | 表达式 | NaN 条件 | 兜底写法 |
|---|---|---|---|
| 1 | `b.hp / b.maxHp` | `maxHp === 0` | `b.maxHp > 0 ? b.hp / b.maxHp : 0` |
| 2 | `b.fireT / b.fireGap` | `fireGap === 0` | 现有代码已有 `|| 1`；**注册表加断言：所有 phase 的 gap 必须 > 0** |
| 3 | `spread / (n - 1)` | `n === 1` | `n > 1 ? spread/(n-1) : 0`（见 `fanShot`） |
| 4 | `(Math.PI*2) / n` | `n === 0` | 调用方保证 `n >= 1`；`ringShot` 首行加 `if (!(n > 0)) return;` |
| 5 | `dx/len, dy/len` 归一化 | `len === 0`（实体完全重合） | `if (len > 1e-4)` 守卫（见 kamikaze） |
| 6 | `grazeFill / GRAZE_FULL` | 常量非 0 | ✅ 天然安全，但**不要**改成可配置变量 |
| 7 | `(now - ghost.t) / GHOST_MS` | 常量非 0 | ✅ 同上 |
| 8 | `Math.atan2(0, 0)` | — | ✅ JS 规范返回 `0`，**不是 NaN**，安全 |
| 9 | `Math.sqrt(负数)` | 不会出现（平方和） | ✅ |
| 10 | 未初始化的新字段参与运算 | 池对象脏值 / boss 字段漏初始化 | §2.4 无条件重置 + `spawnBoss` 里所有新字段显式赋初值 |
| 11 | `en.dvx` 作为角度复用时初值 | `spawnEnemy` 里 `dvx = 0` → kamikaze 首步朝向为 0（向右飞） | `en.dvx || (Math.PI/2)` 兜底为向下 |
| 12 | `hsl(${hue}, ...)` 里 hue 为 undefined | 新 kind 忘配 hue | `spawnBoss` 里 `st.bossHue != null ? ... : K.hue`，且注册表每项必填 hue |

**自检**：S17 环境诊断已有 NaN 探针。另外建议实现期临时加：
```js
// 调试期临时开关，交付前删除
if (DJFE.__debug && DJFE.__debug.nanGuard) {
  if (!isFinite(eb.x) || !isFinite(eb.y)) console.error('NaN ebullet', eb);
}
```

### 6.4 DOM id 红线（S1 / S17 查缺失元素 id）

**新增 id 完整清单**

| id | 层级 | T | 必须同时做的三件事 |
|---|---|---|---|
| `grazeWrap` | `#hud` 内 | T1 | ① `index.html` 加元素 ② `data-i18n="hud.graze"` ③ `main.js` 的 `I18N.zh` + `I18N.en` 各加一条 |
| `graze` | `#grazeWrap` 内 | T1 | 同上 |
| `grazeBar` | `#grazeWrap` 内 | T1 | 纯 CSS，无 i18n |
| `grazeFill` | `#grazeBar` 内 | T1 | 纯 CSS，无 i18n |
| `buffWrap` | `#hud` 内 | T3 | + `hud.buff` 中英 |
| `buff` | `#buffWrap` 内 | T3 | 同上 |

**三条硬规矩**
1. **JS 侧一律守卫**：`const el = document.getElementById('graze'); ... if (el) el.textContent = ...`
   —— 照抄现有 `comboWrapEl` 的写法。冒烟在无头环境跑，元素缺失直接 null 崩。
2. **不破坏既有 id / JS 钩子**：`#hud` 的现有 7 个 `<b>` 和 `comboWrap` **一个都不能动**
   （MEMORY 记载前端 overhaul 时"DOM 结构/元素 id/data-i18n/JS 钩子一字未动"，这条纪律要继续守）。
3. **中文优先**：`data-i18n` 的默认内联文案写中文（与现有一致），英文只在 `I18N.en` 里。

**同步链（★ MEMORY 铁律 1，最容易漏）**
```bash
# 改完 src/*.js 与 index.html 之后
node scripts/sync-web.js     # 生成 www/（Web + 安卓资产副本）
node tests/run-smoke.js      # 期望 125/125
```
> 只改 `src/` 不跑同步 → 用户双击 `index.html` **能**看到（根目录 index.html 直接引 src/），
> 但 Web 包 / EXE / 安卓包全是旧代码。v1.2.0 差点踩这个坑。

### 6.5 其它设计层红线

| 红线 | 说明 |
|---|---|
| **不许改 `explode()`** | 18+1 粒子、每颗恰好 2 次 RNG —— S16 种子序列 + S18 预算双重依赖。新特效一律用 `addParticle` 单颗 |
| **不许在渲染层调 `Math.random()`** | 见 §6.1 |
| **不许新增输入方式** | 支柱 P1。没有聚焦键、没有武器切换、没有蓄力长按 |
| **不许让僚机参与碰撞** | 见 §3.3 边缘情况 2 |
| **不许让陨石挡敌弹** | 见 §3.6 取舍表（性能 + 主导策略双重理由） |
| **不许在护盾/无敌期计擦弹** | 见 §3.4 主导策略红线 |
| **不许把 `game.power` 用作散射的状态位** | 见 §5 T3 风险表 |
| **新 Boss 不依赖新贴图** | 美术资产是独立工作流（林绘澄），本次设计不产生美术依赖 |

---

## 7. 与现有代码钩子的映射表

### 7.1 `src/game.js`

| 函数 / 常量 | 现有位置 | 动作 | 职责变化 |
|---|---|---|---|
| `mkEbullet()` | :125 | **改** | 新增 `ax/ay/av/hold/ttl/split/splitN/gz` 8 个字段 |
| `mkEnemy()` | :129-135 | **改** | 新增 `fromBoss` 字段（召唤物标记） |
| `POOL` | :136-143 | **改** | cap：bullets 512 / ebullets 1200 / enemies 200 / items 96 / rings 96 |
| `addEbullet()` | :164-169 | **改** | 改为薄封装，转调 `addEbulletEx(..., null)`；**签名不变**，6 处既有调用点零改动 |
| `addEbulletEx()` | — | **新增** | 扩展入口，无条件重置全部新字段 |
| `fanShot / aimShot / ringShot / wallShot / crossRainShot` | — | **新增** | 弹幕原语库（§2.3） |
| `subFire()` | — | **新增** | 多段齐射驱动器（按逻辑步） |
| `STAGES` | :399-408 | **改** | 前 4 项各加 `bossKind`；追加 S5 / S6 两项 |
| `STAGE_WAVES` | :398 | 不变（T1/T2） | T3 才改为每关可配 |
| `startGame()` | :412-432 | **改** | 重置 `graze / grazeFill / focusUntil / focusStacks / optTick / spreadUntil`；`player.opts` 归位；`grazeWrap` 加 `hidden` |
| `beginWave()` | :448-464 | 不变 | 波次调度逻辑完全复用 |
| `BOSS_KINDS` | — | **新增** | Boss 注册表（6 款 + T3 的 EX） |
| `BOSS_PATS` | — | **新增** | 弹幕模式名 → 原语调用的映射 |
| `moveSweep / moveFigure8 / moveHover / moveOrbit / moveBlink` | — | **新增** | 5 个可复用的 Boss 移动函数 |
| `spawnBoss()` | :467-480 | **改** | 查 `BOSS_KINDS`，初始化 12 个新字段；`fireGap` 由 phase[0] 决定 |
| `bossFire()` | :481-502 | **重写** | 由 `bossPattern%3` 改为「查当前阶段的 pats → 轮转 → 调原语」 |
| `enterBossPhase()` | — | **新增** | 阶段跃迁：换 gap / 相位爆 / 无敌 / 回调 |
| `hitBossPart()` | — | **新增** | 部件（装甲 / 舱门 / 晶体）的优先碰撞判定 |
| `spawnMinion()` | — | **新增** | Boss 召唤，复用 `ENEMY_STATS` 与 `enemies` 池 |
| `onBossKilled()` | :503-520 | **微改** | 附加：`b.minions` 相关清理（若保留小怪则无需）；掉落数按 kind 微调 |
| `shoot()` | :558-583 | **改** | 末尾追加僚机半频开火；T3 追加散射分支（`now < game.spreadUntil`） |
| `ENEMY_STATS` | :588-600 | **改** | 追加 `turret / kamikaze / curver / rock` 四项（`hue()` 必须返回常量） |
| `spawnEnemy()` | :601-630 | **改** | 权重表加 4 项；`en.fromBoss = 0` |
| `dropItem()` | :633-647 | **改** | 追加 `C` / `G` 分段（RNG 调用次数保持 1 次） |
| `applyItem()` | :648-655 | **改** | 追加 `C`（加分）/ `G`（`spreadUntil`）分支 |
| `onEnemyKilled()` | :656-681 | **改** | 得分公式加 `focusMul`；召唤物 `minions--` |
| `triggerBomb()` | :684-697 | **微改** | `if (game.boss) game.boss.minions = 0;` |
| `updatePlayer()` | :542-555 | **改** | 末尾追加僚机弹性追随 |
| `snapshot()` | :806-812 | **改** | 追加 `player.opts` 的 px/py 记录 |
| `step()` — 敌机行为链 | :864-924 | **改** | 追加 `rock`（最前）/ `turret` / `kamikaze` / `curver` 四个分支 |
| `step()` — 敌弹更新 | :947-950 | **改** | 加入 `hold / av / ax / ay / ttl / split` 处理（§2.4） |
| `step()` — 敌弹 vs 玩家 | :951-957 | **改** | 追加擦弹判定块（§3.4） |
| `step()` — Boss 段 | :973-995 | **重写** | 阶段检查 → `K.move` → `subFire` → 节拍开火 → `K.summon`；碰撞加部件与无敌门 |
| `step()` — HUD 刷新 | :1024-1036 | **改** | 追加 `grazeWrap / graze / grazeFill` 更新（带 null 守卫） |
| DOM 常量区 | :20-52 | **改** | 追加 `grazeWrapEl / grazeEl / grazeFillEl`（T3 追加 buff 两个） |
| `EB_STYLE` | 渲染段 | **可选改** | 可为新弹型加 `lance`（尾刺，粗白热）/ `vortex`（漩涡，紫）两个样式键；不加则回退 `aim`，也能跑 |

### 7.2 `src/entities.js`

| 函数 | 现有位置 | 动作 | 职责 |
|---|---|---|---|
| `drawBoss()` | :615-727 | **重构为分发器** | 首行 `const K = DJFE.bossKinds[b.kind]; if (K && K.draw) return K.draw(b, now, player, ctx);`<br>否则走现有逻辑（`sentinel` 精灵路径 + 通用矢量降级） |
| `drawBossSentinel` | — | **新增** | 现有精灵路径 + 双肩装甲矢量叠加 + 裂纹 |
| `drawBossScorpion` | — | **新增** | 梯形躯干 + 双螯（开合）+ 5 节尾巴 + 白热尾刺 + 预警虚线 |
| `drawBossCarrier` | — | **新增** | 宽扁舰体 + 指挥塔 + 双舱门（开合动画 + 破损态）+ 4 挂点 |
| `drawBossCore` | — | **新增** | 脉动核心 + 6 花瓣（旋转 / 反向 / 张开）+ 双环能量冠 + 过载变色 |
| `drawBossPhaser` | — | **新增** | 双三角嵌套（反向自转）+ 菱形核 + 3 层残影 + 相位半透明 |
| `drawBossVoid` | — | **新增** | 黑洞核 + 双吸积盘 + 6 晶体（逐块崩落）+ 全身外光 |
| `drawEnemy()` | 敌机段 | **改** | 追加 `turret / kamikaze / curver / rock` 四个矢量分支；四者一律 `spriteName = null`（照抄 sniper） |
| `drawPlayer()` | 玩家段 | **改** | 追加僚机绘制（2 个小型三角 + 引擎点）；T3 追加散射紫环 |
| `DJFE.draw` 导出 | :729 | **改** | 无需改（分发在 `drawBoss` 内部） |
| `DJFE.bossKinds` | — | **新增桥接** | `game.js` 定义注册表后挂到 `DJFE.bossKinds`，供 `entities.js` 读取 draw 函数<br>⚠️ 注意加载顺序：`entities.js` 先于 `game.js` 加载 → **必须在 `drawBoss` 运行时读取**（不能在模块顶层缓存） |

### 7.3 `index.html`

| 位置 | 动作 |
|---|---|
| `#hud`（:450） | 在 `comboWrap` 之后插入 `grazeWrap` 块（4 个新 id，带 `data-i18n="hud.graze"`）；T3 再插 `buffWrap` |
| `<style>` | 新增 `#grazeBar` / `#grazeFill` / `#grazeWrap.focus` 三条规则（沿用方向 B 暖调：`grazeFill` 用柔金 `--gold`，`focus` 态加暖金脉动） |
| 其它 | **一字不动** —— 现有全部 id / `data-i18n` / JS 钩子保持原样 |

### 7.4 `src/main.js`

| 位置 | 动作 |
|---|---|
| `I18N.zh` | 加 `'hud.graze': '擦弹'`、`'hud.focus': '集中'`；T3 加 `'hud.buff': '增益'` |
| `I18N.en` | 加 `'hud.graze': 'GRAZE'`、`'hud.focus': 'FOCUS'`；T3 加 `'hud.buff': 'BUFF'` |
| 其它 | 不动 |

### 7.5 `tests/run-smoke.js`

| 套件 | 影响 | 动作 |
|---|---|---|
| S1 启动 | 新增 4 个 DOM id | 无需改（S1 自动扫 `getElementById` 与 index.html 的差集） |
| S10 Boss 全链路 | Boss 结构变化 | **检查**是否硬编码了 `bossPattern` 或 3 段弹幕；若有，改为断言「Boss 会开火 + 会被击杀」 |
| S11 长跑 | 池 cap 变大 | 无需改，但要确认内存断言阈值仍够用 |
| S15 通关 | 4 关 → 6 关 | **检查**是否硬编码「打 4 个 Boss 即通关」；若有，改为 `STAGES.length` |
| S16 六档 | 新增 RNG 点 | 无需改，但**这是最重要的门**，每次改完必跑 |
| S18 零扩容 | 新 cap | 无需改（只判 `grown === 0`） |

### 7.6 建议实现顺序（12 步，每步跑一次冒烟）

```
 1. ebullet 扩展字段 + addEbulletEx + 更新逻辑          → 跑冒烟（应无行为变化，125/125）
 2. 池 cap 调整                                        → 跑冒烟
 3. 弹幕原语库（纯函数，暂不接线）                        → 跑冒烟
 4. BOSS_KINDS 注册表（只放 sentinel，行为等同现状）      → 跑冒烟 ★ 关键校验点
 5. spawnBoss / bossFire / step Boss 段改造              → 跑冒烟（应仍与 v1.2.0 行为一致）
 6. 阶段系统 enterBossPhase + sentinel 三阶段            → 跑冒烟 + 手测 S1 Boss
 7. 剩余 5 款 Boss 的 phases / move / 招牌机制            → 每款单独手测
 8. 6 款 Boss 的矢量绘制                                → 手测外观
 9. STAGES 扩到 6 关                                    → 跑冒烟（重点看 S15）
10. 僚机 Option                                        → 跑冒烟 + 手测 power 2→3→5
11. 擦弹 Graze + HUD + i18n                            → 跑冒烟（重点看 S1/S17）
12. sync-web.js + 全量冒烟 + 六关手测                    → 交付
```

> **第 4~5 步是整个重构的安全阀**：此时代码结构已完全换成注册表，但**行为应与 v1.2.0 逐位相同**。
> 如果这一步冒烟不是 125/125，说明重构本身出了问题，**不要继续往前堆内容**，先修。

---

## 8. 附录

### 8.1 数值总表（供实现时直接抄）

```js
/* ---- Boss ---- */
const BOSS_PHASE_TH   = [1.00, 0.66, 0.33];  // 阶段阈值
const BOSS_PHASE_IFRAME = 1200;              // 阶段切换无敌 (ms)
const BOSS_PHASE_FXBUDGET = 24;              // 相位爆粒子上限
const BOSS_CLEAR_SCORE = 5;                  // 清屏每颗弹得分

/* ---- 擦弹 ---- */
const GRAZE_R    = 26;
const GRAZE_FULL = 30;
const FOCUS_MS   = 4000;
const FOCUS_MUL  = 1.5;
const GRAZE_PT   = 2;
const FOCUS_SHIELD_MS = 1500;   // 第 2 次满槽附赠

/* ---- 僚机 ---- */
const OPT_OFFSET  = [[-34, 18], [34, 18]];
const OPT_EASE    = 0.18;
const OPT_BULLET  = { vy: -10, r: 3 };
const OPT_FIRE_DIV = 2;         // 半频

/* ---- 敌种 ---- */
const KAMIKAZE_MAXTURN = 0.045; // rad/step —— 公平性关键常量，勿调高
const TURRET_BURST_N   = 3;
const TURRET_BURST_GAP = 150;   // ms
const TURRET_CYCLE     = 2000;  // ms

/* ---- 召唤 ---- */
const MINION_CAP_SCORPION = 4;
const MINION_CAP_CARRIER  = 8;
const MINION_SCORE_MUL    = 0.6;

/* ---- 池 cap ---- */
bullets 512 / ebullets 1200 / particles 2048 / enemies 200 / items 96 / rings 96
```

### 8.2 弹数预算总表（S18 依据）

| 场景 | 弹幕来源 | 单轮弹数 | 同屏轮数 | 峰值 | cap 1200 余量 |
|---|---|---|---|---|---|
| S1 sentinel P3 | 弹墙 11 + 螺旋 12 + 瞄准 5 | 9.3 均 | 7 | ~65 | 18.5x |
| S2 scorpion P3 | 尾刺 28 + 环 20 + 瞄准 5 | 13 均 | 4 | ~175 | 6.9x |
| S3 carrier P3 | 分裂 30 + 双雨 18 + 瞄准 5 | 17.7 均 | 3 | ~145 | 8.3x |
| S4 core P3 | 旋转臂 84 + 脉冲 72 + 过载 32 | — | — | ~260 | 4.6x |
| S5 phaser P3 | 横穿 14 + 双扇 16 + 双瞄 10 + 残影 16 | 14 均 | 4.5 | ~250 | 4.8x |
| **S6 void P3** | 漩涡 28 + 臂 56 + 横穿 14 + 瞄 7，**Echo 翻倍** | 105 → 210 | 2.5 | **~520** | **2.3x** |
| 非 Boss 波（最坏） | 杂兵 34 只各自开火 | — | — | ~120 | 10x |

**结论**：`ebullets cap = 1200` 在最坏情况（void P3）仍有 2.3 倍冗余。✅

### 8.3 待用户/主理人拍板的开放问题

| # | 问题 | 选项 | 我的建议 |
|---|---|---|---|
| **Q1** | Boss HP 是否按 §4.3 的「建议实装值」上调（170→260 等）？ | A. 按建议值 B. 保持原值先试 C. 交严守真实测后定 | **C**，先按建议值实装，实测 9 组条件后微调 |
| **Q2** | 关卡是否从 4 扩到 6？单局时长会到 13~16 分钟 | A. 扩到 6 关 B. 保持 4 关只换 Boss C. 扩到 6 关 + 加快杂兵波节奏 | **C** |
| **Q3** | 擦弹满槽的奖励？ | A. 只给 1.5x 得分 B. 只给护盾 C. 得分 + 第 2 次满槽附赠护盾 | **C**（有层次，且护盾不会太频繁） |
| **Q4** | `void` 的玩家牵引引力做不做？ | A. 做（更压迫） B. 不做（护自主感） C. 做但默认关闭 | **B 或 C** —— 收益小于 SDT 风险 |
| **Q5** | T3 的 `hydra`（分裂双 Boss）做不做？ | A. 做 B. 不做 | **B** —— 架构侵入大，性价比最低 |
| **Q6** | 新敌种做 2 种还是 3 种？ | A. turret + kamikaze B. 三种全做 | **B** —— curver 是唯一用到 `av` 弯曲弹的杂兵，能给弹幕语法多一个维度 |
| **Q7** | 陨石只在 S2/S5，还是全关低概率？ | A. 仅 S2/S5 B. 全关低概率 | **A** —— 保持关卡辨识度 |

### 8.4 已知取舍（明确记录，避免后人反复讨论）

| 取舍 | 放弃了什么 | 换来了什么 |
|---|---|---|
| 旋转光束用「弹链 + 角速度」而非真 beam | 光束的连续感、精确的扫描判定 | 零新碰撞类型、零新池、零新渲染路径；风险从「高」降到「低」 |
| 僚机用固定偏移而非轨迹跟随 | Gradius 的正宗手感 | 可预测性（支柱 P2）、零内存开销、确定性简单 |
| 陨石不挡敌弹 | 「掩体」玩法 | 避免 128k 次/步的碰撞开销 + 避免「躲石头后面」主导策略 |
| `STAGE_WAVES` 保持 3 | 每关节奏的精细控制 | 不动关卡映射逻辑，回归风险最小 |
| 僚机不可被摧毁 | 「保护僚机」的紧张感 | 不引入新的注意力负担与潜在输入需求（支柱 P1） |
| 部件伤害用 `dmgMul` 而非 `bullet.dmg` | 更灵活的伤害系统 | 不波及所有碰撞点，改动面从 6 处降到 1 处 |
| sentinel 保留 `boss.png` | 六款 Boss 视觉风格统一 | 老玩家的视觉记忆锚点 + 不浪费已有资产 |

---

### 8.5 实现就绪决策包（续）

> 本节约为主理人 / 主程序开工前的「决策锁定 + 风险清单」，由文策渊在代码复核后补入。所有结论基于已核实的 `src/game.js` / `src/entities.js` 真实代码（见 §0 代码事实基线与 §7 钩子映射）。

#### 8.5.1 锁定决策表（§8.3 七项待决已裁决）

| # | 问题 | **锁定决策** | 一句话理由 |
|---|---|---|---|
| **Q1** | Boss HP 是否上调 | 按建议值实装为起点，用 §4.3 修正矩阵 | 原值按 p1~2 低 DPS 调，p3+僚机下过短，必须涨 |
| **Q2** | 4 关 → 6 关 | 扩到 6 关 + 加快杂兵波节奏 | 单局 13~16 分钟可接受；只换 Boss 不动关卡 = 白做 |
| **Q3** | 擦弹满槽奖励 | 得分 1.5x + 第 2 次满槽附赠护盾 | 有层次、护盾不泛滥（护栏见 §3.4） |
| **Q4** | void 引力 | **做，但 `CONFIG.voidGravity=false` 默认关闭**（留代码路径） | 收益 < SDT 自主感风险；首发质量门优先 |
| **Q5** | T3 `hydra` 双 Boss | 不做 | 架构侵入大、性价比最低，T3 可省 |
| **Q6** | 新敌种 2 还是 3 | 三种全做 | `curver` 是唯一用到 `av` 弯曲弹的杂兵，多一弹幕语法维度 |
| **Q7** | 陨石范围 | 仅 S2/S5 | 保关卡辨识度，避免全关掩体 = 主导策略 |

#### 8.5.2 修正 Boss HP 矩阵（§4.3 已回填）

- 真实火力：射速 7.14 发/s（140ms），p1~5 = 1/2/3/5/5 颗，每颗 1 伤害；p3 原始 DPS 仅 **21.4**（非原稿误算的 32）。
- 实测起点微调：**sentinel 260→290~300、scorpion 380→430、carrier 520→580**；core / phaser / void 保持。
- 校准判据：`easy/normal/hard × power 1/3/5` 共 9 组，锚定 **normal + power 3 每场 30~90s 且随关卡单调递增**。
- HR（命中率）为假设值，真机测量后回灌 §4.3 矩阵即可反推精确 HP。

#### 8.5.3 六款 Boss 招牌机制 · 实现陷阱清单

| Boss | 招牌机制 | 陷阱（真实代码锚点） | 护栏 |
|---|---|---|---|
| **sentinel** | 横扫 + 双肩装甲 | ① 装甲减伤需改 `b.hp--`（`game.js:986`）为 `b.hp -= dmg`，装甲期 `dmg=0.5`；按 §8.4 用 `dmgMul` 单点改 | ② 横扫弹随时间累积，靠 `ttl` 回收，峰值≈8 颗同屏，安全 |
| **scorpion** | 8 字弹 + 尾刺 + 召唤 | ① 8 字依赖 `eb.av` 在 `game.js:947-950` 积分，`addEbulletEx` 必须**无条件重置 `av`**（§2.4 红线） | ② `spawnMinion` 须 `minions++` + `onBossKilled` 清零 + 硬上限 `MAX_MINIONS=6` |
| **carrier** | 悬停 + 舰载机弹射 + 二段分裂 | ① **分裂峰值**：`split` 归零瞬间 ×`splitN` 颗，活跃分裂弹×splitN ≤ ebullets 余量（≤30×4=120 瞬时） | ② 弹射弹用 step 内 `b.x` 实时值，非 spawn 快照 |
| **core** | 旋转光束 + 过载 | ① **光束角速度确定性**：旋转状态放 boss 上（`b.beamPhase += av*dt`，仿 `game.js:978`），每颗 `a=baseA+beamPhase`；**严禁**每帧 `eb.a+=eb.av`（六档 dt 下转速不一致 → S16 失败） | ② 过载 `fireGap*=0.6` 后更密，重评 S18 峰值 |
| **phaser** | 瞬移 + 残影爆散 + 双子分身 | ① 瞬移落点 = `f(b.phase)` 确定性函数，**禁 `Math.random()`**（S16） | ② 残影爆散瞬发 ~12 颗，叠加查峰值；③ 双子共享 `b.hp`，两 hitbox 各自吃弹 + 撞玩家，死亡清两个 |
| **void** | 三形态 + 漩涡 + 崩落 | ① 漩涡向心弹用 `ax/ay`，**必须 `ttl` 兜底回收**（否则绕圈永生 → S18 池泄漏），`ttl≈300` 步 | ② 引力 Q4 默认关，开启时位移在 step 内、避开 `invuln/shield` 守卫（`game.js:955/965/991`）；③ 形态切换 = `enterBossPhase`，粒子受 `fxBudget=24` |

#### 8.5.4 12 步构建清单（带冒烟门，安全阀标注）

| 步 | 任务 | 冒烟 | 门 |
|---|---|---|---|
| 1 | ebullet 扩展字段 + `addEbulletEx` + 更新逻辑 | ✅ 应无行为变化 | 125/125 |
| 2 | 池 cap 调整（ebullets 640→1200 等） | ✅ | S18 `grown===0` |
| 3 | 弹幕原语库（纯函数，暂不接线） | ✅ | — |
| 4 | **`BOSS_KINDS` 注册表（只放 sentinel，行为 = 现状）** | ✅ | **★ 安全阀：须 125/125 且与 v1.2.0 逐位同** |
| 5 | `spawnBoss/bossFire/step` 改造 | ✅ | **★ 同上，否则停手先修** |
| 6 | 阶段系统 `enterBossPhase` + sentinel 三阶段 | ✅ + 手测 S1 | — |
| 7 | 剩余 5 款 Boss 的 phases / move / 招牌 | 每款单独手测 | — |
| 8 | 6 款 Boss 矢量绘制 | 手测外观 | — |
| 9 | `STAGES` 扩 6 关 | ✅（重点 S15） | — |
| 10 | 僚机 Option | ✅ + 手测 p2→3→5 | — |
| 11 | 擦弹 Graze + HUD + i18n | ✅（重点 S1/S17） | DOM id 全在 |
| 12 | `sync-web.js` + 全量冒烟 + 六关手测 | ✅ | **交付** |

> **第 4~5 步是整次重构的安全阀**：结构上已换注册表，但行为必须与 v1.2.0 逐位一致。若此步非 125/125，**不要往前堆**，先修。任何 `src/` 改动后必跑 `node scripts/sync-web.js` + `node tests/run-smoke.js`（MEMORY 铁律1）。

---

**文档结束。**
实现过程中如发现与代码事实冲突，或需要调整数值，请通过主理人（游承峰）回传，我会同步修订本文档。
