const {markdown,clipText}=require('../../utils/code-view');
const STATES={running:'执行中',completed:'完成',failed:'失败',cancelled:'已停止',resolved:'已处理',pending:'待处理'};
Component({
 options:{styleIsolation:'apply-shared'},
 properties:{item:Object,large:Boolean,agent:Object,readonly:Boolean},
 data:{expanded:false,actionsVisible:false,blocks:[],messageLimit:6000,messageMore:false,outputLimit:3000,outputText:'',outputMore:false,fileCount:0,added:0,removed:0},
 observers:{item(value){
  if(!value)return;
  const patch={stateLabel:STATES[value.state]||value.state||'',stateIcon:({completed:'check',failed:'warning',cancelled:'stop',resolved:'check-circle',pending:'clock'})[value.state]||'terminal'};
  if(this.lastText!==value.text){this.lastText=value.text;const text=clipText(value.text,this.data.messageLimit);patch.blocks=markdown(text);patch.messageMore=text.length<(value.text||'').length;}
  if(value.type==='diff'){patch.fileCount=(value.files||[]).length;patch.added=(value.files||[]).reduce((n,f)=>n+(f.added||0),0);patch.removed=(value.files||[]).reduce((n,f)=>n+(f.removed||0),0);}
  this.setData(patch);if(this.data.expanded)this.renderOutput();
 }},
 methods:{
  toggleActions(){if(['user','assistant','result'].includes((this.data.item||{}).type))this.setData({actionsVisible:!this.data.actionsVisible});},
  moreMessage(){const limit=this.data.messageLimit+8000,text=clipText(this.data.item.text,limit);this.setData({messageLimit:limit,blocks:markdown(text),messageMore:text.length<(this.data.item.text||'').length});},
  toggle(){this.setData({expanded:!this.data.expanded});if(this.data.expanded)this.renderOutput();},
  renderOutput(){const text=this.data.item.detail||'',visible=clipText(text,this.data.outputLimit);this.setData({outputText:visible,outputMore:visible.length<text.length});},
  moreOutput(){this.setData({outputLimit:this.data.outputLimit+5000});this.renderOutput();},
  open(){this.triggerEvent('open',{item:this.data.item});},
  copy(){wx.setClipboardData({data:this.data.item.detail||this.data.item.text||''});},
  copyCode(e){const blocks=this.data.messageMore?markdown(this.data.item.text):this.data.blocks;const block=blocks.find(b=>b.id===e.currentTarget.dataset.id);if(block&&block.kind==='code')wx.setClipboardData({data:block.lines.map(l=>l.text).join('\n')});},
  quote(){if(!this.data.readonly)this.triggerEvent('quote',{text:this.data.item.text||''});}
 }
});
