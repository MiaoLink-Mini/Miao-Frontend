const {definePage}=require('../../utils/page');const requirements=require('../../catalog/requirements');
definePage({onLoad(q){this.setData({requirement:requirements.find(r=>r.id===q.id)||null});}});
