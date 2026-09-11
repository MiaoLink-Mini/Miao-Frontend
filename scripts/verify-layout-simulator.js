// Native layout regression check. Run against an isolated demo copy, never live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require(process.env.WECHAT_AUTOMATOR_PATH || 'miniprogram-automator');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve(__dirname, '../test-results/layout');
const deadline = setTimeout(() => { console.error('Layout verification timed out'); process.exit(1); }, 180000);
async function verify() {
  const mp = await automator.connect({wsEndpoint: process.env.WECHAT_AUTOMATION_ENDPOINT || 'ws://127.0.0.1:9420'});
  const exceptions = [];
  mp.on('exception', e => exceptions.push(e.message));
  async function rect(element) {
    assert.ok(element, 'Expected layout element');
    return {...await element.offset(), ...await element.size()};
  }
  async function capture(name) {
    await pause(350);
    await mp.screenshot({path: path.join(output, name + '.png')});
    console.log('Checked native layout: ' + name);
  }
  async function fullWidth(page, selector, container, padding = 0) {
    const outer = await rect(await page.$(container));
    const inner = await rect(await page.$(selector));
    assert.ok(Math.abs(inner.width - (outer.width - padding)) <= 2, selector + ' must fill its content slot');
    assert.ok(Math.abs(inner.left - (outer.left + padding / 2)) <= 2, selector + ' must align to its content slot');
  }
  try {
    assert.equal(await mp.evaluate(() => getApp().runtime.gateway.constructor.name), 'FakeGateway', 'Use an isolated demo fixture');
    fs.mkdirSync(output, {recursive: true});
    const operations = await mp.evaluate(() => getApp().runtime.gateway.operations.size);
    let page = await mp.reLaunch('/pages/login/index');
    await pause(300);
    await fullWidth(page, '.primary', '.welcome-bottom');
    assert.equal((await page.$$('.welcome-bottom button')).length, 1, 'Only one authentication action');
    const top = await rect(await page.$('.welcome-top'));
    const icon = await rect(await page.$('.icon-button'));
    assert.ok(Math.abs(icon.left + icon.width - top.left - top.width) <= 2, 'Theme action must align to the right edge');
    await capture('login');
    if (!await mp.evaluate(() => !!getApp().runtime.auth)) {
      await page.callMethod('enter');
      for (let i = 0; i < 40; i++) {
        await pause(150);
        page = await mp.currentPage();
        if (page && page.path !== 'pages/login/index') break;
      }
    }
    page = await mp.currentPage();
    if (page.path === 'pages/guide/index') { await page.callMethod('finish'); await pause(300); }
    for (const route of ['home', 'sessions', 'inbox', 'me']) {
      page = await mp.switchTab('/pages/' + route + '/index');
      await pause(300);
      assert.equal(page.path, 'pages/' + route + '/index');
      if (route === 'home') {
        const content = await rect(await page.$('.screen-head'));
        const action = await rect(await page.$('.screen-head .primary'));
        assert.ok(action.width < content.width / 2, 'Header action must remain compact');
        assert.ok(Math.abs(action.left + action.width - content.left - content.width) <= 2, 'Header action aligns right');
        const list = await rect(await page.$('.attention-list'));
        const row = await rect(await page.$('.attention-row'));
        assert.ok(row.width > list.width * .85, 'Request rows must not collapse to native default width');
      }
      await capture(route);
    }
    page = await mp.navigateTo('/pages/session/index?id=demo-complete');
    await pause(500);
    const screen = await rect(await page.$('.session-screen'));
    const timeline = await rect(await page.$('.timeline'));
    const composer = await rect(await page.$('.composer'));
    assert.ok(timeline.height > 100, 'Transcript retains scrolling space');
    assert.ok(timeline.top + timeline.height <= composer.top + 2, 'Transcript must end above composer');
    assert.ok(composer.top + composer.height <= screen.top + screen.height + 2, 'Composer stays inside viewport');
    const send = await rect(await page.$('.terminal-send'));
    assert.ok(send.width < screen.width / 4, 'Send control remains compact');
    await capture('session');
    page = await mp.navigateTo('/pages/share/index?id=demo-complete');
    // Render live-only controls with local fixture data; do not trigger their handlers.
    await page.setData({live: true});
    await pause(200);
    const options = await page.$$('.ttl');
    assert.ok(options.length >= 3);
    const first = await rect(options[0]), second = await rect(options[1]), third = await rect(options[2]);
    assert.ok(Math.abs(first.top - second.top) < 2 && Math.abs(first.top - third.top) < 2, 'Expiry choices must share a row');
    assert.ok(second.left >= first.left + first.width, 'Expiry choices must not overlap');
    await capture('share');
    await page.callMethod('refresh');
    page = await mp.navigateTo('/pages/shared/index');
    await page.setData({
      invited: false, authenticated: true, id: 'layout-only',
      meta: {ownerName: '布局测试', agentName: 'Pi', nodeOnline: true},
      session: {title: '协作会话布局'}, grant: {permissionLabel: '可控制', expiryLabel: '测试'},
      isController: true, canQueue: true, canCancel: true, canSend: true,
      following: false, keyboardHeight: 0, items: [], pendingRequests: []
    });
    await pause(200);
    const shared = await rect(await page.$('.shared-screen'));
    const footer = await rect(await page.$('.shared-footer'));
    for (const selector of ['.send-button', '.stop-button']) {
      const control = await rect(await page.$(selector));
      assert.ok(control.width < shared.width / 4 && Math.abs(control.width - control.height) <= 2, selector + ' remains square');
      assert.ok(control.left + control.width <= shared.width + 2, selector + ' stays onscreen');
    }
    const jump = await rect(await page.$('.jump-latest'));
    assert.ok(jump.width < shared.width * .7, 'Latest-message pill remains compact');
    assert.ok(jump.top + jump.height <= footer.top + 2, 'Latest-message pill must not overlap the composer');
    assert.ok(Math.abs(jump.left + jump.width / 2 - shared.width / 2) <= 2, 'Latest-message pill stays centered');
    assert.ok(footer.top + footer.height <= shared.top + shared.height + 2, 'Shared composer stays in viewport');
    await capture('shared');
    assert.equal(await mp.evaluate(() => getApp().runtime.gateway.operations.size), operations, 'No remote operation may be issued');
    assert.deepEqual(exceptions, []);
    console.log('Native layout verification passed. No tasks, approvals or invitations submitted.');
  } finally {
    await mp.disconnect();
    clearTimeout(deadline);
  }
}
verify().catch(error => { clearTimeout(deadline); console.error(error); process.exitCode = 1; });
