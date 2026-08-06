# GDD · 招牌技能 + Boss 强辨识度（实现就绪细化包）

> **Task ID**：DES-SKILLS-BOSS　|　**作者**：文策渊（design-strategist）　|　**状态**：实现就绪（工程可直接照抄）
> **母本**：`variety-v2.md`（§1.4 招牌技能 / §1.5 触发方案 / §3 Boss 强辨识 / §4 整合 / §6 决策包 P-1~P-8）
> **本文档不修改 `variety-v2.md` 与任何既有 GDD**，仅把上述章节落成工程可直接照抄的细则（字段名、数值、DOM 结构、2D 路径要点、3D 几何清单、分步清单与冒烟门）。
> **代码事实基线**（本次逐处核实，与 v2 §0.2 一致）：
> - 技能键现状：`core.js:372` `pointerdown` 在 `pointerType==='touch'` 时 `return`，桌面端调 `DJFE._onPointerDown`→`triggerBomb`；`core.js:379` `keydown` 的 `KEY_MAP`（`core.js:356`）**无 Shift**，右键当前无 `e.button` 守卫会连带放炸弹。
> - Boss 2D：`entities.js:956` `BOSS_SHAPES` 现有 **6 款**（scorpion/carrier/core/phaser/void/weaverqueen）；**sentinel 无专属分支**（`entities.js:1624` `drawBoss` 里 `shape` 为 undefined → 走 `boss.png` 精灵路径，`entities.js:1647`）。这正是 v2 §3.1 指出的「辨识度低」根因。
> - 3D 同构：`render3d.js:108` `buildShip(THREE,w,h,kind)` 6 分支 + `render3d.js:254` 预建 + `render3d.js:307` `draw` 按 `currentId()` 切显。Boss 3D 化照此建 `buildBoss` 即可。
> - HUD：`index.html:472` `#hud` 内 `#comboWrap`/`#buffWrap` 为 inline span，`game.js:2531` 照 `#buffWrap` 模式 toggle hidden。
> - 触屏：`index.html:482` `#touchUI` 含 `#btnPause`/`#btnBomb`（`main.js:80` 接线）。

---

## 0. 命名与字段约定（工程唯一真源）

### 0.1 技能充能字段（落在 `game` 对象，全部 `startGame` 复位）

> 注：v2 §4.1 用 `skillMeter`，本文档按任务措辞统一改名为 **`skillCharge`**（语义更直白），其余与 v2 完全一致。`costMul` 为**每皮肤常量**（非运行时字段），见 §1 各款表。

| 字段 | 类型 | 安全默认 | 复位点 | 说明 |
|---|---|---|---|---|
| `game.skillCharge` | number | `0` | `startGame()` | 当前充能，**上限钳制 `min(skillCharge, costMul)`**；禁止囤积 |
| `game.skillCdUntil` | number(ms) | `0` | `startGame()` | 防连点锁（逻辑时钟）；释放后置 `now + SKILL_LOCK` |
| `game.skillT` | number(步) | `0` | `startGame()` | 技能持续剩余步数（overdrive/lance/beam/swarm 视觉与逻辑计时用）；cloak 不走此字段（走 `player.cloakUntil`） |
| `game.skillKind` | string | `''` | `startGame()` | 当前生效技能 id（`''`=无）；`step` 内递减 `skillT` 至 0 后置回 `''` |
| `game.skillWaves` | array[5] | 5 个 `{x,y,t,used:false}` | `startGame()` **只重置字段不 `new`** | 圣裁连爆定长波次表（常驻，仿 `boss.echo[4]`） |

### 0.2 玩家字段（新增 1 个）

| 字段 | 类型 | 安全默认 | 复位点 | 说明 |
|---|---|---|---|---|
| `player.cloakUntil` | number(ms) | `0` | `startGame()` | **幽影潜行专属**，**绝不复用 `shieldUntil`**（陷阱 T3） |

### 0.3 设置项（localStorage，非 game 字段）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `DJFE.settings.skillAuto` | boolean | 桌面 `false` / 触屏 `true` | 自动释放开关（S3 可访问性补丁） |

### 0.4 皮肤字段（v2 §1.2，已锁定，本文档沿用）

`SKIN_PRESETS[id]` 增 `hull / weapon / skill`；自定义皮肤缺失兜底 `|| 'cyan_knight' / 'dot' / 'overdrive'`（v2 §1.4-A）。

### 0.5 前置依赖（Phase 2c framework 必须先落地，属 S16 安全阀）

子弹 8 字段扩展（`kind=''/dmg=1/pierce=0/hitCd=0/av=0/ttl=0/blastR=0/target=-1`，`mkBullet` 给默认、`addBullet` 无条件重置）与伤害口径改造（`en.hp -= (b.dmg>0?b.dmg:1)`、Boss 侧双护栏）为 **Phase 2c-1 的前置步骤**——本包所有技能效果都建立在「弹可带 `kind/dmg/pierce/ttl/blastR/target`」这一基础上。**任一默认值不等价则冒烟不再逐位一致，停手先修。**

---

## 1. 六款皮肤招牌技能（细化 v2 §1.4）

### 1.0 通用规格（六款共享）

**触发（统一单键，脉冲而非模式 —— 守 P1 精神）**
- 桌面：`ShiftLeft` / `ShiftRight`（`keydown` 独立分支，**不进 `KEY_MAP`**，加 `e.repeat` 守卫防长按连发）或鼠标右键（`pointerdown` 且 `e.button===2`，并 `contextmenu`→`preventDefault`）。
- 触屏：`#btnSkill` 按钮（`click`→`DJFE.Game.skill()`），与 `#btnBomb` 完全同构。
- 释放函数 `DJFE.Game.skill()`：守卫 `state===PLAYING` → 校验 `skillCharge>=costMul && now>=skillCdUntil` → 按 `skin.skill` 分发到 `releaseXxx()` → `skillCharge=0; skillCdUntil=now+SKILL_LOCK(500)`。
- 自动释放（S3）：`skillAuto` 为真时，`step` 内 `skillCharge>=costMul && now>=skillCdUntil` 自动调 `skill()`。

**充能源（通用，与 v2 §4.1 一致）**

