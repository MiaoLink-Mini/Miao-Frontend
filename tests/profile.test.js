const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount } = require('./helpers');
const { LiveGateway } = require('../miniprogram/services/live-gateway');
const images = require('../miniprogram/utils/profile-image');

test('profile editor uses native user-initiated avatar and nickname form', () => {
  const template = fs.readFileSync(__dirname + '/../miniprogram/pages/profile/index.wxml', 'utf8');
  assert.match(template, /open-type="chooseAvatar"/);
  assert.match(template, /type="nickname" name="nickname"/);
  assert.match(template, /form-type="submit"/);
  assert.match(template, /bindsubmit="save"/);
  assert.ok(require('../miniprogram/app.json').pages.includes('pages/profile/index'));
  const style = fs.readFileSync(__dirname + '/../miniprogram/pages/profile/index.wxss', 'utf8');
  assert.match(style, /button\.avatar-chooser:not\(\[size='mini'\]\)/);
  assert.match(style, /max-width:160rpx/);
  assert.match(style, /height:88rpx;padding:0 24rpx;line-height:normal/);
});

test('profile gateway authenticates calls and preserves omitted avatar', async () => {
  const g = new LiveGateway({wx:{}});g.user={id:'user_a',displayName:'old'};
  const calls=[];g.request=async (...args)=>{calls.push(args);return {displayName:'new',avatarBase64:null,revision:1};};
  await g.getProfile();await g.saveProfile({displayName:'new',revision:0});
  assert.equal(calls[0][0],'/me/profile');assert.equal(calls[1][2],'PATCH');
  assert.deepEqual(calls[1][3],{displayName:'new',revision:0});assert.equal(g.user.displayName,'new');
});

test('profile save uses submitted nickname, removal and revision; duplicate submission guarded', async () => {
  let release;let calls=0;let saved;
  const rt={auth:true,live:true,epoch:1,changed(){},gateway:{saveProfile:async b=>{calls++;saved=b;await new Promise(r=>release=r);return {displayName:b.displayName,revision:4};}}};
  const page=mount('pages/profile/index.js',rt);page.loaded=true;page.setData({loading:false,revision:3});page.avatarChange=null;
  const pending=page.save({detail:{value:{nickname:' 阿林 '}}});
  await page.save({detail:{value:{nickname:'duplicate'}}});assert.equal(calls,1);
  release();await pending;assert.deepEqual(saved,{displayName:'阿林',revision:3,avatarBase64:null});
  assert.equal(page.data.saving,false);assert.ok(page.calls.some(c=>c.method==='navigateBack'));
});

test('rejected nickname and late save after account change never navigate', async () => {
  let release;const rt={auth:true,live:true,epoch:1,changed(){},gateway:{saveProfile:()=>new Promise(r=>release=r)}};
  const page=mount('pages/profile/index.js',rt);page.loaded=true;page.setData({loading:false});
  await page.save({detail:{value:{nickname:''}}});assert.equal(page.data.error,'错误码：PROFILE_NAME_INVALID');
  const pending=page.save({detail:{value:{nickname:'new'}}});rt.epoch++;release({revision:1,displayName:'new'});await pending;
  assert.ok(!page.calls.some(c=>c.method==='navigateBack'));
});

test('avatar files are local, scoped by user and revision; only our own files are removed', async () => {
  const deleted=[];const written=[];
  const api={env:{USER_DATA_PATH:'wxfile://usr'},getFileSystemManager:()=>({
    writeFile:o=>{written.push(o.filePath);o.success();},
    readdirSync:()=>['golink-profile-user_a-0.jpg','golink-profile-user_b-1.jpg','private.txt'],unlinkSync:p=>deleted.push(p)
  })};
  assert.equal(await images.avatarFile(api,'user_a',{avatarBase64:'YWJj',revision:1}),'wxfile://usr/golink-profile-user_a-1.jpg');
  assert.deepEqual(deleted,['wxfile://usr/golink-profile-user_a-0.jpg']);
  assert.equal(await images.avatarFile(api,'user_a',{avatarBase64:null,revision:2}),images.DEFAULT_AVATAR);
  await assert.rejects(images.avatarFile(api,'../escape',{avatarBase64:'YWJj',revision:1}), { code: 'AVATAR_INVALID' });
  images.clearAvatars(api);assert.ok(!deleted.some(p=>p.endsWith('private.txt')));
});

test('avatar processing rejects oversize and read failures', async () => {
  const api={compressImage:o=>o.success({tempFilePath:'temp.jpg'}),getFileSystemManager:()=>({readFile:o=>o.success({data:'a'.repeat(49153)})})};
  await assert.rejects(images.selectedAvatar(api,'photo.jpg'),/过大/);
  api.getFileSystemManager=()=>({readFile:o=>o.fail()});await assert.rejects(images.selectedAvatar(api,'photo.jpg'),/无法读取/);
});
