const test=require('node:test'),assert=require('node:assert/strict');
const {Runtime}=require('../miniprogram/services/runtime');
const {FakeGateway}=require('../miniprogram/services/fake-gateway');
const {mount}=require('./helpers');
test('encoded diff card key resolves the exact event and full-screen file',async t=>{
 const rt=new Runtime(new FakeGateway({delay:1}));t.after(()=>rt.dispose());await rt.login();
 const id='demo-complete',key='turn_a:diff_index';
 const file={id:'file_fixture',name:'index.html',lines:[{kind:'added',text:'+ hello'}]};
 rt.timelines[id]={items:[{key,type:'diff',files:[file]},{key:'turn_b:other',type:'diff',files:[]}]};
 for(const value of [key,encodeURIComponent(key)]){
  const page=mount('pages/panel/index.js',rt);page.onLoad({kind:'diff',sessionId:id,itemKey:value});page.refresh();
  assert.equal(page.data.detail.key,key);assert.equal(page.data.files[0].name,'index.html');
  const full=mount('pages/file/index.js',rt);full.onLoad({sessionId:id,itemKey:value,fileId:file.id});full.refresh();assert.equal(full.data.file.id,file.id);
 }
 const invalid=mount('pages/panel/index.js',rt);invalid.onLoad({kind:'diff',sessionId:id,itemKey:'%broken'});invalid.refresh();assert.equal(invalid.data.detail,null);
});