| 来源 | 增量 | 挂载点 |
|---|---|---|
| 击杀敌机 | `+0.028` | `onEnemyKilled()`（`game.js:1666`） |
| 擦弹 | `+0.010` | 擦弹计数点（`game.js:2013` `game.graze++` 之后，与 `grazeTotal++` 同段） |
| 连击修正 | `× (1 + min(combo,30)×0.01)`，上限 ×1.30 | 上述两处统一乘 |
| Boss 击破 | `+0.30` | `onBossKilled()` |

- **上限钳制**：`skillCharge = min(skillCharge, costMul)` —— 禁止囤积到 Boss 战连放两次。
- **攒槽节奏**（对齐擦弹加成的 ~25s 节奏）：杂兵波 ≈26s、Boss 战 ≈25s、高连击 ≈21s、`costMul=1.30`(violet) ≈27–34s。一场 Boss 战吃 1–2 次，整关 3–4 次。

**与既有三系统关系（v2 §4.2，再确认）**
- **bomb**：完全独立。技能不消耗 `game.bombs`，bomb 不影响 `skillCharge`。职能分离（bomb=清屏保命可囤积 9；技能=输出/位移/资源再生不可囤积），玩家无需做「该用哪个」的比较决策 → 防认知过载。
- **graze**：单向加挂。擦弹同时给 `grazeMeter`（不改 `GRAZE_GAIN=0.012`）和 `skillCharge`（新 +0.010）。**绝不修改 `GRAZE_GAIN`**。
- **combo**：作为充能乘数（×1.0~×1.30），不改既有分数公式。

**平衡纪律（守设计红线）**：技能是「**战术爆发**」不是「**常态输出**」。以 p3≈21.4 基线，单次技能伤折算摊薄 DPS 占 Boss 战总有效 DPS 的 **[18.0, 22.4]**（极差 ±11%），**无机型形成数值主导**（v2 §6.2 表）。

---

### 1.1 cyan_knight「超载齐射」`overdrive`

| 项 | 内容 |
|---|---|
| **触发** | 单键；`skillAuto` 可自动 |
| **充能源** | 通用；`costMul = 1.20` |
| **冷却** | 释放后 `skillCdUntil = now + 500`；`skillT = 120`（2.0s 逻辑步） |
| **效果** | `skillKind='overdrive'` 期间，`shoot()` 内 `shootInterval` 临时 `×0.60`（140→84ms，射速 +67%）。弹型/伤害/pattern **全不变**，只加快节拍。复用现有 `addBullet`/`firePattern` 接口，发一圈 `dot`。 |
| **新增字段** | `skillCharge/skillCdUntil/skillT/skillKind`（见 §0.1） |
| **与既有交互** | 与散射枪（G）**叠加**（散射改 pattern、超载改间隔，正交）；**不消耗 bombs**；持续期机身尾焰双层加长（纯视觉，不动判定） |
| **HUD** | 充能满→`#skillWrap` 显示「就绪」；释放期不另开 HUD（读数在机身尾焰，不在 HUD，避免再挤一条读数） |
| **平衡** | 唯一**随 power 线性放大**：p3 ≈+28.7、p5 ≈+47.8。与紫电（定值 38.4）反向，形成非支配关系。零新弹种、零新判定，全阵容风险最低 |
| **实现要点** | `shoot()` 开头：`const iv = (skillKind==='overdrive' && skillT>0) ? game.shootInterval*0.60 : game.shootInterval;` 用 `iv` 替代 `game.shootInterval` 判定发射。`step` 内 `if(skillT>0){skillT--; if(skillT===0) skillKind='';}` |

### 1.2 crimson_falcon「灼焰突刺」`lance`

| 项 | 内容 |
|---|---|
| **触发** | 单键；`skillAuto` 可自动 |
| **充能源** | 通用；`costMul = 1.10` |
| **冷却** | `skillCdUntil = now + 500`；`skillT = 36`（0.6s） |
| **效果** | `skillT=36` 期间，每逻辑步从机首发 1 颗穿透弹（`kind='dot'`, `ttl=10`, `pierce=99`, `hitCd=3`, `dmg=0.35`, `vy=-18`, `r=12`），共 36 颗，同屏峰值 ≈10。同时 `player.invulnUntil = now + 600`（0.6s 无敌）。 |
| **新增字段** | `skillCharge/skillCdUntil/skillT/skillKind`；复用 `player.invulnUntil` |
| **与既有交互** | 走 `player.invulnUntil`（**非 `shieldUntil`**，避开擦弹守卫）；**不消耗 bombs**；伤害最低（36×0.35≈12.6）但生存价值最高（0.6s 无敌≈半个炸弹） |
| **HUD** | 充能满→就绪；释放期机身前焰加长（视觉） |
| **平衡** | 必须贴脸才有输出意义，闭环「红隼贪婪」：想吃满霰射 DPS 必近身 → 近身危险 → 技能给近身许可证（仅 0.6s）。costMul 1.10 偏低补偿最低伤害产出 |
| **实现要点** | `step` 内 `if(skillKind==='lance' && skillT>0){ fireOne(player.x, player.y - player.h*0.5, 0, -18, {dmg:0.35, pierce:99, hitCd:3, ttl:10, r:12}); }`。`hitCd` 步末统一置位（同 v2 T2）。近身一排杂兵时穿透语义使其成为清墙工具 |

### 1.3 emerald「蜂群锁定」`swarm`

| 项 | 内容 |
|---|---|
| **触发** | 单键；`skillAuto` 可自动 |
| **充能源** | 通用；`costMul = 1.20` |
| **冷却** | `skillCdUntil = now + 500`（瞬发，无持续期；`skillT` 不用） |
| **效果** | 瞬发 **12 颗强追踪弹**（`kind='homing'`, `turn=0.12 rad/step`, `ttl=120`, `dmg=1.5`, `vy=-8`, `r=4`）。目标分配：按 `game.enemies` **数组序号**取前 6 个（Boss 存在时优先给 Boss 6 颗），每目标 2 颗。 |
| **新增字段** | `skillCharge/skillCdUntil`；复用 `bullets` 池 |
| **与既有交互** | 走 `bullets` 池（`homing` 现状），**不新建池**；**不消耗 bombs** |
| **HUD** | 充能满→就绪（无持续期，释放即结算） |
| **平衡** | 单体 18.0（全命中 Boss）；对杂兵波一次清 6 个目标，是全阵容最强群体点杀。主武器 DPS 与基线完全相等（21.42）→ 定位「更省心」而非「更强」 |
| **实现要点（S16 硬约束）** | 目标选择**必须按数组序号确定性遍历**，**禁止 `Math.random()` / 不稳定排序**（`Array.sort` 对相等键顺序引擎相关）。目标死亡后立即置 `target=-1` 转直线（v2 T4）。分配伪码：`const targets = b? [b] : game.enemies.slice(0,6); for i in 0..11: tgt=targets[i%targets.length]; spawn homing{target:index}` |

