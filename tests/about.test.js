const test=require('node:test'),assert=require('node:assert/strict');const {mount}=require('./helpers');
test('about lists both developers and copies only the selected profile',()=>{
 const page=mount('pages/about/index.js',{});assert.equal(page.data.developers.length,2);
 assert.equal(page.data.developers[1].role,'\u5168\u6808\u5de5\u7a0b\u5e08');
 for(const developer of page.data.developers){page.copyGithub({currentTarget:{dataset:{name:developer.name}}});assert.equal(page.calls.at(-1).arg.data,developer.url);}
 const count=page.calls.length;page.copyGithub({currentTarget:{dataset:{name:'unknown'}}});assert.equal(page.calls.length,count);
 assert.equal(page.data.repos.length,3);for(const repo of page.data.repos){page.copyRepo({currentTarget:{dataset:{name:repo.name}}});assert.equal(page.calls.at(-1).arg.data,repo.url);}
});
