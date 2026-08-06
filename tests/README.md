# tests/ — 无头冒烟测试

零依赖。不引入 Vite / ESM / 任何 npm 测试框架，**不影响 `index.html` 双击即玩（file://）**。

```
tests/
├── stubs.js       # DOM / Canvas2D / Web Audio / rAF / localStorage / performance 桩
├── run-smoke.js   # 冒烟测试主脚本（122 条质量门 + 3 条缺陷探针）
└── README.md      # 本文件
```

---

## 运行方式

```bash
node tests/run-smoke.js                      # 标准运行
SMOKE_VERBOSE=1 node tests/run-smoke.js      # 打印游戏内 console.log 与全部 detail
SMOKE_SEED=42 node tests/run-smoke.js        # 换随机种子（用于抖动排查）
```

**退出码**：`0` = 全部质量门通过；`1` = 有 GATE 失败 / 未捕获异常 / NaN 绘制参数。
可直接用作 CI 或提交前的 pre-push 门禁。

**环境要求**：Node ≥ 16（实测 v22.22.2）。无需 `npm install`，不读写任何项目文件。

**性能**：单次全量运行约 **1.8 秒**，模拟约 **115 秒虚拟游戏时长 / 6900 帧 / 300 万次 canvas 调用**。

---

## 设计原理

游戏是经典 `<script>` + `window.DJFE` 命名空间，没有模块导出。测试用 Node 内置 `vm`
建一个沙箱，把 `window/document/canvas/...` 桩注入沙箱全局，然后**按 `index.html` 里
一模一样的顺序**依次 `runInContext`：

```
src/core.js → src/entities.js → src/game.js → src/main.js
```

`main.js` 末尾会调用 `DJFE.Game.init()`，因此脚本加载完毕即等价于"浏览器里打开了页面"。
测试随后通过 `DJFE.__debug`（game.js 已内置的调试句柄）读写内部状态，并用注入事件
（keydown / pointerdown / click / input）驱动真实代码路径。

### 四个关键设计

**1. 虚拟时钟 —— 零真实等待、完全确定性**

`performance.now()`、`requestAnimationFrame`、`setTimeout/setInterval`、
`AudioContext.currentTime` 全部挂在同一条虚拟时间轴上。测试调用 `env.frame(dt)`
推进一帧，时钟按 `dt` 走、到期定时器触发、rAF 队列出队。
所以"等 700ms 进第一波""长跑 50 秒"都是瞬时完成的，且每次结果完全一致。

**2. 确定性随机 —— 消灭 flaky**

沙箱内 `Math.random` 被替换成可播种的 mulberry32。敌机机型、生成位置、道具掉落、
爆炸粒子全部可复现。同一种子两次运行输出**逐字节一致**（已验证）。
用例断言只在 6 个种子（1 / 7 / 42 / 99 / 20250728 / 987654）下全绿才算稳定。

**3. DOM 桩从真实 `index.html` 解析**

`stubs.js` 会正则解析 `index.html`，只为 HTML 里**真实存在**的 id 建元素。
JS 里 `getElementById('xxx')` 引用了但 HTML 没有的 id → 返回 `null` 并记为
`missing-element-id` 告警，由 S17 的质量门拦截。
这样测试能真正抓出"改 HTML 时删了元素但忘了改 JS"这类回归。

**4. Canvas2D 桩带 NaN / undefined 哨兵**

所有绘制方法的数值参数、`fillStyle/strokeStyle/shadowColor` 等颜色串、
渐变 `addColorStop` 的 offset 与颜色，一旦出现 `NaN`/`Infinity`/字面量
`"NaN"`/`"undefined"`/`"null"`，立刻记录来源。
弹幕游戏里 NaN 通常只表现为"某个东西没画出来"，肉眼极难发现——这层哨兵把它变成硬失败。

---

## 覆盖范围

