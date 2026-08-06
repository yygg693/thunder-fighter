libs/ — 第三方 vendor 依赖（随仓库内置，保证 file:// 双击即玩）
================================================================

three.min.js
------------
  版本   : Three.js r160（THREE.REVISION === "160"）
  构建   : UMD（经典 <script>，挂 window.THREE）
  来源   : https://unpkg.com/three@0.160.0/build/three.min.js
  许可   : MIT (Copyright 2010-2023 Three.js Authors)
  大小   : ~670 KB

为什么是 UMD 而不是 ES module
-----------------------------
本项目的红线是「file:// 双击即玩、零依赖、零构建」。
ES module（`<script type="module">`）在 file:// 协议下会被浏览器的 CORS
策略直接拦掉，一行都跑不起来。UMD 构建走经典 <script>，把 THREE 挂到
window 上，file:// 下正常工作。

注意：three.min.js 自 r150 起被官方标记为 deprecated，加载时控制台会打印
一条 deprecation warning（不是错误，不影响功能）。r160 是仍然提供该 UMD
构建的最后一批版本之一。若将来要升到 r161+，官方不再产出 UMD，届时需要
自建 bundle 或改用 importmap —— 见下方「升级路径」。

如果这个文件丢了怎么办
----------------------
游戏**不会崩**。src/render3d.js 全程 feature-detect：
检测不到 window.THREE 就返回 available()===false，渲染自动回落到
原来的 Canvas2D 路径，玩法完全不受影响（只是没有 3D 机体）。

要恢复，把上面那个 URL 的文件下载到本目录、命名 three.min.js 即可：
  curl -fsSL -o libs/three.min.js https://unpkg.com/three@0.160.0/build/three.min.js
镜像（同版本）：
  https://cdnjs.cloudflare.com/ajax/libs/three.js/r160/three.min.js

升级路径（r161+ 无 UMD 时）
---------------------------
1. 用 esbuild/rollup 把 three 打成 IIFE 全局包：
     esbuild three --bundle --format=iife --global-name=THREE --minify
2. 产物照样放这里叫 three.min.js，render3d.js 一行都不用改
   （它只依赖 window.THREE 这个契约）。

同步链
------
scripts/sync-web.js 的 dirs 里已包含 'libs'，`node scripts/sync-web.js`
会把本目录拷进 www/。若新增 vendor 文件，无需再改同步脚本。
