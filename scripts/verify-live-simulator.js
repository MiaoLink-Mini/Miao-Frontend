// Read-only UI check against an already configured development Gateway. No Agent tasks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require(process.env.WECHAT_AUTOMATOR_PATH || 'miniprogram-automator');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve(__dirname, '../test-results/live-review');
async function main() {
  const mp = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_ENDPOINT || 'ws://127.0.0.1:9420' });
  let signedIn = false; const exceptions = [], checks = [];
  mp.on('exception', error => exceptions.push(error.message));
  const deadline = setTimeout(() => { console.error('Live UI verification timeout'); process.exit(1); }, 90000);
  try {
    const initial = await mp.evaluate(() => ({ auth: getApp().runtime.auth, live: getApp().runtime.live, reviewed: typeof getApp().runtime.loadLiveTimeline === 'function' }));
    assert.ok(initial.live && initial.reviewed, 'Compile the reviewed live client first');
    if (!initial.auth) {
      await mp.reLaunch('/pages/login/index');
      const login = await mp.currentPage(); await login.callMethod('enter'); signedIn = true;
    }
    for (let i = 0; i < 80; i++) {
      if (await mp.evaluate(() => getApp().runtime.connection === 'online')) break; await pause(250);
    }
    assert.equal(await mp.evaluate(() => getApp().runtime.auth && getApp().runtime.connection === 'online'), true);
    checks.push('real wx HTTP authentication + single SocketTask ready');
    // Exercise the actual wx cryptographic API without exposing its generated value.
    assert.equal(await mp.evaluate(async () => /^probe_[0-9a-f]{32}$/.test(await getApp().runtime.gateway.id('probe'))), true);
    checks.push('wx.getRandomValues');
    fs.mkdirSync(output, { recursive: true });
    await mp.switchTab('/pages/home/index'); await pause(400); await mp.screenshot({ path: path.join(output, 'home.png') });
    await mp.switchTab('/pages/sessions/index'); await pause(500);
    const sessions = await mp.currentPage(); assert.equal(await sessions.data('listError'), '');
    checks.push('server session list'); await mp.screenshot({ path: path.join(output, 'sessions.png') });
    await mp.switchTab('/pages/inbox/index'); await pause(500);
    const inbox = await mp.currentPage(); assert.equal(await inbox.data('listError'), '');
    const requestId = await mp.evaluate(() => { const request = getApp().runtime.snapshot().requests.find(r => r.state === 'pending'); return request ? request.id : ''; });
    if (requestId) {
      await mp.navigateTo('/pages/request/index?id=' + encodeURIComponent(requestId)); await pause(600);
      const request = await mp.currentPage(); assert.ok(await request.data('request'));
      await mp.screenshot({ path: path.join(output, 'request.png') }); checks.push('authorized request detail (no answer submitted)');
    }
    const sessionId = await mp.evaluate(() => { const s = getApp().runtime.snapshot().sessions.find(s => s.historyState !== 'purged'); return s ? s.id : ''; });
    if (sessionId) {
      await mp.navigateTo('/pages/session/index?id=' + encodeURIComponent(sessionId)); await pause(800);
      const session = await mp.currentPage(); assert.ok(await session.data('session')); assert.ok(!(await session.data('error')));
      await mp.screenshot({ path: path.join(output, 'session.png') }); checks.push('native CLI timeline (no prompt submitted)');
    }
    assert.deepEqual(exceptions, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, noAgentCommands: true, exceptions }, null, 2));
    console.log('Live simulator passed: ' + checks.join('; '));
  } finally {
    if (signedIn) {
      // Logout listeners reLaunch the app. Return the automation result before that
      // destroys the page context holding this evaluate callback.
      await mp.evaluate(() => { setTimeout(() => { getApp().runtime.logout().catch(() => {}); }, 0); return true; });
      await pause(500); await mp.reLaunch('/pages/login/index');
    }
    else await mp.switchTab('/pages/home/index');
    clearTimeout(deadline); await mp.disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
