# 发布就绪检查表 · Release Readiness

> 版本：**v1.2.0** ｜ 评审强度：**full** ｜ 平台范围：Web(itch.io) + Windows EXE + Android APK
> 发布主理：release-ops ｜ 生成日期：2026-07-29 ｜ 末次更新：2026-07-31（B-01/B-05 回写、B-04→RESOLVING、§5.3 接入 `verify.js` 四柱门、§2.2 记录 B-04 降级提案）
> **本文件是 go / no-go 的唯一依据。Blocker 未清不发布，除非用户明确豁免。**

---

## 0. 当前门控判定

| 平台 | 判定 | 说明 |
|---|---|---|
| **Web (itch.io)** | 🟡 **CONDITIONAL GO** | 内容与功能已达发布水位（quality 无头冒烟 122/122 PASS）。B-01 版本号对齐、B-05 gitignore 吞文档**已回写修复（2026-07-31）**；B-04 高刷屏加速**已转 RESOLVING**（eng 在 Task #3 落地 D8 固定时间步长，待 QA S16 复测）；**仍余 B-02 SW 缓存版本（src/*.js，转 eng）**。 |
| **Windows EXE** | 🟡 **CONDITIONAL GO** | 配置与主进程代码审阅通过；**本机因网络受限未能实际出包**（见 §3.1），需先在 CI 上 `workflow_dispatch` 跑绿一次。B-01 已回写；B-04 已 RESOLVING。**无代码签名**，玩家会遇 SmartScreen 警告，需在页面说明。 |
| **Android APK** | 🔴 **NO-GO** | CI 只产 **debug** APK，未做正式签名，不可公开分发（B-03）。首发建议**不上架 APK**。 |

**综合建议：**

