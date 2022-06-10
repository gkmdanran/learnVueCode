/* @flow */

import VNode from './vnode'
import { resolveConstructorOptions } from 'core/instance/init'
import { queueActivatedComponent } from 'core/observer/scheduler'
import { createFunctionalComponent } from './create-functional-component'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject
} from '../util/index'

import {
  resolveAsyncComponent,
  createAsyncPlaceholder,
  extractPropsFromVNodeData
} from './helpers/index'

import {
  callHook,
  activeInstance,
  updateChildComponent,
  activateChildComponent,
  deactivateChildComponent
} from '../instance/lifecycle'

import {
  isRecyclableComponent,
  renderRecyclableComponentTemplate
} from 'weex/runtime/recycle-list/render-component-template'

// inline hooks to be invoked on component VNodes during patch
// patch 期间在组件 vnode 上调用内联钩子
const componentVNodeHooks = {
   // 初始化
  init (vnode: VNodeWithData, hydrating: boolean): ?boolean {
    if (
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) {
      // kept-alive components, treat as a patch
      // 被 keep-alive 包裹的组件
      const mountedNode: any = vnode // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode)
    } else {
      // 创建组实例，执行_init方法
      const child = vnode.componentInstance = createComponentInstanceForVnode(
        vnode,
        activeInstance
      )
      //组件实例进行挂载
      child.$mount(hydrating ? vnode.elm : undefined, hydrating)
    }
  },

  // 更新 VNode，用新的 VNode 配置更新旧的 VNode 上的各种属性
  prepatch (oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    // 新 VNode 的组件配置项
    const options = vnode.componentOptions
    // 老 VNode 的组件实例
    const child = vnode.componentInstance = oldVnode.componentInstance
     // 用 新vnode 上的属性更新 child 上的各种属性
    updateChildComponent(
      child,
      options.propsData, // updated props
      options.listeners, // updated listeners
      vnode, // new parent vnode
      options.children // new children
    )
  },

  insert (vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode
    // 如果组件未挂载，则调用 mounted 声明周期钩子
    if (!componentInstance._isMounted) {
      componentInstance._isMounted = true
      callHook(componentInstance, 'mounted')
    }
    // 处理 keep-alive 组件的异常情况
    if (vnode.data.keepAlive) {
      if (context._isMounted) {
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.
        queueActivatedComponent(componentInstance)
      } else {
        activateChildComponent(componentInstance, true /* direct */)
      }
    }
  },

  destroy (vnode: MountedComponentVNode) {
    // 获取组件实例
    const { componentInstance } = vnode
    if (!componentInstance._isDestroyed) {
      if (!vnode.data.keepAlive) {
        //不被keep-alive销毁，则直接调用 $destroy 方法销毁组件
        componentInstance.$destroy()
      } else {
        // 负责让组件失活，不销毁组件实例，从而缓存组件的状态
        deactivateChildComponent(componentInstance, true /* direct */)
      }
    }
  }
}

const hooksToMerge = Object.keys(componentVNodeHooks)