| 用例组 | 覆盖内容 |
|---|---|
| **S1 启动** | 4 个脚本按 index.html 顺序加载无异常；`DJFE.Game / draw / audio / input / skins / __debug` API 完整；引导后处于 MENU；主循环已注册；HTML 元素 id 无缺失 |
| **S2 菜单待机** | 空转 120 帧状态不漂移、有实际绘制、不生成实体 |
| **S3 开局** | `start()` → PLAYING；分 0 / 命 3 / 火力 1 / 波次 0；难度炸弹数；音频解锁；HUD 显隐 |
| **S4 波次与战斗** | 700ms 进第 1 波；关卡/Boss 波标记；敌机生成；自动开火；击杀计分与连击；爆炸粒子；玩家坐标夹取；全实体有限数 |
| **S5 炸弹与道具** | 鼠标点击放炸弹并清屏；炸弹为 0 不变负数；touch 指针不误触；P/B/L/S 四种道具拾取生效 |
| **S6 暂停** | ESC → PAUSED；浮层显示；**暂停期间分数/波次/敌机/子弹/玩家位置全部冻结**且仍在渲染；「继续」按钮与 ESC 均可恢复；可反复切换 |
| **S7 死亡** | 每次致命伤害恰好扣 1 命（无重复扣命）；耗尽 3 命 → GAMEOVER；命数不为负；结算面板显隐；finalScore 正确；最高分与排行榜落盘（含 stage/date 字段） |
| **S8 重开** | 「再来一局」→ PLAYING；状态完全复位；残留实体清空；波次调度恢复；无 NaN |
| **S9 返回菜单** | 暂停 →「返回菜单」→ MENU；菜单「开始游戏」可二次开局 |
| **S10 Boss** | 第 3 波触发 Boss；入场下落；三种弹幕；血量削减；击杀清场 + 加分 + 强制掉落；推进到第 2 关 |
| **S11 长跑** | 3000 帧（≈50s）实体池峰值不失控（子弹/敌弹/敌机/粒子/环）；状态机无卡死；rAF 无泄漏；无 NaN |
| **S12 resize** | 400×800 与 2560×1080 下继续运行不崩、无 NaN |
| **S13 设置/皮肤/存档** | 皮肤面板与 6 个预设缩略图渲染；皮肤编辑器；自定义皮肤保存并落盘且自动选中；音量设置持久化；灵敏度滑杆联动；静音开关；中英文 i18n 切换；三档难度参数生效 |
| **S14 键盘** | WASD / 方向键位移与边界夹取 |
| **S15 通关** | 最终关清场 → VICTORY；通关面板显示；结算分数正确性（探针） |
| **S16 帧率耦合** | 量化 60Hz vs 144Hz 的位移比（探针，对应 refactor-plan D8） |
| **S17 诊断汇总** | 全程零异常 / 零 NaN 绘制参数 / 零 console.error / 零缺失元素 |

### GATE 与 PROBE 的区别

- **GATE（质量门）**：122 条。任何一条失败 → 退出码 1。用来拦回归。
- **PROBE（探针）**：3 条。记录**已知缺陷**与工程指标，**不拦截**冒烟门。
  避免"已知问题让 CI 永远红灯"从而让人对红灯脱敏。修复后应把对应 PROBE 升级为 GATE。

当前 3 条 PROBE 全部标记为 BUG，详见 `docs/qa/smoke-test-plan.md` 第 5 节。

---

## 已知限制（本层测不了的东西）

| 测不了 | 原因 | 建议由谁覆盖 |
|---|---|---|
| **视觉正确性** | Canvas 是桩，只验证"调用了、参数不是 NaN"，不验证画面长什么样 | 二期 Playwright 截图基线比对 |
| **真实性能 / 帧耗时** | 虚拟时钟下 `dt` 是喂进去的，测不出真机掉帧 | 二期 Playwright + `performance` 采样 |
| **真实音频输出** | Web Audio 全是桩，只保证调用链不抛异常 | 人工 Playtest |
| **CSS 布局 / 响应式** | 无样式引擎，`classList` 只做显隐语义断言 | Playwright 视觉测试 |
| **触屏 / 手势** | `createEnv({touch:true})` 已预留开关，但触屏 UI 分支尚未编写用例 | 二期补 |
| **真实浏览器差异** | vm 沙箱 ≠ Chrome/Safari/WebView | Playwright 多浏览器矩阵 |
| **Capacitor / Electron 壳** | 只覆盖 `src/` 逻辑，不含 android/ 与 desktop/ | 端到端手工冒烟 |
| **`sw.js` / PWA 离线** | 未加载 | 二期 |

---

## 维护约定

1. **新增 `src/` 里的状态或流程，必须同步加冒烟用例**——没有测试的需求不算完成。
2. **修 bug 必须补回归断言**，并把对应 PROBE 升级为 GATE。
3. **改 `index.html` 删元素前**先跑一遍冒烟，S1/S17 会直接告诉你哪个 id 断了。
4. **不要为了让测试通过去改游戏逻辑**；反过来，也不要为了迁就 bug 放宽断言——
   放宽断言的唯一合法方式是把它降级成 PROBE 并在计划文档里登记。
5. 桩本身的改动要跑一次**变异测试**自检（见下），确认质量门不是空转。

### 变异测试自检（推荐每季度做一次）

把 `src/` 复制到临时目录、人为植入缺陷、跑测试，确认能被抓到。已验证的 4 个变异：

| 植入的缺陷 | 结果 |
|---|---|
| 注释掉 `if (game.lives <= 0) gameOver();` | 捕获 8 条 GATE 失败 |
| 禁用 `Escape` 键回调 | 捕获 5 条 GATE 失败 |
| 玩家子弹 `x` 置为 `NaN` | 捕获 7 条 GATE 失败 |
| 冲击波环 `r` 置为 `NaN` | 捕获 4 条 GATE 失败 + 40 条 NaN 绘制参数 |
