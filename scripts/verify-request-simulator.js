// Native geometry/input check; never submits an approval or answer.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const automator=require(process.env.WECHAT_AUTOMATOR_PATH||'miniprogram-automator');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const output=path.resolve(__dirname,'../test-results/appearance');
const deadline=setTimeout(()=>{console.error('Request simulator verification timed out');process.exit(1);},180000);
async function verify(){
  const mp=await automator.connect({wsEndpoint:process.env.WECHAT_AUTOMATION_ENDPOINT||'ws://127.0.0.1:9420'});
  const exceptions=[];mp.on('exception',e=>exceptions.push(e.message));
  let question,originalAnswers,originalLarge,originalQuestions,originalStatus;
  const bottom=async element=>Number((await element.offset()).top)+Number((await element.size()).height);
  async function fits(page){
    const screen=await page.$('.request-screen'),footer=await page.$('.request-footer'),scroll=await page.$('.request-main');
    assert.ok(Number((await scroll.size()).height)>40,'Content must retain a usable scrolling viewport');
    assert.ok(await bottom(scroll)<=Number((await footer.offset()).top)+1,'Content viewport must end above the footer');
    assert.ok(await bottom(footer)<=await bottom(screen)+1,'Footer must stay inside the viewport');
    for(const button of await page.$$('.request-footer button')) {
      assert.ok(Number((await button.offset()).top)>=Number((await footer.offset()).top),'Action must stay in footer');
      assert.ok(await bottom(button)<=await bottom(screen)+1,'Action must remain visible');
    }
  }
  async function scrolls(page,lastSelector,requireOverflow=true){
    const scroll=await page.$('.request-main'),footer=await page.$('.request-footer');
    await scroll.scrollTo(0,0);await pause(200);
    const footerTop=Number((await footer.offset()).top),headerTop=Number((await(await page.$('.request-header')).offset()).top);
    await scroll.scrollTo(0,10000);await pause(350);
    if(requireOverflow)assert.ok(Number((await(await page.$('.request-header')).offset()).top)<headerTop-20,'Content must actually scroll');
    assert.ok(Math.abs(Number((await footer.offset()).top)-footerTop)<=1,'Scrolling must not move the action buttons');
    const last=await page.$(lastSelector);
    assert.ok(await bottom(last)<=footerTop+1,'Last field must be reachable above the footer');
    assert.ok(Number((await last.offset()).top)>=Number((await scroll.offset()).top)-1,'Last field must not remain above the scroll viewport');
    await fits(page);
  }
  try{
    assert.equal(await mp.evaluate(()=>getApp().runtime.gateway.constructor.name),'FakeGateway');
    let page=await mp.currentPage();
    if(page.path==='pages/login/index'){await(await page.$('button.primary')).tap();await pause(1800);page=await mp.currentPage();}
    if(page.path!=='pages/request/index'||(await page.data('id'))!=='demo-input')page=await mp.navigateTo('/pages/request/index?id=demo-input');
    await pause(600);question=page;originalAnswers=await page.data('answers');
    originalStatus={};for(const key of ['busy','unknown','receipt','error'])originalStatus[key]=(await page.data(key))||false;
    originalLarge=await mp.evaluate(()=>getApp().runtime.preferences.largeText);
    const operations=await mp.evaluate(()=>getApp().runtime.gateway.operations.size);
    fs.mkdirSync(output,{recursive:true});
    await fits(page);
    for(const value of ['MacBook Pro','WeAgent Frontend','Claude Code','梳理移动端断线恢复流程'])assert.ok((await(await page.$('.request-context')).text()).includes(value));
    const before=Number((await(await page.$('.request-header')).offset()).top);
    await mp.pageScrollTo(400);await pause(200);
    assert.equal(Number((await(await page.$('.request-header')).offset()).top),before,'Page itself must not scroll');
    await mp.screenshot({path:path.join(output,'request-card-top.png')});
    await scrolls(page,'.answer-textarea');
    await mp.screenshot({path:path.join(output,'request-card-scrolled.png')});console.log('Checked question: full cards scroll, footer stays visible');
    await(await page.$('radio-group')).trigger('change',{value:'demo-history'});
    await(await page.$('.answer-textarea')).input('固定按钮与卡片滚动测试，不提交回答');await pause(200);
    assert.equal((await page.data('answers'))['demo-q1'],'demo-history');
    assert.equal((await page.data('answers'))['demo-q2'],'固定按钮与卡片滚动测试，不提交回答');
    await mp.evaluate(()=>{getApp().runtime.preferences.largeText=true;});await page.callMethod('refresh');await pause(150);
    await scrolls(page,'.answer-textarea');
    await page.callMethod('focusAnswer',{currentTarget:{dataset:{id:'demo-q2'}}});
    await page.callMethod('keyboard',{detail:{height:300}});await pause(200);
    await fits(page);
    assert.equal(await page.data('scrollTarget'),'question-demo-q2');
    const textarea=await page.$('.answer-textarea');
    assert.ok(Number((await textarea.offset()).top)<Number((await(await page.$('.request-footer')).offset()).top),'Focused answer must be reachable above the keyboard');
    assert.ok(await bottom(await page.$('.submit-answer'))<=await bottom(await page.$('.request-screen')),'Submit must remain above the simulated keyboard');
    await mp.screenshot({path:path.join(output,'request-card-keyboard.png')});
    await page.setData({unknown:true,receipt:'结果未知，请恢复连接后查询',error:''});await pause(150);
    await fits(page);assert.equal((await page.$$('.request-footer button')).length,2,'Unknown outcome must expose query and disabled submit without hiding either');
    assert.equal(String(await(await page.$('.submit-answer')).property('disabled')),'true');
    await page.setData(originalStatus);
    await page.callMethod('keyboard',{detail:{height:0}});
    await mp.evaluate(value=>{getApp().runtime.preferences.largeText=value;},originalLarge);await page.callMethod('refresh');
    originalQuestions=await mp.evaluate(()=>getApp().runtime.gateway.data.requests.find(r=>r.id==='demo-input').questions);
    await mp.evaluate(()=>{
      const request=getApp().runtime.gateway.data.requests.find(r=>r.id==='demo-input');
      request.questions=Array.from({length:8},(_,i)=>({id:'layout-long-'+i,label:'完整可滚动问题 '+(i+1),type:'text',required:false}));
    });await page.callMethod('refresh');await pause(200);
    await scrolls(page,'#question-layout-long-7 .answer-textarea');
    await mp.evaluate(value=>{getApp().runtime.gateway.data.requests.find(r=>r.id==='demo-input').questions=value;},originalQuestions);await page.callMethod('refresh');
    page=await mp.navigateTo('/pages/request/index?id=demo-approval');await pause(500);
    await fits(page);assert.equal((await page.$$('.request-choices button')).length,2);
    await scrolls(page,'.scope',false);
    assert.ok((await(await page.$('.scope')).text()).includes('本次文件修改'));
    await mp.screenshot({path:path.join(output,'approval-card-scrolled.png')});console.log('Checked approval: full scope scrolls, both choices stay visible');
    await mp.navigateBack();
    assert.equal(await mp.evaluate(()=>getApp().runtime.gateway.operations.size),operations);
    assert.deepEqual(exceptions,[]);
    fs.writeFileSync(path.join(output,'request-report.json'),JSON.stringify({checks:['full monochrome context and form cards','question/approval pinned footer geometry','native page does not scroll','native scroll-view moves content and exposes final field','radio and text input','large-text layout','eight-field long form scrolling','simulated keyboard focus with visible submit','unknown outcome keeps query and disabled submit visible','full approval scope reachable','no request submitted'],exceptions},null,2)+'\n');
    console.log('Request simulator verification passed.');
  }finally{
    try{
      if(originalLarge!==undefined)await mp.evaluate(value=>{getApp().runtime.preferences.largeText=value;},originalLarge);
      if(originalQuestions!==undefined)await mp.evaluate(value=>{getApp().runtime.gateway.data.requests.find(r=>r.id==='demo-input').questions=value;},originalQuestions);
      if(question&&originalAnswers!==undefined){
        const current=await mp.currentPage();
        if(current.path==='pages/request/index'&&(await current.data('id'))==='demo-approval')await mp.navigateBack();
        await question.setData({answers:originalAnswers});await question.callMethod('keyboard',{detail:{height:0}});await question.callMethod('refresh');
        if(originalStatus)await question.setData(originalStatus);
        await(await question.$('.request-main')).scrollTo(0,0);
      }
    }finally{mp.disconnect();}
  }
}
verify().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(deadline));
