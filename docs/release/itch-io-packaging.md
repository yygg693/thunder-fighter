# itch.io 上架打包清单

> 适用版本：**v1.2.0**（首个公开发布 / Demo 试水）
> 项目形态：无构建器的静态站点（纯 HTML5 Canvas + 原生 JS，`window.DJFE` 命名空间）
> 红线：**任何打包步骤都不得破坏「双击 `index.html` 即玩」的能力**

---

## 0. TL;DR

本项目没有构建器，**上传物 = 仓库里的 Web 文件本身**。打包 = 把 6 个条目压成一个 zip：

```
index.html  manifest.webmanifest  sw.js  icon.svg  src/  assets/
```

zip 内 **`index.html` 必须在根层级**（不能多套一层目录），否则 itch.io 找不到入口。

---

## 1. 上传物清单

### 1.1 必须包含

| 条目 | 说明 | 必需 |
|---|---|---|
| `index.html` | 游戏入口，全屏 canvas + HUD + 顺序加载 4 个脚本 | ✅ |
| `src/core.js` | 画布 / 最高分 / 碰撞 / 程序化音频 / 输入 / 皮肤预设 | ✅ |
| `src/entities.js` | 玩家 / 敌机 / Boss / 道具的纯绘制 | ✅ |
| `src/game.js` | 状态机 / 波次 / Boss / 碰撞 / 主循环 | ✅ |
| `src/main.js` | 启动层 + i18n 字典（zh/en 62 键） | ✅ |
| `manifest.webmanifest` | PWA 清单（itch.io 是 https，会生效） | ✅ |
| `sw.js` | Service Worker，离线可玩 | ✅ |
| `icon.svg` | PWA 图标（矢量，零二进制依赖） | ✅ |
| `assets/` | 当前为空目录，保留占位；若为空可省略 | ⬜ |

### 1.2 必须排除（否则 zip 体积暴涨、且暴露源码结构）

```
node_modules/    desktop/        android/       www/
.git/            .github/        scripts/
tools/           tests/
package.json     package-lock.json
plan.md          docs/           capacitor.config.json
```

> `www/` 是 Capacitor 的 `webDir`，由 `scripts/sync-web.js` 生成，内容与上传物几乎相同但**不含 `assets/`**，不要拿它当上传物。
>
> ⚠️ **`tools/` 与 `tests/` 于 2026-07-31 补入本清单**。二者是开发期门控工具（`tools/verify.js`、`tools/headless-harness.js`、`tests/run-smoke.js`，脚本头部均自述「不随游戏发布」），玩家侧零用途。
> 其中 **`tools/.baseline/` 是改动前 `src` 的完整快照** —— 一旦误打包，zip 体积翻倍，且把重构前的源码一并公开。
> 原清单两者「既不在必须包含、也不在必须排除」，属于会被逐字执行的人踩中的空档，故显式补齐。
> §2.1 的手工 zip 命令用的是**白名单**（只压 §1.1 列出的条目），本身不受影响；但用 butler 直推目录（§2.2）或自写脚本时，必须依赖本排除清单。

### 1.3 建议附带

- `LICENSE`（MIT，itch.io 页面 credits 可引用）
- 不要把 `CHANGELOG.md` 塞进 zip，改为贴到 itch.io 的 devlog

---

## 2. 打包步骤

### 2.1 方式 A：手工 zip（首发推荐，零依赖）

在**仓库根目录**执行（Git Bash / PowerShell 皆可）：

```bash
cd /d/MyGame/thunder-fighter

# 清理旧包
rm -f dafeiji-web-v1.2.0.zip

# 打包（注意：不带顶层目录）
zip -r dafeiji-web-v1.2.0.zip \
  index.html manifest.webmanifest sw.js icon.svg src assets \
  -x "*.DS_Store" "*Thumbs.db"
```

PowerShell 等价写法：

```powershell
Compress-Archive -Path index.html,manifest.webmanifest,sw.js,icon.svg,src,assets `
                 -DestinationPath dafeiji-web-v1.2.0.zip -Force
