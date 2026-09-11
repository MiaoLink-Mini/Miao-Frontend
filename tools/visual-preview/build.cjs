// Offline design QA only. Real WXML/WXSS and isolated fictional fixture driver.
// Only files in the reviewed source release manifest are embedded: never local config/state.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-files.json'), 'utf8'));
const prefix = 'WeAgent-Frontend/miniprogram/';
const source = {}, assets = {};
for (const name of manifest.files) {
  if (!name.startsWith(prefix)) continue;
  const k = name.slice(prefix.length), p = path.join(root, name);
  if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Symlink is not a preview source: ' + name);
  if (/\.(?:js|json|wxml|wxss)$/.test(k)) source[k] = fs.readFileSync(p, 'utf8');
  else if (k.endsWith('.png') || k.endsWith('.svg')) {
    const mime = k.endsWith('.png') ? 'image/png' : 'image/svg+xml';
    assets['/' + k] = 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
  }
}
const runtime = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
const payload = JSON.stringify({source, assets}).replace(/</g, '\\u003c');
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>喵连 - offline UI preview</title><style id="styles"></style></head><body><main id="app"></main><script>window.PREVIEW_DATA=' + payload + ';</script><script>' + runtime.replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
const out = process.argv[2] || path.join(__dirname, 'preview.html');
fs.writeFileSync(out, html);
console.log('Offline preview:', out, Buffer.byteLength(html), 'bytes');
