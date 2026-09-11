const {definePage}=require('../../utils/page');
const onboarding=require('../../utils/onboarding');
const installCommands={
  windows:"$p=Join-Path $env:TEMP ('golink-'+[guid]::NewGuid()+'.mjs'); Invoke-WebRequest https://agent.000.moe/downloads/node/install.mjs -OutFile $p; if ($?) { node $p }",
  posix:'d=$(mktemp -d) && curl -fsSL https://agent.000.moe/downloads/node/install.mjs -o "$d/install.mjs" && node "$d/install.mjs"'
};
definePage({
  data:{step:0,installPlatform:'windows',installCommand:installCommands.windows,replay:false,steps:[
    {tag:'01 / CONNECT',title:'把电脑放进口袋',text:'在电脑运行 喵连 Node，用配对码安全连接。',icon:'monitor'},
    {tag:'02 / INSTALL',title:'从你的电脑开始',text:'复制命令，在电脑终端运行。',icon:'terminal'},
    {tag:'03 / CREATE',title:'选一个 Agent，开始',text:'按安装提示选择项目与 Agent，再用配对码连接电脑。',icon:'folder'},
    {tag:'04 / STAY IN FLOW',title:'看得清，控得住',text:'实时看输出，审阅改动，确认审批。也可限时分享会话。',icon:'spark'},
    {tag:'05 / OPEN SOURCE',title:'开源，一起打磨',text:'喵连 以 MIT 协议开源，前端、后端与 Node 分列三个仓库。欢迎 Star、Issue 与贡献。',icon:'share'}
  ]},
  onLoad(q){this.setData({replay:q.replay==='1'});},
  refresh(){},
  next(){if(this.data.step<this.data.steps.length-1)this.setData({step:this.data.step+1});else this.finish();},
  previous(){this.setData({step:Math.max(0,this.data.step-1)});},
  selectPlatform(e){const platform=e.currentTarget.dataset.platform;if(!Object.prototype.hasOwnProperty.call(installCommands,platform))return;this.setData({installPlatform:platform,installCommand:installCommands[platform]});},
  copyInstall(){wx.setClipboardData({data:this.data.installCommand});},
  copyOrg(){wx.setClipboardData({data:'https://github.com/MiaoLink-Mini'});},
  finish(){onboarding.finish(getApp(),wx);},
  connect(){onboarding.complete(wx);if(getApp().pendingShareToken){onboarding.continueToApp(getApp(),wx);return;}wx.redirectTo({url:'/pages/pair/index'});}
});