> **首发 = Web (itch.io) + Windows EXE，Android 延到 v1.2.1 补齐签名流程后再上。**
> **放行前需清的 Blocker：B-02（SW 缓存版本，src/*.js→eng）、B-03（安卓签名→APK 延 v1.2.1）、B-04（RESOLVING，待 QA S16）。**
> **B-01（版本号对齐）、B-05（gitignore 吞文档）已于 2026-07-31 回写修复。**
> B-04 原建议「60Hz 封顶」（§2.1 方案 A）；eng 在 Task #3 直接落地**方案 B 固定时间步长（D8）+ 渲染外插**，从根上解帧率耦合，比方案 A 更彻底，现 RESOLVING 待 QA S16 高刷复测位移比 ≈1.0 后降级。

**为什么把 B-04 定为 Blocker 而不是 Known Issue：**
本作的核心卖点与目标人群是「笔记本触摸板玩家」，而当代游戏本 / 轻薄本普遍是 120Hz 以上高刷屏。
也就是说，**受影响的恰恰是我们主动去拉的那批人**。他们打开 Demo 会看到一个跑快 2.4 倍的游戏，
得出的结论不是「这游戏有个帧率 bug」，而是「这游戏手感很烂」——
而 Demo 试水的唯一目的就是采集口碑数据。用一个有此缺陷的版本去采集，得到的数据是错的，
这轮发布也就白做了。这不是技术洁癖，是发布目标本身要求它必须修。

---

## 1. 版本号统一决策

### 1.1 核对结果

| 位置 | 当前值 | 来源 | 目标值 |
|---|---|---|---|
| `package.json` `version` | ~~1.1.0~~ → **1.2.0** | 本次已改 ✅ | 1.2.0 |
| `android/app/build.gradle` `versionName` | `1.1.0` | commit `a8edfaf` | **1.2.0** ✅（2026-07-31 回写） |
| `android/app/build.gradle` `versionCode` | `2` | commit `a8edfaf` | **3** ✅（2026-07-31 回写） |
| `desktop/package.json` `version` | `1.0.0` | 初版未再维护 | **1.2.0** ✅（2026-07-31 回写） |
| `sw.js` `CACHE` | `djfe-v1` | 从未变更 | **`djfe-v1.2.0`** ⬜ |
| git tag | `v1.0.0`、`v1.0.1` 已存在 | 2026-07-21 | 新增 `v1.2.0` ⬜ |

### 1.2 为什么是 1.2.0，而不是 v1.0.0 或 1.1.0

**关键发现：`v1.0.0` 与 `v1.0.1` 两个 tag 已经存在于仓库中**（分别指向 `e4456c9`、`8380b15`），
且 `.github/workflows/release.yml` 在 `tags: ['v*']` 上会自动创建 GitHub Release —— 也就是说这两个版本号**已被消耗**，对应的 EXE 已经作为 Release 附件公开可下载。

因此：

- ❌ **不能用 v1.0.0** —— tag 已占用。强行复用需要 `git tag -f` 并删除已有 Release，会破坏发布可追溯性（这是发布管理的红线）。
- ❌ **不建议用 1.1.0** —— `1.1.0` 是 `a8edfaf`（2026-07-27）打在安卓工程上的版本戳，此后又合入了两个 `feat` 提交：
  - `4b23463` feat: 前端 UI 全面升级
  - `057e3ce` feat: 玩法大拓展（火力 5 级变形 / 4 种新敌机 / 连击系统）

  期间 CI 在 push `main` 时已产出多个标称 `versionName 1.1.0` 的 APK 产物。若把内容更多的 HEAD 也叫 1.1.0，等于**同一版本号对应多份不同二进制**，构建溯源与玩家问题定位都会失效。
- ✅ **1.2.0** —— 符合 SemVer（`1.1.0` 之后有 `feat` → minor 递进），tag 未占用，且能干净地作为「首个公开发行版」锚点。`v1.0.0` / `v1.0.1` 在 `CHANGELOG.md` 中已明确标注为「内部预公开构建」，对外叙事不冲突。

> **公开首发版本号不是 1.0.0 会不会奇怪？** 不会。玩家不会去数版本号，只会看内容。
> 反而复用已发布的 tag 会在 GitHub Releases 页留下互相矛盾的两条记录，那才是真问题。

### 1.3 版本对齐补丁（已分批应用）

> 本段原为「待批准」补丁。2026-07-31 主理人授权后，**android 版本戳、desktop 版本戳、gitignore 已回写**（见下方 ✅ 标注）；
> **`sw.js` CACHE（B-02）因属 `src/*.js`，已转 eng 处理，本回合未动**。

以下为补丁原文（精确到行），供审计与 eng 接手 B-02 参考：

```diff
# android/app/build.gradle  (第 10-11 行)
-        versionCode 2
-        versionName "1.1.0"
+        versionCode 3
+        versionName "1.2.0"
```

```diff
# desktop/package.json  (第 3 行)
-  "version": "1.0.0",
+  "version": "1.2.0",
```

```diff
# sw.js  (第 5 行)
-const CACHE = 'djfe-v1';
+const CACHE = 'djfe-v1.2.0';
```

同时需修 B-05（否则本目录的三份文档根本进不了仓库）—— **已于 2026-07-31 回写为 `/release/` ✅**：

```diff
# .gitignore  (第 5 行)
-release/
+/release/
```

---

## 2. 阻塞项与风险清单

### 🔴 Blocker（必须清除，否则 no-go）

| ID | 项 | 影响 | 处置 | 负责 |
|---|---|---|---|---|
| **B-01** | 三处版本号漂移（android 1.1.0 / desktop 1.0.0 / package.json 1.2.0） | 三端产物版本不一致，玩家报 bug 时无法定位构建；安卓 `versionCode` 不递增将来无法在 Play 上架更新 | ✅ **已回写（2026-07-31）**：android→1.2.0/code 3、desktop→1.2.0（见 §1.1 / §1.3） | release-ops |
| **B-02** | `sw.js` 的 `CACHE = 'djfe-v1'` 从未随版本变更 | itch.io 是 https，SW 会生效。老访客刷新后**仍命中 v1 缓存**，永远看不到新版本，且极难自查 | 改为 `djfe-v1.2.0`，并写入发版流程「每次发版必改」 | eng |
| **B-03** | CI 仅产 **debug** APK（`assembleDebug`），未配置签名 | debug APK 用通用 debug key 签名，安装有安全警告；一旦分发出去，后续正签版因签名不一致**无法覆盖升级**，只能让玩家卸载重装 | 方案 A（推荐）：首发不上 APK；方案 B：补 release 签名密钥 + `assembleRelease` + CI secrets | release-ops + eng |
| **B-05** | **`.gitignore` 第 5 行的 `release/` 把 `docs/release/` 整个目录吞了** —— `git check-ignore -v docs/release/release-readiness.md` → `.gitignore:5:release/`。gitignore 的无斜杠前缀模式匹配**任意层级**的同名目录 | 本次产出的 3 份发布文档**永远不会被 git 追踪**，`git status` 里连提示都不给，团队会以为文档已入库。同理任何未来放进 `docs/release/` 的物料都会静默丢失 | ✅ **已回写（2026-07-31）：第 5 行改为 `/release/`**（锚定根目录，符合「忽略根级构建产物」原意）。`git check-ignore` 复核已失效（docs/release/ 不再被吞） | release-ops |
| **B-04** | **帧率耦合：120/144Hz 屏上游戏整体加速 2.4 倍**（quality 实测量化，见 `docs/qa/smoke-test-plan.md` BUG-03 / 重构文档 D8） | 游戏本 / 高刷屏用户拿到的是一个跑快 2.4 倍的版本，难度完全变形、排行榜跨设备无可比性。**而高刷屏正是本作主打的「笔记本触摸板」人群的常见配置** —— 直接摧毁「零上手门槛」这个核心卖点 | 🟡 **RESOLVING**：eng 在 Task #3 落地 **D8 固定时间步长 + 渲染外插**（累加器接线于 `src/game.js` 643/649/661/663 行），从根上解帧率耦合，比原方案 A 更彻底。待 **QA S16 在 120/144Hz 复测位移比 ≈1.0** 后正式降级。quality 已提出「降为回归守门人」，**提案与触发条件见 §2.2，待主理人签字，本表尚未据此改判** | eng（落地）+ QA（验证） |

### 2.1 B-04 处置方案（三选一，需用户拍板）

| 方案 | 做法 | 工作量 | 风险 | release-ops 意见 |
|---|---|---|---|---|
| **A. 帧率封顶（原推荐用于 v1.2.0）** | 主循环加一道 60Hz 节流：`if (now - last < 16.6) { rAF(loop); return; }`，高刷屏上多余的帧直接跳过 | ~5 行 | 低。不动任何位移数值、不动玩法逻辑；副作用是高刷屏拿不到 144fps 的顺滑度（但本作是固定像素位移，本来也没有插值） | ⏸ **原首选，未采用**。被方案 B 取代 |
| **B. 固定时间步长重构** | 按 `smoke-test-plan.md` BUG-03 的建议引入累加器，`update` 从 `loop` 抽离 | 结构性改动，需单独排 Story + 全量回归 | 中。触及主循环，可能引发新的手感/数值问题 | ✅ **已落地（Task #3 / D8）**。eng 在发布窗口前完成了固定时间步长 + 渲染外插，从根上解帧率耦合，现 RESOLVING 待 QA S16 复测 |
| **C. 接受并披露** | 不改，在商店页注明「建议在 60Hz 显示器上游玩」 | 0 | 高。玩家不会看说明，只会留下「这游戏快得没法玩」的差评，而差评会直接毁掉 Demo 试水的口碑验证目的 | ❌ **不建议**。免费 Demo 的唯一产出就是口碑数据，用有缺陷的版本采集只会得到错误结论 |

> **release-ops 原建议方案 A（60Hz 封顶）作为 v1.2.0 最小收尾；最终 eng 在 Task #3 落地了方案 B 固定时间步长（D8），更彻底。当前状态：B-04 = RESOLVING，待 QA 用 S16 在 120/144Hz 复测位移比 ≈1.0 后正式降级、再进字符串冻结。**

### 2.2 B-04 降级提案（quality 提出，⏸ **待主理人签字，本文件尚未据此改判**）

**quality 的主张（2026-07-31 转达）：** BUG-03 实为已修复（D8 固定步长已落地），B-04 赖以成立的「60Hz 帧率封顶」前提不再存在，建议把 B-04 **从 Blocker 降为回归守门人**，由 S16 六档 GATE 代为守门。

**release-ops 复核意见：方向认可，但降级必须绑定证据，不能靠论证。**

- ✅ **支持降级的新证据**：`tools/verify.js refresh` 实现的正是这套六档自动门 —— 它在 30/60/72/120/144/240Hz 各跑 30s，同时断言 ①逻辑步数区间 ≤ 2（即步频与刷新率解耦）②各档与 60Hz **逐字节同态**。这比原计划「人工复测位移比 ≈1.0」更严格，且可重复执行。只要它接入发布门（已写入 §5.3 并定为 🔴 硬门），B-04 在**结构上**就已有常设守门人，符合「回归守门人」的定义。
- ⚠️ **尚缺的一环**：截至本次更新，**没有任何一份 `verify.js refresh` 在当前 `src/` 上的绿灯运行记录送达发布侧**。降级的前提是这道门确实绿着，而不是这道门存在。门存在 ≠ 门通过。
- ⚠️ **无头 ≠ 真机**：该验证跑在 Node vm 沙箱 + 虚拟时钟上，证明的是「逻辑步频与 rAF 节奏解耦」。真机高刷屏还叠加 vsync 抖动、后台降频、`performance.now()` 精度、以及 `MAX_CATCHUP` 追帧钳位的实际手感。故仍保留**一次真机点验**，但它只是确认项，不再是 Blocker 级工作量。

**降级触发条件（两项同时满足即自动生效，无需再讨论）：**

1. `node tools/verify.js refresh` 在当前 `src/` 上 **PASS**，运行输出留存至 `docs/qa/`（六档步数区间与同态比对结果需可见）；
2. 120Hz 或 144Hz **真机点验**一次，主观速度与 60Hz 一致、无追帧突进。

**满足后的目标状态：** B-04 由 🔴 Blocker → 🟢 **回归守门人**（closed，由 §5.3 `refresh` 硬门常设看守），§0 的 Web / EXE 判定同步移除 B-04 项。
**在此之前**：B-04 维持 🟡 RESOLVING，§0 判定不变 —— 因为主理人上一轮授权的是「标为 RESOLVING」，改判 Blocker 属 go/no-go 决策，需主理人（及用户）拍板，release-ops 不自行改判。

### 🟠 Major（强烈建议发布前处理）

| ID | 项 | 影响 | 处置 |
|---|---|---|---|
| **M-01** | 19 处玩家可见中文硬编码未进 i18n | 英文玩家在关卡名 / Boss 名 / 波次横幅 / 皮肤名 / 音效按钮处看到中文，中英混排。而这些恰恰是商店页宣传的内容 | 见 §4.2 清单；译文已备好在 `store-copy.md` 附表，落地成本约 1 小时 |
| **M-02** | Windows EXE 无代码签名 | 首次运行触发 SmartScreen「未知发布者」蓝屏警告，下载转化率损失显著 | 首发接受，但**必须在 itch.io 页面显著位置说明**「便携版无签名，Windows 会提示，点『更多信息 → 仍要运行』」；二期考虑 EV 证书 |
| **M-03** | `index.html` 缺 `<meta name="description">` 与 OG / Twitter Card | 分享链接无预览图与描述，社媒传播效果差 | 补 meta 标签（不涉游戏逻辑），文案取 `store-copy.md` 短描述 |
| **M-04** | 无游戏内版本号显示 | 玩家报 bug 说不清版本，运营无法定位 | 建议在菜单页角落显示 `v1.2.0`（约 3 行代码） |
| **M-07** | **通关结算把「本局得分」显示成「历史最高分」**（quality 实测，`smoke-test-plan.md` BUG-01；`game.js` `victory()` 222–227 行） | 通关是玩家的高光时刻，结算数字却是错的，直接击穿信任。而通关演出正是本作 4 关战役的收尾，商店页也在宣传它 | 一行修复：`fv.textContent = raw`（用未被 `commitBest` 覆写的原始分数）。**建议随 B-04 一起进 v1.2.0** |
| **M-08** | **暂停不冻结限时增益**（quality 实测，BUG-02） | 暂停 12 秒回来护盾没了，玩家会认为「护盾没生效」而非「暂停偷走了时间」 | 暂停时记录 `pausedAt`，恢复时把所有 `*Until` 时间戳整体后移。可与 M-07 同批处理 |
| **M-05** | **EXE 未配图标** —— `desktop/package.json` `build` 段无 `icon`，项目只有 `icon.svg`（electron-builder 需 `.ico`） | 桌面版沿用 Electron 默认图标，玩家桌面上看不出是什么游戏，辨识度与观感都差 | 由 `icon.svg` 导出 256×256 多尺寸 `desktop/build/icon.ico`，在 `build` 段加 `"icon": "build/icon.ico"` |
| **M-06** | `desktop/package.json` 缺 `author` 字段（electron-builder 明确告警） | EXE 文件属性「发布者」为空，叠加无签名会加重 SmartScreen 警告 | 补 `"author": "…"`，与 `LICENSE` 版权主体保持一致 |

### 🟡 Minor（可发布后跟进）

| ID | 项 | 说明 |
|---|---|---|
| **C-01** | `assets/` 为空目录 | 打包脚本与 `desktop` 的 `extraResources` 均未包含 `assets/`。当前无影响（全程序化美术），但未来加真实资源时会漏打包 |
| **C-02** | Android `AndroidManifest.xml` 声明 `INTERNET` 权限 | 游戏全程离线，权限声明与「零联网」宣传不符。Play 上架时数据安全问卷会被追问。建议移除，或在商店隐私说明中解释（Capacitor 默认模板带入） |
| **C-03** | `manifest.webmanifest` 的 `name` / `description` 仅中文 | 英文用户 PWA 安装提示为中文。Web App Manifest 无内建多语言，需靠 `lang` 分发或接受现状 |
| **C-04** | `index.html` 硬编码 `lang="zh-CN"` | 切换到 EN 后 `document.documentElement.lang` 会被 JS 改正，但首屏 SEO / 屏幕阅读器仍读作中文 |
| **C-05** | 固定 960×720 逻辑分辨率 + CSS 拉伸 | 超宽屏 / 异形屏可能变形，商店截图需选标准比例。已列入二期重构 D9 |
| **C-06** | `sw.js` 的 `ASSETS` 预缓存清单未含 `assets/` | 与 C-01 同源，未来加资源需同步 |
| **C-07** | 无自动化测试与 CI 质量门 | 回归靠手测。已列入二期重构 D5，本次发布依赖 `itch-io-packaging.md` §5 的人工冒烟清单 |

---

## 3. 出包可构建性验证

### 3.1 Windows 桌面 EXE — ⚠️ 配置完好，本机因网络受限未能完成出包

**环境**

| 项 | 值 |
|---|---|
| Node.js | v22.22.2 ✅ |
| npm | 10.9.7 ✅ |
| electron（npm 包） | 31.7.7 ✅ 已安装 |
| electron-builder | 24.13.3 ✅ 已安装 |
| `desktop/node_modules` | 243 个包，但 **`node_modules/electron/dist/` 不存在、`path.txt` 为空** ❌ |

**配置审阅结论：完好，无需改动（除 B-01 版本号 + 下方 2 处小瑕疵）**

- `desktop/main.js` 逻辑正确：`resolveGameDir()` 先探 `process.resourcesPath/game/index.html`（打包态），回退到 `__dirname/..`（开发态），两种模式都能跑
- 安全配置到位：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` / `removeMenu()`
- 只 `loadFile()` 本地文件，无任何 `loadURL()` 远程加载 —— 与「零联网」宣传一致 ✅
- 产物名已是 ASCII（`dafeiji-portable.exe`），不会出现 Release 附件名乱码 ✅
- `extraResources` filter：`index.html` / `manifest.webmanifest` / `icon.svg` / `src/**/*`
  - ⚠️ 未含 `assets/`（当前空目录，无影响，见 C-01）
  - ✅ 未含 `sw.js` —— 这是对的，`file://` 下 SW 无法注册
