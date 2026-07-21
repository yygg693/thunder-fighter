# 打飞机 · Fighter Shooter

纵版弹幕射击（shmup）。笔记本触摸板 / 鼠标操控，自动开火。**纯前端、零依赖、双击即玩。**

## 特性

- 触摸板 **绝对定位** 操控（指哪打哪）+ 键盘辅助（WASD / 方向键）
- 多种敌机、波次递进、每 3 波一个 Boss
- 道具成长：火力 `P` / 护盾 `S` / 炸弹 `B` / 生命 `L`
- 程序化音效（Web Audio，无音频文件）+ 屏震 / 受击闪白 / 冲击波环等特效
- 本地最高分（localStorage）

## 怎么玩

- **最简单**：直接双击 `index.html` 即可（推荐先体验）。
- 本地服务（避免个别浏览器 `file://` 限制）：

  ```bash
  cd thunder-fighter
  python3 -m http.server 8000
  # 浏览器打开 http://localhost:8000
  ```

- 操作：手指在触摸板移动 → 战机跟随；自动开火；点击放炸弹；`ESC` 暂停。

## 桌面版（Windows exe）

- 在仓库的 **Releases / Actions 产物** 里下载 `打飞机-portable.exe`，双击即玩。
- 自己构建：

  ```bash
  cd desktop
  npm install
  npm run dist      # 产物在 desktop/dist/打飞机-portable.exe
  ```

  桌面版只加载本地 `index.html`（file://），**无任何网络请求、无下载、无外部代码执行**，与网页版完全一致。

## 技术 & 结构

纯 HTML5 Canvas + 原生 JavaScript，经典 `<script>` + `window.DJFE` 命名空间（不用 ES Module，以保证 `file://` 双击可玩）。

- `index.html` — 全屏 canvas + HUD + 四个脚本顺序加载
- `src/core.js` — 基础设施：画布 / 最高分 / 碰撞 / 程序化音效 / 输入
- `src/entities.js` — 纯绘制：玩家 / 敌机 / Boss / 道具
- `src/game.js` — 状态机 / 波次 / Boss / 碰撞 / 主循环 / 渲染编排
- `src/main.js` — 薄启动层，把菜单按钮接到 `DJFE.Game`
- `manifest.webmanifest` + `sw.js` — PWA（仅在 `http(s)` 部署时启用）
- `desktop/` — Electron 套壳（桌面 exe）
- `.github/workflows/release.yml` — 推送即构建 exe 的 CI

## 许可

MIT License，详见 [LICENSE](LICENSE)。
