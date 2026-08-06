# 皮肤面板升级方案 · Skin Panel v2

> 归属：《雷霆战机 / Thunder Fighter》· 设计 + 叙事（文策渊）
> 状态：待主理人审批
> 关联待办：`overview.md`「仍待处理」第 1 条 —— *皮肤视觉差异化：6 皮肤仍是同一张 player.png 色相旋转，用户反馈「只是简单换色」*。
> 关键发现：6 张独立 AI 精灵图 `assets/player_<id>.png`（均 1024×1024 正方形）**已生成、已以 data URI 嵌入 `src/spriteb64.js`（键 `player_<id>`），且已在 3D 路径 `src/render3d.js:149` 使用**。问题仅出在 2D **皮肤面板**仍用 `DJFE.draw.paintShip()` 程序化绘制（`src/main.js:207`），导致用户「看不到战机效果」。本方案把已就绪的 AI 资产前置到面板，零新美术成本。

---

## A. 每款皮肤文案（中 / 英，已接入 i18n 的 key 命名）

约束：名称/slogan/武器/画意每行 ≤ 14 中文字 / ≤ 40 英文字符。
武器风格短句呼应 `src/game.js:2013-2021` 的 `SKIN_WEAPONS` profile。

| id | 中文名 | 英文名 | tagline（一句话定位） | 武器风格短句（呼应 profile） | 画意风味（可选） |
|----|--------|--------|----------------------|------------------------------|------------------|
| `cyan_knight` | 苍蓝骑士 | Azure Knight | 宽正面火力覆盖的骑士型 | 笔直弹道·稳定输出 | 静水流深，一击贯虹 |
| `crimson_falcon` | 烈焰红隼 | Crimson Falcon | 近身扇形覆盖的猛禽型 | 扇形散射·贴脸爆发 | 烈焰掠空，羽刃如潮 |
| `emerald` | 翡翠游隼 | Emerald Peregrine | 自动索敌的灵巧游隼 | 微追踪弹·自动咬尾 | 翠羽穿林，矢无虚发 |
| `violet` | 紫电惊鸿 | Violet Comet | 穿透光束的惊鸿机型 | 穿透激光·贯穿一线 | 紫电裂空，一瞬惊鸿 |
| `stealth` | 暗夜幽灵 | Shadow Phantom | 弧波荡散的隐身机体 | 弧波震荡·范围荡散 | 暗夜无声，弧光潜行 |
| `golden` | 黄金圣翼 | Golden Seraph | 环爆圣翼的守护机型 | 环形爆裂·近身守护 | 圣翼垂光，金环绽放 |

### A-1 英文版（用于 i18n `en` 字典）

| id | name | tagline | weapon | flavor |
|----|------|---------|--------|--------|
| `cyan_knight` | Azure Knight | Knight frame, wide frontal coverage | Straight bolts, steady DPS | Still water, one shot through the bow |
| `crimson_falcon` | Crimson Falcon | Raptor frame, close-range fan spray | Fan spread, point-blank burst | Flame sweeps sky, feather-blades tide |
| `emerald` | Emerald Peregrine | Nimble falcon, auto-homing shots | Homing darts, auto-lock tail | Jade darts the wood, sure to hit |
| `violet` | Violet Comet | Comet frame, piercing beam line | Piercing laser, line-punch | Violet rips the dark, a comet's wink |
| `stealth` | Shadow Phantom | Stealth frame, arcing shockwave | Arc wave, area disperse | Silent night, arc light gliding |
| `golden` | Golden Seraph | Seraph wings, ring-burst guard | Ring blast, close guard | Seraph sheds light, gold rings bloom |

### A-2 武器 profile 对照（给 engineering 校验用，源自 `SKIN_WEAPONS`）

| id | kind | pattern | dmg | sp(px/step) | r | 备注 |
|----|------|---------|-----|------|---|------|
| `cyan_knight` | `''` | `dot` | 1.00 | 11 | 4 | 基线（p3 单目标 21.42 DPS） |
| `crimson_falcon` | `fan` | `fan` | 0.75 | 11 | 4 | 贴脸全中时等效 21.42 |
| `emerald` | `homing` | `para` | 1.00 | 9 | 4 | turn 0.035 / ttl 150 |
| `violet` | `laser` | `pierce` | 1.40 | 14 | 3 | 穿透（pierce 99） |
| `stealth` | `arc` | `arc` | 1.00 | 11 | 4 | 弧波荡散 |
| `golden` | `ring` | `blast` | 1.20 | 9 | 7 | ttl 25，近身环爆 |

