#!/usr/bin/env node
/* =====================================================================
 * 打飞机 · Fighter Shooter — tools/boss-drill.js
 *
 * Boss 逐款钻取压测（开发期排查工具，不参与 sync-web / 不进产物）。
 *
 * run-smoke 的 S10 只打第 1 关的 sentinel，S15 直接把 boss 置空跳到 VICTORY，
 * 中间四款 Boss 的战斗逻辑其实一次都没被跑到。这个脚本把每一款 Boss 单独拉出来
 * 强制走完三个相位，盯三件事：
 *   ① 有没有 NaN 漏进实体字段（→ 会直接喂给 ctx，S17 红线）
 *   ② 对象池有没有被撑到扩容（grown > 0 → S18 红线）
 *   ③ 同屏弹幕峰值离 cap 还有多少冗余
 *
 * 用法：node tools/boss-drill.js
 * 退出码：0 = 全部干净；1 = 有 NaN / 池扩容 / 抛异常
 * ===================================================================== */
'use strict';

const path = require('path');
const { createEnv } = require('../tests/stubs');

const ROOT = path.resolve(__dirname, '..');
const SEED = parseInt(process.env.DRILL_SEED || '20250728', 10);
const SCRIPTS = ['src/core.js', 'src/entities.js', 'src/game.js', 'src/main.js'];
const FRAMES_PER_PHASE = 900;   // 每个相位跑 900 帧（≈15s 虚拟时长）

let failed = 0;

function boot() {
  const env = createEnv({ root: ROOT, seed: SEED, width: 960, height: 720 });
  for (const s of SCRIPTS) env.loadScript(s);
  return env;
}

function scanNaN(g, p) {
  const bad = [];
  const check = (label, arr, fields) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length && bad.length < 8; i++) {
      const o = arr[i];
      if (!o || typeof o !== 'object') continue;
      for (const f of fields) {
        const v = o[f];
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${label}[${i}].${f}=${v}`);
      }
    }
  };
  check('ebullets', g.ebullets, ['x', 'y', 'vx', 'vy', 'r', 'hold', 'ttl', 'split', 'av', 'ax', 'ay']);
  check('bullets', g.bullets, ['x', 'y', 'vx', 'vy', 'r']);
  check('enemies', g.enemies, ['x', 'y', 'vy', 'hp', 'hue', 'phase']);
  check('particles', g.particles, ['x', 'y', 'vx', 'vy', 'life']);
  check('rings', g.rings, ['x', 'y', 'r', 'maxR', 'life']);
  const b = g.boss;
  if (b) {
    for (const f of ['x', 'y', 'hp', 'phase', 'beamPhase', 'fireT', 'fireGap', 'anchorT', 'ghostT', 'tele']) {
      if (typeof b[f] === 'number' && !Number.isFinite(b[f])) bad.push(`boss.${f}=${b[f]}`);
    }
  }
  if (p) for (const f of ['x', 'y']) if (!Number.isFinite(p[f])) bad.push(`player.${f}=${p[f]}`);
  return bad;
}

function drill(stage) {
  const env = boot();
  const D = env.DJFE;
  const g = () => D.__debug.game;
  const p = D.__debug.player;

  D.Game.start();
  env.pump(60);
  g().lives = 999;                       // 钻取期间不许死，否则跑不满三个相位
  const stageWaves = D.__debug.stageWaves;

  // 把波次直接顶到该关的 Boss 波前一波，让调度器自然进入 Boss 战
  g().wave = stage * stageWaves - 1;
  g().stage = stage;
  g().betweenWaves = true;
  g().nextWaveAt = env.clock.now;
  env.pump(30);

  const boss = g().boss;
  if (!boss) { console.log(`  \x1b[31mFAIL\x1b[0m  第 ${stage} 关 Boss 未生成`); failed++; return; }
  const name = boss.name, kind = boss.kind, maxHp = boss.maxHp;

  const peak = { ebullets: 0, particles: 0, enemies: 0, rings: 0, bullets: 0 };
  const seenPhase = {};
  let nanHits = [];

  // 三个相位各跑一段：靠直接压血把 Boss 推进相位，模拟真实 DPS 下的完整战斗
  const cuts = [1.0, 0.60, 0.28];
  for (let c = 0; c < cuts.length; c++) {
    const b0 = g().boss;
    if (!b0) break;
    if (c > 0) { b0.hp = Math.max(2, Math.round(maxHp * cuts[c])); }
    for (let f = 0; f < FRAMES_PER_PHASE; f += 30) {
      // 贴脸跟随：phaser/void 会瞬移，不跟着走玩家子弹一发都命中不了，
      // 命中不了就不会触发 checkBossPhase，相位 1/2 的弹幕永远压不到。
      const bf = g().boss;
      if (bf && p) { p.x = bf.x; p.y = Math.min(env.clock ? 700 : 700, bf.y + 220); }
      env.pump(30);
      const gg = g();
      if (!gg.boss) break;
      gg.lives = 999;
      gg.boss.hp = Math.max(2, gg.boss.hp);      // 别让玩家火力把它打死，钻取要跑满时长
      seenPhase[gg.boss.pi] = true;
      for (const k in peak) peak[k] = Math.max(peak[k], gg[k].length);
      const bad = scanNaN(gg, p);
      if (bad.length) { nanHits = nanHits.concat(bad); break; }
    }
    if (nanHits.length) break;
  }

  const pool = D.__debug.poolStats();
  let grown = 0;
  const grownDetail = [];
  for (const k in pool) {
    const gr = pool[k].grown || 0;
    grown += gr;
    if (gr) grownDetail.push(`${k}:${gr}`);
  }
  const errs = env.errors ? env.errors.length : 0;
  const phases = Object.keys(seenPhase).sort().join(',');
  const ok = !nanHits.length && grown === 0 && !errs;
  if (!ok) failed++;

  console.log(
    `  ${ok ? '\x1b[32m PASS\x1b[0m' : '\x1b[31m FAIL\x1b[0m'}  S${stage} ${kind.padEnd(9)} ${name}` +
    `  相位=${phases}  峰值 eb=${String(peak.ebullets).padStart(4)} pt=${String(peak.particles).padStart(4)}` +
    ` en=${String(peak.enemies).padStart(3)} rg=${String(peak.rings).padStart(3)}` +
    `  扩容=${grown}${grownDetail.length ? '(' + grownDetail.join(' ') + ')' : ''}`
  );
  if (nanHits.length) console.log(`        \x1b[31mNaN\x1b[0m → ${nanHits.slice(0, 6).join(', ')}`);
  if (errs) console.log(`        \x1b[31m异常\x1b[0m → ${JSON.stringify(env.errors.slice(0, 3))}`);
}

console.log(`\x1b[1mBoss 钻取压测\x1b[0m  (seed=${SEED}, 每相位 ${FRAMES_PER_PHASE} 帧)`);
const total = (() => { const e = boot(); const n = e.DJFE.__debug.stageCount; return n; })();
for (let s = 1; s <= total; s++) drill(s);
console.log(failed ? `\n\x1b[41m\x1b[30m  DRILL FAIL  \x1b[0m  ${failed} 款有问题\n`
                   : `\n\x1b[42m\x1b[30m  DRILL PASS  \x1b[0m  ${total} 款 Boss 全部干净\n`);
process.exit(failed ? 1 : 0);
