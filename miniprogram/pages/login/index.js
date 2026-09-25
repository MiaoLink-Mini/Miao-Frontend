const { errorText, errorCode } = require('../../utils/error-display');
const {definePage,runtime}=require('../../utils/page');
const config=require('../../config');
definePage({
  public:true,
  data:{busy:false,error:'',connectionDetail:'',primaryLabel:config.mode==='live'?'微信登录':'离线预览'},
  copyConnectionError(){
    const g=runtime().gateway, e=this.connectionError||g.lastError||{}, info=wx.getDeviceInfo?wx.getDeviceInfo():wx.getSystemInfoSync();
    const appId=wx.getAccountInfoSync().miniProgram.appId;
    wx.setClipboardData({data:JSON.stringify({appId,platform:info.platform,system:info.system,endpoint:e.endpoint||(g.base||config.gatewayURL).replace(/^http/,'ws')+'/v1/ws/client',code:errorCode(e),phase:e.phase||'',closeCode:e.closeCode||null,nativeDetail:require('../../utils/socket-error').nativeDetail({message:e.nativeDetail||''}),message:this.data.error},null,2)});
  },
  browse(){wx.switchTab({url:'/pages/home/index'});},
  async enter(){
    if(this.data.busy)return;
    this.connectionError=null;
    this.setData({busy:true,error:'',connectionDetail:''});
    try{
      await runtime().login('wechat');
      require('../../utils/onboarding').afterLogin(getApp(),wx);
    }catch(error){
      this.connectionError=error;
      this.setData({error:errorText(error),connectionDetail:''});
    }finally{
      this.setData({busy:false});
    }
  }
});
