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
      'menu.title': '打飞机', 'menu.sub': 'FIGHTER SHOOTER', 'menu.best': '历史最高', 'menu.start': '开始游戏', 'menu.settings': '设置',
      'menu.howto': '手指在触摸板上移动 → 战机跟到对应位置，自动开火<br>点击屏幕放炸弹清屏 · WASD / 方向键也能操控 · ESC 暂停',
      'menu.lb': '本地排行榜',
      'diff.easy': '简单', 'diff.normal': '普通', 'diff.hard': '困难',
      'hud.score': '分数', 'hud.life': '生命', 'hud.bomb': '炸弹', 'hud.stage': '关卡', 'hud.wave': '波次', 'hud.power': '火力',
      'panel.sens': '触摸板灵敏度',
      'retry': '再来一局', 'menuBtn': '返回菜单',
      'pause.title': '已暂停', 'resume': '继续',
      'gameover.title': '坠机了！', 'gameover.score': '本局得分', 'gameover.best': '历史最高',
      'victory.title': '通关！', 'victory.sub': '全部关卡肃清 · 指挥官辛苦了', 'victory.score': '本局得分', 'victory.best': '历史最高',
      'hint': '移动手指控制战机 · 自动开火 · 点击放炸弹 · 击杀掉 火力(P)/护盾(S)/炸弹(B)/生命(L) · WASD/方向键 · ESC 暂停',
      'settings.title': '设置', 'settings.music': '音乐音量', 'settings.sfx': '音效音量',
      'settings.fullscreen': '全屏', 'settings.lang': '语言', 'settings.close': '关闭', 'settings.on': '开启', 'settings.off': '退出',
      'lb.empty': '暂无记录',
    },
    en: {
      'menu.title': 'Fighter Shooter', 'menu.sub': 'FIGHTER SHOOTER', 'menu.best': 'BEST', 'menu.start': 'START', 'menu.settings': 'SETTINGS',
      'menu.howto': 'Move a finger on the touchpad → ship follows, auto-fire<br>Tap to drop a bomb · WASD / Arrows also work · ESC to pause',
      'menu.lb': 'LEADERBOARD',
      'diff.easy': 'EASY', 'diff.normal': 'NORMAL', 'diff.hard': 'HARD',
      'hud.score': 'SCORE', 'hud.life': 'LIVES', 'hud.bomb': 'BOMB', 'hud.stage': 'STAGE', 'hud.wave': 'WAVE', 'hud.power': 'POWER',
      'panel.sens': 'Touchpad Sens',
      'retry': 'RETRY', 'menuBtn': 'MENU',
      'pause.title': 'PAUSED', 'resume': 'RESUME',
      'gameover.title': 'GAME OVER', 'gameover.score': 'SCORE', 'gameover.best': 'BEST',
      'victory.title': 'VICTORY!', 'victory.sub': 'All stages cleared · Well done, commander', 'victory.score': 'SCORE', 'victory.best': 'BEST',
      'hint': 'Move to steer · auto-fire · tap to bomb · drops: Power(P)/Shield(S)/Bomb(B)/Life(L) · WASD/Arrows · ESC pause',
      'settings.title': 'SETTINGS', 'settings.music': 'Music', 'settings.sfx': 'SFX',
      'settings.fullscreen': 'Fullscreen', 'settings.lang': 'Language', 'settings.close': 'CLOSE', 'settings.on': 'ON', 'settings.off': 'OFF',
      'lb.empty': 'No records yet',
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
  }

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
    });
  });
  // 初始化语言高亮
  document.querySelectorAll('#settings .seg button').forEach((b) => {
    if (b.dataset.lang === (DJFE.settings.lang || 'zh')) b.classList.add('sel');
    else b.classList.remove('sel');
  });

  // 启动
  DJFE.Game.init();
  applyI18n();
  syncFullscreenBtn();

})(window.DJFE);
