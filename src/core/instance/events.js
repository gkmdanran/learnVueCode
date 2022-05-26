/* @flow */

import {
  tip,
  toArray,
  hyphenate,
  formatComponentName,
  invokeWithErrorHandling
} from '../util/index'
import { updateListeners } from '../vdom/helpers/index'

export function initEvents (vm: Component) {
  vm._events = Object.create(null)
  vm._hasHookEvent = false
  // init parent attached events
  const listeners = vm.$options._parentListeners
  if (listeners) {
    updateComponentListeners(vm, listeners)
  }
}

let target: any

function add (event, fn) {
  target.$on(event, fn)
}

function remove (event, fn) {
  target.$off(event, fn)
}

function createOnceHandler (event, fn) {
  const _target = target
  return function onceHandler () {
    const res = fn.apply(null, arguments)
    if (res !== null) {
      _target.$off(event, onceHandler)
    }
  }
}

export function updateComponentListeners (
  vm: Component,
  listeners: Object,
  oldListeners: ?Object
) {
  target = vm
  updateListeners(listeners, oldListeners || {}, add, remove, createOnceHandler, vm)
  target = undefined
}

export function eventsMixin (Vue: Class<Component>) {
  const hookRE = /^hook:/
  Vue.prototype.$on = function (event: string | Array<string>, fn: Function): Component {
    const vm: Component = this
    //event是一个数组，循环调用$on
    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$on(event[i], fn)
      }
    } else {
      //event是字符串及事件名:在vm._events对象中事件名对应的事件函数数组中添加传入的函数。
      //vm._events={
      //   'eventName1':[fn1,fn2,fn3,....],
      //   'eventName2':[fn4,fn5,fn6,....],
      //   ....
      // }
      (vm._events[event] || (vm._events[event] = [])).push(fn)
      // optimize hook:event cost by using a boolean flag marked at registration
      // instead of a hash lookup
      // 如果事件名是类似这样的：'@hook:mounted'，则在实例上添加_hasHookEvent=true表示存在HookEvent
      if (hookRE.test(event)) {
        vm._hasHookEvent = true
      }
    }
    return vm
  }

  Vue.prototype.$once = function (event: string, fn: Function): Component {
    const vm: Component = this
    //$emit时调用的函数是on，调用on时会先在_events中移除on，然后再调用fn
    //fn函数会存放在on的fn上，当调用$off时就会通过on.fn与用户传入的fn进行比较
    function on () {
      vm.$off(event, on)
      fn.apply(vm, arguments)
    }
    on.fn = fn
    vm.$on(event, on)  //将on存放到event对应的事件函数数组中
    return vm
  }

  Vue.prototype.$off = function (event?: string | Array<string>, fn?: Function): Component {
    const vm: Component = this
    //调用this.$off()，没有传递任何参数，表示清空实例上所有的事件：vm._events={}
    if (!arguments.length) {
      vm._events = Object.create(null)
      return vm
    }
    //event是一个数组，循环调用$off
    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$off(event[i], fn)
      }
      return vm
    }
    //_events中压根没有存放任何关于event的事件函数，则直接return，啥也不会做。
    const cbs = vm._events[event]
    if (!cbs) {
      return vm
    }
    //第二个参数fn没有传递，则清空event对应的事件函数数组。
    if (!fn) {
      vm._events[event] = null
      return vm
    }
    //遍历event对应的事件函数数组，找到对应的函数移除。
    let cb
    let i = cbs.length
    while (i--) {
      cb = cbs[i]
      //这里的cb.fn === fn是为了兼容处理$once方法：
      //因为$once中用户传入的fn不会直接塞入事件函数数组中而是存放在包裹后的函数的fn上。
      //再将包裹后的函数塞入事件函数数组
      if (cb === fn || cb.fn === fn) {   
        cbs.splice(i, 1)
        break
      }
    }
    return vm
  }

  Vue.prototype.$emit = function (event: string): Component {
    const vm: Component = this
    if (process.env.NODE_ENV !== 'production') {
      const lowerCaseEvent = event.toLowerCase()
      if (lowerCaseEvent !== event && vm._events[lowerCaseEvent]) {
        tip(
          `Event "${lowerCaseEvent}" is emitted in component ` +
          `${formatComponentName(vm)} but the handler is registered for "${event}". ` +
          `Note that HTML attributes are case-insensitive and you cannot use ` +
          `v-on to listen to camelCase events when using in-DOM templates. ` +
          `You should probably use "${hyphenate(event)}" instead of "${event}".`
        )
      }
    }
    //找到event对应的事件函数数组
    let cbs = vm._events[event]
    if (cbs) {
      cbs = cbs.length > 1 ? toArray(cbs) : cbs
      const args = toArray(arguments, 1) //this.$emit(eventName,arg1,..)获取除了eventName的其余参数。
      const info = `event handler for "${event}"`
      for (let i = 0, l = cbs.length; i < l; i++) { //循环调用事件函数，并传入args参数。
        invokeWithErrorHandling(cbs[i], vm, args, vm, info)
      }
    }
    return vm
  }
}