### 1.4 violet「贯穿光矛」`beam`

| 项 | 内容 |
|---|---|
| **触发** | 单键；`skillAuto` 可自动 |
| **充能源** | 通用；`costMul = 1.30`（全阵容最高） |
| **冷却** | `skillCdUntil = now + 500`；`skillT = 48`（0.8s，仅视觉/HUD 计时，beam 弹自身 `ttl` 控制） |
| **效果** | 瞬发 1 道全屏纵向光矛：从机首沿纵轴延伸到屏幕顶端，宽 22px，持续 0.8s（48 步）。矛内所有敌机/Boss **每逻辑步受 0.80 伤**。 |
| **新增字段** | `skillCharge/skillCdUntil/skillT/skillKind`；复用 `bullets` 池 1 颗 |
| **与既有交互** | 复用 `bullets` 池取 1 颗 `kind='beam'` 特殊弹（`vy=0, ttl=48, pierce=∞`）；碰撞在既有 `bullets` 循环内加 `kind==='beam'` 分支走**竖条 AABB**（`|en.x - b.x| < 11 + en.w*0.45 && en.y < b.y`），**不新增碰撞类型、不新建实体池** |
| **HUD** | 充能满→就绪；释放期机身一道竖向光（视觉） |
| **平衡** | 48×0.80=**38.4**（全阵容最高），且**不随 power 缩放**（p1 与 p5 同值）→ 低 power 阶段全阵容最强技能。命中条件：矛垂直、Boss 横向巡游，玩家须预判 Boss 横向相位再释放（技巧门槛，非无脑按键） |
| **实现要点** | `beam` 弹在 bullets 循环里的命中分支：`if(b.kind==='beam'){ if(en.y < b.y && Math.abs(en.x-b.x) < 11+en.w*0.45) en.hp -= 0.80; }`（Boss 同式，用 `bs.w*0.42`）。`pierce=∞` 保证不销毁，靠 `ttl` 到期回收 |

### 1.5 stealth「幽影潜行」`cloak`

| 项 | 内容 |
|---|---|
| **触发** | 单键；`skillAuto` 可自动 |
| **充能源** | 通用；`costMul = 1.20` |
| **冷却** | `skillCdUntil = now + 500`；**不走 `skillT`**，走 `player.cloakUntil = now + 3000`（3.0s） |
| **效果** | 3.0s 内进入潜行态：① 敌弹与撞机判定全部跳过（等效无敌）；② 潜行期内擦弹计入**翻倍**（`grazeMeter += GRAZE_GAIN×2`、`skillCharge` 同样翻倍）；③ 潜行结束瞬间原地一发环爆 `r=220`，范围内敌机受 **12 伤**（Boss 同吃） |
| **新增字段** | `skillCharge/skillCdUntil`；**新增 `player.cloakUntil`** |
| **与既有交互** | **必须新增 `player.cloakUntil`，不可复用 `shieldUntil`**（现有守卫 `grazeOn = now>=invulnUntil && now>=shieldUntil` 会在护盾期关闭擦弹，直接反向清零本技能核心机制 —— v2 T3）。环爆复用 `game.rings` 池（占 1 格） |
| **HUD** | 充能满→就绪；释放期机身半透明（视觉，复用 `playerAlpha` 半透明通道，与无敌闪烁口径一致） |
| **平衡** | 伤害倒数第二（12.0），但**唯一能把生存直接兑换成资源**（擦弹槽+技能槽翻倍）。3s 无敌不清屏（与 bomb 关键区别），出潜行瞬间仍在原弹幕里 → 贪心站位即时结算。全阵容最纯粹 P3 旋钮 |
| **实现要点（改 4 处守卫）** | ① 擦弹：`grazeOn = (now>=invulnUntil && now>=shieldUntil) || (now < cloakUntil)`；② 撞机判定（4 处 `loseLife` 守卫 `game.js:2375/2386/2420/2472`）：加 `&& now >= cloakUntil`；③ 环爆在 `cloakUntil` 到期那步触发一次（step 内检测 `prev<now<=cloakUntil`）；④ 半透明：draw 时 `playerAlpha` 在 `now<cloakUntil` 时取 0.4 |

### 1.6 golden「圣裁连爆」`judgment`

| 项 | 内容 |
|---|---|
| **触发** | 单键；`skillAuto` 可自动 |
| **充能源** | 通用；`costMul = 1.20` |
| **冷却** | `skillCdUntil = now + 500`（无持续期；`skillT` 不用；波次由 `skillWaves` 驱动） |
| **效果** | 在当前主目标（Boss 优先；无 Boss 时取 `game.enemies[0]`，**禁 RNG**）位置降下 **5 波延迟环爆**，每 **12 逻辑步**一波，半径 100px，**每波 5.0 伤** |
| **新增字段** | `skillCharge/skillCdUntil`；复用 `game.rings` 池（占 5 格）+ `game.skillWaves`（定长 5 格，常驻）；每波 `game.flash += 0.15` |
| **与既有交互** | 视觉复用 `game.rings`（cap 96，一次占 5 格）；判定用 `game.skillWaves` 定长 5 格数组（随 game 常驻，`startGame` 只重置字段不 `new`）；**不消耗 bombs** |
| **HUD** | 充能满→就绪（无持续期） |
| **平衡** | 5×5.0=**25.0**。主武器 17.1 全阵容最低（−19.9%，卡 C1 带下沿），靠群体场景 2–3 倍有效 DPS 补齐；Boss 战短板由技能 25 伤补（总有效 DPS 拉到 18.4，仍最低但差距收窄到 −14%）。定位「反群体特化」 |
| **实现要点（S16 零 RNG）** | 主目标确定：`const tgt = game.boss || game.enemies[0];`。释放时填 `skillWaves[0..4] = {x:tgt.x, y:tgt.y, t:now+12*i, used:false}`。step 内遍历 `skillWaves`：到 `t` 且 `!used` → 触发 ring 爆炸（半径 100、5 伤、用 `blastR`/一次性范围判定，仿 v2 §2.6）+ `rings` 池取 1 格视觉 + `game.flash+=0.15`，置 `used=true`。目标死亡则波次落在尸体坐标（已确定，不追新目标） |

