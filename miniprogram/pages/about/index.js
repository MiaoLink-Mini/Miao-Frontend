const {definePage}=require('../../utils/page');
definePage({
  data:{
    version:require('../../config').version,
    repos:[
      {name:'Miao-Frontend',label:'小程序前端',url:'https://github.com/MiaoLink-Mini/Miao-Frontend'},
      {name:'Miao-Backend',label:'Go 网关后端',url:'https://github.com/MiaoLink-Mini/Miao-Backend'},
      {name:'Miao-Node',label:'Node 主机端',url:'https://github.com/MiaoLink-Mini/Miao-Node'}
    ],
    developers:[
      {name:'TomorrowX6',role:'全栈工程师',url:'https://github.com/TomorrowX6',avatar:'/assets/github-tomorrowx6.png'},
      {name:'QGQ123-qwq',role:'全栈工程师',url:'https://github.com/QGQ123-qwq',avatar:'/assets/github-qgq123-qwq.png'}
    ]
  },
  refresh(){},
  copyRepo(e){
    const repo=this.data.repos.find(item=>item.name===e.currentTarget.dataset.name);
    if(repo)wx.setClipboardData({data:repo.url});
  },
  copyGithub(e){
    const developer=this.data.developers.find(item=>item.name===e.currentTarget.dataset.name);
    if(developer)wx.setClipboardData({data:developer.url});
  }
});