- ⚠️ **`desktop/package.json` 缺 `author` 字段**，electron-builder 明确告警
  `• author is missed in the package.json`
  → 产出 EXE 的「发布者 / 公司」文件属性为空，配合无签名（M-02）会进一步加重 SmartScreen 警告。建议补 `"author": "…"`
- ⚠️ **`build` 段无 `icon` 配置** —— 项目只有 `icon.svg`，electron-builder 需要 `.ico`。当前 EXE 会使用 Electron 默认图标，商店/桌面辨识度受损（见新增 M-05）

**实际构建尝试（3 次，全部失败于同一环境原因）**

```bash
cd desktop && npm run dist
```

```
• electron-builder version=24.13.3 os=10.0.26200
• loaded configuration file=package.json ("build" field)      ← 配置解析 OK
• author is missed in the package.json                        ← 见上
• packaging platform=win32 arch=x64 electron=31.7.7           ← 目标解析 OK
• downloading url=…/electron-v31.7.7-win32-x64.zip size=111 MB
⨯ Get "https://github.com/electron/electron/releases/download/v31.7.7/electron-v31.7.7-win32-x64.zip":
  wsarecv: A connection attempt failed because the connected party did not properly respond…
⨯ ERR_ELECTRON_BUILDER_CANNOT_EXECUTE
```

