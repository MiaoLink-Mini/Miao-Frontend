Component({
  options:{styleIsolation:'apply-shared'},
  properties:{session:Object,swipeable:Boolean,revealed:Boolean},
  methods:{
    touchStart(e){const p=e.touches[0];this.gesture={x:p.clientX,y:p.clientY};this.swiped=false;},
    touchEnd(e){
      const p=e.changedTouches[0],g=this.gesture;this.gesture=null;
      if(!p||!g||!this.data.swipeable)return;
      const dx=p.clientX-g.x,dy=p.clientY-g.y;
      if(Math.abs(dx)<40||Math.abs(dx)<Math.abs(dy)*1.5)return;
      this.swiped=true;this.triggerEvent('reveal',{id:dx<0?this.data.session.id:''});
    },
    touchCancel(){this.gesture=null;this.swiped=true;},
    remove(){this.triggerEvent('delete',{id:this.data.session.id});},
    rename(){this.triggerEvent('rename',{id:this.data.session.id});},
    open(){if(this.swiped){this.swiped=false;return;}if(this.data.revealed){this.triggerEvent('reveal',{id:''});return;}wx.navigateTo({url:'/pages/session/index?id='+encodeURIComponent(this.data.session.id)});}
  }
});