export function createComponent (
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  // 组件构造函数不存在，直接结束
  if (isUndef(Ctor)) {
    return
  }
  //这里就是Vue
  const baseCtor = context.$options._base

  // plain options object: turn it into a constructor
  // 当 Ctor 为配置对象时，通过 Vue.extend 将其转为构造函数sub
  if (isObject(Ctor)) {
    Ctor = baseCtor.extend(Ctor)
  }

  // if at this stage it's not a constructor or an async component factory,
  // reject.
  // 如果到这个为止，Ctor 仍然不是一个函数，则表示这是一个无效的组件定义
  if (typeof Ctor !== 'function') {
    if (process.env.NODE_ENV !== 'production') {
      warn(`Invalid Component definition: ${String(Ctor)}`, context)
    }
    return
  }

  // async component
  // 异步组件markGkM
  let asyncFactory
  if (isUndef(Ctor.cid)) {
    asyncFactory = Ctor
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor)
    if (Ctor === undefined) {
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.
      return createAsyncPlaceholder(
        asyncFactory,
        data,
        context,
        children,
        tag
      )
    }
  }

  data = data || {}

  // resolve constructor options in case global mixins are applied after
  // component constructor creation
  // 解析构造函数选项，并合基类选项
  resolveConstructorOptions(Ctor)

  // transform component v-model data into props & events
  // 将组件的 v-model 的信息（值和回调）转换为 data.attrs 对象的属性、值和 data.on 对象上的事件、回调
  if (isDef(data.model)) {
    transformModel(Ctor.options, data)
  }

  // extract props
  // 提取 props 数据，得到 propsData 对象，propsData[key] = val
  // 以组件 props 配置中的属性为 key，父组件中对应的数据为 value
  const propsData = extractPropsFromVNodeData(data, Ctor, tag)

  // functional component
  // 函数组件
  if (isTrue(Ctor.options.functional)) {
    return createFunctionalComponent(Ctor, propsData, data, context, children)
  }

  // extract listeners, since these needs to be treated as
  // child component listeners instead of DOM listeners
  // 获取事件监听器对象 data.on，因为这些监听器需要作为子组件监听器处理，而不是 DOM 监听器
  const listeners = data.on
  // replace with listeners with .native modifier
  // so it gets processed during parent component patch.
  // 将带有 .native 修饰符的事件对象赋值给 data.on
  data.on = data.nativeOn

  if (isTrue(Ctor.options.abstract)) {
    // abstract components do not keep anything
    // other than props & listeners & slot

    // work around flow
    const slot = data.slot
    data = {}
    if (slot) {
      data.slot = slot
    }
  }

  // install component management hooks onto the placeholder node
   /**
   * 在组件的 data 对象上设置 hook 对象，
   * hook 对象增加四个属性，init、prepatch、insert、destroy，
   * 负责组件的创建、更新、销毁，这些方法在组件的 patch 阶段会被调用
   * install component management hooks onto the placeholder node
   */
  installComponentHooks(data)

  // return a placeholder vnode
  // 实例化组件的 VNode，对于普通组件的标签名会比较特殊，vue-component-${cid}-${name}
  const name = Ctor.options.name || tag
  //创建组件的vnode
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ''}`,
    data, undefined, undefined, undefined, context,
    { Ctor, propsData, listeners, tag, children },   //vnode.componentOptions
    asyncFactory
  )

  // Weex specific: invoke recycle-list optimized @render function for
  // extracting cell-slot template.
  // https://github.com/Hanks10100/weex-native-directive/tree/master/component
  /* istanbul ignore if */
  if (__WEEX__ && isRecyclableComponent(vnode)) {
    return renderRecyclableComponentTemplate(vnode)
  }

  return vnode
}

export function createComponentInstanceForVnode (
  // we know it's MountedComponentVNode but flow doesn't
  vnode: any,
  // activeInstance in lifecycle state
  parent: any
): Component {
  const options: InternalComponentOptions = {
    _isComponent: true,
    _parentVnode: vnode,
    parent
  }
  // check inline-template render functions
  // 检查内联模版渲染函数
  const inlineTemplate = vnode.data.inlineTemplate
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render
    options.staticRenderFns = inlineTemplate.staticRenderFns
  }
  // vnode.componentOptions.Ctor就是通过Vue.extend创建的组件构造函数sub，new 的时候会创建一个组件实例，并执行vue实例的_init方法
  return new vnode.componentOptions.Ctor(options)
}

function installComponentHooks (data: VNodeData) {
  //在组件data上设置hook对象
  const hooks = data.hook || (data.hook = {})
  // 遍历 hooksToMerge 数组，hooksToMerge = ['init', 'prepatch', 'insert' 'destroy']
  for (let i = 0; i < hooksToMerge.length; i++) {
    // 比如 key = init
    const key = hooksToMerge[i]
     // 从 data.hook 对象中获取 key 对应的方法
    const existing = hooks[key]
    // componentVNodeHooks 对象中 key 对象的方法
    const toMerge = componentVNodeHooks[key]
    // 合并用户传递的 hook 方法和框架自带的 hook 方法，其实就是分别执行两个方法
    if (existing !== toMerge && !(existing && existing._merged)) {
      hooks[key] = existing ? mergeHook(toMerge, existing) : toMerge
    }
  }
}

function mergeHook (f1: any, f2: any): Function {
  //将两个函数合并成一个函数，合并后的函数就是内部分别调用这两个函数
  const merged = (a, b) => {
    // flow complains about extra args which is why we use any
    f1(a, b)
    f2(a, b)
  }
  //已合并标记
  merged._merged = true
  return merged
}

// transform component v-model info (value and callback) into
// prop and event handler respectively.
function transformModel (options, data: any) {
  const prop = (options.model && options.model.prop) || 'value'
  const event = (options.model && options.model.event) || 'input'
  ;(data.attrs || (data.attrs = {}))[prop] = data.model.value
  const on = data.on || (data.on = {})
  const existing = on[event]
  const callback = data.model.callback
  if (isDef(existing)) {
    if (
      Array.isArray(existing)
        ? existing.indexOf(callback) === -1
        : existing !== callback
    ) {
      on[event] = [callback].concat(existing)
    }
  } else {
    on[event] = callback
  }
}
