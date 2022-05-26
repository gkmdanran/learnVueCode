import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'

function Vue (options) {
  console.log('------test new Vue()------')
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)  //new Vue()时执行进行初始化，将用户定义的options作为参数传入。
}

initMixin(Vue)  //Vue原型上挂载_init函数，在new Vue()时会执行此方法进行初始化。
stateMixin(Vue) //Vue原型上挂载$set、$delete、$watch方法。原型上添加$data、$props属性。
eventsMixin(Vue) //Vue原型上挂载$emit、$on、$off、$once方法，这些都是Vue事件系统的方法。Event Bus的原理也是再此。
lifecycleMixin(Vue) //Vue原型上挂载了_update方法用来进行vnode的patch操作；$forceUpdate方法强制更新视图；$destroy销毁组件。
renderMixin(Vue) //Vue原型挂载了$nextTick方法；_render方法用来根据用户传递的render函数或编译生成的render函数生成vnode。

export default Vue
