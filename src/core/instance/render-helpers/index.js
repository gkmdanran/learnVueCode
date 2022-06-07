/* @flow */

import { toNumber, toString, looseEqual, looseIndexOf } from 'shared/util'
import { createTextVNode, createEmptyVNode } from 'core/vdom/vnode'
import { renderList } from './render-list'
import { renderSlot } from './render-slot'
import { resolveFilter } from './resolve-filter'
import { checkKeyCodes } from './check-keycodes'
import { bindObjectProps } from './bind-object-props'
import { renderStatic, markOnce } from './render-static'
import { bindObjectListeners } from './bind-object-listeners'
import { resolveScopedSlots } from './resolve-scoped-slots'
import { bindDynamicKeys, prependModifier } from './bind-dynamic-keys'

export function installRenderHelpers (target: any) {
  target._o = markOnce
  // 将值转换为数字
  target._n = toNumber
  //将值转换为字符串形式，普通值 => String(val)，对象 => JSON.stringify(val)
  target._s = toString
  //运行时渲染 v-for，循环遍历 val 值，依次为每一项执行 render 方法生成 VNode，最终返回一个 VNode 数组
  target._l = renderList
  target._t = renderSlot
  //判断两个值是否相等
  target._q = looseEqual
  //相当于 indexOf 方法
  target._i = looseIndexOf
  /**
   * 运行时负责生成静态树的 VNode 的帮助程序，完成了以下两件事
   *   1、执行 staticRenderFns 数组中指定下标的渲染函数，生成静态树的 VNode 并缓存，下次在渲染时从缓存中直接读取（isInFor 必须为 true）
   *   2、为静态树的 VNode 打静态标记
   */
  target._m = renderStatic
  //解析得到过滤器
  target._f = resolveFilter
  target._k = checkKeyCodes
  target._b = bindObjectProps
  //为文本节点创建 VNode
  target._v = createTextVNode
  //为空节点创建 VNode
  target._e = createEmptyVNode
  target._u = resolveScopedSlots
  target._g = bindObjectListeners
  //处理动态属性
  target._d = bindDynamicKeys
  //capture、once、passive事件修饰添加标记
  target._p = prependModifier
}