二次尝试用 `--config.electronDist=node_modules/electron/dist` 绕过下载，同样失败：

```
⨯ ENOENT: no such file or directory, rename '…\dist\win-unpacked\electron.exe' -> '…\打飞机.exe'
```

**根因定位：环境问题，不是项目配置问题。**
`node_modules/electron/` 下没有 `dist/` 目录、`path.txt` 为空 —— 说明当初 `npm install` 时 electron 的 postinstall 二进制下载步骤未成功完成，本机 `desktop/node_modules` 处于**不完整状态**；而 electron-builder 现场补下载 111MB 二进制时又被网络阻断（本机到 `github.com` releases 连接超时）。

**判定：**
- 项目侧配置、主进程代码、打包 filter、产物命名 —— **全部通过静态审阅，无阻塞问题**
- 本机**无法**给出「已成功产出 EXE」的实证，此项验证状态为 **未验证（环境受限）**，不作为放行依据

**本机若需复现构建，两条路**

```bash
# 路线 1：修好 electron 二进制下载（推荐用国内镜像）
cd desktop
rm -rf node_modules
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm install
npm run dist

# 路线 2：手动放置二进制（离线环境）
# 下载 electron-v31.7.7-win32-x64.zip 与 SHASUMS256.txt
# 放入 %LOCALAPPDATA%\electron-builder\Cache\electron\ 后重跑 npm run dist
```

**CI 路径（首发实际依赖的路径）**：`.github/workflows/release.yml` 的 `windows` job 在 `windows-latest` 上 `npm install` → `npm run dist`，打 tag 时经 `softprops/action-gh-release@v2` 发布 `desktop/dist/*.exe`。GitHub runner 到 `github.com` 网络畅通，无本机的下载问题；且 README 记载此链路历史上已成功产出过 EXE（v1.0.0 / v1.0.1 的 Release 附件即由它产出）。