---

## 2. 技能系统整合（含 P-1 落地）

### 2.1 输入接线（S1 方案的具体形态，修正右键连带放炸弹）

| 平台 | 触发 | 实现要点（照现有 bomb 键风格） |
|---|---|---|
| 桌面·键盘 | `Shift`（ShiftLeft/ShiftRight） | **不进 `KEY_MAP`**（`KEY_MAP` 是持续状态表，Shift 是脉冲）。在 `core.js:379` 的 `keydown` 里加独立分支：`if((e.code==='ShiftLeft'||e.code==='ShiftRight') && !e.repeat){ e.preventDefault(); DJFE._onSkill?.(); }`。**`e.repeat` 守卫是「脉冲≠蓄力」的 P1 合规关键** |
| 桌面·鼠标 | 右键（`pointerdown` 且 `e.button===2`） | **⚠ 必须先修现有 bug**：`core.js:372` 的 `pointerdown` 无 `e.button` 判定，右键当前会误触发炸弹。改法：`if(e.pointerType!=='touch'){ if(e.button===0) DJFE._onPointerDown(); } else return;` 然后把右键接在 `if(e.button===2){ e.preventDefault(); DJFE._onSkill?.(); }`。同时 `canvas.addEventListener('contextmenu', e=>e.preventDefault())` |
| 触屏 | `#btnSkill` | 与 `#btnBomb` 完全同构（`main.js:80`）：`if(btnSkill) btnSkill.addEventListener('click', e=>{ e.preventDefault(); DJFE.Game.skill(); })` |
| 可访问性(S3) | `settings.skillAuto` | 桌面默认 `false`，触屏默认 `true`。为真时满槽自动释放（`skill()` 在 step 内结算） |

> `DJFE._onSkill` 与 `DJFE._onPointerDown`（炸弹）同构挂在闭包外，供 `core.js` 调用。`DJFE.Game.skill()` 实现：守卫 `state===PLAYING` → 校验 `skillCharge>=costMul && now>=skillCdUntil` → 按 `skin.skill` 分发 → 置 `skillCharge=0; skillCdUntil=now+SKILL_LOCK`。

### 2.2 自动释放（S3）

- 存储：`DJFE.settings.skillAuto`（localStorage）；桌面默认 `false`、触屏默认 `true`。
- 逻辑：`step()` 内（非渲染层），若 `settings.skillAuto && skillCharge>=costMul && now>=skillCdUntil` → `DJFE.Game.skill()`。

### 2.3 HUD（`#skillWrap` 独立槽，遵循 v2 D9 **不复用 #buffWrap**）

> ⚠ **与任务描述的措辞冲突**：任务描述写「复用 `#buffWrap/#buff` 显示技能待发/冷却」，但 v2 §4.4/D9 已锁定**新增独立 `#skillWrap`**——理由：技能与散射（G）可能同时生效，复用同一槽会互相顶掉。**本文档执行 v2 锁定结论（D9）**。请主理人确认取舍（见 §6 风险点 ⑥）。

**新增静态 DOM id（必须同时进 `index.html`）**：

| id | 位置 | 结构 | 说明 |
|---|---|---|---|
| `#skillWrap` | `#hud` 内，`#buffWrap` 之后（`index.html:472` 行尾追加） | `<span id="skillWrap" class="hidden">` | 仿 `comboWrap` 的 hidden 切换 |
| `#skillLabel` | `#skillWrap` 内 | `<b id="skillLabel">` | 技能名 / READY 文案（读 i18n） |
| `#skillFill` | `#skillWrap` 内 | `<i id="skillFill">` | 充能进度条（`width = skillCharge/costMul*100%`），仿 `#grazeFill` |
| `#btnSkill` | `#touchUI` 内，`#btnBomb` 左侧（`index.html:484` 前） | `<button id="btnSkill" class="tbtn" aria-label="skill">⚡<span class="cnt" id="skillCnt"></span></button>` | 触屏技能键 |
| `#skillAutoBtn` | `#settings` 面板内（`index.html:587` 前） | `<button id="skillAutoBtn" class="setbtn">` | 自动释放开关（可选，S3） |

**认知过载护栏**：HUD 现 9 项读数，加技能=10 项，逼近 P2 红线。`#skillWrap` **仅在 `skillCharge/costMul >= 0.50` 时显示**（低于 50% 隐藏），满槽挂 `.ready` class 由 CSS 接管脉动。常态 HUD 与现在一模一样，只在「快能用了」才出现（仿 `comboWrap` ≥x2 才显示）。

**HUD 更新循环接入点**：在 `game.js:2531` 的 `#buffWrap` 块之后，加 `#skillWrap` 块：
```
if(skillWrapEl && skillFillEl && skillLabelEl){
  const ratio = costMul>0 ? game.skillCharge/costMul : 0;   // costMul 护栏（NaN 门）
  const show = ratio >= 0.50;
  skillWrapEl.classList.toggle('hidden', !show);
  if(show){
    skillFillEl.style.width = (Math.min(1,ratio)*100).toFixed(1)+'%';
    const ready = ratio >= 1;
    skillWrapEl.classList.toggle('ready', ready);
    skillLabelEl.textContent = ready
      ? (I18N[lang].skill.ready) + ' · ' + I18N[lang]['skill.'+skinSkill]
      : I18N[lang]['skill.'+skinSkill];
  }
}
```
所有 `el` 一律 `if(el)` 守卫（照 `game.js:2107+` 既有模式），DOM 缺一块只是不显示，不崩。

### 2.4 路由（严守 S16 —— 逻辑在 step 内，渲染只读）

