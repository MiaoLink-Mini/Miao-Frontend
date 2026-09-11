const {
  definePage,runtime
}
=require('../../utils/page');
const nav=require('../../utils/navigation');
definePage({
  resource: "nodes",
  data:{
    id:''
  }
  ,onLoad(q){
    this.setData({
      id:q.id||''
    }
    );
  }
  ,refresh(){
    const v=runtime().view(),node=v.nodes.find(n=>n.id===this.data.id);
    this.setData(Object.assign(v,{demo:!runtime().live,
      newUrl:nav.createUrl({nodeId:this.data.id}),node:node||null,projects:v.projects.filter(p=>p.nodeId===this.data.id),agents:v.agents.filter(a=>a.nodeId===this.data.id),sessions:v.sessions.filter(s=>s.nodeId===this.data.id)
    }
    ));
  }
  ,allSessions(){nav.switchList(runtime(),'sessions',{nodeId:this.data.id,projectId:'',agentId:'',filter:'all',organization:'all'});}
  ,revoke(){
    if(!this.data.node||this.data.node.revoked||this.data.busy||this.data.unknown)return;
    wx.showModal({
      title:'撤销此设备的远程访问？',content:`设备：${this.data.node.name}。旧控制权限将失效；恢复接入需要新的有效配对。此操作不会删除主机文件。`,confirmText:'撤销访问',confirmColor:'#b64337',success:r=>{
        if(r.confirm)this.action('revoke',[this.data.id]);
      }
    }
    );
  }
}
);
