const {
  definePage,runtime,toast
}
=require('../../utils/page');
definePage({
  onLoad(q){
    let itemKey=q.itemKey||'';
    try { itemKey=decodeURIComponent(itemKey); } catch (_) { /* Keep malformed keys unmatched. */ }
    this.query=Object.assign({},q,{itemKey});
    this.setData({loading:runtime().live});
  }
  ,refresh(){
    if(runtime().live){
      const q=this.query||{},s=runtime().snapshot().sessions.find(s=>s.id===q.sessionId),file=s&&s.historyState!=='purged'&&runtime().gateway.files[q.fileId];
      this.setData({demo:false,file:file?Object.assign({},file,{name:file.path}):null,text:file?file.patch:''});return;
    }
    const q=this.query||{
    }
    ,s=runtime().snapshot().sessions.find(s=>s.id===q.sessionId),t=s&&runtime().timelines[s.id],item=t&&t.items.find(i=>i.key===q.itemKey),file=item&&item.files&&item.files.find(f=>f.id===q.fileId);
    this.setData({demo:!runtime().live,
      file:file||null,text:file?file.lines.filter(l=>l.kind!=='removed').map(l=>l.text.replace(/^\+ /,'')).join('\n'):''
    }
    );
  }
  ,async onShow(){
    if(!runtime().live)return;
    const q=this.query||{},rt=runtime(),life=this.pageLife,epoch=rt.epoch;
    this.setData({loading:true,error:''});
    await rt.ensure('sessions',q.sessionId);
    if(life!==this.pageLife||epoch!==rt.epoch)return;
    await rt.gateway.diffFile(q.fileId,q.sessionId);
    if(life===this.pageLife&&epoch===rt.epoch)this.refresh();
  }
  ,copy(){
    if(this.data.file)wx.setClipboardData({
      data:this.data.text
    }
    );
  }
}
);
