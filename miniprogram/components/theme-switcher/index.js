const {THEMES}=require('../../utils/appearance');
Component({options:{styleIsolation:'apply-shared'},properties:{open:Boolean,selected:String,motion:String},data:{themes:THEMES},methods:{close(){this.triggerEvent('close');},noop(){},choose(e){this.triggerEvent('change',{id:e.currentTarget.dataset.id});},motionChange(e){this.triggerEvent('motion',{id:e.currentTarget.dataset.id});}}});
