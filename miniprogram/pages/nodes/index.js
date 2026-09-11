const {
  definePage,runtime
}
=require('../../utils/page');
definePage({
  data:{
    revoked:false
  }
  ,refresh(){
    const v=runtime().view();
    this.setData(Object.assign(v,{
      list:v.nodes.filter(n=>n.revoked===this.data.revoked)
    }
    ));
  }
  ,toggle(e){
    this.setData({
      revoked:e.currentTarget.dataset.value==='revoked'
    }
    );
    this.refresh();
  }
}
);
