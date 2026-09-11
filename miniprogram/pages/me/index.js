const { errorText } = require('../../utils/error-display');
const {
  definePage,runtime
}
=require('../../utils/page');
definePage({
  data: { avatarPath: '/assets/default-avatar.png' },
  async onShow() {
    const rt=runtime(); if(!rt.live)return;
    const epoch=rt.epoch, life=this.pageLife, userId=rt.gateway.user.id;
    try {
      const profile=await rt.gateway.getProfile();
      if(epoch!==rt.epoch || life!==this.pageLife)return;
      rt.gateway.user.displayName=profile.displayName;
      const avatarPath=await require('../../utils/profile-image').avatarFile(wx,userId,profile);
      if(epoch===rt.epoch && life===this.pageLife)this.setData({avatarPath,accountTitle:profile.displayName});
    } catch (_) { /* Keep the last available profile; the editor offers explicit retry. */ }
  },
  editProfile() {
    if(!runtime().live)return wx.showToast({title:errorText('UNAUTHENTICATED'),icon:'none'});
    wx.navigateTo({url:'/pages/profile/index'});
  },
  refresh(){
    const rt=runtime(),user=rt.live&&rt.gateway.user;
    const uid=user&&user.id||'demo';
    if(this.profileUserId!==uid){this.profileUserId=uid;this.setData({avatarPath:'/assets/default-avatar.png'});}
    this.setData(Object.assign(rt.view(),{demo:!rt.live,
      accountTitle:user&&user.displayName?user.displayName:'喵连',
      accountNote:rt.live?'已连接真实 Gateway':'本地身份 · 尚未关联微信账号',
      version:require('../../config').version}));
  }
  ,logout(){
    const live=runtime().live;
    wx.showModal({
      title:live?'退出登录？':'退出演示账号？',content:(live?'撤销本次登录令牌，':'')+'清除本次草稿与正文缓存。退出页面或账号不会终止远端任务。',success:r=>{
        if(r.confirm){
          Promise.resolve(runtime().logout()).catch(()=>{}).then(()=>wx.reLaunch({
            url:'/pages/login/index'
          }
          ));
        }
      }
    }
    );
  }
}
);
