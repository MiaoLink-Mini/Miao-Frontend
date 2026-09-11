const {
  definePage,runtime
}
=require('../../utils/page');
const requirements=require('../../catalog/requirements');
definePage({
  data:{
    query:''
  }
  ,refresh(){
    const q=this.data.query.toLowerCase(),list=requirements.filter(r=>!q||(r.id+' '+r.name+' '+r.entry).toLowerCase().includes(q));
    const groups=[];
    list.forEach(r=>{
      let group=groups.find(g=>g.id===r.group);
      if(!group){
        group={
          id:r.group,title:r.groupName,items:[]
        }
        ;
        groups.push(group);
      }
      group.items.push(r);
    }
    );
    this.setData({demo:!runtime().live,
      groups,total:list.length,missingCount:requirements.filter(r=>r.status==='未接入').length,plannedCount:requirements.filter(r=>r.status==='扩展规划').length,partialCount:requirements.filter(r=>r.status==='部分实现').length
    }
    );
  }
  ,input(e){
    this.setData({
      query:e.detail.value
    }
    );
    this.refresh();
  }
}
);
