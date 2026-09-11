const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../miniprogram');
function styles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? styles(file) : file.endsWith('.wxss') ? [file] : [];
  });
}
const files = styles(root);

test('native v2 buttons use full-width actions without automatic horizontal margins', () => {
  const source = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
  assert.match(source, /button:not\(\[size='mini'\]\)\{width:100%;margin-left:0;margin-right:0\}/);
  // Compact and icon controls must still override the native-sized reset.
  assert.match(source, /button\.small:not\(\[size='mini'\]\)\{width:auto/);
  assert.match(source, /\.icon-button\{width:76rpx!important/);
  const shared = fs.readFileSync(path.join(root, 'pages/shared/index.wxss'), 'utf8');
  assert.match(shared, /button\.send-button,button\.stop-button\{width:68rpx/);
  assert.match(shared, /button\.jump-latest\{width:auto/);
  assert.match(fs.readFileSync(path.join(root, 'pages/share/index.wxss'), 'utf8'), /button\.ttl\{width:auto/);
});

test('theme sheet grid options outrank the global full-width button reset', () => {
  const source = fs.readFileSync(path.join(root, 'components/theme-switcher/index.wxss'), 'utf8');
  // app.wxss forces button:not([size='mini']) to width:100%; the grid options must keep the same attribute guard or they collapse into one column and the sheet overflows the screen.
  assert.doesNotMatch(source, /\.theme-option\{/);
  assert.match(source, /\.theme-option:not\(\[size='mini'\]\)\{width:calc\(\(100% - 32rpx\)\/3\)/);
  assert.match(source, /\.theme-option:not\(\[size='mini'\]\)\{display:block\}/);
  // The accent dot inside each theme preview must stay a small circle.
  const wxml = fs.readFileSync(path.join(root, 'components/theme-switcher/index.wxml'), 'utf8');
  assert.match(wxml, /class="mini-input-action"/);
});

test('WXSS selectors never use the unsupported universal selector', () => {
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, header] of source.matchAll(/([^{}]+)\{/g)) {
      if (header.trim().startsWith('@')) continue;
      // Attribute substring matches and quoted values are not universal selectors.
      const selector = header.replace(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/g, '').replace(/\[[^\]]*\]/g, '');
      assert.doesNotMatch(selector, /\*/, path.relative(root, file) + ': ' + header.trim());
    }
  }
});

test('motion off, hidden and reduced retain their native-element overrides', () => {
  const source = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const tag of ['view', 'text', 'button', 'input', 'textarea', 'scroll-view', 'image']) {
    for (const mode of ['motion-off', 'is-hidden', 'motion-reduced']) {
      const rule = rules.find(([, selectors]) => selectors.split(',').map(s => s.trim()).includes('.' + mode + ' ' + tag));
      assert.ok(rule, mode + ' ' + tag);
      if (mode === 'motion-reduced') {
        assert.match(rule[2], /animation-duration:0\.001ms!important/);
        assert.match(rule[2], /animation-iteration-count:1!important/);
        assert.match(rule[2], /transition-duration:\.12s!important/);
      } else {
        assert.match(rule[2], /animation:none!important/);
        assert.match(rule[2], /transition:none!important/);
      }
    }
  }
});

const compiler = process.env.WECHAT_WCSC_PATH || 'C:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcsc.exe';
test('installed native WXSS compiler accepts every stylesheet', { skip: !fs.existsSync(compiler) && !process.env.WECHAT_WCSC_PATH }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weagent-wxss-'));
  try {
    const output = path.join(directory, 'compiled.js');
    const result = spawnSync(compiler, ['-o', output, '-pc', String(files.length), ...files.map(file => path.relative(root, file))], {
      cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.statSync(output).size > 0, 'native compiler must produce output');
    t.diagnostic('Native WXSS compilation passed: ' + files.length + ' stylesheets');
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
