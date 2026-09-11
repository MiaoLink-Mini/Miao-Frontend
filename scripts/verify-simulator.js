// Optional integration check against an already-open, automation-enabled WeChat simulator.
// Does not submit tasks, answer approvals, persist preferences or contact a real Gateway.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const automator = require(process.env.WECHAT_AUTOMATOR_PATH || 'miniprogram-automator');
const app = require('../miniprogram/app.json');
const output = path.resolve(__dirname,'../test-results/appearance');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const deadline = setTimeout(()=>{ console.error('Simulator verification timed out'); process.exit(1); },180000);

async function verify() {
  const mp = await automator.connect({wsEndpoint:process.env.WECHAT_AUTOMATION_ENDPOINT || 'ws://127.0.0.1:9420'});
  const exceptions=[],screenshots=[];
  mp.on('exception',error=>exceptions.push(error.message));
  async function current(route) {
    for(let i=0;i<40;i++) { const page=await mp.currentPage(); if(page && page.path===route) return page; await pause(150); }
    throw new Error(`Navigation did not reach ${route}`);
  }
  async function capture(name) {
    console.log(`Checking ${name}`);
    await pause(500); await mp.screenshot({path:path.join(output,`${name}.png`)}); screenshots.push(name);
  }
  try {
    fs.mkdirSync(output,{recursive:true});
    assert.equal(await mp.evaluate(()=>getApp().runtime.gateway.constructor.name),'FakeGateway','Run only in the local demo');
    let page=await mp.currentPage();
    if(page.path==='pages/login/index') {
      assert.ok(await page.$('.brand-icon')); await capture('login');
      await (await page.$('button.primary')).tap();
    } else {
      assert.equal(await mp.evaluate(()=>!!getApp().runtime.auth),true);
      await mp.switchTab('/pages/home/index');
    }
    page=await current('pages/home/index'); await pause(500);
    const bar=await mp.evaluate(()=>__wxConfig.tabBar);
    assert.equal(bar.selectedColor,app.tabBar.selectedColor); assert.equal(bar.backgroundColor,app.tabBar.backgroundColor);
    for(const tab of app.tabBar.list) for(const key of ['iconPath','selectedIconPath']) {
      const info=await mp.callWxMethod('getImageInfo',{src:'/'+tab[key]});
      assert.equal(info.width,72); assert.equal(info.height,72); assert.equal(info.type,'png');
    }
    const pageSize=await (await page.$('.page')).size(),cta=await page.$('.new-session');
    assert.ok(Number((await cta.size()).width)>Number(pageSize.width)*.85,'Primary action must fill the content width');
    assert.ok(Number((await (await page.$('.hero')).size()).height)<210,'Overview text must not contain formatting-only blank lines');
    await capture('home');
    await cta.tap(); page=await current('pages/create/index'); await pause(300);
    assert.equal(await page.data('ready'),true);
    const input=await page.$('textarea'),draft=await page.data('prompt');
    try {
      await input.input(''); await pause(250);
      assert.equal(String(await (await page.$('button.primary.bottom')).property('disabled')),'true');
      await input.input('检查页面布局\n仅验证输入，不提交任务');
      await pause(250);
      assert.equal(await page.data('prompt'),'检查页面布局\n仅验证输入，不提交任务');
      assert.equal(String(await (await page.$('button.primary.bottom')).property('disabled')),'false');
    } finally { await input.input(draft); await pause(250); }
    await capture('create');
    await mp.switchTab('/pages/sessions/index'); page=await current('pages/sessions/index');
    await pause(300); const filter=await page.$('.filter');
    assert.ok(Number((await filter.size()).height)<42,'Filter labels must not carry formatting-only newlines');
    await (await page.$('input.search')).input('__weagent_no_matching_session__');
    await pause(250);
    assert.equal((await page.data('list')).length,0); assert.ok(await page.$('.empty-title'));
    await (await page.$('input.search')).input('');
    await pause(250);
    await (await page.$('[data-value="completed"]')).tap();
    await pause(250);
    assert.ok((await page.data('list')).every(session=>session.state==='completed'));
    await (await page.$('[data-value="all"]')).tap();
    await pause(250);
    await capture('sessions');
    for(const route of ['inbox','me']) { await mp.switchTab(`/pages/${route}/index`); await current(`pages/${route}/index`); await capture(route); }
    for(const [id,brand] of [['demo-review','codex'],['demo-question','claude'],['demo-complete','pi']]) {
      await mp.navigateTo('/pages/session/index?id='+id); page=await current('pages/session/index'); await pause(700);
      console.log(`Checking CLI interactions: ${brand}`);
      assert.equal((await page.data('session')).id,id);
      const logo=await page.$('.terminal-agent .agent-logo');
      assert.equal(await logo.attribute('src'),`/assets/agents/${brand}.svg`);
      assert.ok(Number((await logo.size()).width)>12);
      assert.ok(await page.$('.prompt-glyph')); assert.ok(await page.$('.composer'));
      // Global components resolve to anonymous component nodes in DevTools; use their public prop.
      const cards=await page.$$('.timeline-inner [item]'); let assistant,tool;
      assert.equal(cards.length,(await page.data('items')).length);
      for(const card of cards) { const item=await card.data('item'); if(item.type==='assistant')assistant=card; if(item.type==='tool')tool=card; }
      assert.ok(assistant); assert.ok(tool);
      assert.equal(await (await assistant.$('.event-agent-logo')).attribute('src'),`/assets/agents/${brand}.svg`);
      assert.equal(await assistant.$('.message-actions'),null,'Message controls should not clutter the transcript');
      const input=await page.$('.composer-input'),draft=await page.data('draft');
      try {
        await input.input(''); await pause(250);
        assert.equal(String(await (await page.$('.terminal-send')).property('disabled')),'true');
        await (await assistant.$('.message-menu')).tap(); await pause(180);
        assert.ok(await assistant.$('.message-actions'));
        const actions=await assistant.$$('.message-actions .terminal-action');
        await actions[1].tap(); await pause(250);
        assert.equal(await page.data('draft'),'> '+(await assistant.data('item.text'))+'\n');
        assert.equal(String(await (await page.$('.terminal-send')).property('disabled')),'false');
        await (await assistant.$('.message-menu')).tap(); await pause(180);
        assert.equal(await assistant.$('.message-actions'),null);
      } finally { await input.input(draft); await pause(250); }
      assert.equal(await tool.$('.output'),null);
      await (await tool.$('.tool-controls .terminal-action')).tap(); await pause(200);
      assert.ok(await tool.$('.output')); assert.ok((await (await tool.$('.output')).text()).includes(await tool.data('item.detail')));
      await (await tool.$('.tool-controls .terminal-action')).tap(); await pause(200);
      assert.equal(await tool.$('.output'),null);
      await page.callMethod('pauseFollow'); await pause(200);
      await (await page.$('.timeline')).scrollTo(0,0); await pause(300);
      await capture('cli-'+brand);
      if(brand==='pi') {
        const originalLarge=await mp.evaluate(()=>getApp().runtime.preferences.largeText);
        const normalSize=parseFloat(await (await tool.$('.body')).style('font-size'));
        try {
          await mp.evaluate(()=>{getApp().runtime.preferences.largeText=true;});
          await page.callMethod('refresh'); await pause(250);
          assert.ok(parseFloat(await (await tool.$('.body')).style('font-size'))>normalSize,'Large-text preference must include tool output');
        } finally { await mp.evaluate(value=>{getApp().runtime.preferences.largeText=value;},originalLarge); await page.callMethod('refresh'); }
      }
      await mp.navigateBack();
    }
    await mp.navigateTo('/pages/request/index?id=demo-approval'); page=await current('pages/request/index');
    assert.equal((await page.data('request')).id,'demo-approval'); await capture('approval');
    await mp.navigateBack();
    await mp.navigateTo('/pages/pair/index'); await current('pages/pair/index'); await capture('pair');
    await mp.switchTab('/pages/home/index'); await current('pages/home/index');
    assert.deepEqual(exceptions,[],'No app-service exceptions during navigation');
    const report={screenshots,iconsVerified:8,agentSVGs:['codex','claude','pi'],checks:[...(screenshots.includes('login')?['demo login']:[]),'four tab routes','native PNG image decoding','brand SVG sources and screenshots','full-width CTA','compact text layout','draft input/disabled state','search empty state','completed filter','CLI message menus/quote/tool expansion','large-text tool output','chat/approval/pair rendering'],exceptions};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`Simulator verification passed: ${screenshots.length} screenshots, 8 native icons, 3 Agent SVGs, CLI interactions and navigation/input/filter checks. Artifacts: ${output}`);
  } finally { mp.disconnect(); }
}
verify().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(deadline));