| 字段 | 复位位置 | step 内更新位置 |
|---|---|---|
| `skillCharge` | `startGame()`（与 graze 同段） | 累积：`onEnemyKilled()` +0.028 / 擦弹点 +0.010 / 乘 combo 修正；Boss 击破 +0.30；`min(,costMul)` 钳制 |
| `skillCdUntil` | `startGame()` | 仅 `skill()` 释放时置 `now+500` |
| `skillT` | `startGame()` | `step` 内递减；归 0 置 `skillKind=''` |
| `skillKind` | `startGame()` | `skill()` 设置；`skillT` 归零复位 |
| `skillWaves` | `startGame()`（**只重置字段不 `new`**） | `skill()` 填波次；step 内到时触发并置 `used` |
| `player.cloakUntil` | `startGame()` | `skill()`（cloak）设置；step 内到时触发环爆 |

**边界声明**：技能**不改变**子弹形态/武器（`SKIN_WEAPONS` 的事）。技能是独立的一次性效果，叠加在现有武器 profile 之上（如 overload 改 `shootInterval`，不碰武器分派）。

### 2.5 i18n 键（main.js 双字典同步加，`index.html` 用 `data-i18n`）

```
zh: 'hud.skill':'技能', 'skill.ready':'就绪',
    'skill.overdrive':'超载齐射','skill.lance':'灼焰突刺','skill.swarm':'蜂群锁定',
    'skill.beam':'贯穿光矛','skill.cloak':'幽影潜行','skill.judgment':'圣裁连爆',
    'settings.skillAuto':'技能自动释放'
en: 'hud.skill':'SKILL', 'skill.ready':'READY',
    'skill.overdrive':'Overdrive Salvo','skill.lance':'Flame Lance','skill.swarm':'Seeker Swarm',
    'skill.beam':'Phase Lance','skill.cloak':'Phantom Cloak','skill.judgment':'Judgment Barrage',
    'settings.skillAuto':'Auto-cast Skill'
```
须更新既有键（教玩家技能键）：`hint`（zh/en）追加「Shift/右键放技能」；`menu.howto`（zh/en，含触屏分支 `main.js:76-77`）追加「左下 ⚡ 按钮放技能」。

---

## 3. 七款 Boss 强辨识度（细化 v2 §3，2D + 3D 双轨）

### 3.0 总原则（破模板）

当前 6 款共享「能量冠+舰体+核心」通用模板（`entities.js:1552 bossHullGeneric`），辨识度低。**改造目标：每款一条拓扑级唯一特征**。2D 与 3D 共用同一套剪影语言（质量分布+轮廓拓扑），2D 为确定性矢量路径（零 RNG），3D 为 `buildBoss(THREE, kind)` 几何体组合（仿 `buildShip` 同构：`init` 预建 7 款、`draw` 按 `b.kind` 切显）。**Boss 弹幕/HP/移动逻辑一律不改，只改造型（v2 D11/D14）。**

> ⚠ **sentinel 现状缺专属分支**：`BOSS_SHAPES` 无 `sentinel` 项 → `drawBoss` 走 `boss.png` 精灵（v2 §3.2 / §6 D12 已决「弃用 boss.png」）。**§3.1 给出 sentinel 的 2D 形状新增规格**，替代精灵路径。

### 3.1 sentinel · 哨戒机甲（hue 198 / HP 290）— **人形（有肩有臂，无腿）**

- **强区分剪影**：唯一的人形。宽高比 1.5:1。两块巨大梯形肩甲占剪影总宽 55%；胸腔厚重、中央内凹圆形探照灯窝；左右短粗手臂各持方形炮盒；腰部以下接一圈向下喷射推进器裙（无腿）。
- **招牌视觉母题**：装甲板 + 铆钉 + 液压杆（关节可见外露液压活塞）。
- **配色**：冷青灰装甲 hue 198（饱和 35%）+ 深色内构 + **hue 38 琥珀金警示条纹**（斜纹，走 hue 38 **非**危险带 12–24）。
- **2D 矢量细化（新增 `BOSS_SHAPES.sentinel`，纯路径零 RNG）**：
  - 肩甲：两片梯形（`moveTo(-s*0.5,-hb*0.20)→(-s*0.18,-hb*0.30)→(-s*0.18,-hb*0.02)→(-s*0.5,hb*0.10)` 镜像到右），占总宽 ~55%。
  - 胸甲：上宽下窄多边形，中央 `arc` 探照灯窝（半径 `s*0.12`，内凹暗色）。
  - 双臂：两条短粗 `Box` 状路径（用 `lineTo` 多边形）持方形炮盒（小矩形）。
  - 推进裙：底部 4 具向下锥形喷口（`moveTo` 三角 ×4）。
  - 机制视觉化：满血期双肩甲向内闭合（交叠处泛防护辉光）；HP<66% 进 pi=1 肩甲炸开永久消失（宽度骤增）；HP<33% 胸甲板翻起露骨架。
- **3D 网格蓝图（一句话）**：`buildBoss` 建「两组梯形肩甲 Box + 胸甲 Extrude 多边形 + 双臂 Box 炮盒 + 底部 4 锥喷口 Group」，中央球形探照灯用 `engMat` 自发光，`init` 预建、`draw` 按 `b.kind==='sentinel'` 切显。

### 3.2 scorpion · 采矿巨蝎（hue 32 / HP 430）— **有腿（8 条机械步足）**

- **强区分剪影**：唯一有腿。8 条向下弯折机械步足（左右各 4，3 节，钻头条尖）撑开，腿展开宽 = 甲壳宽 1.8×；宽扁六边形甲壳；双巨螯；分节尾翘过头顶占屏高 40%，尾端旋转钻头尖刺。
- **招牌视觉母题**：采矿钻头 + 发光青绿矿脉晶簇（暖褐机体上唯一冷色，面积 <5%）。
- **配色**：暖砂岩褐 hue 32（饱和 ≤40%）+ 矿脉青绿 hue 165 发光晶簇。
- **2D 矢量细化（改现有 `BOSS_SHAPES.scorpion`）**：现状已有尾/螯/甲壳，但被通用辉光语法抹平。**强化**：① 8 条腿改为显式绘制的 3 节折线（当前仅尾与螯，腿缺失 —— 这是辨识度关键，必须补）；② 甲壳缝隙嵌青绿晶簇（`fillStyle` 用 hue 165 小多边形，面积 <5%）；③ 尾针 5 节逐级白热预警（现状 `chargeGlow` 已部分实现，保持）。
- **3D 网格蓝图（一句话）**：建「六边形甲壳扁 Box + 8 条 3 节机械腿（Cylinder 段链）+ 双螯 Box + 分节尾（Cylinder 链）+ 尾端钻头 Cone」，晶簇用 `engMat` 青绿自发光，`init` 预建、`draw` 按 `b.kind` 切显。

