const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const base = path.resolve(__dirname, '../miniprogram');

test('empty states avoid redundant copy and duplicate session actions', () => {
  const read = name => fs.readFileSync(path.join(base, 'pages', name, 'index.wxml'), 'utf8');
  const home = read('home'), nodes = read('nodes'), create = read('create');
  assert.doesNotMatch(home + nodes + create, /先连接你的电脑|选择项目，开始第一个任务|添加一台设备开始工作|模型使用主机当前配置|\{\{readiness\}\}/);
  for (const source of [home, nodes]) assert.match(source, /class="compact-empty empty-actions"/);
  assert.match(home, /class="compact-empty empty-actions"><view class="empty-title">还没有会话<\/view><\/view>/);
  assert.match(nodes, /class="secondary small inline-action"[^>]*>输入配对码/);
  assert.match(create, /class="row task-counter"/);
  // Copy cleanup must not remove admission guards or real error feedback.
  assert.match(create, /disabled="\{\{!ready \|\| busy \|\| unknown\}\}"/);
  assert.match(create, /template is="operation"/);
});

function templates(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? templates(file) : file.endsWith('.wxml') ? [file] : [];
  });
}

test('shared sessions use the same segmented group while preserving their destination', () => {
  const source = fs.readFileSync(path.join(base, 'pages/sessions/index.wxml'), 'utf8');
  const group = source.match(/<view class="segmented organize-tabs">([\s\S]*?)<\/view>/);
  assert.ok(group);
  assert.equal((group[1].match(/<button\b/g) || []).length, 4);
  assert.match(group[1], /<button class="shared-tab" bindtap="open" data-url="\/pages\/shared\/index">与我共享<\/button>/);
  assert.doesNotMatch(group[1], /chevron-right|inline-action/);
});

test('WXML conditions and button states use valid, unescaped expressions', () => {
  let count = 0;
  for (const file of templates(base)) {
    const source = fs.readFileSync(file, 'utf8');
    // Syntax smoke test only, not a replacement for the WeChat WXML compiler.
    for (const match of source.matchAll(/\b(wx:if|wx:elif|disabled|loading)\s*=\s*(["'])\{\{([\s\S]*?)\}\}\2/g)) {
      assert.doesNotThrow(() => new vm.Script(`(${match[3]})`), `${path.relative(base, file)}: ${match[1]}`);
      count++;
    }
  }
  assert.ok(count > 0, 'Expected to check WXML expressions');
});

test('create offline notice short-circuits when the selected device is missing', () => {
  const source = fs.readFileSync(path.join(base, 'pages/create/index.wxml'), 'utf8');
  const match = source.match(/wx:if="\{\{(nodes\[nodeIndex\][\s\S]*?)\}\}"/);
  assert.ok(match, 'Expected the selected-device warning condition');
  const condition = new vm.Script(`!!(${match[1]})`);
  for (const [nodes, nodeIndex, expected] of [
    [[], -1, false], [[], 0, false], [[{ online: true }], -1, false],
    [[{ online: true }], 0, false], [[{ online: false }], 0, true]
  ]) {
    assert.equal(condition.runInNewContext({ nodes, nodeIndex }), expected);
  }
});
