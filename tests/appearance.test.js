const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const zlib = require('node:zlib');
const app = require('../miniprogram/app.json');
const { generate } = require('../scripts/generate-icons');
const assets = path.resolve(__dirname,'../miniprogram/assets');

test('tab bar lifecycle respects the theme sheet and restores the current theme and destination', t => {
  const { mount } = require('./helpers');
  const previous = { getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx, Component: global.Component };
  t.after(() => Object.assign(global, previous));
  const bar = mount('custom-tab-bar/index.js', {}, true);
  const app = { appearance: { theme: 'paper', motion: 'full' } };
  const page = { route: 'pages/me/index', data: { themeSheet: true } };
  global.getApp = () => app;
  global.getCurrentPages = () => [page];
  bar.definition.lifetimes.attached.call(bar);
  assert.equal(bar.data.hidden, true);
  assert.equal(bar.data.selected, 3);
  for (const theme of ['mono', 'ocean', 'paper']) {
    app.appearance.theme = theme;
    bar.definition.pageLifetimes.show.call(bar);
    assert.equal(bar.data.hidden, true, 'A native show event must not cover the theme controls');
    assert.equal(bar.data.themeId, theme);
  }
  page.data.themeSheet = false;
  page.route = 'pages/inbox/index';
  bar.definition.pageLifetimes.show.call(bar);
  assert.equal(bar.data.hidden, false);
  assert.equal(bar.data.selected, 2);
  assert.equal(bar.data.themeId, 'paper');
});

test('saved theme is available before first render and returning pages do not repaint the native shell', t => {
  const appearance = require('../miniprogram/utils/appearance');
  const { definePage } = require('../miniprogram/utils/page');
  const previous = { getApp: global.getApp, wx: global.wx, Page: global.Page };
  t.after(() => Object.assign(global, previous));
  const app = { appearance: { theme: 'paper', motion: 'full' } }, calls = [];
  global.getApp = () => app;
  global.wx = {
    setNavigationBarColor: value => calls.push(['navigation', value]),
    setBackgroundColor: value => calls.push(['background', value])
  };
  let page;
  global.Page = value => { page = value; };
  definePage({ public: true });
  assert.equal(page.data.themeCanvas, '#f7f5ef');
  assert.equal(page.data.themeId, 'paper');
  page.setData = patch => Object.assign(page.data, patch);
  page.appearanceView();
  assert.equal(calls[0][1].animation.duration, 0);
  const firstPaint = calls.length;
  for (let i = 0; i < 4; i++) {
    page.onHide();
    assert.equal(page.data.pageActive, false);
    page.appearanceView();
    assert.equal(page.data.pageActive, true);
    assert.equal(page.data.themeCanvas, '#f7f5ef');
  }
  assert.equal(calls.length, firstPaint, 'Returning to a cached page must not restart native color transitions');
  page.onHide();
  app.appearance = { theme: 'ocean', motion: 'reduced' };
  page.appearanceView();
  assert.equal(page.data.themeCanvas, appearance.palette('ocean').canvas);
  assert.equal(page.data.motionMode, 'reduced');
  assert.equal(calls.at(-1)[1].backgroundColor, page.data.themeCanvas);
});

test('native shell and all four destinations use the monochrome theme', () => {
  assert.equal(app.window.navigationBarBackgroundColor,'#000000');
  assert.equal(app.window.navigationBarTextStyle,'white');
  assert.equal(app.tabBar.backgroundColor,'#090909');
  assert.equal(app.tabBar.selectedColor,'#f4f4f1');
  assert.equal(app.tabBar.color,'#858580');
  assert.deepEqual(app.tabBar.list.map(t=>t.pagePath),['pages/home/index','pages/sessions/index','pages/inbox/index','pages/me/index']);
});

test('native icons are reproducible, visible RGBA PNGs matching selected and idle colors', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(),'weagent-icons-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(fixture)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('weagent-icons-'));
    fs.rmSync(fixture,{recursive:true,force:true});
  });
  assert.equal(generate(fixture),13);
  for (const item of app.tabBar.list) for (const [key,color] of [['iconPath',app.tabBar.color],['selectedIconPath',app.tabBar.selectedColor]]) {
    const file = path.basename(item[key]),bytes = fs.readFileSync(path.join(assets,file));
    assert.deepEqual(bytes,fs.readFileSync(path.join(fixture,file)),`${file}: regenerate assets after changing vectors`);
    assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    assert.ok(bytes.length < 40*1024);
    assert.equal(bytes.readUInt32BE(16),72); assert.equal(bytes.readUInt32BE(20),72);
    assert.equal(bytes[24],8); assert.equal(bytes[25],6);
    const chunks=[]; let offset=8;
    while (offset<bytes.length) { const size=bytes.readUInt32BE(offset); if(bytes.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+size)); offset+=size+12; }
    const raw=zlib.inflateSync(Buffer.concat(chunks)),rgb=color.slice(1).match(/../g).map(c=>parseInt(c,16));
    assert.equal(raw.length,72*(1+72*4));
    let visible=0,transparent=0;
    for(let y=0;y<72;y++) {
      assert.equal(raw[y*289],0,'Generated PNGs use the None row filter');
      for(let x=0;x<72;x++) { const i=y*289+1+x*4; if(raw[i+3]>128){visible++; assert.deepEqual([...raw.subarray(i,i+3)],rgb);} if(!raw[i+3])transparent++; }
    }
    assert.ok(visible>400,`${file}: glyph must not be blank`);
    assert.ok(transparent>72*72/2,`${file}: background must remain transparent`);
  }
});

test('home keeps new-session entry above overview and retains device/session/project routes', () => {
  const source=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/home/index.wxml'),'utf8');
  assert.ok(source.indexOf('data-url="{{createTarget}}"')<source.indexOf('metric-strip'));
  const logic=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/home/index.js'),'utf8');
  for(const route of ['create','pair','nodes','projects']) assert.ok((source+logic).includes(`/pages/${route}/index`));
  for(const target of ['sessions','inbox']) assert.ok(logic.includes("switchList(runtime(),'"+target+"'"));
  assert.ok(source.includes('<session-card'));
});
