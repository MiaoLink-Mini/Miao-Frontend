// Optional native UI test. Only navigates local read-only shortcuts; never sends an Agent task.
const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
const automator=require(process.env.WECHAT_AUTOMATOR_PATH||'miniprogram-automator');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const output=path.resolve(__dirname,'../test-results/appearance');
const deadline=setTimeout(()=>{console.error('Slash simulator test timed out');process.exit(1);},180000);

async function verify(){
  console.log('Connecting to the WeChat simulator');
  const mp=await automator.connect({wsEndpoint:process.env.WECHAT_AUTOMATION_ENDPOINT||'ws://127.0.0.1:9420'});
  const errors=[]; mp.on('exception',error=>errors.push(error.message));
  let page,originalDraft;
  async function current(route){
    for(let i=0;i<50;i++){const target=await mp.currentPage();if(target&&target.path===route)return target;await pause(150);}
    throw new Error('Navigation did not reach '+route);
  }
  try{
    console.log('Checking demo runtime');
    assert.equal(await mp.evaluate(()=>getApp().runtime.gateway.constructor.name),'FakeGateway');
    page=await mp.currentPage();
    if(page.path==='pages/login/index'){await(await page.$('button.primary')).tap();await pause(1600);}
    await mp.switchTab('/pages/home/index');
    page=await mp.navigateTo('/pages/session/index?id=demo-complete');await pause(600);
    originalDraft=await page.data('draft');
    const operationCount=await mp.evaluate(()=>getApp().runtime.gateway.operations.size);
    fs.mkdirSync(output,{recursive:true});
    async function type(value){await(await page.$('.composer-input')).input(value);await pause(180);}
    async function capture(name){await pause(350);await mp.screenshot({path:path.join(output,name+'.png')});console.log('Checked '+name);}
    await type('/');
    assert.equal(await page.data('slashOpen'),true);
    assert.equal((await page.$$('.slash-option')).length,5,'Pi queue capability is false');
    assert.ok(Number((await(await page.$('.slash-popup')).size()).height)<=261);
    await capture('slash-commands');
    await type('/pl');
    assert.deepEqual((await page.data('slashItems')).map(item=>item.name),['plan']);
    await capture('slash-filter');
    await(await page.$('[data-name="plan"]')).tap();await pause(250);
    assert.equal(await page.data('draft'),'/plan');assert.equal(await page.data('slashOpen'),false);
    assert.equal((await mp.currentPage()).path,'pages/session/index','Completion must not execute');
    assert.ok((await(await page.$('.terminal-send')).text()).includes('/plan'));
    await(await page.$('.terminal-send')).tap();
    page=await current('pages/panel/index');await pause(300);
    assert.equal(await page.data('kind'),'plan');assert.equal(await page.data('sessionId'),'demo-complete');
    await mp.navigateBack();page=await current('pages/session/index');await pause(300);
    assert.equal(await page.data('draft'),'');
    await type('/计划');assert.equal((await page.data('slashItems'))[0].name,'plan');
    await type('/no-such-command');assert.ok(await page.$('.slash-empty'));
    assert.equal(String(await(await page.$('.terminal-send')).property('disabled')),'true');
    await(await page.$('.slash-raw')).tap();await pause(180);
    assert.equal(await page.data('slashOpen'),false);assert.equal(await page.data('slashPending'),false);
    assert.equal(String(await(await page.$('.terminal-send')).property('disabled')),'false');
    // Do not press Send in literal mode.
    await type('保留我的草稿');await(await page.$('.slash-trigger')).tap();await pause(150);
    assert.equal(await page.data('draft'),'保留我的草稿');
    await type('');assert.equal(await page.data('slashOpen'),false);
    await(await page.$('.slash-trigger')).tap();await pause(200);assert.equal(await page.data('draft'),'/');
    await page.callMethod('keyboard',{detail:{height:300}});await pause(200);
    const popup=await page.$('.slash-popup'),header=await page.$('.session-header');
    assert.ok((await popup.offset()).top>=(await header.offset()).top+Number((await header.size()).height),'Suggestions must fit below the session header with a simulated keyboard');
    assert.ok(Number((await popup.size()).height)<=Number(await page.data('slashMaxHeight'))+1);
    await page.callMethod('keyboard',{detail:{height:0}});
    await type('/latest');await(await page.$('.terminal-send')).tap();await pause(180);
    assert.equal(await page.data('following'),true);assert.equal(await page.data('draft'),'');
    assert.equal(await mp.evaluate(()=>getApp().runtime.gateway.operations.size),operationCount);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'slash-report.json'),JSON.stringify({checks:['slash trigger','prefix/Chinese filtering','capability filtering','completion without execution','local plan navigation','unknown command/literal opt-in','draft preservation','simulated keyboard geometry','local latest action','no Gateway operation'],exceptions:errors},null,2)+'\n');
    console.log('Slash simulator verification passed; no Agent tasks submitted.');
  }finally{
    if(originalDraft!==undefined){
      await mp.evaluate(value=>getApp().runtime.draft('demo-complete',value),originalDraft);
      const current=await mp.currentPage();
      if(current&&current.path==='pages/session/index'&&(await current.data('id'))==='demo-complete'){
        await current.callMethod('input',{detail:{value:originalDraft}});
        await current.callMethod('keyboard',{detail:{height:0}});
        await current.callMethod('blurInput');
      }
    }
    mp.disconnect();
  }
}
verify().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(deadline));
