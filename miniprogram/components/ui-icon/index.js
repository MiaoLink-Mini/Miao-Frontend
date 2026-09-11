const appearance=require('../../utils/appearance');
const {source}=require('../../utils/icon-source');
Component({
 options:{styleIsolation:'isolated'},
 properties:{name:{type:String,value:''},size:{type:Number,value:40},tone:{type:String,value:'ink'},theme:{type:String,value:''}},
 data:{src:'',edge:40},
 observers:{name(){this.syncIcon();},size(){this.syncIcon();},tone(){this.syncIcon();},theme(){this.syncIcon();}},
 lifetimes:{attached(){this.unsubscribeIcon=appearance.subscribe(()=>this.syncIcon());this.syncIcon();},detached(){if(this.unsubscribeIcon)this.unsubscribeIcon();this.unsubscribeIcon=null;}},
 methods:{syncIcon(){const size=Number(this.data.size),edge=Number.isFinite(size)?Math.max(12,Math.min(160,size)):40;const theme=this.data.theme||appearance.normalize(getApp().appearance).theme;const src=source(this.data.name,theme,this.data.tone);if(src!==this.data.src||edge!==this.data.edge)this.setData({src,edge});}}
});
