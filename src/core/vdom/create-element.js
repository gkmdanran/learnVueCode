/* @flow */

import config from '../config'
import VNode, { createEmptyVNode } from './vnode'
import { createComponent } from './create-component'
import { traverse } from '../observer/traverse'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject,
  isPrimitive,
  resolveAsset
} from '../util/index'

import {
  normalizeChildren,
  simpleNormalizeChildren
} from './helpers/index'

const SIMPLE_NORMALIZE = 1
const ALWAYS_NORMALIZE = 2

// wrapper function for providing a more flexible interface
// without getting yelled at by flow
export function createElement (
  context: Component,
  tag: any,
  data: any,
  children: any,
  normalizationType: any,
  alwaysNormalize: boolean
): VNode | Array<VNode> {
  if (Array.isArray(data) || isPrimitive(data)) {
    normalizationType = children
    children = data
    data = undefined
  }
  //用户传的render函数，规范类型是2
  if (isTrue(alwaysNormalize)) {
    normalizationType = ALWAYS_NORMALIZE
  }
  // 执行 _createElement 方法创建组件的 VNode
  return _createElement(context, tag, data, children, normalizationType)
}

export function _createElement (
  context: Component,
  tag?: string | Class<Component> | Function | Object,
  data?: VNodeData,
  children?: any,
  normalizationType?: number
): VNode | Array<VNode> {
  // 属性不能是一个响应式对象
  if (isDef(data) && isDef((data: any).__ob__)) {
    process.env.NODE_ENV !== 'production' && warn(
      `Avoid using observed data object as vnode data: ${JSON.stringify(data)}\n` +
      'Always create fresh vnode data objects in each render!',
      context
    )
    return createEmptyVNode()
  }
  // object syntax in v-bind
  //动态组件处理
  if (isDef(data) && isDef(data.is)) {
    tag = data.is
  }
  if (!tag) {
    // in case of component :is set to falsy value
    // 动态组件的 is 属性是一个假值时 tag 为 false，则返回一个空节点的 VNode
    return createEmptyVNode()
  }
  // warn against non-primitive key
  if (process.env.NODE_ENV !== 'production' &&
    isDef(data) && isDef(data.key) && !isPrimitive(data.key)
  ) {
    if (!__WEEX__ || !('@binding' in data.key)) {
      warn(
        'Avoid using non-primitive value as key, ' +
        'use string/number value instead.',
        context
      )
    }
  }
  // support single function children as default scoped slot
  // 子节点数组中只有一个函数时，将它当作默认插槽，然后清空子节点列表
  if (Array.isArray(children) &&
    typeof children[0] === 'function'
  ) {
    data = data || {}
    data.scopedSlots = { default: children[0] }
    children.length = 0
  }
  // 将子元素进行标准化处理
  if (normalizationType === ALWAYS_NORMALIZE) {
    //用户定义的，规范成vnode
    children = normalizeChildren(children)
  } else if (normalizationType === SIMPLE_NORMALIZE) {
    //渲染生成的，基本是vnode，只需做数组打平处理
    children = simpleNormalizeChildren(children)
  }
  let vnode, ns
  // 标签是字符串时，该标签有三种可能：
  //   1、平台保留标签
  //   2、自定义组件
  //   3、不知名标签
  if (typeof tag === 'string') {
    let Ctor
    ns = (context.$vnode && context.$vnode.ns) || config.getTagNamespace(tag)
    //内置标签
    if (config.isReservedTag(tag)) {
      // platform built-in elements
      if (process.env.NODE_ENV !== 'production' && isDef(data) && isDef(data.nativeOn) && data.tag !== 'component') {
        warn(
          `The .native modifier for v-on is only valid on components but it was used on <${tag}>.`,
          context
        )
      }
      //实例化vnode
      vnode = new VNode(
        config.parsePlatformTagName(tag), data, children,
        undefined, undefined, context
      )
    } else if ((!data || !data.pre) && isDef(Ctor = resolveAsset(context.$options, 'components', tag))) {
      // component
      // tag 是一个自定义组件
      // 在 this.$options.components 对象中找到指定标签名称的组件构造函数
      // 创建组件的 VNode，函数式组件直接执行其 render 函数生成 VNode，
      // 普通组件则实例化一个 VNode，并且在其 data.hook 对象上设置了 4 个方法，在组件的 patch 阶段会被调用，
      // 从而进入子组件的实例化、挂载阶段，直至完成渲染
      vnode = createComponent(Ctor, data, context, children, tag)
    } else {
      // unknown or unlisted namespaced elements
      // check at runtime because it may get assigned a namespace when its
      // parent normalizes children
      // 不知名的一个标签，但也生成 VNode，因为考虑到在运行时可能会给一个合适的名字空间
      vnode = new VNode(
        tag, data, children,
        undefined, undefined, context
      )
    }
  } else {
    // direct component options / constructor
    // tag 为非字符串，比如可能是一个组件的配置对象或者是一个组件的构造函数
    vnode = createComponent(tag, data, context, children)
  }
  if (Array.isArray(vnode)) {
    return vnode
  } else if (isDef(vnode)) {
    if (isDef(ns)) applyNS(vnode, ns)
    if (isDef(data)) registerDeepBindings(data)
    return vnode
  } else {
    return createEmptyVNode()
  }
}

function applyNS (vnode, ns, force) {
  vnode.ns = ns
  if (vnode.tag === 'foreignObject') {
    // use default namespace inside foreignObject
    ns = undefined
    force = true
  }
  if (isDef(vnode.children)) {
    for (let i = 0, l = vnode.children.length; i < l; i++) {
      const child = vnode.children[i]
      if (isDef(child.tag) && (
        isUndef(child.ns) || (isTrue(force) && child.tag !== 'svg'))) {
        applyNS(child, ns, force)
      }
    }
  }
}

// ref #5318
// necessary to ensure parent re-render when deep bindings like :style and
// :class are used on slot nodes
function registerDeepBindings (data) {
  if (isObject(data.style)) {
    traverse(data.style)
  }
  if (isObject(data.class)) {
    traverse(data.class)
  }
}
