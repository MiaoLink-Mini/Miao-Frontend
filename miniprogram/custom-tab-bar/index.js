const appearance=require('../utils/appearance');
Component({
  options:{styleIsolation:'apply-shared'},
  data:{selected:0,pendingCount:0,hidden:false,tabs:[{url:'/pages/home/index',label:'总览',icon:'home'},{url:'/pages/sessions/index',label:'会话',icon:'sessions'},{url:'/pages/inbox/index',label:'待处理',icon:'inbox'},{url:'/pages/me/index',label:'我的',icon:'me'}]},
  lifetimes:{attached(){this.syncAppearance();}},
  pageLifetimes:{show(){this.syncAppearance();}},
  methods:{
    syncAppearance(){
      const pages=getCurrentPages(),page=pages[pages.length-1];
      // Native page show notifications must not reveal the bar over an open sheet.
      const patch=Object.assign({},appearance.view(getApp().appearance),{hidden:!!(page&&page.data.themeSheet)});
      const selected=this.data.tabs.findIndex(tab=>page&&tab.url==='/'+page.route);
      if(selected>=0)patch.selected=selected;
      this.setData(patch);
    },
    switch(e){const index=Number(e.currentTarget.dataset.index);if(this.data.tabs[index]&&index!==this.data.selected)wx.switchTab({url:this.data.tabs[index].url});}
  }
});
