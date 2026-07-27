// 把游戏 Web 资产同步到 www/（Capacitor webDir）
// 用法：node scripts/sync-web.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');

const files = ['index.html', 'manifest.webmanifest', 'icon.svg', 'sw.js'];
const dirs = ['src'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, f));
}
for (const d of dirs) {
  fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });
}
console.log('sync-web: copied to www/ ->', files.join(', '), '+', dirs.join(', '));