> 详情区（Part B 的「完整描述」）可直接读 `DJFE.weaponOf(id)` 拉 dmg/sp/r，无需手填。

---

## B. 面板 UX 方案

### B-0 现状（问题根因）
- `renderSkinCards()`（`src/main.js:196-237`）为每张卡新建 `110×128` canvas，调用 `DJFE.draw.paintShip(c, …)` 程序化绘制；预览与游戏内 2D 机体一致（色相旋转版），**没有用到** `DJFE_SPRITE_B64.player_<id>`。
- 卡片仅有 `.skinname`（名称 + 选中时「· 使用中」），**无任何描述/武器/slogan**。
- 用户反馈：「图像没更新、看不到战机效果」「看不了战机效果或者说介绍」——根因即以上两点。

### B-1 目标状态
1. **预览图 = AI 精灵图**：预设皮肤直接用 `window.DJFE_SPRITE_B64['player_'+sk.id]` 渲染；精灵 1024×1024 正方形，缩放至约 `96×96` 展示，保留现有 `drop-shadow` 柔光。
2. **卡片加描述区**：每张卡含 `预览图 + 名称 + tagline + 武器风格短句`（均 ≤ 14 中文字，常驻不挤）。
3. **选中高亮 + 完整描述**：选中卡维持金色高亮（现有 `.skincard.sel`）；面板底部新增 `#skinDetail` 详情条，随选中/悬停更新，展示 **名称（中英）+ tagline + weapon + flavor 画意 + 武器数值（dmg/sp/r）**。
4. **与现有流程衔接**：`renderSkinCards()` 仅改预览与描述；`openEditor()`（程序化实时预览 `edPrev`）与自定义皮肤「编辑/删除」流程**不变**；自定义皮肤无 AI 图，回退到 `paintShip` 或占位图。

### B-2 预览图实现（二选一，推荐方案 A）
- **方案 A · `<img>`（推荐）**：`card` 内插入 `<img class="skinimg" src="${window.DJFE_SPRITE_B64['player_'+sk.id]}" alt="…" width="96" height="96">`。
  - 浏览器负责解码/缓存；data URI 同源无跨域污染（与 `spriteb64.js` 头注释一致）。
  - 仅在面板打开时（`openSkinPanel()`→`renderSkinCards()`）才建 DOM，**不在启动期预载**，避免常驻内存。
- **方案 B · `<canvas>` + `drawImage`**：预载一次 `Image`，`ctx.drawImage(img, 0,0,96,96)`。控制力更强（可做 idle 浮动动画 / 复用 glow），但代码量更大。**仅当后续要加动效时采用**。
- **自定义 / 缺图回退**：`if (DJFE.skins.isCustom(sk.id) || !window.DJFE_SPRITE_B64['player_'+sk.id])` → 走现有 `paintShip(canvas)` 分支（占位图同义）。

### B-3 卡片 DOM 结构（目标）
```html
<!-- 预设皮肤 -->
<div class="skincard sel" data-id="cyan_knight">
  <img class="skinimg" src="data:image/png;base64,…" alt="苍蓝骑士 · 宽正面火力覆盖的骑士型" width="96" height="96">
  <div class="skinname">苍蓝骑士 · 使用中</div>
  <div class="skintag">宽正面火力覆盖的骑士型</div>
  <div class="skinweapon">武器 · 笔直弹道·稳定输出</div>
  <!-- 自定义皮肤才有：<div class="skinmini">…编辑/删除…</div> -->
</div>
```

### B-4 详情区 `#skinDetail`（完整描述载体）
放在 `#skins` 内、`#skinGrid` 之下（`#skinsClose` 之上）。选中或悬停某卡时由 `updateSkinDetail(sk)` 刷新：
- 中英文名称 + tagline + weapon + flavor（文案取自 Part A / i18n）。
- 武器数值：`DJFE.weaponOf(sk.id)` 的 `dmg / sp / r`（自定义皮肤 `isCustom` 时隐藏数值行，改显「自定义涂装」）。
- 视觉：沿用面板 `--gold/--teal-hi` 主色，左对齐，字号略大于卡片行。

