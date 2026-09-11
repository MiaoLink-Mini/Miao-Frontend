const {definePage,runtime}=require('../../utils/page');
definePage({data:{query:''},
 input(e){this.setData({query:e.detail.value});this.refresh();},
 refresh(){const rt=runtime(),v=rt.view(),q=this.data.query.trim().toLowerCase();this.setData({connection:v.connection,connectionLabel:v.connectionLabel,projects:v.projects.map(p=>{const node=v.nodes.find(n=>n.id===p.nodeId);return Object.assign({},p,{nodeName:node?node.name:'设备不可访问',online:!!node&&node.online,sessionCount:v.sessions.filter(s=>s.projectId===p.id&&!s.archived&&s.historyState!=='purged').length});}).filter(p=>!q||[p.name,p.nodeName,p.description].filter(Boolean).join(' ').toLowerCase().includes(q))});}
});
