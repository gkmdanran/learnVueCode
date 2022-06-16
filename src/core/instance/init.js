/* @flow */

import config from '../config'
import { initProxy } from './proxy'
import { initState } from './state'
import { initRender } from './render'
import { initEvents } from './events'
import { mark, measure } from '../util/perf'
import { initLifecycle, callHook } from './lifecycle'
import { initProvide, initInjections } from './inject'
import { extend, mergeOptions, formatComponentName } from '../util/index'

let uid = 0

export function initMixin (Vue: Class<Component>) {
  Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    // a uid
    // 每个 vue 实例都有一个 _uid，并且是依次递增的
    vm._uid = uid++

    let startTag, endTag
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      mark(startTag)
    }

    // a flag to avoid this being observed
    vm._isVue = true   //实例上添加_isVue标记防止被响应式处理
    // merge options
    if (options && options._isComponent) {   //如果是组件调用的_init方法会走这里
      // optimize internal component instantiation
      // since dynamic options merging is pretty slow, and none of the
      // internal component options needs special treatment.
      initInternalComponent(vm, options)
    } else {
      //Vue根走这里
      //将用户new Vue()时传入的options和Vue构造函数上的options合并，然后添加到实例的$options上
      //组件选项合并主要发生在以下三个地方
      //1.Vue.component(CompName,Comp)，做了选项合并，合并的Vue内置的全局组件和用户自己注册的全局组件，最终都会放到全局的components选项中
      //2.{components:{xxx}},局部注册组件，执行编译器生成render函数时做了选项合并，会合并全局配置项到组建局部配置上
      //3.这里的根组件情况
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      initProxy(vm)
    } else {
      vm._renderProxy = vm
    }
    // expose real self
    vm._self = vm
    initLifecycle(vm)//初始化$parent、$root、$children、$refs
    initEvents(vm)   //初始化事件vm._events={},如果是组件：更新组件的事件updateComponentListeners
    initRender(vm)   //createElement
    callHook(vm, 'beforeCreate')  //调用beforeCreate生命周期函数
    initInjections(vm) // 处理inject
    initState(vm)//初始化props、methods、data、computed、watch
    initProvide(vm) // 处理provide
    callHook(vm, 'created') //调用created生命周期函数

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`vue ${vm._name} init`, startTag, endTag)
    }
    //如果用户在options中定义了el，则调用$mount挂载
    if (vm.$options.el) {
      vm.$mount(vm.$options.el)
    }
  }
}

export function initInternalComponent (vm: Component, options: InternalComponentOptions) {
  //基于原来组件的构造函数上的options创建一个opts对象
  const opts = vm.$options = Object.create(vm.constructor.options)
  // doing this because it's faster than dynamic enumeration.
  // 组件调用_init时也会传入{_isComponent: true,_parentVnode: vnode,parent}作为options
  const parentVnode = options._parentVnode
  //$options.parent
  opts.parent = options.parent
  //$options._parentVnode=_parentVnode
  opts._parentVnode = parentVnode

  //componentOptions={ Ctor, propsData, listeners, tag, children }
  const vnodeComponentOptions = parentVnode.componentOptions
  //$options.propsData=propsData
  opts.propsData = vnodeComponentOptions.propsData
  //$options._parentListeners=listeners
  opts._parentListeners = vnodeComponentOptions.listeners
  //$options._renderChildren=children
  opts._renderChildren = vnodeComponentOptions.children
  //$options._componentTag=tag
  opts._componentTag = vnodeComponentOptions.tag
  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}

export function resolveConstructorOptions (Ctor: Class<Component>) {
  let options = Ctor.options
  //根不存在super，则直接获取构造函数的options返回
  if (Ctor.super) {
    //存在父类，递归解析父类构造函数的选项
    const superOptions = resolveConstructorOptions(Ctor.super)
    //获得原来父类选项
    const cachedSuperOptions = Ctor.superOptions
    //进行比较
    if (superOptions !== cachedSuperOptions) {
      // super option changed,
      // need to resolve new options.
      //如果不相同，则说明父类构造函数选项已经发生改变，需要重新设置
      Ctor.superOptions = superOptions
      // check if there are any late-modified/attached options (#4976)
      // 检查 Ctor.options 上是否有任何后期修改/附加的选项
      const modifiedOptions = resolveModifiedOptions(Ctor)
      // update base extend options
      // 如果存在被修改或增加的选项，则合并到extendOptions，这个extendOptions就是调用extend时传入的参数option
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions)
      }
      //再将superOptions和extendOptions合并更新原来子类构造函数的options
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions)
      if (options.name) {
        options.components[options.name] = Ctor
      }
    }
  }
  return options
}

function resolveModifiedOptions (Ctor: Class<Component>): ?Object {
  let modified
  //最新的选项
  const latest = Ctor.options
  //之前密封保存的选项
  const sealed = Ctor.sealedOptions
  //两者进行比较，找出不同项，返回
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {}
      modified[key] = latest[key]
    }
  }
  return modified
}