### B-5 交互与衔接
| 现有钩子 | 处理 |
|----------|------|
| `renderSkinCards()` (`main.js:196`) | 预览改 `<img>`/回退 `paintShip`；新增 tagline/weapon DOM；点击仍 `select()`+重渲+`updateSkinDetail()`。 |
| `openEditor()` (`main.js:265`) | **不改**：编辑器 `edPrev` 仍用 `paintShip` 程序化实时预览（自定义皮肤无 AI 图）。 |
| 自定义「编辑/删除」(`main.js:218-233`) | **不改**：保留 `skinmini` 按钮逻辑。 |
| 语言切换 (`main.js:166-176`) | 新增：切语言后对**已打开**面板调 `renderSkinCards()` + `updateSkinDetail()`，使每皮肤的动态 i18n key 重新解析（见 C-3）。 |
| `applyI18n()` (`main.js:64`) | 仅处理 `[data-i18n]` 静态节点；皮肤卡为动态生成，**不依赖** `data-i18n`，由 `renderSkinCards` 内联解析 `I18N[lang]['skin.'+id+'.*']`。 |

### B-6 边界情况（设计层，已规避）
1. **缺图 key**：新皮肤无对应 `player_<id>` → 自动回退 `paintShip`，不报错。
2. **自定义皮肤武器**：`weaponOf` 对非预设 id 返 `cyan_knight` 基线；详情区对 `isCustom` 隐藏数值，避免误显。
3. **长名称溢出**：`sk.name` 已在编辑器 `maxlength=8` 限制；卡片 `overflow:hidden` + 描述行省略号兜底。
4. **同色带纪律**：玩家弹道色统一避敌弹「危险色带」(hue 12-24)，文案不暗示危险色；AI 图本身已遵循方向 B 柔调画意基调。

---

## C. 给 engineering-lead 的交接清单

> 范围：`src/main.js` + `index.html` + i18n（同文件 `I18N` 对象）。**不改 `src/core.js` / `src/game.js` / `src/entities.js` / `src/spriteb64.js`。**

### C-1 `src/main.js` · `renderSkinCards()` 改造（`main.js:200-211` 区间）
- 删除：新建 `canvas` + `cv.getContext('2d')` + `DJFE.draw.paintShip(...)` 三行（`main.js:202-207`）。
- 新增预览分支：
  ```js
  const lang = DJFE.settings.lang || 'zh';
  const D = I18N[lang] || I18N.zh;
  const spriteURI = window.DJFE_SPRITE_B64 && window.DJFE_SPRITE_B64['player_' + sk.id];
  if (DJFE.skins.isCustom(sk.id) || !spriteURI) {
    // 自定义 / 缺图：保留程序化预览（现有逻辑）
    const cv = document.createElement('canvas'); cv.width = 110; cv.height = 128;
    DJFE.draw.paintShip(cv.getContext('2d'), performance.now(), cv.width/2, cv.height*0.52, 28, 42, sk, {});
    card.appendChild(cv);
  } else {
    const img = document.createElement('img');
    img.className = 'skinimg'; img.width = 96; img.height = 96; img.src = spriteURI;
    img.alt = (sk.name) + ' · ' + (D['skin.' + sk.id + '.tagline'] || '');
    card.appendChild(img);
  }
  ```
- 名称行保留（含 `· 使用中`），并在其后追加：
  ```js
  const tag = document.createElement('div'); tag.className = 'skintag';
  tag.textContent = D['skin.' + sk.id + '.tagline'] || '';
  const wpn = document.createElement('div'); wpn.className = 'skinweapon';
  wpn.textContent = (D['skin.weapon.label'] || '武器') + ' · ' + (D['skin.' + sk.id + '.weapon'] || '');
  card.appendChild(tag); card.appendChild(wpn);
  ```
- 点击回调末尾补 `updateSkinDetail(sk);`（与 `renderSkinCards()` 同文件定义）。

### C-2 `src/main.js` · 新增 `updateSkinDetail(sk)`
```js
function updateSkinDetail(sk) {
  const el = document.getElementById('skinDetail'); if (!el) return;
  const lang = DJFE.settings.lang || 'zh'; const D = I18N[lang] || I18N.zh;
  const nameEN = D['skin.' + sk.id + '.name'] || sk.name;
  const flavor = DJFE.skins.isCustom(sk.id) ? (D['skin.custom.tagline'] || '自定义涂装')
                : (D['skin.' + sk.id + '.flavor'] || '');
  let stats = '';
  if (!DJFE.skins.isCustom(sk.id)) {
    const w = DJFE.weaponOf(sk.id);
    stats = `<div class="skd-stats">DMG ${w.dmg.toFixed(2)} · SPD ${w.sp} · R ${w.r}</div>`;
  }
  el.innerHTML =
    `<div class="skd-name">${sk.name} <span class="skd-en">${nameEN}</span></div>` +
    `<div class="skd-tag">${D['skin.' + sk.id + '.tagline'] || ''}</div>` +
    `<div class="skd-wpn">${(D['skin.weapon.label']||'武器')} · ${D['skin.' + sk.id + '.weapon']||''}</div>` +
    `<div class="skd-flav">${flavor}</div>` + stats;
}
```
- 在 `openSkinPanel()` 内、`renderSkinCards()` 之后调用一次 `updateSkinDetail(DJFE.skins.current())`。

