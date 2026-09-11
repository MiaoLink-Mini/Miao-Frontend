const KEY='weagent:guide:v1';
function completed(api){try{return api.getStorageSync(KEY)===true;}catch(_){return false;}}
function afterLogin(app,api){
  if(!completed(api)){api.redirectTo({url:'/pages/guide/index'});return;}
  continueToApp(app,api);
}
function continueToApp(app,api){
  // Invite secrets never go to persistent storage or the owner runtime snapshot.
  if(app.pendingShareToken){api.redirectTo({url:'/pages/shared/index'});return;}
  api.switchTab({url:'/pages/home/index'});
}
function complete(api){api.setStorageSync(KEY,true);}
function finish(app,api){complete(api);continueToApp(app,api);}
module.exports={KEY,completed,afterLogin,continueToApp,finish,complete};