### 3.3 carrier · 雷云母舰（hue 150 / HP 580）— **不对称（右舷舰岛）**

- **强区分剪影**：唯一不对称。水平航母平台，宽高比 **3.2:1**（全阵容最扁最宽，单凭长宽比即可区分）。顶部直通甲板（跑道中线+降落标线）；**舰岛偏右舷**（唯一不对称签名）；舰腹两侧各 3 个方形机库门（共 6，可开合）；舰艉两具方形推进器。
- **招牌视觉母题**：跑道/舱门/引导灯（甲板边缘绿引导灯带、机库门状态灯、弹射轨槽）。
- **配色**：军绿灰船体 hue 150（饱和 25%，哑光）+ 冷白甲板标线 + 引导灯绿 hue 145（仅灯带）。
- **2D 矢量细化（改现有 `BOSS_SHAPES.carrier`）**：现状已扁长+机库+舰桥，但舰岛居中。① **舰岛必须移到右舷**（当前居中 `±s*0.15` → 改右偏 `s*0.30`）；② 甲板加白色虚线跑道中线（`setLineDash` 虚线横穿）；③ 机库门开合动画（现状 `bay` 亮度已绑定 `minions`，保留并升级为门板旋转）。
- **3D 网格蓝图（一句话）**：建「超扁长主舰体 Box（3.2:1）+ 右舷偏置舰岛塔 Box + 6 个机库门（可旋转 Box 面板）+ 舰艉双推进器 Cylinder + 甲板标线贴图/线框」，引导灯用 `engMat` 绿自发光，`init` 预建、`draw` 按 `b.kind` 切显。

### 3.4 core · 歼灭核心（hue 338 / HP 460）— **中空（能看穿背景）**

- **强区分剪影**：唯一中空的浮游环阵。3 个同心圆环悬浮，环间无物理连接（4 根哑光能量支柱松散维持），中心裸露球核。**能从环隙看到背景星空**——全阵容唯一「能看穿」的 Boss。环直径比 1.0/0.74/0.48，外薄快、内厚慢。
- **招牌视觉母题**：天体仪/陀螺仪（环内侧面等距刻度槽，像游标卡尺）。
- **配色**：品红能量环 hue 338（高饱和自发光）+ 近黑哑光支柱（最高对比）。
- **2D 矢量细化（改现有 `BOSS_SHAPES.core`）**：现状已有三环+支架+球核，辨识度已较好。**强化中空读感**：① 环改为**不闭合弧段**（虚线/断口），让背景确实透出来（现状是实线弧，仍像实心）；② 支柱改哑光深色（现状 `p.dark` 已用，保持）；③ 发射中的环加速并实体化成连续能量刃（现状 `beamPhase` 已驱动旋转，加「实体化」层）。
- **3D 网格蓝图（一句话）**：建「3 个 Torus（不同半径/厚度，开口不闭合）+ 4 根细 Cylinder 哑光支柱 + 中心 Sphere 裸核（engMat 品红自发光）」，环开口让背景透视，`init` 预建、`draw` 按 `b.kind` 切显。

### 3.5 phaser · 相位幻影（hue 288 / HP 500）— **分离成 3 块不接触**

- **强区分剪影**：唯一分离成多块。一大两小共 3 块不规则棱柱晶体，彼此完全不接触，空中固定相对位置缓慢自转。主晶体拉长八面棱柱（上下尖），两副晶体约主体 35%，悬左下/右上（非对称）。无任何机械部件。
- **招牌视觉母题**：折射与内像（主晶体内能看到错位的缩小自己，位置=下次瞬移落点）。
- **配色**：紫罗兰半透 hue 288（α0.55）+ 内部彩虹色散（**跳过危险带 12–24**，用 `260→330→30(跳)→60→180` 非连续谱）。
- **2D 矢量细化（改现有 `BOSS_SHAPES.phaser`）**：现状已有主菱+残影+3 碎片+核心。**强化分离读感**：① 主晶体与副晶体**拉大间距**、明确不接触（现状副晶体绕核心公转 `rot`，需改固定偏移悬停）；② 内像预告（瞬移前 400ms 主晶体内浮现目的地倒影）—— 现状 `tele` 残影是离开点，需加「目的地预显」；③ 色散彩虹边（多色描边，跳过 12–24）。
- **3D 网格蓝图（一句话）**：建「1 个拉长八面主晶体（Extrude/自定义）+ 2 个悬浮副晶体（独立 Mesh，固定偏移）+ 内像代理 Mesh（半透，位移=落点预告）」，材质半透紫罗兰+色散描边，`init` 预建、`draw` 按 `b.kind` 切显。

### 3.6 void · 终末虚空（hue 262 / HP 640）— **中心是纯黑负空间**

- **强区分剪影**：唯一中心纯黑。奇点+吸积盘：中心纯黑球（不发光不反光，吃掉背后一切）；倾斜 ~20° 扁平吸积盘（粒子流，内白外暗紫）；4 块破碎岩甲被引力捕获绕转（朝向中心倾斜）；盘外缘引力透镜白弧。
- **招牌视觉母题**：引力与坠落（一切朝心倾斜、向内螺旋，无直线无静止）。
- **配色**：靛蓝吸积盘 hue 262（内 90%→外 25% 强梯度）+ **绝对黑核 #000（零发光）** + 冷白引力透镜弧。
- **2D 矢量细化（改现有 `BOSS_SHAPES.void`）**：现状已有引力环+4 岩甲+中心暗洞，**辨识度已强，保持并微调**：① 中心暗洞确保 `#000` 零发光（现状径向渐变已做，保持）；② 岩甲崩落被黑洞「吃掉」（螺旋内旋→拉成线消失，非炸掉）—— 现状 `form` 直接不画岩甲，改「内旋拉线」动画；③ 吸积盘随 `form` 增亮增速（现状 `aura` 已有，保持）。
- **3D 网格蓝图（一句话）**：建「中心黑球 Sphere（MeshBasicMaterial 纯黑，不参与光照）+ 倾斜吸积盘（Ring/Torus 半透渐变）+ 4 块岩甲（低模，绕轴公转且朝心倾斜）+ 透镜弧 Ring（engMat 冷白）」，黑洞用 Basic 材质不吃光，`init` 预建、`draw` 按 `b.kind` 切显。

