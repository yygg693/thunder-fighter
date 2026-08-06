/* =====================================================================
 * 打飞机 · Fighter Shooter — main.js (bootstrap)
 * 只负责把 DOM 菜单按钮接到 DJFE.Game，并启动游戏。
 * 真正逻辑在 core.js / entities.js / game.js。
 * ===================================================================== */
(function (DJFE) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // ---- 多语言 ----
  const I18N = {
    zh: {
      'menu.title': '打飞机', 'menu.sub': '街机弹幕射击', 'menu.best': '历史最高', 'menu.start': '开始游戏', 'menu.settings': '设置',
      'menu.howto': '手指在触摸板上移动 → 战机跟到对应位置，自动开火<br>点击屏幕放炸弹清屏 · WASD / 方向键也能操控 · ESC 暂停 · Shift / 右键放技能',
      'menu.lb': '本地排行榜',
      'diff.easy': '简单', 'diff.normal': '普通', 'diff.hard': '困难',
      'hud.score': '分数', 'hud.life': '生命', 'hud.bomb': '炸弹', 'hud.stage': '关卡', 'hud.wave': '波次', 'hud.power': '火力', 'hud.combo': '连击', 'hud.graze': '擦弹', 'hud.buff': '增益',
      'go.maxcombo': '最高连击',
      'panel.sens': '触摸板灵敏度',
      'retry': '再来一局', 'menuBtn': '返回菜单',
      'pause.title': '已暂停', 'resume': '继续',
      'gameover.title': '坠机了！', 'gameover.score': '本局得分', 'gameover.best': '历史最高',
      'victory.title': '通关！', 'victory.sub': '全部关卡肃清 · 指挥官辛苦了', 'victory.score': '本局得分', 'victory.best': '历史最高',
      'result.bossBreak': '击破 Boss', 'result.graze': '擦弹', 'result.grazeMax': '最高擦弹', 'result.empty': '本局未记录击破',
      'hint': '移动手指控制战机 · 自动开火 · 点击放炸弹 · 击杀掉 火力(P)/护盾(S)/炸弹(B)/生命(L) · WASD/方向键 · ESC 暂停 · Shift/右键 放技能',
      'settings.title': '设置', 'settings.music': '音乐音量', 'settings.sfx': '音效音量',
      'settings.fullscreen': '全屏', 'settings.lang': '语言', 'settings.close': '关闭', 'settings.on': '开启', 'settings.off': '退出', 'settings.skillAuto': '技能自动释放',
      'lb.empty': '暂无记录',
      'menu.skin': '皮肤',
      'skin.title': '战机皮肤', 'skin.tip': '选择预设，或新建自己的涂装（相当于内置 Mod）',
      'skin.create': '新建皮肤', 'skin.close': '返回', 'skin.editor': '设计皮肤',
      'skin.name': '名称', 'skin.body': '机身', 'skin.accent': '描边高光', 'skin.engine': '尾焰',
      'skin.wing': '机翼', 'skin.trail': '弹道', 'skin.pattern': '涂装',
      'skin.pattern.plain': '纯色', 'skin.pattern.stripe': '条纹', 'skin.pattern.hex': '蜂巢', 'skin.pattern.carbon': '碳纤',
      'skin.save': '保存皮肤', 'skin.cancel': '取消', 'skin.use': '使用', 'skin.del': '删除', 'skin.using': '使用中',
      // 皮肤面板 v2 · 每款预设皮肤文案（key 前缀 skin.<id>.*，由 renderSkinCards 内联解析，不走 data-i18n）
      'skin.weapon.label': '武器', 'skin.custom.tagline': '自定义涂装',
      'skin.cyan_knight.name': '苍蓝骑士', 'skin.cyan_knight.tagline': '宽正面火力覆盖的骑士型', 'skin.cyan_knight.weapon': '笔直弹道·稳定输出', 'skin.cyan_knight.flavor': '静水流深，一击贯虹',
      'skin.crimson_falcon.name': '烈焰红隼', 'skin.crimson_falcon.tagline': '近身扇形覆盖的猛禽型', 'skin.crimson_falcon.weapon': '扇形散射·贴脸爆发', 'skin.crimson_falcon.flavor': '烈焰掠空，羽刃如潮',
      'skin.emerald.name': '翡翠游隼', 'skin.emerald.tagline': '自动索敌的灵巧游隼', 'skin.emerald.weapon': '微追踪弹·自动咬尾', 'skin.emerald.flavor': '翠羽穿林，矢无虚发',
      'skin.violet.name': '紫电惊鸿', 'skin.violet.tagline': '穿透光束的惊鸿机型', 'skin.violet.weapon': '穿透激光·贯穿一线', 'skin.violet.flavor': '紫电裂空，一瞬惊鸿',
      'skin.stealth.name': '暗夜幽灵', 'skin.stealth.tagline': '弧波荡散的隐身机体', 'skin.stealth.weapon': '弧波震荡·范围荡散', 'skin.stealth.flavor': '暗夜无声，弧光潜行',
      'skin.golden.name': '黄金圣翼', 'skin.golden.tagline': '环爆圣翼的守护机型', 'skin.golden.weapon': '环形爆裂·近身守护',       'skin.golden.flavor': '圣翼垂光，金环绽放',
      'banner.stagePrefix': '关卡', 'banner.wavePrefix': '第', 'banner.waveSuffix': '波', 'banner.bossWave': 'BOSS 来袭！', 'boss.default': 'BOSS', 'title': '雷霆战机', 'brand.arcade': '◆ 街机 ◆'
    },
    en: {
      'menu.title': 'Fighter Shooter', 'menu.sub': 'FIGHTER SHOOTER', 'menu.best': 'BEST', 'menu.start': 'START', 'menu.settings': 'SETTINGS',
      'menu.howto': 'Move a finger on the touchpad → ship follows, auto-fire<br>Tap to drop a bomb · WASD / Arrows also work · ESC to pause · Shift / Right-click for skill',
      'menu.lb': 'LEADERBOARD',
      'diff.easy': 'EASY', 'diff.normal': 'NORMAL', 'diff.hard': 'HARD',
      'hud.score': 'SCORE', 'hud.life': 'LIVES', 'hud.bomb': 'BOMB', 'hud.stage': 'STAGE', 'hud.wave': 'WAVE', 'hud.power': 'POWER', 'hud.combo': 'COMBO', 'hud.graze': 'GRAZE', 'hud.buff': 'BUFF',
      'go.maxcombo': 'MAX COMBO',
      'panel.sens': 'Touchpad Sens',
      'retry': 'RETRY', 'menuBtn': 'MENU',
      'pause.title': 'PAUSED', 'resume': 'RESUME',
      'gameover.title': 'GAME OVER', 'gameover.score': 'SCORE', 'gameover.best': 'BEST',
      'victory.title': 'VICTORY!', 'victory.sub': 'All stages cleared · Well done, commander', 'victory.score': 'SCORE', 'victory.best': 'BEST',
      'result.bossBreak': 'BOSSES DOWN', 'result.graze': 'GRAZE', 'result.grazeMax': 'MAX GRAZE', 'result.empty': 'No kills recorded',
      'hint': 'Move to steer · auto-fire · tap to bomb · drops: Power(P)/Shield(S)/Bomb(B)/Life(L) · WASD/Arrows · ESC pause · Shift/Right-click for skill',
      'settings.title': 'SETTINGS', 'settings.music': 'Music', 'settings.sfx': 'SFX',
      'settings.fullscreen': 'Fullscreen', 'settings.lang': 'Language', 'settings.close': 'CLOSE', 'settings.on': 'ON', 'settings.off': 'OFF', 'settings.skillAuto': 'Auto Skill',
      'lb.empty': 'No records yet',
      'menu.skin': 'SKINS',
      'skin.title': 'SHIP SKINS', 'skin.tip': 'Pick a preset, or design your own (built-in mod)',
      'skin.create': 'NEW SKIN', 'skin.close': 'BACK', 'skin.editor': 'DESIGN SKIN',
      'skin.name': 'NAME', 'skin.body': 'BODY', 'skin.accent': 'TRIM', 'skin.engine': 'ENGINE',
      'skin.wing': 'WING', 'skin.trail': 'TRAIL', 'skin.pattern': 'PATTERN',
      'skin.pattern.plain': 'Plain', 'skin.pattern.stripe': 'Stripe', 'skin.pattern.hex': 'Hex', 'skin.pattern.carbon': 'Carbon',
      'skin.save': 'SAVE SKIN', 'skin.cancel': 'CANCEL', 'skin.use': 'USE', 'skin.del': 'DEL', 'skin.using': 'IN USE',
      // 皮肤面板 v2 · 每款预设皮肤英文文案（key 前缀 skin.<id>.*）
      'skin.weapon.label': 'WEAPON', 'skin.custom.tagline': 'Custom skin',
      'skin.cyan_knight.name': 'Azure Knight', 'skin.cyan_knight.tagline': 'Knight frame, wide frontal coverage', 'skin.cyan_knight.weapon': 'Straight bolts, steady DPS', 'skin.cyan_knight.flavor': 'Still water, one shot through the bow',
      'skin.crimson_falcon.name': 'Crimson Falcon', 'skin.crimson_falcon.tagline': 'Raptor frame, close-range fan spray', 'skin.crimson_falcon.weapon': 'Fan spread, point-blank burst', 'skin.crimson_falcon.flavor': 'Flame sweeps sky, feather-blades tide',
      'skin.emerald.name': 'Emerald Peregrine', 'skin.emerald.tagline': 'Nimble falcon, auto-homing shots', 'skin.emerald.weapon': 'Homing darts, auto-lock tail', 'skin.emerald.flavor': 'Jade darts the wood, sure to hit',
      'skin.violet.name': 'Violet Comet', 'skin.violet.tagline': 'Comet frame, piercing beam line', 'skin.violet.weapon': 'Piercing laser, line-punch', 'skin.violet.flavor': 'Violet rips the dark, a comet\'s wink',
      'skin.stealth.name': 'Shadow Phantom', 'skin.stealth.tagline': 'Stealth frame, arcing shockwave', 'skin.stealth.weapon': 'Arc wave, area disperse', 'skin.stealth.flavor': 'Silent night, arc light gliding',
      'skin.golden.name': 'Golden Seraph', 'skin.golden.tagline': 'Seraph wings, ring-burst guard', 'skin.golden.weapon': 'Ring blast, close guard', 'skin.golden.flavor': 'Seraph sheds light, gold rings bloom',
      'banner.stagePrefix': 'STAGE', 'banner.wavePrefix': 'WAVE', 'banner.waveSuffix': '', 'banner.bossWave': 'BOSS 来袭！', 'boss.default': 'BOSS', 'title': 'Fighter Shooter', 'brand.arcade': '◆ ARCADE ◆'
    },
  };
  function applyI18n() {
    const lang = DJFE.settings.lang || 'zh';
    const dict = I18N[lang] || I18N.zh;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (dict[key] != null) el.innerHTML = dict[key];
    });
    document.documentElement.lang = (lang === 'en') ? 'en' : 'zh-CN';
    document.title = DJFE.t('title');
  }

  DJFE.t = function (k) {
    const d = I18N[DJFE.settings.lang || 'zh'] || I18N.zh;
    return (d && d[k] != null) ? d[k] : (I18N.zh[k] != null ? I18N.zh[k] : k);
  };

  // ---- 触屏适配：操控提示换文案 + 触屏按钮接线 ----
  if (DJFE.isTouch) {
    I18N.zh['menu.howto'] = '手指在屏幕上滑动 → 战机跟随，自动开火<br>右下角 💣 按钮放炸弹清屏 · 左下角 ⚡ 放技能 · 右上角 ⏸ 暂停';
    I18N.en['menu.howto'] = 'Drag on screen → ship follows, auto-fire<br>Tap 💣 (bottom-right) to bomb · ⚡ (bottom-left) for skill · ⏸ (top-right) to pause';
  }
  const btnBomb = $('btnBomb'), btnPause = $('btnPause');
  if (btnBomb) btnBomb.addEventListener('click', (e) => { e.preventDefault(); DJFE.Game.bomb(); });
  if (btnPause) btnPause.addEventListener('click', (e) => { e.preventDefault(); DJFE.Game.togglePause(); });
  // 2c-1 · 触屏技能键（左下 ⚡）：只置标志，step 内结算
  const btnSkill = $('btnSkill');
  if (btnSkill) btnSkill.addEventListener('click', (e) => { e.preventDefault(); DJFE.Game.skill(); });

  // ---- 难度按钮 ----
  document.querySelectorAll('#menu .diff button').forEach((b) => {
    b.addEventListener('click', () => {
      DJFE.Game.setDifficulty(b.dataset.diff);
      document.querySelectorAll('#menu .diff button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
    });
  });

  // ---- 主菜单 / 死亡菜单 / 暂停菜单 按钮 ----
  $('startBtn').addEventListener('click', () => DJFE.Game.start());
  $('retryBtn').addEventListener('click', () => DJFE.Game.start());
  $('menuBtn').addEventListener('click', () => DJFE.Game.toMenu());
  $('quitBtn').addEventListener('click', () => DJFE.Game.toMenu());
  $('resumeBtn').addEventListener('click', () => DJFE.Game.resume());
  $('victoryRetry').addEventListener('click', () => DJFE.Game.start());
  $('victoryMenu').addEventListener('click', () => DJFE.Game.toMenu());
  $('menuSettingsBtn').addEventListener('click', () => settingsEl.classList.remove('hidden'));
  const pauseSettingsBtn = $('pauseSettingsBtn');
  if (pauseSettingsBtn) pauseSettingsBtn.addEventListener('click', () => settingsEl.classList.remove('hidden'));

  // 静音切换
  const muteBtn = $('muteBtn');
  DJFE.Game.setMute(muteBtn);

  // ---- 设置浮层 ----
  const settingsEl = $('settings');
  $('settingsBtn').addEventListener('click', () => settingsEl.classList.remove('hidden'));
  $('settingsClose').addEventListener('click', () => settingsEl.classList.add('hidden'));

  // 音乐 / 音效 音量
  const musicVol = $('musicVol'), sfxVol = $('sfxVol');
  musicVol.value = Math.round((DJFE.settings.musicVol || 0.55) * 100);
  sfxVol.value = Math.round((DJFE.settings.sfxVol || 0.85) * 100);
  musicVol.addEventListener('input', () => DJFE.audio.setMusicVol(musicVol.value / 100));
  sfxVol.addEventListener('input', () => DJFE.audio.setSfxVol(sfxVol.value / 100));

  // 2c-1 · 技能自动释放开关（持久化到 settings，并实时下发 game）
  const skillAutoBtn = $('skillAutoBtn');
  function syncSkillAutoBtn() {
    if (!skillAutoBtn) return;
    const on = !!(DJFE.settings && DJFE.settings.skillAuto);
    skillAutoBtn.textContent = (DJFE.settings.lang === 'en')
      ? (on ? I18N.en['settings.on'] : I18N.en['settings.off'])
      : (on ? I18N.zh['settings.on'] : I18N.zh['settings.off']);
  }
  if (skillAutoBtn) {
    skillAutoBtn.addEventListener('click', () => {
      const v = !DJFE.settings.skillAuto;
      DJFE.settings.skillAuto = v;
      DJFE.saveSettings();
      DJFE.Game.setSkillAuto(v);
      syncSkillAutoBtn();
    });
    syncSkillAutoBtn();
  }

  // 全屏
  $('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement);
      DJFE.settings.fullscreen = true;
    } else {
      (document.exitFullscreen || (() => {})).call(document);
      DJFE.settings.fullscreen = false;
    }
    DJFE.saveSettings();
    syncFullscreenBtn();
  });
  function syncFullscreenBtn() {
    const b = $('fullscreenBtn');
    if (!b) return;
    const on = !!document.fullscreenElement || !!DJFE.settings.fullscreen;
    b.textContent = (DJFE.settings.lang === 'en')
      ? (on ? I18N.en['settings.off'] : I18N.en['settings.on'])
      : (on ? I18N.zh['settings.off'] : I18N.zh['settings.on']);
  }
  document.addEventListener('fullscreenchange', syncFullscreenBtn);

  // 语言切换
  document.querySelectorAll('#settings .seg button').forEach((b) => {
    b.addEventListener('click', () => {
      DJFE.settings.lang = b.dataset.lang;
      DJFE.saveSettings();
      document.querySelectorAll('#settings .seg button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      applyI18n();
      syncFullscreenBtn();
      syncSkillAutoBtn();
      // 皮肤面板已打开时，切语言后刷新卡片与详情条（皮肤 i18n key 为动态内联解析，不走 data-i18n）
      if (skinsEl && !skinsEl.classList.contains('hidden')) {
        renderSkinCards();
        updateSkinDetail(DJFE.skins.current());
      }
    });
  });
  // 初始化语言高亮
  document.querySelectorAll('#settings .seg button').forEach((b) => {
    if (b.dataset.lang === (DJFE.settings.lang || 'zh')) b.classList.add('sel');
    else b.classList.remove('sel');
  });

  // ---- 皮肤面板 ----
  const skinsEl = $('skins');
  const skinGrid = $('skinGrid');
  const editorEl = $('skinEditor');

  function normHex(h) {
    if (!h) return '#3d8ba3';
    h = String(h).trim();
    if (h[0] !== '#') h = '#' + h;
    if (h.length === 4) h = '#' + h.slice(1).split('').map(x => x + x).join('');
    return /^#[0-9a-fA-F]{6}$/.test(h) ? h : '#3d8ba3';
  }

  function renderSkinCards() {
    skinGrid.innerHTML = '';
    const curId = DJFE.skins.currentId();
    const D = I18N[DJFE.settings.lang] || I18N.zh;
    DJFE.skins.list().forEach((sk) => {
      const card = document.createElement('div');
      card.className = 'skincard' + (curId === sk.id ? ' sel' : '');
      // 预览图：预设皮肤用 AI 精灵图（<img> data URI）；自定义 / 缺图回退 paintShip 占位
      const spriteURI = window.DJFE_SPRITE_B64 && window.DJFE_SPRITE_B64['player_' + sk.id];
      if (DJFE.skins.isCustom(sk.id) || !spriteURI) {
        const cv = document.createElement('canvas');
        cv.width = 110; cv.height = 128;
        DJFE.draw.paintShip(cv.getContext('2d'), performance.now(), cv.width / 2, cv.height * 0.52, 28, 42, sk, {});
        card.appendChild(cv);
      } else {
        const img = document.createElement('img');
        img.className = 'skinimg'; img.width = 96; img.height = 96; img.src = spriteURI;
        img.alt = sk.name + ' · ' + (D['skin.' + sk.id + '.tagline'] || '');
        card.appendChild(img);
      }
      const nm = document.createElement('div');
      nm.className = 'skinname';
      nm.textContent = sk.name + (curId === sk.id ? ' · ' + D['skin.using'] : '');
      card.appendChild(nm);
      const tag = document.createElement('div');
      tag.className = 'skintag';
      tag.textContent = D['skin.' + sk.id + '.tagline'] || '';
      card.appendChild(tag);
      const wpn = document.createElement('div');
      wpn.className = 'skinweapon';
      wpn.textContent = (D['skin.weapon.label'] || '武器') + ' · ' + (D['skin.' + sk.id + '.weapon'] || '');
      card.appendChild(wpn);
      // 整卡点击 = 选用
      card.addEventListener('click', () => {
        DJFE.skins.select(sk.id);
        renderSkinCards();
        updateSkinDetail(DJFE.skins.current());
      });
      // 自定义皮肤：编辑 / 删除
      if (DJFE.skins.isCustom(sk.id)) {
        const mini = document.createElement('div');
        mini.className = 'skinmini';
        const ed = document.createElement('button');
        ed.textContent = (I18N[DJFE.settings.lang] || I18N.zh)['skin.use'];
        ed.addEventListener('click', (e) => { e.stopPropagation(); openEditor(sk); });
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = (I18N[DJFE.settings.lang] || I18N.zh)['skin.del'];
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          DJFE.skins.deleteCustom(sk.id);
          renderSkinCards();
        });
        mini.appendChild(ed); mini.appendChild(del);
        card.appendChild(mini);
      }
      skinGrid.appendChild(card);
    });
  }

  function openSkinPanel() {
    renderSkinCards();
    updateSkinDetail(DJFE.skins.current());
    skinsEl.classList.remove('hidden');
  }

  // 底部 #skinDetail 详情条：中英文名 / 画意风味 / 武器数值（dmg·sp·r 来自 DJFE.weaponOf）。
  // 用 DOM + textContent 构建（不拼 innerHTML 字符串），自定义皮肤名也不会造成 XSS。
  function updateSkinDetail(sk) {
    const el = document.getElementById('skinDetail'); if (!el) return;
    const lang = DJFE.settings.lang || 'zh'; const D = I18N[lang] || I18N.zh;
    el.innerHTML = '';
    const name = document.createElement('div'); name.className = 'skd-name';
    name.appendChild(document.createTextNode(sk.name + ' '));
    const en = document.createElement('span'); en.className = 'skd-en';
    // 详情条「中英文名称」：主名取 sk.name（预设为中文），副名固定取英文 key，避免同语言下重复。
    en.textContent = (I18N.en['skin.' + sk.id + '.name']) || sk.name;
    name.appendChild(en);
    el.appendChild(name);
    const tag = document.createElement('div'); tag.className = 'skd-tag';
    tag.textContent = D['skin.' + sk.id + '.tagline'] || '';
    el.appendChild(tag);
    const wpn = document.createElement('div'); wpn.className = 'skd-wpn';
    wpn.textContent = (D['skin.weapon.label'] || '武器') + ' · ' + (D['skin.' + sk.id + '.weapon'] || '');
    el.appendChild(wpn);
    const flav = document.createElement('div'); flav.className = 'skd-flav';
    flav.textContent = DJFE.skins.isCustom(sk.id) ? (D['skin.custom.tagline'] || '自定义涂装')
      : (D['skin.' + sk.id + '.flavor'] || '');
    el.appendChild(flav);
    if (!DJFE.skins.isCustom(sk.id)) {
      const w = DJFE.weaponOf(sk.id);
      const stats = document.createElement('div'); stats.className = 'skd-stats';
      stats.textContent = 'DMG ' + w.dmg.toFixed(2) + ' · SPD ' + w.sp + ' · R ' + w.r;
      el.appendChild(stats);
    }
  }

  // ---- 皮肤编辑器 ----
  let editorRAF = 0;
  function stopEditorAnim() { if (editorRAF) { cancelAnimationFrame(editorRAF); editorRAF = 0; } }
  function readEditorSkin() {
    return {
      name: ($('edName').value || (I18N[DJFE.settings.lang] || I18N.zh)['skin.create']).slice(0, 8),
      body: normHex($('edBody').value), accent: normHex($('edAccent').value),
      engine: normHex($('edEngine').value), wing: normHex($('edWing').value),
      trail: normHex($('edTrail').value), pattern: $('edPattern').value,
    };
  }
  function updateEditorPreview() {
    const cv = $('edPrev');
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    DJFE.draw.paintShip(c, performance.now(), cv.width / 2, cv.height * 0.5, 34, 52, readEditorSkin(), {});
  }
  function editorLoop() {
    updateEditorPreview();
    editorRAF = requestAnimationFrame(editorLoop);
  }
  function openEditor(base) {
    base = base || DJFE.skins.current();
    $('edName').value = base.name || '';
    $('edBody').value = normHex(base.body);
    $('edAccent').value = normHex(base.accent);
    $('edEngine').value = normHex(base.engine);
    $('edWing').value = normHex(base.wing);
    $('edTrail').value = normHex(base.trail);
    $('edPattern').value = base.pattern || 'plain';
    editorEl.classList.remove('hidden');
    skinsEl.classList.add('hidden');
    stopEditorAnim();
    editorLoop();
  }
  ['edBody', 'edAccent', 'edEngine', 'edWing', 'edTrail', 'edPattern', 'edName'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', updateEditorPreview);
  });
  $('edSave').addEventListener('click', () => {
    DJFE.skins.saveCustom(readEditorSkin());
    stopEditorAnim();
    editorEl.classList.add('hidden');
    openSkinPanel();
  });
  $('edCancel').addEventListener('click', () => {
    stopEditorAnim();
    editorEl.classList.add('hidden');
    skinsEl.classList.remove('hidden');
  });

  $('menuSkinBtn').addEventListener('click', openSkinPanel);
  $('skinsClose').addEventListener('click', () => skinsEl.classList.add('hidden'));
  $('newSkinBtn').addEventListener('click', () => openEditor(DJFE.skins.current()));

  // 启动
  DJFE.Game.init();
  applyI18n();
  syncFullscreenBtn();

})(window.DJFE);
