const { errorText } = require('../../utils/error-display');
Component({options:{styleIsolation:'apply-shared'}, properties:{ state:{type:String,value:''}, label:{type:String,value:''} }, methods:{ recover(){ getApp().runtime.recover().catch(error=>wx.showToast({title:errorText(error, 'NETWORK_ERROR'),icon:'none'})); } } });