> ⚠️ **放行前必须做的一件事**：在 CI 上跑一次 `workflow_dispatch`，确认 `windows` job 绿灯并能下载到 EXE 产物，
> **再打 tag**。不要让「打 tag」成为第一次验证 —— tag 一旦推上去就会自动建 Release，失败要回滚很难看。

### 3.2 Android APK — ⚠️ 本机不可构建，走 CI 路径

**本机环境探测结果：不满足构建条件**

| 检查项 | 结果 | 说明 |
|---|---|---|
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | ❌ 均为空 | 未配置 |
| `%LOCALAPPDATA%\Android\Sdk` | ❌ 不存在 | 未安装 Android SDK |
| `android/local.properties` | ❌ 不存在 | 无 SDK 路径指向 |
| JDK | ❌ **1.8.0_31** | AGP 8.7.2 + Gradle 8.11.1 **要求 JDK 17+**，JDK 8 会直接构建失败 |

**结论：未执行本机 `./gradlew assembleRelease`。** 缺 SDK 且 JDK 版本不达标，强行执行只会得到与项目配置无关的环境错误，无诊断价值。按任务要求（非必须、不产签名包）跳过，改为配置静态审阅 + CI 路径核验。

**配置审阅结论：CI 构建链路完整，配置自洽**

| 项 | 值 | 评估 |
|---|---|---|
| AGP | 8.7.2 | ✅ 与 Gradle 8.11.1 兼容 |
| Gradle Wrapper | 8.11.1-all | ✅ |
| compileSdk / targetSdk | 35 / 35 | ✅ 满足 Play 2025 的 targetSdk 35 要求 |
| minSdk | 23 (Android 6.0) | ✅ 覆盖面充足 |
| `applicationId` | `com.dafeiji.game` | ✅ 与 `capacitor.config.json` `appId` 一致 |
| Capacitor | 7.x（core / android / cli） | ✅ |
| `webDir` | `www`（不入库，`scripts/sync-web.js` 生成） | ✅ CI 已在 `cap sync` 前先跑 sync-web |
| 自适应图标 | 已配（深空底 + 渐变战机） | ✅ |
| Splash | 各密度 png 齐全 | ✅ |
| `buildTypes.release` | `minifyEnabled false`，**未配 `signingConfig`** | ❌ 见 B-03 |

**CI 路径核验**（`.github/workflows/release.yml` `android` job）

```
checkout → setup-node 20 → setup-java 17(temurin) → npm ci
        → node scripts/sync-web.js → npx cap sync android
        → gradle/actions/setup-gradle@v4
        → ./gradlew assembleDebug     ← ⚠️ debug，不是 release
        → 上传 app-debug.apk
```

链路本身健康（历史上三次 CI 修复已让它跑通），但**产物是 debug APK**。

**若要正式分发 APK，需补的工作（B-03 方案 B）**

1. 生成 upload keystore：
   ```bash
   keytool -genkeypair -v -keystore dafeiji-release.jks -keyalg RSA \
           -keysize 2048 -validity 10000 -alias dafeiji
   ```
2. keystore base64 后存入 GitHub Secrets：`ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`
3. `android/app/build.gradle` 增加 `signingConfigs.release` 并在 `buildTypes.release` 中引用
4. CI 把 `assembleDebug` 改为 `assembleRelease`（tag 触发时），并在 job 中还原 keystore 文件
5. **keystore 必须离线备份**——丢失将导致该 `applicationId` 永远无法在 Play 上架更新
6. `.gitignore` 追加 `*.jks` / `*.keystore` / `keystore.properties`，严防密钥入库

### 3.3 Web (itch.io) — ✅ 无构建器，静态直传

打包与上传流程见 `docs/release/itch-io-packaging.md`。零构建，主要风险在 SW 缓存（B-02）与 zip 目录层级。

---

## 4. 本地化就绪度

### 4.1 覆盖率

| 层级 | 覆盖率 | 结论 |
|---|---|---|
| DOM UI 层（`index.html` `data-i18n`） | **57 / 57 键** | ✅ 100% |
| i18n 字典键对等（zh vs en） | **62 / 62** | ✅ 完全对等，零缺键、零冗余键 |
| 字典键 vs HTML 引用 | 无缺失 | ✅ HTML 用到的键字典全都有 |
| **Canvas / JS 硬编码文案** | **0 / 19** | ❌ **完全未覆盖** |
| PWA manifest | 仅中文 | ⚠️ C-03 |
| Android `strings.xml` | 仅中文（`app_name` = 打飞机） | ⚠️ 无 `values-en/` |
| 桌面窗口标题 | 仅中文 | ⚠️ |

### 4.2 未本地化字符串清单（M-01）

| 位置 | 内容 | 数量 |
|---|---|---|
| `src/game.js:198-201` | 4 个关卡名（近地轨道 / 陨石带 / 电离层 / 深空要塞） | 4 |
| `src/game.js:198-201` | 4 个 Boss 名（哨戒机甲 / 采矿巨蝎 / 雷云母舰 / 歼灭核心） | 4 |
| `src/game.js:183` | 排行榜条目 `第N关` | 1 |
| `src/game.js:860` | Canvas 横幅 `BOSS 来袭！` / `第 N 波` | 2 |
| `src/game.js:932` | 音效按钮 `音效 开` / `音效 关` | 2 |
| `src/core.js:51-56` | 6 个内置皮肤预设名 | 6 |
| | **合计** | **19** |

> 英文译名已备好，见 `docs/release/store-copy.md` 末尾「英文译名对照表」。
> 落地方式：把这 19 条加进 `src/main.js` 的 `I18N` 字典，调用点改为查表。属游戏代码改动，需 eng 执行。

### 4.3 字符串冻结

- 商店页文案（`store-copy.md`）**待用户审批**，批准后即进入冻结
- 游戏内 62 组 i18n 文案本次不改动，视为已冻结
- 若采纳 M-01 补齐 19 条，需在冻结前完成，**不接受冻结后追加**（热修除外）

