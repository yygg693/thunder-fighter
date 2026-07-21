/* =====================================================================
 * 打飞机 · Fighter Shooter — main.js (bootstrap)
 * 只负责把 DOM 菜单按钮接到 DJFE.Game，并启动游戏。
 * 真正逻辑在 core.js / entities.js / game.js。
 * 依赖：core.js → entities.js → game.js 已先加载（见 index.html 脚本顺序）
 * ===================================================================== */
(function (DJFE) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // 难度按钮：高亮 + 通知 game.js
  document.querySelectorAll('#menu .diff button').forEach((b) => {
    b.addEventListener('click', () => {
      DJFE.Game.setDifficulty(b.dataset.diff);
      document.querySelectorAll('#menu .diff button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
    });
  });

  // 主菜单 / 死亡菜单 / 暂停菜单 按钮
  $('startBtn').addEventListener('click', () => DJFE.Game.start());
  $('retryBtn').addEventListener('click', () => DJFE.Game.start());
  $('menuBtn').addEventListener('click', () => DJFE.Game.toMenu());
  $('quitBtn').addEventListener('click', () => DJFE.Game.toMenu());
  $('resumeBtn').addEventListener('click', () => DJFE.Game.resume());

  // 静音切换
  DJFE.Game.setMute($('muteBtn'));

  // 启动
  DJFE.Game.init();

})(window.DJFE);
