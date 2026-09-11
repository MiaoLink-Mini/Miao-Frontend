const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const { mount } = require('../tests/helpers');
const base = path.resolve(__dirname, '../miniprogram'); const app = require('../miniprogram/app.json');
let checks = 0; function check(value, message) { checks++; if (!value) throw new Error(message); }
const files = [];
function walk(folder) { fs.readdirSync(folder, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(folder, e.name)) : files.push(path.join(folder, e.name))); }
walk(base);
// Conservative source budgets catch oversized assets before native packaging.
const sourceBytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
const mediaBytes = files.filter(file => /\.(png|jpe?g|gif|webp|svg|mp3|wav|aac|m4a|mp4)$/i.test(file)).reduce((sum, file) => sum + fs.statSync(file).size, 0);
check(sourceBytes < 1500000, `Main package source exceeds 1.5 MB: ${sourceBytes} bytes`);
check(mediaBytes < 200000, `Bundled media exceeds 200 KB: ${mediaBytes} bytes`);
check(app.lazyCodeLoading === 'requiredComponents', 'Enable component lazy code loading');
console.log(`Package source budget: ${sourceBytes} bytes; bundled media: ${mediaBytes} bytes.`);
const sharedComponents = ['connection-bar','session-card','event-card','activity-mark','theme-switcher','code-diff','session-picker','ui-icon'];
const allowedTags = new Set(['page-meta','view','text','button','input','form','textarea','scroll-view','picker','radio-group','radio','checkbox-group','checkbox','label','switch','block','template','import','image',...sharedComponents]);
for (const file of files) {
  const source = fs.readFileSync(file, file.endsWith('.png') ? undefined : 'utf8');
  if (file.endsWith('.json')) { JSON.parse(source); checks++; }
  if (file.endsWith('.js')) { new vm.Script(source, { filename: file }); checks++; }
  if (!file.endsWith('.wxml')) continue;
  const tags = source.matchAll(/<\/?([\w-]+)\b[^>]*>/g); const stack = [];
  for (const match of tags) {
    const tag = match[1]; check(allowedTags.has(tag), `Unsupported WXML tag ${tag} in ${file}`);
    if (match[0].startsWith('</')) check(stack.pop() === tag, `Unbalanced ${tag} in ${file}`);
    else if (!match[0].endsWith('/>')) stack.push(tag);
  }
  check(stack.length === 0, `Unclosed tags ${stack} in ${file}`);
  for (const match of source.matchAll(/(?:src|data-url)="([^"{]+)"/g)) {
    if (match[1].includes('/pages/')) {
      const route = match[1].replace(/^\//, '').split('?')[0]; check(app.pages.includes(route), `Unregistered route ${route}`);
    } else if (match[1].startsWith('.')) check(fs.existsSync(path.resolve(path.dirname(file), match[1])), `Missing import ${match[1]}`);
    else if (match[1].startsWith('/assets/')) check(fs.existsSync(path.join(base, match[1])), `Missing image ${match[1]}`);
  }
  const js = file.replace(/\.wxml$/, '.js');
  if (fs.existsSync(js)) {
    const isComponent = ['components','custom-tab-bar'].includes(path.relative(base, js).split(path.sep)[0]);
    const instance = mount(path.relative(base, js), {}, isComponent);
    for (const match of source.matchAll(/(?:bind|catch)(?::)?[\w-]+="(\w+)"/g)) check(typeof instance[match[1]] === 'function', `Missing handler ${match[1]} in ${file}`);
  }
}
for (const route of app.pages) for (const extension of ['js','json','wxml','wxss']) check(fs.existsSync(path.join(base, `${route}.${extension}`)), `Missing ${route}.${extension}`);
for (const route of app.tabBar.list) {
  check(app.pages.includes(route.pagePath), `Missing tab route ${route.pagePath}`);
  for (const key of ['iconPath','selectedIconPath']) check(fs.existsSync(path.join(base, route[key])), `Missing tab icon ${route[key]}`);
}
for (const component of sharedComponents) for (const extension of ['js','json','wxml','wxss']) check(fs.existsSync(path.join(base, 'components', component, `index.${extension}`)), `Missing component ${component}.${extension}`);
check(app.tabBar.list.map(tab => tab.text).join(',') === '总览,会话,待处理,我的', 'Navigation differs from requirement B07');
console.log(`Project checks passed: ${checks}; ${app.pages.length} native pages, ${sharedComponents.length} shared components.`);
