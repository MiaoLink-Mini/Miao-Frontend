const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { mount } = require('./helpers');
const assets = require('../docs/brand-assets.json');

test('brand assets match the reviewed supplied-image derivatives', () => {
  assert.equal(assets.productName, '喵连');
  for (const asset of assets.assets) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', asset.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assert.equal(bytes.readUInt32BE(16), asset.width);
    assert.equal(bytes.readUInt32BE(20), asset.height);
    assert.equal(bytes.length, asset.bytes);
  }
});

test('generic share cards use the new name and never substitute user content', () => {
  const rt = {auth: true, epoch: 1, contentEpoch: 1};
  const share = mount('pages/share/index.js', rt);
  const shared = mount('pages/shared/index.js', rt);
  for (const result of [share.onShareAppMessage({from: 'menu'}), shared.onShareAppMessage()]) {
    assert.equal(result.title, '喵连');
    assert.equal(result.path, '/pages/login/index');
    assert.equal(result.imageUrl, '/assets/share-card.png');
  }
});

test('onboarding prose uses the new name while actual repository URLs stay unchanged', () => {
  const guide = mount('pages/guide/index.js', {});
  const text = guide.data.steps.map(s => s.text).join('\n');
  assert.ok(text.includes('喵连 Node'));
  assert.doesNotMatch(text, /GoLink|WeAgent/);
  const about = mount('pages/about/index.js', {});
  assert.deepEqual(about.data.repos.map(r => r.url), [
    'https://github.com/MiaoLink-Mini/Miao-Frontend',
    'https://github.com/MiaoLink-Mini/Miao-Backend',
    'https://github.com/MiaoLink-Mini/Miao-Node'
  ]);
});
