Component({
  options: {styleIsolation:'apply-shared'},
  properties: {open:Boolean, title:String, sessions:Array},
  methods: {
    close() {this.triggerEvent('close');},
    noop() {},
    choose(event) {
      const id = event.currentTarget.dataset.id;
      if ((this.data.sessions || []).some(session => session.id === id)) this.triggerEvent('select',{id});
    }
  }
});