### 3.7 weaverqueen · 织网者（hue 283 / HP 1500）— **织轮 + 拖曳丝线**

- **强区分剪影**：唯一有「手工艺/古典机械」质感。横置圆形织轮（直径占全宽 70%，12 辐条+经纬丝线，持续转动）；下半膨大纺锤腹囊（分节，4 条细长纺器机械臂，姿态永动）；质量上轻下重（与其余 6 款相反）。
- **招牌视觉母题**：丝线与经纬（从机身永远垂着几缕未织完的丝连到屏幕边缘——全阵容唯一侵占屏幕空间的静态母题）。
- **配色**：深紫腹囊 hue 283（饱和 45%）+ 珍珠白丝线（半透虹彩）+ 织轮黄铜暖金 hue 40（唯一古典机械材质信号）。
- **2D 矢量细化（改现有 `BOSS_SHAPES.weaverqueen`）**：现状已有织机格+丝线冠+纺锤菱核+分段核心，**辨识度已强，保持并强化丝线侵占感**：① 从机身垂丝连到屏幕边缘（现状丝线冠 `len` 限在 `R*0.86` 内，需延长到屏幕边缘，且在 `drawBoss` 外额外画几条跨越全屏的静态丝）；② 黄铜织轮（`STColor` hue 40，现状用 `p.hh` 紫，需给织轮独立暖金色）；③ `hold` 期丝线松弛下垂→归零瞬间绷直白热（现状未实现松弛态，需加 `hold>0` 下垂曲线）。
- **3D 网格蓝图（一句话）**：建「横置织轮（Torus+12 辐条 Cylinder，黄铜 MeshStandard）+ 纺锤腹囊（拉伸 Sphere）+ 4 条纺器臂（Cylinder 链，持续微动）+ 经纬丝线代理（Line/细 Cylinder，半透虹彩）」，丝线代理延伸到场景边缘，`init` 预建、`draw` 按 `b.kind` 切显。

### 3.8 七款拓扑区分度自检（任取两款，≥2 列不同 → 21 对全过）

| Boss | 拓扑唯一特征 | 长宽比 | 材质语言 | 中心 |
|---|---|---|---|---|
| sentinel | **人形（肩/胸/臂无腿）** | 1.5:1 | 工业装甲/铆钉 | 胸口探照灯 |
| scorpion | **有腿（8 条）** | 1.6:1(+腿1.8×) | 岩石/钻头/晶簇 | 甲壳 |
| carrier | **不对称（右舷舰岛）** | **3.2:1** | 军用工程涂装 | 甲板跑道 |
| core | **中空（看穿背景）** | 1:1 | 纯能量/哑光 | 裸露球核 |
| phaser | **分离 3 块** | 1:1.3 | 半透晶体/色散 | 主晶体内像 |
| void | **中心纯黑** | 1:1 | 引力/粒子流 | **纯黑洞** |
| weaverqueen | **织轮+拖丝** | 1:1.4 | 黄铜/丝绸/甲壳 | 转动织轮 |

### 3.9 Boss 3D 化架构（与 `buildShip` 同构）

- 在 `render3d.js` 新增 `buildBoss(THREE, w, h, kind)`：按 `kind` 7 分支，每款返回 `{group, bodyMat, engMat, accentMat?}`（accentMat 用于警示条/晶簇/丝线等副色，照 `bodyMat/engMat` 双材质契约扩展为三材质）。
- `init` 阶段预建 7 款（`BOSS_KINDS = [sentinel,scorpion,carrier,core,phaser,void,weaverqueen]`），全部 `group.visible=false` 常驻场景（仿 `render3d.js:254`）。
- `draw` 按 `b.kind` 切显（仿 `render3d.js:321` 的 `sid` 切显逻辑，改用当前 Boss 的 `kind`；无 Boss 时全隐）。
- 位置/尺寸/侧倾照机体：`mapXY(b.x,b.y)` + `scale` 贴合 `b.w/b.h`；配色写 `bodyMat/engMat/accentMat`（仅在色值变时写）。
- **硬约束（S16/S18）**：几何体 `init` 预建、draw 只切显/写矩阵/写材质色，**绝不逐帧 new 几何体**；Boss 3D 网格**不入任何游戏对象池**（它是渲染层常驻资源，不占 `bullets/ebullets/rings`）。

---

## 4. 质量门与陷阱（工程必须遵守）

### 4.1 S16 · 确定性（六档刷新率逐位一致）
- 所有 `Math.random()` 必须落在 `step()` 内。本文档新增机制**全部零 RNG**：homing 目标按数组序号（§1.3）、圣裁目标按数组序号（§1.6）、技能充能确定性累加、Boss 造型相位走 `b.phase`/`now`（渲染时钟）。
- 弹道驱动一律按**逻辑步**（不读 `performance.now`、不乘 `dt`）。`skillT` 递减、`ttl` 递减、`hitCd` 递减全为整数步计数。
- 渲染层**零 RNG**：2D `BOSS_SHAPES` 全纯路径（无 `Math.random`）；3D 粒子/材质动画用确定性 `now`（rt），禁 `Math.random`。
- 验证：`rg "Math\.random" src/` 逐处确认在 step 路径内；Boss 造型改动后 `rg` 确认 `BOSS_SHAPES` 内无 `Math.random`。

### 4.2 S18 · 对象池零扩容
- **硬约束：不新建任何池。** 技能弹全部复用 `bullets`(512) / `ebullets`(1600)；环爆视觉复用 `rings`(96)；圣裁波次用 `game.skillWaves` 定长 5 格（常驻）。Boss 3D 网格不入游戏池。
- bullets 池峰值（v2 §5.3）：最坏 ≈219/512（2.3 倍余量，含超载齐射×0.6 的 196 峰值 + 突刺/蜂群/光矛叠加）。**须实测确认 `grown===0`**。

