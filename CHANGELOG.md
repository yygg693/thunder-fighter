# Changelog

本文件记录「打飞机 · Fighter Shooter」的所有值得注意的变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 SemVer 2.0.0](https://semver.org/lang/zh-CN/)。

> **版本基线说明**
> `v1.0.0` / `v1.0.1` 是 2026-07-21 打在仓库上的**内部预公开构建**（仅产出 Windows EXE，未做商店发行）。
> 首个面向公众的发行版本是 **`v1.2.0`（itch.io Demo 首发）**。
> 中间的 `1.1.0` 只是 `android/app/build.gradle` 里的一次版本戳（commit `a8edfaf`），未打 tag、未公开发行；
> 其后又合入了两个 `feat` 提交（UI 全面升级、玩法大拓展），按 SemVer 需要再次 minor 递进，故公开首发定为 `1.2.0`。

---

## [Unreleased]

### 待办（发布前需处理，见 `docs/release/release-readiness.md`）

**🔴 阻塞级**

- **fix(perf)**：帧率耦合 —— 120/144Hz 屏上游戏整体加速 **2.4 倍**（quality 实测量化，`docs/qa/smoke-test-plan.md` BUG-03）。~~建议先上 60Hz 帧率封顶的最小修复~~ → 🟡 **RESOLVING**：eng 已直接落地 **D8 固定时间步长 + 渲染外插**（比封顶更彻底），待 `verify.js refresh` 绿灯留档 + 高刷真机点验后关闭，见 `docs/release/release-readiness.md` §2.2
- **fix(ui)**：通关结算把「本局得分」显示成「历史最高分」（`game.js` `victory()` 222–227 行，BUG-01）
- **fix(game)**：暂停不冻结护盾 / 无敌 / 连击等限时增益，暂停期间时间照走（BUG-02）

**🟠 版本与发布**

- ~~**fix(repo)**：`.gitignore` 第 5 行 `release/` 会匹配任意层级同名目录，导致 `docs/release/` 下的发布文档被静默忽略、无法入库 → 改为 `/release/`~~ ✅ **已应用（2026-07-31，B-05）**

- ~~**chore(version)**：`android/app/build.gradle` 的 `versionName` 需由 `1.1.0` → `1.2.0`，`versionCode` 由 `2` → `3`~~ ✅ **已应用（2026-07-31，B-01）**
- ~~**chore(version)**：`desktop/package.json` 的 `version` 需由 `1.0.0` → `1.2.0`~~ ✅ **已应用（2026-07-31，B-01）**
- ~~**chore(pwa)**：`sw.js` 的 `CACHE` 常量需由 `djfe-v1` → `djfe-v1.2.0`~~ ✅ **已应用（2026-07-31，B-02，三处副本全覆盖）** —— 详见 `[1.2.0]` 的「Release Engineering」段
- **fix(sw)**：`sw.js` 的 `ASSETS` 预缓存清单未包含 `index.html` 之外的图标变体，离线首屏可用性待复核
- **i18n**：19 处玩家可见字符串仍是中文硬编码（关卡名 / Boss 名 / 波次横幅 / 皮肤预设名 / 音效按钮），英文玩家会看到中英混排
- **chore(android)**：`AndroidManifest.xml` 声明了 `INTERNET` 权限但游戏全程离线，建议移除或在商店隐私说明中解释
- **chore(desktop)**：`desktop/package.json` 缺 `author` 字段；`build` 段无 `icon`（缺 `.ico`，EXE 现用 Electron 默认图标）
- **chore(ci)**：安卓 CI 仅 `assembleDebug`，未配 release 签名 —— APK 暂不具备公开分发条件

### Added（未发布）

- **test**：零依赖无头冒烟测试套件 `tests/`（`node tests/run-smoke.js`，122 条质量门 + 3 条缺陷探针），补上重构文档 D5 的测试债务底座 — by quality

---

## [1.2.0] - 2026-07-29 — 首个公开发布（itch.io Demo）

首次面向公众发行。平台：Web（itch.io）+ Windows 便携版 EXE + Android APK。

### Added · 新增

**玩法核心**

- **触摸板绝对定位操控**：手指在触摸板/鼠标的位置直接映射为战机位置，"指哪打哪"，配插值平滑；键盘 WASD / 方向键作为辅助操控
- **自动开火**：解放一只手，玩家专注走位闪避；点击画布 = 释放炸弹清屏
- **4 关战役系统**：近地轨道 → 陨石带 → 电离层 → 深空要塞，各关独立配色主题、难度曲线与通关演出
- **4 个关底 Boss**：哨戒机甲 / 采矿巨蝎 / 雷云母舰 / 歼灭核心，多阶段血量、三种弹幕模式循环（扇形 7 发 / 螺旋双向 / 瞄准 3 连发）、专属血条与登场横幅
- **8 种敌机机型**：直冲 `straight`、蛇行 `weaver`、射击 `shooter`、精英 `elite`、回旋 `spinner`、俯冲 `diver`、狙击 `sniper`、分裂 `splitter`；后四种随关卡进度解锁，分裂型死亡再产出 3 架小无人机
- **弹幕 4 型差异化**：不同敌机使用不同弹型与弹速，狙击弹独立高速渲染
- **连击倍率系统**：3 秒内连续击杀累加连击，得分倍率最高 ×4.0，受击清空；HUD 实时显示，结算展示最高连击
- **火力 5 级变形**：单发 → 双发 → 三向 → 五向 → 五向扇形，玩家机外形随火力等级变形
- **道具成长**：火力 `P` / 护盾 `S`（8 秒免伤 + 撞击反伤）/ 炸弹 `B` / 生命 `L`（稀有）；精英必掉，普通按概率掉
- **波次调度**：数量随波次增长（5 + 1.6n），敌机血量 / 速度 / 生成间隔随波次爬升，清波奖励 `wave × 100`
- **三档难度**：简单 / 普通 / 困难，含不同初始炸弹数

**表现层**

- **程序化音效**（Web Audio 合成，零音频文件）：开火 / 爆炸 / 受击 / 道具 / 炸弹 / Boss 登场 / 坠机
- **自适应 BGM**：程序化生成，双总线混音（音乐 / 音效独立音量），随战况变化
- **美术升级**：能量束弹、加法混合粒子拖尾、星球背景 + 暗角、六边形护盾环、能量翼、Boss 能量冠 + 追踪眼 + 充能预告、史诗级 Boss 死亡演出
- **打击感特效**：屏幕震动（0.88 衰减）、敌机受击闪白、冲击波扩散环、机首开火火光、粒子带重力下坠
- **前端 UI 全面升级**：浮层卡片化、入场动效、霓虹渐变分色标题 + 呼吸辉光、ARCADE 徽章、玻璃拟态菜单卡片、按钮流光扫过、大号分数、Boss 血条美化

**系统与内容**

- **皮肤 Mod 系统**：6 款内置预设（苍蓝骑士 / 烈焰红隼 / 翡翠游隼 / 紫电惊鸿 / 暗夜幽灵 / 黄金圣翼）+ 自由设计编辑器（机身 / 描边 / 尾焰 / 机翼 / 弹道 / 4 种涂装图案），实时预览、本地持久化
- **本地排行榜**：记录得分与到达关卡，localStorage 持久化
- **设置菜单**：音乐 / 音效音量、触摸板灵敏度、全屏切换、语言切换
- **中英双语 i18n**：62 组文案键，DOM UI 层 100% 覆盖，语言选择本地持久化
- **状态机流程**：menu → playing → paused → gameover / victory，ESC 暂停

**平台与工程**

- **PWA**：`manifest.webmanifest` + `sw.js`，`http(s)` 部署下可安装、可离线；`file://` 下由协议守卫自动跳过，不影响双击即玩
- **移动端触屏适配**：屏幕拖动操控 + 右下角 💣 炸弹按钮 + 右上角 ⏸ 暂停按钮
- **Android APK**：Capacitor 7 工程（`android/`），`applicationId` = `com.dafeiji.game`，minSdk 23 / targetSdk 35，战机主题自适应图标（深空底 + 渐变战机）
- **Windows 桌面版**：Electron 套壳（`desktop/`），产出单文件便携版 `dafeiji-portable.exe`，仅加载本地 `index.html`，零网络请求
- **CI 双端构建**：`.github/workflows/release.yml`，push `main` 出 Actions 产物，打 `v*` tag 自动发布 EXE + APK 到 GitHub Releases
- **Web 资产同步脚本**：`scripts/sync-web.js` 把根目录 Web 资产同步进 Capacitor `webDir`（`www/`）

### Changed · 变更

- **架构模块化**：单文件拆分为 `core.js`（基础设施）/ `entities.js`（纯绘制）/ `game.js`（状态机与主循环）/ `main.js`（启动层），经由 `window.DJFE` 全局命名空间共享
- 开火节奏随波次加速（`shootInterval` 从 150ms 逐步降至 95ms）
- 敌机种类概率随 `score` + `wave` 动态变化，越往后机型越丰富
- 桌面版产物名改为 ASCII（`dafeiji-portable.exe`），避免 GitHub Release 附件名乱码

### Fixed · 修复

- **漏怪不再扣命**：原设计漏怪扣血过于硬核，与「零上手门槛」定位冲突，改为只扣分不扣命
- 敌弹改为三层高可见度绘制（外晕 + 橙红环 + 白热核心），解决暗色背景下敌弹看不清
- 背景星球移出菜单区域并减弱暗角、显式设置 `z-index`，避免星球被误认为可点按钮、菜单点不动
- 战机受击闪烁无敌帧，防止一次碰撞连续掉血
- CI：安卓构建前先执行 `sync-web.js` 生成 `www/`（`webDir` 不入库，`cap sync` 依赖它）
- CI：显式安装 android-35 平台与 build-tools（runner 镜像可能只带 SDK 36）
- CI：改用 `gradle/actions/setup-gradle@v4` 管理 wrapper 与缓存，构建失败时把错误行注入 GitHub annotations 便于诊断

### Release Engineering · 发布工程

- **fix(pwa)**：**B-02 已应用** —— 三处 Service Worker 副本（根目录 `sw.js`、`www/sw.js`、Android 资产 `android/app/src/main/assets/public/sw.js`）的 `CACHE` 常量统一由 `djfe-v1` 改为 **`djfe-v1.2.0`**，强制老访客缓存失效，否则刷新后仍命中旧版本且极难自查
- **chore(build)**：**发布产物已同步** —— `www/` 由 `src/` 重新生成，确保 Web + EXE 发布物包含 **D8 固定时间步长**与 **D4 对象池**修复。已逐文件字节校验：`index.html` / `sw.js` / `manifest.webmanifest` / `src/{core,entities,game,main}.js` 七项与根目录**逐字节一致**（`game.js` 均为 55766 字节），同步完整无遗漏
- **chore(android)**：Android 资产副本**代码仍为旧版**（`game.js` 31290 字节、`entities.js` / `index.html` / `main.js` 同样滞后），未随本次同步刷新。因首发 **Android NO-GO**（B-03 签名缺失）不影响本轮发布，**延至 v1.2.1**
  - ⚠️ **v1.2.1 必查**：该副本的 `sw.js` 已是 `djfe-v1.2.0`，但其打包的游戏代码是旧版 —— 即**用 1.2.0 的缓存键盖住了 1.1 时代的代码**。若在此状态下出包，SW 会把旧代码长期锁死在「1.2.0」这个键下，日后真正的 1.2.0 修复反而无法令其失效，等于在 Android 侧复现一次 B-02。**v1.2.1 必须先跑 `node scripts/sync-web.js` + `cap sync` 再出包**

### Security · 安全与隐私

- 首发版本**零联网、零数据采集**：无统计 SDK、无广告 SDK、无账号体系，全部数据存于本地 `localStorage`
- 桌面版只加载本地 `file://` 资源，无外部代码执行
- 全部美术与音频均为程序化生成，无第三方素材版权风险

---

## [1.0.1] - 2026-07-21 — 内部预公开构建

### Fixed

- 桌面版产物名改为 ASCII，避免 GitHub Release 附件名乱码

## [1.0.0] - 2026-07-21 — 内部预公开构建

### Added

- 「打飞机 · Fighter Shooter」完整源码：触摸板绝对定位操控、自动开火、敌机生成、波次、Boss、道具、粒子爆炸、程序化音效、开始 / 暂停 / 结算界面、本地最高分
- Electron 桌面套壳与 GitHub Actions CI（打 tag 自动构建并发布 EXE 到 Releases）

---

[Unreleased]: https://github.com/OWNER/thunder-fighter/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/OWNER/thunder-fighter/compare/v1.0.1...v1.2.0
[1.0.1]: https://github.com/OWNER/thunder-fighter/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/OWNER/thunder-fighter/releases/tag/v1.0.0