### C-3 `src/main.js` · i18n 新增 key（`I18N.zh` / `I18N.en` 各补，位于 `skin.*` 段）
建议 key：`skin.<id>.name` / `skin.<id>.tagline` / `skin.<id>.weapon` / `skin.<id>.flavor`，以及通用 `skin.weapon.label`、`skin.custom.tagline`。
- 取值见 Part A / A-1 表（直接搬运，零翻译歧义）。
- `skin.weapon.label`：zh `武器` / en `WEAPON`；`skin.custom.tagline`：zh `自定义涂装` / en `Custom skin`。
- ⚠ 注意：这些是**动态 per-skin key**，不走 `data-i18n` 属性，由 `renderSkinCards` 内联读取（见 B-5）。

### C-4 `index.html` · 结构 + 样式
- 结构：在 `#skinGrid`（`index.html:619`）之后、`menu-aux`（`index.html:621`）之前插入：
  ```html
  <div id="skinDetail" class="skindetail"></div>
  ```
- 样式（加入 `#skins` 样式块，约 `index.html:356` 起）：
  ```css
  .skincard img.skinimg { display:block; margin:0 auto; width:96px; height:96px;
    object-fit:contain; filter: drop-shadow(0 5px 12px rgba(0,0,0,.45)); }
  .skintag { color: var(--teal-hi); font-size:10.5px; text-align:center; margin-top:6px;
    letter-spacing:.3px; opacity:.92; }
  .skinweapon { color: var(--ink); font-size:10px; text-align:center; margin-top:2px; opacity:.7; }
  .skindetail { margin:14px auto 0; max-width:520px; padding:12px 14px;
    background:rgba(20,16,14,.5); border:1px solid var(--line); border-radius:12px;
    text-align:left; }
  .skindetail .skd-name { font-size:15px; font-weight:700; color:var(--gold-hi); }
  .skindetail .skd-en { font-size:11px; color:var(--ink); opacity:.6; font-weight:400; }
  .skindetail .skd-tag { font-size:12px; color:var(--teal-hi); margin-top:3px; }
  .skindetail .skd-wpn { font-size:11px; color:var(--ink); margin-top:2px; }
  .skindetail .skd-flav { font-size:11px; color:var(--ink); opacity:.66; margin-top:4px; font-style:italic; }
  .skindetail .skd-stats { font-size:11px; color:var(--gold); margin-top:5px; letter-spacing:.5px; }
  ```

### C-5 验证（回归）
- `node --check src/main.js` 通过。
- `node tests/run-smoke.js` 保持 125/125（面板无游戏逻辑改动，预期无回归）。
- `node tools/playtest.mjs --bot` 截图皮肤面板：确认 6 张 AI 精灵图显示、卡片有 tagline/weapon 文案、选中卡金色高亮且 `#skinDetail` 有完整描述；切换语言后文案随 i18n 刷新；console / pageerror 无新增报错。

---

## 风险与取舍
- **data URI 体积**：6 张精灵合计约 2–5 MB（解码后驻留），仅在面板打开时建 DOM 并浏览器缓存，可接受；**避免**在启动期一次性 `new Image()` 预载全部。
- **不改游戏代码**：游戏内战斗仍由 `paintShip`（2D）与 `render3d.js` 的 AI billboard（3D）负责，本方案只动菜单面板，零战斗回归风险。
- **自定义皮肤**：无 AI 图，维持 `paintShip` 程序化预览 + 显示「自定义涂装」，符合用户「暂用占位图或 paintShip」要求。
- **设计支柱一致**：AI 精灵与文案均遵循方向 B「柔调画意科幻」基调，无霓虹硬边、无危险色带暗示。

## 待主理人审批项
1. 六款中文 slogan / 英文 name 与画意风味是否定稿（Part A）。
2. 完整描述放「底部 `#skinDetail` 详情条」还是「选中卡就地展开」——本方案默认详情条（更稳、不挤动网格）。
3. 预览实现选 `<img>`（方案 A，推荐）还是 `<canvas>`+`drawImage`（方案 B，留作动效扩展）。
4. 是否要把本方案作为 `overview.md`「待处理第 1 条」的闭环交付（建议是）。