### 4.3 NaN 红线
- 新字段全部给安全默认（§0.1/§0.2/§0.3）。
- HUD 宽度计算 `skillCharge/costMul`：`costMul` 必须有 `>0` 护栏（自定义皮肤兜底 1.0）。
- 3D 层不引入新 NaN 源：mesh 位置直接读逻辑层已护栏的 `x/y`，渲染层不做新除法/atan2/归一化。

### 4.4 S1 / S17 · DOM id 门
- 新增静态 id：`#skillWrap` `#skillLabel` `#skillFill` `#btnSkill` `#skillAutoBtn`（§2.3）。**必须同时**：① 加进 `index.html`；② `game.js` 取用处加 `if(el)` 守卫；③ 对应 i18n 键加进 `main.js` zh 与 en 两份字典。
- `tests/run-smoke.js` 的 S1 静态 id 扫描须覆盖 `#touchUI` 内按钮（新增 `#btnSkill`）—— 见 v2 §0.3 空白①，须 engineering-lead 确认。

### 4.5 向后兼容
- **未加技能的老存档照玩**：`skillCharge=0`（默认），技能键按下因 `skillCharge<costMul` 不释放，零副作用。
- **Boss 弹幕/HP/移动逻辑不改**，只改造型（v2 D11/D14/S15 零影响）。
- 子弹 8 字段缺失的旧调用路径：`kind=''` 等价于 `dot`、`dmg=1`、`pierce=0`（§0.5 安全阀）逐位一致。

---

## 5. 分步构建清单（建议顺序）+ 每步冒烟门

> 铁律：改 `src/` 后必跑 `node scripts/sync-web.js` + `node tests/run-smoke.js`。
> 前置：子弹 8 字段扩展 + 伤害口径改造（§0.5）须先于 2c-1 落地（S16 安全阀）。

| 步 | 任务 | 触发门 | 备注 |
|---|---|---|---|
| **2c-1** | **技能 framework**：`game` 加 5 字段 + `player.cloakUntil` + `startGame` 复位；`onEnemyKilled`/擦弹点接充能；`DJFE.Game.skill()` 释放门（校验+分发+置 `skillCharge=0`/`skillCdUntil`）；输入接线（修右键 `button===0` 守卫 + Shift 独立分支 + `#btnSkill`）；`#skillWrap/#skillLabel/#skillFill` 进 `index.html` + `game.js` HUD 循环（`if(el)` 守卫）；i18n 双字典 | **S1 / S16 / S17** | 六款效果**接同一 `skill()` 释放函数**，先 framework 后填效果 |
| **2c-2** | **六款技能效果**：overdrive（shootInterval×0.6）/ lance（穿透射流+invulnUntil）/ swarm（12 homing 数组序号分配）/ beam（beam 弹竖条 AABB）/ cloak（cloakUntil + 4 处守卫改 + 环爆）/ judgment（skillWaves 5 波 + rings 池） | **S16（零 RNG）/ S18（`grown===0`）** | 平衡数值见 §1；cloak 最后做（动 graze 守卫，风险最高） |
| **3-1** | **Boss 2D 剪影细化（headless 可见，优先）**：新增 `BOSS_SHAPES.sentinel`（人形，替代 boss.png）；强化 scorpion 8 腿、carrier 右舷舰岛+跑道、core 环开口透背景、phaser 分离间距+内像、void 黑洞、weaverqueen 垂丝+黄铜织轮 | **S16（零 RNG）/ 手测外观** | 纯路径、零 RNG；每款独立轮廓，不再共享通用舰体三段 |
| **3-2** | **Boss 3D 网格**：`render3d.buildBoss(THREE,kind)` 7 分支 + `init` 预建 7 款 + `draw` 按 `b.kind` 切显；三材质（body/eng/accent）契约 | **S16（init 预建）/ S17 / S18（不入池）** | 交工程+美术同构验收；零逐帧 new 几何体 |

> 每步标门：**2c-1/2c-2 → S1/S16/S17/S18**；**3-1 → S16**；**3-2 → S16/S17/S18**。

---

## 6. 需主理人拍板的风险点

| # | 风险点 | 我的建议 | 若否决的退路 |
|---|---|---|---|
| **①** | **P1 支柱偏离**（新增技能键 Shift/右键/`#btnSkill`，输入 2→3） | 采纳 S1+S3（脉冲非模式，守住 P1 精神）。v2 §1.5/D7 已论证 | 退回 S2 满槽自动（stealth 改纯被动无敌、violet 改情境自动触发、策略深度降约一半） |
| **②** | **HUD 槽位取舍**：任务描述写「复用 `#buffWrap`」，但 v2 D9 已锁定「新增独立 `#skillWrap`」 | **执行 v2 D9（独立 `#skillWrap`）**——技能与散射可同时生效，复用会互相顶掉 | 若坚持复用 `#buffWrap`：技能与散射同时时需合并文案（如「散射 5s / 技能就绪」），牺牲一条独立读数位 |
| **③** | **cloak 改动 4 处 `loseLife` 守卫 + graze 守卫**（v2 T3） | 严格按 §1.5 实现：`grazeOn` 在 `cloakUntil` 期显式放行；4 处撞机守卫加 `&& now>=cloakUntil` | 无（这是本包的红线，不可省略） |
| **④** | **右键连带放炸弹的现有 bug**（`core.js:372` 无 `e.button` 守卫） | 2c-1 必须先修：加 `e.button===0` 守卫再接右键 | 若不修，接右键技能会同时放炸弹，双花资源 |
| **⑤** | **S1 静态 id 扫描是否覆盖 `#touchUI` 内 `#btnSkill`**（v2 §0.3 空白①） | 须 engineering-lead 确认 `run-smoke.js` 覆盖触屏按钮 id | 若漏扫，新增 id 不会被门拦住，回归风险 |
| **⑥** | **无**（其余风险已在 v2 P-1~P-8 覆盖；本包仅 B/Boss 造型，不新增 P2/P3/P4/P5/P6/P7/P8 级决策） | — | — |

> 结论：本包**唯一需主理人最终拍板的是 ①（P1 偏离，v2 已记）与 ②（HUD 槽位措辞冲突，建议 D9）**；④ 为必须修的 bug（非决策）；⑤ 为工程确认项。

---

**文档结束。** 实现过程中如发现与代码事实冲突或需调数值，请通过主理人（游承峰）回传，我会同步修订本文档。本文档不修改 `variety-v2.md` 与其余既有 GDD。