```

**验证 zip 结构**（`index.html` 必须在第一层）：

```bash
unzip -l dafeiji-web-v1.2.0.zip | head -20
# 期望看到 index.html 而不是 thunder-fighter/index.html
```

**本地验收**（务必做，别直接传）：

```bash
mkdir -p /tmp/itchcheck && unzip -o dafeiji-web-v1.2.0.zip -d /tmp/itchcheck
cd /tmp/itchcheck && python -m http.server 8123
# 浏览器打开 http://localhost:8123 → 走一遍 §5 冒烟清单
```

### 2.2 方式 B：butler CLI（后续迭代推荐）

butler 支持增量补丁上传，玩家端自动更新，适合频繁迭代。

```bash
# 1. 安装（一次性）
#    https://itch.io/docs/butler/installing.html
butler login

# 2. 直接推目录（butler 不需要先 zip）
cd /d/MyGame/thunder-fighter
mkdir -p .itchbuild && rm -rf .itchbuild/*
cp index.html manifest.webmanifest sw.js icon.svg .itchbuild/
cp -r src .itchbuild/
[ -d assets ] && cp -r assets .itchbuild/

# 3. 上传（USER/GAME 换成你的 itch.io 用户名与项目 slug）
butler push .itchbuild USER/dafeiji:html5 --userversion 1.2.0

# 4. 核对
butler status USER/dafeiji
```

> `--userversion 1.2.0` 与 `package.json` / CHANGELOG 保持一致，方便追溯。
> 建议把 `.itchbuild/` 加进 `.gitignore`。

### 2.3 方式 C：浏览器直传

itch.io 项目编辑页 → Uploads → Upload files → 选 zip → 勾选 **"This file will be played in the browser"**。适合首次上架，操作最直观。

---

## 3. itch.io 项目配置

### 3.1 基础设置

| 字段 | 建议值 |
|---|---|
| Title | 打飞机 · Fighter Shooter |
| Project URL | `dafeiji` 或 `fighter-shooter` |
| Classification | **Games** |
| Kind of project | **HTML** |
| Release status | **Released**（Demo 试水也算正式发布，不要设 Prototype，会降低曝光） |

### 3.2 Embed / iframe 设置（最容易踩坑的一块）

| 选项 | 建议值 | 理由 |
|---|---|---|
| Viewport dimensions | **960 × 720** | 与游戏内部逻辑分辨率一致，避免 CSS 拉伸变形 |
| Fullscreen button | ✅ 开启 | 游戏自带全屏切换，itch 层再给一个更保险 |
| Enable scrollbars | ❌ 关闭 | canvas 全屏铺满，滚动条会破坏沉浸感 |
| Mobile friendly | ✅ 开启 + **Orientation: Portrait** | 已做触屏适配，纵版射击锁竖屏 |
| Automatically start on page load | ❌ 关闭 | 保留点击启动页 —— **浏览器音频策略要求首次用户手势才能解锁 Web Audio**，自动启动会导致 BGM/音效静默 |
| Background color | `#05060f` | 与 `manifest.webmanifest` / `capacitor.config.json` 的 `backgroundColor` 一致，消除加载时白闪 |

> ⚠️ **Web Audio 解锁**：本作音效/BGM 全部由 Web Audio 程序化生成，必须在用户首次点击后才能出声。
> 保留 itch 的 "Click to launch" 遮罩即可天然满足这一约束，**不要开自动启动**。

### 3.3 SharedArrayBuffer / COOP-COEP

**不需要开启**。本项目无 WASM、无多线程、无 `SharedArrayBuffer`，开启反而可能拦截未来接入的第三方资源。

---

## 4. 商店页面设置

### 4.1 定价

**推荐：`No payments`（免费）+ 开启 "Donations" 打赏**

理由：
- 本次是 Demo 试水，目标是**验证操控卖点的口碑与留存**，不是收入。价格门槛会直接压掉 90% 的试玩量。
- itch.io 的免费 + 打赏组合零成本，且可随时改为付费。
- 与 `docs/commercialization-refactor-plan.md` 的路线一致：itch.io 免费验证口碑 → Steam 买断制收主要收入。

打赏建议金额：**建议 $2（Suggested donation）**，不设下限。

### 4.2 标签（Tags，itch.io 最多 10 个）

按检索价值排序，建议全用官方推荐词（自造词无检索量）：

```
shoot-em-up, bullet-hell, arcade, html5, singleplayer,
2d, pixel-art-free, score-attack, mouse-only, casual
```

> `mouse-only` 是本作差异化卖点（触摸板/鼠标"指哪打哪"）对应的官方标签，务必保留。
> 若 `pixel-art-free` 不在推荐列表里就换成 `retro`——本作是矢量程序化美术，不要标 `pixel-art`（会误导玩家）。

### 4.3 元数据

| 字段 | 值 |
|---|---|
| Genre | Shooter |
| Made with | HTML5 / JavaScript（不要填引擎名，本作零依赖是卖点） |
| Average session | A few minutes |
| Languages | 简体中文（Simplified Chinese）、English |
| Inputs | Mouse、Touchscreen、Keyboard |
| Accessibility | One button（自动开火，实际只需移动 + 点击） |
| Multiplayer | 无 |

### 4.4 附加下载（可选）

在同一个 itch.io 项目页下挂桌面/移动包，转化路径最短：

| 文件 | 平台标记 | 说明 |
|---|---|---|
| `dafeiji-portable-v1.2.0.exe` | Windows | 由 `desktop/npm run dist` 或 CI 产出，免安装 |
| `dafeiji-v1.2.0.apk` | Android | **注意：当前 CI 只产 debug APK，不适合公开分发**，见 `release-readiness.md` |

> Android debug APK 未做正式签名，玩家安装会有安全警告，且无法后续升级为正签版本（签名不一致）。
> **首发建议只挂 Web + Windows EXE，APK 等签名流程就绪后再上。**

---

## 5. 上传后冒烟验收清单

在 itch.io 页面（**不是本地**）实际跑一遍：

- [ ] 页面加载无 404（F12 Network 面板全绿，特别看 `src/*.js` 四个文件）
- [ ] 点击启动 → 菜单出现，霓虹标题与动效正常
- [ ] **音频出声**（点击后 BGM + 开火音效）—— 这是最常见的 itch 部署事故
- [ ] 鼠标移动 → 战机跟随，"指哪打哪"手感无延迟
- [ ] 自动开火 → 击杀敌机 → 加分 + 连击计数出现
- [ ] 点击画布 → 炸弹清屏 + 屏震
- [ ] 打到第 3 波 → Boss 登场横幅 + 血条正常
- [ ] ESC 暂停 / 继续正常
- [ ] 设置面板：音量滑块、灵敏度、**语言切到 EN 后 UI 全变英文**
- [ ] 皮肤面板：预设切换 + 新建自定义皮肤 + 刷新后仍在（localStorage 生效）
- [ ] 死亡 → 结算页显示得分 / 最高分 / 最高连击 → 再来一局
- [ ] 全屏按钮生效且退出全屏后布局不错乱
- [ ] 手机浏览器打开 itch 页面 → 竖屏 → 拖动操控 + 💣 / ⏸ 按钮可点
- [ ] 断网后刷新页面仍可玩（Service Worker 生效）

---

## 6. 已知发布风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **SW 缓存版本号未升**（`sw.js` 里 `CACHE = 'djfe-v1'` 从未变过） | 迭代新版后，老玩家浏览器命中旧缓存，看到的还是旧版本，且难以自查 | **上传前必须**把 `CACHE` 改成 `djfe-v1.2.0`；此后每次发版同步递增 |
| R2 | Web Audio 未解锁 | 玩家听不到任何声音，误判为"游戏没做音效" | 关闭 itch 自动启动，保留点击遮罩（§3.2） |
| R3 | 19 处中文硬编码字符串 | 英文玩家在关卡名 / Boss 名 / 波次横幅处看到中文，体验割裂 | 首发可接受（标签已标注双语）；v1.3.0 补齐，见 `release-readiness.md` |
| R4 | 固定 960×720 逻辑分辨率 + CSS 拉伸 | 超宽屏 / 异形手机屏可能变形 | itch viewport 设 960×720 锁定；移动端已锁竖屏 |
| R5 | zip 多套一层目录 | itch 报 "index.html not found"，上架失败 | 用 §2.1 的 `unzip -l` 校验命令 |
| R6 | Android debug APK 误挂上架 | 玩家安装告警 + 后续无法正签升级 | 首发不挂 APK（§4.4） |

---

## 7. 发布后动作

1. 发一篇 **Devlog**，正文用 `CHANGELOG.md` 的 `[1.2.0]` 段落改写为玩家语言
2. itch.io 社区版块（Community）**开启评论**，用于收集反馈
3. 首周监测：页面浏览量 / 试玩数 / 试玩转化率 / 评论；重点看**是否有人提到"操控很舒服"**——这是核心卖点是否成立的验证信号
4. 收集到的反馈按 `feat` / `fix` 归档进 `CHANGELOG.md` 的 `[Unreleased]`
