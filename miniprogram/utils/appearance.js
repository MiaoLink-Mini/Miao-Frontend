const listeners=new Set();
function subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
const STORAGE = 'weagent:appearance:v1';
const THEMES = [
  { id:'ember', name:'余烬', note:'Ember', canvas:'#171816', surface:'#20211e', raised:'#292b26', control:'#30332b', line:'#393d32', soft:'#2b2e27', ink:'#f2f1e8', muted:'#b5b7a9', quiet:'#929887', accent:'#edaa86', accentInk:'#291a13', accentSoft:'#3b2e24', positive:'#b9d58d', negative:'#f2a49d', warning:'#e8c780', addBg:'#253325', removeBg:'#3a2725', addMark:'#385438', removeMark:'#653a34', code:'#121410', syntax:'#e7bd8e', shadow:'0 16rpx 52rpx #00000028', nav:'white', dots:['#edaa86','#b9d58d','#f2f1e8'] },
  { id:'paper', name:'纸白', note:'Paper', canvas:'#f7f5ef', surface:'#fffefa', raised:'#eeece4', control:'#e9e6dc', line:'#d9d6cc', soft:'#eae7de', ink:'#2c3028', muted:'#616759', quiet:'#747b6c', accent:'#965330', accentInk:'#ffffff', accentSoft:'#f0e0d5', positive:'#397048', negative:'#aa403a', warning:'#855b18', addBg:'#e5f0df', removeBg:'#f9e5df', addMark:'#bfdeba', removeMark:'#efbfb4', code:'#f0eee6', syntax:'#845421', shadow:'0 16rpx 52rpx #3133230b', nav:'black', dots:['#965330','#678460','#2c3028'] },
  { id:'ocean', name:'深海', note:'Ocean', canvas:'#101b22', surface:'#162831', raised:'#1d333d', control:'#22404a', line:'#2d4651', soft:'#20353f', ink:'#e8f6f4', muted:'#a6c1c6', quiet:'#87a7b0', accent:'#87d7d0', accentInk:'#102d2e', accentSoft:'#203e42', positive:'#a2d2a5', negative:'#edaaa6', warning:'#e8cb88', addBg:'#1d3631', removeBg:'#3b2b32', addMark:'#2d5442', removeMark:'#603b47', code:'#0d171d', syntax:'#b7c9f3', shadow:'0 16rpx 52rpx #00000028', nav:'white', dots:['#87d7d0','#b7c9f3','#e8f6f4'] },
  { id:'iris', name:'鸢尾', note:'Iris', canvas:'#1a1722', surface:'#252031', raised:'#30293e', control:'#3a314d', line:'#463b57', soft:'#342c40', ink:'#f5eefb', muted:'#c3b5d1', quiet:'#a798b6', accent:'#c6acf4', accentInk:'#2b1c3d', accentSoft:'#3d3051', positive:'#b8d49a', negative:'#f0a6b7', warning:'#e6cb96', addBg:'#2c352f', removeBg:'#402934', addMark:'#415342', removeMark:'#653847', code:'#14111b', syntax:'#efc39e', shadow:'0 16rpx 52rpx #00000028', nav:'white', dots:['#c6acf4','#efc39e','#f5eefb'] },
  { id:'forest', name:'苔绿', note:'Moss', canvas:'#15201a', surface:'#1d2c23', raised:'#27392c', control:'#304434', line:'#3b4d3e', soft:'#2c3c30', ink:'#edf3e5', muted:'#b7c4ad', quiet:'#98ad90', accent:'#c4dca0', accentInk:'#22301a', accentSoft:'#34432b', positive:'#b8d8a0', negative:'#eda399', warning:'#e8cf8c', addBg:'#2a3f2a', removeBg:'#3f2d26', addMark:'#3d5b35', removeMark:'#624138', code:'#111a14', syntax:'#e9c093', shadow:'0 16rpx 52rpx #00000028', nav:'white', dots:['#c4dca0','#e9c093','#edf3e5'] },
  { id:'mono', name:'墨黑', note:'Mono', canvas:'#101010', surface:'#1c1c1c', raised:'#282828', control:'#333333', line:'#414141', soft:'#2c2c2c', ink:'#fafaf7', muted:'#c5c5be', quiet:'#9f9f97', accent:'#eeeecc', accentInk:'#171712', accentSoft:'#37372c', positive:'#b6d6a5', negative:'#eda7a7', warning:'#e4d29c', addBg:'#263026', removeBg:'#362727', addMark:'#3c5338', removeMark:'#5e3939', code:'#090909', syntax:'#d8c59f', shadow:'0 16rpx 52rpx #00000028', nav:'white', dots:['#eeeecc','#9f9f97','#fafaf7'] }
];
const MOTION = ['full','reduced','off'];
function normalize(value) {
  return { theme: THEMES.some(t=>t.id===value?.theme) ? value.theme : 'ember', motion:MOTION.includes(value?.motion)?value.motion:'full' };
}
function read(api) { try { return normalize(api.getStorageSync(STORAGE)); } catch (_) { return normalize(); } }
function palette(id) { return THEMES.find(t=>t.id===id) || THEMES[0]; }
function style(theme) {
  const t=palette(theme);
  return Object.entries({canvas:t.canvas,surface:t.surface,raised:t.raised,control:t.control,line:t.line,'line-soft':t.soft,ink:t.ink,muted:t.muted,quiet:t.quiet,accent:t.accent,'accent-ink':t.accentInk,'accent-soft':t.accentSoft,positive:t.positive,negative:t.negative,warning:t.warning,'add-bg':t.addBg,'remove-bg':t.removeBg,'add-mark':t.addMark,'remove-mark':t.removeMark,code:t.code,syntax:t.syntax,shadow:t.shadow}).map(([k,v])=>'--'+k+':'+v).join(';');
}
function view(value) { const a=normalize(value); return {themeId:a.theme,themeStyle:style(a.theme),themeCanvas:palette(a.theme).canvas,motionMode:a.motion,themeName:palette(a.theme).name,accent:palette(a.theme).accent}; }
function set(app,api,patch) {
  const next=normalize(Object.assign({},app.appearance||read(api),patch));
  api.setStorageSync(STORAGE,next); app.appearance=next;
  for(const listener of [...listeners])listener(next);
  if(app.runtime)app.runtime.changed(); return next;
}
module.exports={STORAGE,THEMES,MOTION,normalize,read,palette,style,view,set,subscribe};