---

## 5. 跨部门发布清单

### 5.1 代码 · Code（owner: eng）

- [x] B-01 三处版本号对齐至 1.2.0 / versionCode 3（✅ 2026-07-31 回写，见 §1.3）
- [ ] B-02 `sw.js` `CACHE` → `djfe-v1.2.0`（src/*.js，转 eng 处理）
- [x] **B-05 `.gitignore` 第 5 行 `release/` → `/release/`**（✅ 2026-07-31 回写；docs/release/ 不再被吞）
- [ ] B-04 固定时间步长（D8，eng Task #3 已落地）→ 待 QA S16 在 120/144Hz 复测位移比 ≈1.0 后降级
- [ ] M-07 通关结算显示本局得分而非历史最高分
- [ ] M-08 暂停冻结限时增益
- [ ] M-03 补 `<meta name="description">` + OG / Twitter Card
- [ ] M-04 菜单页显示版本号 `v1.2.0`
- [ ] M-05 由 `icon.svg` 导出 `desktop/build/icon.ico` 并在 `build` 段配置 `icon`
- [ ] M-06 `desktop/package.json` 补 `author` 字段
- [ ] （可选 M-01）19 条硬编码字符串接入 i18n
- [ ] （可选 C-02）移除 Android `INTERNET` 权限
- [ ] 本地 `python -m http.server` 跑一遍，控制台 **0 error / 0 warning**

### 5.2 内容 · Content（owner: 内容 / 质量）

- [ ] 4 关战役完整通关一次，无卡关、无 NaN、无穿模
- [ ] 三档难度各开局一次，初始炸弹数正确
- [ ] 4 个 Boss 全部击杀验证（含多阶段弹幕切换）
- [ ] 8 种敌机全部出现验证（`spinner`/`diver` 需 stage ≥ 2，`sniper` ≥ 3，`splitter` ≥ 4）
- [ ] 火力 5 级全部吃到，战机外形逐级变形
- [ ] 连击倍率上限 ×4.0 验证，受击清零验证
- [ ] 皮肤：6 款预设切换 + 自定义新建 / 删除 / 刷新后持久化
- [ ] 排行榜写入与展示正确

### 5.3 测试 · QA（owner: quality — 需协同）

- [x] **无头冒烟套件已就位**：`node tests/run-smoke.js` —— 122/122 质量门 PASS，0 异常 / 0 NaN / 0 console 错误（详见 `docs/qa/smoke-test-plan.md`）✅
- [ ] **每次代码改动后重跑** `node tests/run-smoke.js`，保持 122/122
- [ ] **发布前必跑四柱验证**：`node tools/verify.js all` —— **退出码非 0 即拦截发布**（脚本末行 `process.exit(ok ? 0 : 1)`；不带参数时默认等价于 `all`）。这是冒烟套件之外的**第二道自动门**，由 eng 在 TASK-EL-01 收尾时确认接入，quality 2026-07-31 转达

四柱的门控语义**并不相同**，红灯时按下表判读，不要一律当成「必须修」：

| 柱 | 命令 | 断言 | 门控语义 |
|---|---|---|---|
| **parity** | `verify.js parity` | `tools/.baseline/` 快照 vs 当前 `src/`，18 组用例（5 档恒定 rand × survivor/mortal + 4 组种子 PRNG）**逐帧全量状态比对**，要求行为零变化 | 🟡 **条件门**。仅当本批改动**声称是行为中性的重构**时必须绿。M-07 / M-08 这类**有意的玩法修复**会让它按设计变红 —— 那时不是「修 bug」，而是走下方「基线重锚」流程 |
| **refresh** | `verify.js refresh` | 30 / 60 / 72 / 120 / 144 / 240Hz 六档：逻辑步数区间 ≤ 2 且与 60Hz **逐字节同态** | 🔴 **硬门，必须绿**。这就是 B-04 的自动守门人（即 quality 所说的「S16 六档 GATE」），红灯直接 no-go |
| **alloc** | `verify.js alloc` | 热循环新建数组归零 + 各池 `grown = 0` 且水位 ≤ 85%（含 5 种子 × 300s hard 长局压力） | 🟠 **性能回归门**。红灯不必然拦发布，但需 eng 出结论；池扩容告警意味着长局会掉帧 |
| **gc** | `verify.js gc` | 子进程 `--trace-gc` 跑 3 轮取中位数，要求垃圾总量 ≤ 基线 × 1.02 | 🟠 **性能回归门**。判定本身已放宽，仍红说明分配面确实变差 |

**运行前提与注意事项**（写明白，免得这道门形同虚设）：

- **前提：`tools/.baseline/` 必须在位**（改动前的 `src` 快照，2026-07-31 已核实存在）。基线一旦丢失或被误删，`parity` / `alloc` / `gc` 三柱同时失去参照，脚本会**直接报错而不是判绿**——**不要把报错读成通过**，退出码非 0 一律拦截。
- **基线重锚流程**（有意的行为改动落地时）：① 先在旧基线上跑一次 `all` 并留存报告 → ② eng 书面说明改动点与预期差异 → ③ 主理人确认后，把当前 `src/` 重新快照进 `tools/.baseline/` → ④ 重跑 `all` 应全绿。**禁止**以「反正是有意改的」为由略过 parity 红灯而不重锚，否则下一次真回归时无人能发现。
- **不随游戏发布**：`tools/` 与 `tests/` 均为开发工具（`verify.js` / `headless-harness.js` 头部已自述「开发工具，不随游戏发布」），只用于 CI 与本地门控，**必须排除在上传物之外**——已同步补进 `itch-io-packaging.md` §1.2 排除清单。特别注意 `tools/.baseline/` 是一份**完整的 `src` 副本**，误打包会让 zip 体积翻倍并泄露改动前源码。
- **不是逐提交门**：`all` 要跑满 18 组 parity 用例（单例最长 180s 模拟）+ 六档刷新率双跑 + 5 种子 × 300s 池压力 + 3 轮 GC 子进程，耗时远高于冒烟套件。定位是**发版前 / 重构后**执行；逐提交仍用 `node tests/run-smoke.js`。
- 若接入 CI，建议挂在 `workflow_dispatch` 与 tag 触发上，**不要挂 push**，否则每次推送都要等一轮重负载模拟。

- [ ] B-04 / M-07 / M-08 修复后，对应 PROBE（S16 / S15 / S6）升级为 GATE，防止静默回归
- [ ] `itch-io-packaging.md` §5 冒烟清单全过
- [ ] 浏览器矩阵：Chrome / Edge / Firefox / Safari（至少前三）
- [ ] 设备矩阵：桌面（鼠标）/ 笔记本（触摸板）/ Android 手机（触屏）
- [ ] `file://` 双击 `index.html` 仍可玩（**核心红线，每次发版必测**）
- [ ] 离线可玩验证（PWA 装载后断网）
- [ ] EXE 在干净 Windows 上运行（无 Node / 无 Electron 环境）
- [ ] **高刷屏（120/144Hz）实机验证** —— B-04 修复后必测，位移速度应与 60Hz 一致。**这是 §2.2 B-04 降级触发条件之 2**；`verify.js refresh` 是无头沙箱验证，替代不了真机（vsync 抖动 / 后台降频 / `MAX_CATCHUP` 追帧手感）

### 5.4 商店 · Store（owner: release-ops）

- [ ] itch.io 项目创建，slug 确定
- [ ] 商店文案填入（`store-copy.md`，**待用户批准**）
- [ ] Embed 设置：960×720 / 全屏按钮开 / 滚动条关 / 移动友好开 / **自动启动关** / 背景 `#05060f`
- [ ] 封面图 630×500（必需）
- [ ] 截图 ≥ 4 张（建议：菜单页 / 弹幕高峰 / Boss 战 / 皮肤编辑器）
- [ ] GIF 动图 1 张（展示"指哪打哪"操控 —— 这是转化率最高的素材）
- [ ] 标签 ≤ 10 个（`store-copy.md` 已给）
- [ ] 定价：免费 + 打赏（建议 $2）
- [ ] Windows EXE 作为附加下载挂载，**并标注无签名说明（M-02）**
- [ ] Android APK **首发不挂**（B-03）

### 5.5 法务与合规 · Legal（owner: release-ops）

- [x] 许可证：MIT，`LICENSE` 在库 ✅
- [x] 美术 / 音频版权：全程序化生成，零第三方素材 ✅
- [x] 字体：未引入第三方字体，用系统字体栈 ✅
- [x] 隐私：零联网、零采集、无 SDK ✅（唯一瑕疵是 C-02 的 `INTERNET` 权限声明）
- [ ] itch.io 页面加一句隐私声明：「本游戏不联网、不收集任何数据，所有进度保存在你的设备本地」
- [ ] ⚠️ **名称风险**：「打飞机」在中文语境有俚语歧义且属通用词，难做品牌资产。Demo 阶段可接受；**Steam / 商用版建议启用独立品牌名**（见 `commercialization-refactor-plan.md` §7.5）
- [ ] 国内发行（若考虑）需软著 + 版号 —— 本次仅发 itch.io（海外），不触发

### 5.6 社区 · Community（owner: release-ops）

- [ ] itch.io Community 版块开启评论
- [ ] 首发 Devlog 撰写（取 `CHANGELOG.md` 的 `[1.2.0]` 改写为玩家语言）
- [ ] 反馈收集口径：itch 评论 + GitHub Issues
- [ ] 危机沟通预案：若出现进不去游戏 / 存档丢失，24h 内发 Devlog 说明 + 热修（见 §7）

### 5.7 发布执行 · Release（owner: release-ops，**需用户逐项审批**）

- [ ] 所有 Blocker 已清
- [ ] **两道自动门同时绿灯**：`node tests/run-smoke.js`（122/122）+ `node tools/verify.js all`（退出码 0）。**任一非 0 即停止发布流程**，判读规则见 §5.3
- [ ] **先跑 `workflow_dispatch` 空转一次**，确认 `windows` job 产出 EXE 可下载可运行（§3.1 要求；本机未能验证出包，不能让打 tag 成为第一次验证）
- [ ] `git tag v1.2.0` 并 push（**触发 CI 自动发 Release，高影响动作，需人工审批**）
- [ ] CI 双端构建绿灯
- [ ] itch.io 上传（butler 或浏览器直传）
- [ ] 线上冒烟（`itch-io-packaging.md` §5）
- [ ] 页面从 Draft 切 Public（**最终 go 决策点，需用户点头**）

---

## 6. go / no-go 决策记录

| 轮次 | 日期 | 判定 | 决策人 | 备注 |
|---|---|---|---|---|
| 预审 | 2026-07-29 | 🟡 CONDITIONAL GO（Web + EXE）/ 🔴 NO-GO（APK） | release-ops | 待清 B-01 / B-02 / **B-04**；APK 因 B-03 延期。B-04 处置方案需用户拍板（§2.1） |
| 复审 | 2026-07-31 | 🟡 CONDITIONAL GO（Web + EXE，B-01/B-05 已回写）/ 🔴 NO-GO（APK） | release-ops | B-01 ✅回写、B-05 ✅回写；B-04 → RESOLVING（eng D8 已落地，待 QA S16）；B-02 转 eng（src/*.js）；APK 仍 B-03 延期 |
| 三审 | 2026-07-31 | 🟡 CONDITIONAL GO（Web + EXE）/ 🔴 NO-GO（APK）**判定不变** | release-ops | 本轮只动清单不动判定：①§5.3 接入 `node tools/verify.js all` 四柱门（`refresh` 定为 🔴 硬门，`parity` 为条件门并配基线重锚流程）②§5.7 增「两道自动门齐绿」为放行前置 ③`itch-io-packaging.md` §1.2 补排除 `tools/` 与 `tests/`（`tools/.baseline/` 是 `src` 完整副本，误打包会泄露改动前源码）④§2.2 记录 quality 的 B-04 降级提案与触发条件，**未据此改判** |
| 终审 | — | — | 主理人 | Blocker 全清 + `verify.js all` 绿灯 + B-04 降级触发条件（§2.2）满足后填写 |

---

## 7. 回滚与热修预案

### 7.1 回滚

| 平台 | 回滚方式 | 生效时间 | 备注 |
|---|---|---|---|
| **itch.io Web** | Uploads 页删除 v1.2.0 zip，重新上传上一版；或直接把项目切回 Draft | 立即 | 用 butler 的话：`butler push` 上一版目录并复用同 channel |
| **Windows EXE** | GitHub Release 页删除 v1.2.0 附件；或把 Release 标记 pre-release | 立即（已下载的用户不受影响） | 无自动更新机制，无法强制回收 |
| **Android APK** | 不适用（首发不上架） | — | — |
| **git tag** | `git tag -d v1.2.0 && git push origin :refs/tags/v1.2.0` | 立即 | ⚠️ 会删掉对应 GitHub Release，**仅在发布后 1 小时内、确认无人下载时使用** |

**回滚触发条件（任一即触发）**：游戏无法启动 / 首关无法通过 / 玩家存档被清空 / 出现法律或版权投诉。

### 7.2 热修流程（简化但保留完整审计）

```
1. 确认问题可复现 + 影响面（多少玩家 / 是否阻断游玩）
2. release-ops 记录事故条目（时间 / 现象 / 影响 / 复现步骤）
3. eng 出最小修复补丁 —— 只改必要行，不夹带任何其他改动
4. quality 单点验证 + itch-io-packaging.md §5 冒烟清单（不跑完整回归）
5. 版本号 patch 递进：1.2.0 → 1.2.1（package.json + sw.js CACHE + android/desktop 同步）
6. 用户审批（热修同样需人工放行）
7. 发布 + 线上验证
8. 补写 CHANGELOG [1.2.1] 与 itch.io Devlog 说明
```

**热修红线**：
- 字符串冻结后只有热修可改字符串，且必须在 CHANGELOG 记录
- 热修**必须**同步递增 `sw.js` 的 `CACHE`，否则玩家永远拿不到修复
- 热修不得夹带新功能

---

## 8. 发布后监测（首周）

| 指标 | 来源 | 关注点 |
|---|---|---|
| 页面浏览 / 试玩数 / 试玩转化率 | itch.io Analytics | 转化率 < 20% → 封面图或 GIF 不够抓人 |
| 平均游玩时长 | itch.io Analytics | < 2 分钟 → 开局劝退，查首关难度或加载问题 |
| 评论关键词 | itch.io Community | **重点看是否有人主动提「操控舒服 / 好上手」——这是核心卖点成立与否的验证信号** |
| 崩溃 / 卡死反馈 | 评论 + GitHub Issues | 出现即评估是否走热修 |
| EXE 下载量 vs Web 试玩量 | itch.io | 判断桌面版是否值得继续投入 |
| 中英玩家比例 | 评论语言 | 决定 M-01 本地化补齐的优先级 |

> 项目**无内置埋点**（首发零采集是刻意的隐私设计），以上全靠平台侧数据 + 定性反馈。
> 若二期需要漏斗数据，按 `commercialization-refactor-plan.md` §6 接可关闭的自建埋点，并同步补隐私政策。

---

## 附录 A · 本次核查执行记录

| 核查项 | 方法 | 结果 |
|---|---|---|
| git 历史 | `git log --pretty` (18 commits, 2026-07-21 ~ 07-29) | 已用于生成 CHANGELOG |
| 已有 tag | `git tag` | **`v1.0.0`、`v1.0.1` 已存在** → 决定版本号走向 |
| 工作区状态 | `git status --short` | 干净（本次改动前） |
| 版本号一致性 | 逐文件读取 | 发现三处漂移 → B-01 |
| i18n 覆盖率 | 提取 `data-i18n` 属性与 `I18N` 字典键做 `comm` 差集 | 57/57 HTML 键覆盖，zh/en 62 键完全对等 |
| 硬编码字符串 | `grep -P "[\x{4e00}-\x{9fa5}]"` 扫 `src/*.js` | 19 处玩家可见 → M-01 |
| 桌面构建链 | 读 `desktop/package.json` / `main.js`，探测 Node / Electron / builder 版本，**实际执行 `npm run dist` 共 3 次** | 配置与代码审阅通过；构建失败于 electron 二进制下载（本机网络到 github.com releases 超时，且 `node_modules/electron/dist` 缺失）→ **环境问题，非项目问题**，详见 §3.1。附带发现 M-05（无 .ico）、M-06（缺 author） |
| 安卓构建链 | 探测 `ANDROID_HOME` / SDK 目录 / `local.properties` / `java -version`；审阅 AGP / Gradle / manifest / build.gradle | 本机不可构建（无 SDK + JDK 8）；CI 链路完整但只产 debug → B-03 |
| CI 工作流 | 读 `.github/workflows/release.yml` | 双端链路完整，tag 触发发 Release |
| 合规 | 读 `LICENSE` / manifest / AndroidManifest / 检查素材来源 | MIT + 全程序化素材，仅 `INTERNET` 权限瑕疵 |
| QA 交叉引用 | 读 quality 产出的 `docs/qa/smoke-test-plan.md` + `tests/` | 冒烟 122/122 PASS ✅；采纳其 3 个实测缺陷进入门控：BUG-03 → **B-04（Blocker）**、BUG-01 → M-07、BUG-02 → M-08 |
