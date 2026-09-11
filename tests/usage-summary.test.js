const test=require('node:test');
const assert=require('node:assert/strict');
const {itemView}=require('../miniprogram/services/wire');
test('context uses the reported window and does not invent price or capacity',()=>{
 const value=itemView({type:'usage',contextUsedTokens:25000,contextWindowTokens:100000,cost:null});
 assert.equal(value.contextLabel,'25.0% · 25000 / 100000 tokens');assert.equal(value.costUnavailable,true);
 assert.equal(itemView({type:'usage',contextUsedTokens:0,contextWindowTokens:100}).contextLabel,'0.0% · 0 / 100 tokens');
 assert.equal(itemView({type:'usage',inputTokens:1000}).contextLabel,'尚未上报');
});
test('native usage renders token totals without a detail link',()=>{
 const item=itemView({type:'usage',itemId:'usage',turnId:'turn',inputTokens:1280,outputTokens:420,cost:{amount:'0.01',currency:'USD'}});
 assert.equal(item.text,'输入 1280 / 输出 420 tokens\n预估费用 0.01 USD');assert.equal(item.panel,undefined);
});
test('zero usage is displayed and missing usage is not fabricated',()=>{
 assert.equal(itemView({type:'usage',inputTokens:0,outputTokens:0,cost:null}).text,'输入 0 / 输出 0 tokens');
 assert.equal(itemView({type:'usage',inputTokens:null,outputTokens:null,cost:null}).text,'输入 未提供 / 输出 未提供 tokens');
 assert.equal(itemView({type:'usage'}).input,'未提供');
});

test('usage has a dedicated inline branch without detail actions',()=>{
 const fs=require('node:fs'),path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../miniprogram/components/event-card/index.wxml'),'utf8');const branch=source.match(/<block wx:elif="{{item.type === 'usage'}}">([\s\S]*?)<\/block>/)[1];assert.ok(branch.includes('usage-inline-title'));assert.ok(branch.includes('{{item.text}}'));assert.ok(!branch.includes('bindtap'));
});

test('usage displays after the last output of its own turn without changing stored events',()=>{
 const {usageAtTurnEnd}=require('../miniprogram/stores/timeline');
 const items=[{key:'a',turnId:'1',type:'assistant'},{key:'u',turnId:'1',type:'usage'},{key:'tool',turnId:'1',type:'tool'},{key:'final',turnId:'1',type:'assistant'},{key:'next',turnId:'2',type:'user'}];
 assert.deepEqual(usageAtTurnEnd(items).map(i=>i.key),['a','tool','final','u','next']);assert.equal(items[1].key,'u');
});
