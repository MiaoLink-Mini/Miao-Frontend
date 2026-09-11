const {definePage,runtime}=require('../../utils/page');
const {consumeList}=require('../../utils/navigation');
const FILTERS=['pending','approval','question','notices','history'];
definePage({
 fetchList:require('../../utils/query-list').fetchList,data:{filter:'pending'},
 onShow(){const intent=consumeList(runtime(),'inbox');if(intent&&FILTERS.includes(intent.filter))this.setData(intent);return this.fetchList();},
 onHide(){this.queryGeneration=(this.queryGeneration||0)+1;this.setData({listLoading:false});},
 onUnload(){this.queryGeneration=(this.queryGeneration||0)+1;},
 loadMore(){return this.fetchList(true);},
 listSource(){return this.data.filter==='notices'?{kind:'notifications',queries:[{}]}:{kind:'requests',queries:[{bucket:this.data.filter==='history'?'history':'pending'}]};},
 refresh(){const rt=runtime(),v=rt.view(),filter=this.data.filter;
  const listed=id=>!rt.live||!this.data.remoteIds||this.data.remoteIds.includes(id);
  const requests=v.requests.filter(r=>listed(r.id)&&(filter==='history'?!['pending','deciding'].includes(r.state)||r.expired:filter==='notices'?false:(r.state==='deciding'||r.state==='pending'&&!r.expired)&&(filter==='pending'||r.kind===filter))).sort((a,b)=>(a.kind==='approval'?0:1)-(b.kind==='approval'?0:1)||a.createdAt-b.createdAt);
  this.setData(Object.assign({},v,{list:requests.map(r=>Object.assign({},r,{contextLabel:r.session?[r.session.agent&&r.session.agent.name,r.session.project&&r.session.project.name].filter(Boolean).join(' · '):'会话信息待加载',sessionTitle:r.session?r.session.title:'',online:!!(r.session&&r.session.node&&r.session.node.online)})),notices:v.notifications.filter(n=>listed(n.id))}));
 },
 filter(e){const value=e.currentTarget.dataset.value;if(!FILTERS.includes(value))return;this.setData(Object.assign({filter:value},runtime().live?{remoteIds:[]}:{}));this.refresh();return this.fetchList();},
 notice(e){const rt=runtime(),id=e.currentTarget.dataset.id,notice=rt.view().notifications.find(n=>n.id===id);if(!notice)return;const open=()=>{this.fetchList();if(notice.sessionId)this.open('/pages/session/index?id='+encodeURIComponent(notice.sessionId));};if(rt.live)return this.action('markRead',[id],open);rt.gateway.markRead(id);open();}
});
