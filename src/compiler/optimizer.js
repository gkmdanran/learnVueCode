/* @flow */

import { makeMap, isBuiltInTag, cached, no } from 'shared/util'

let isStaticKey
let isPlatformReservedTag

const genStaticKeysCached = cached(genStaticKeys)

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
export function optimize (root: ?ASTElement, options: CompilerOptions) {
  if (!root) return
  isStaticKey = genStaticKeysCached(options.staticKeys || '')
  isPlatformReservedTag = options.isReservedTag || no
  // first pass: mark all non-static nodes.
  // 遍历所有节点，给每个节点设置 static 属性，标识其是否为静态节点
  markStatic(root)
  // second pass: mark static roots.
  // 进一步标记静态根，一个节点要成为静态根节点，需要具体以下条件：
  // 节点本身是静态节点，而且有子节点，而且子节点不只是一个文本节点，则标记为静态根
  // 静态根节点不能只有静态文本的子节点，因为这样收益太低，这种情况下始终更新它就好了
  markStaticRoots(root, false)
}

function genStaticKeys (keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap' +
    (keys ? ',' + keys : '')
  )
}

function markStatic (node: ASTNode) {
  // 通过 node.static 来标识节点是否为 静态节点
  node.static = isStatic(node)
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    /**
     * 不要将组件的插槽内容设置为静态节点，这样可以避免：
     *   1、组件不能改变插槽节点
     *   2、静态插槽内容在热重载时失败
     */
    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      return
    }
    // 遍历子节点，递归调用 markStatic 来标记这些子节点的 static 属性
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      markStatic(child)
      // 如果子节点是非静态节点，则将父节点更新为非静态节点
      if (!child.static) {
        node.static = false
      }
    }
    // 如果节点存在 v-if、v-else-if、v-else 这些指令，则依次标记 block 中节点的 static
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        //block对应的也是一个ast元素
        const block = node.ifConditions[i].block
        markStatic(block)
        if (!block.static) {
          node.static = false
        }
      }
    }
  }
}

function markStaticRoots (node: ASTNode, isInFor: boolean) {
  if (node.type === 1) {
    // 节点是静态的 或者 节点上有 v-once 指令
    if (node.static || node.once) {
      // 标记 node.staticInFor ，根节点staticInFor是false，静态节点是否在v-for中
      node.staticInFor = isInFor
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    // 节点本身是静态节点，而且有子节点，而且子节点不只是一个文本节点，则标记为静态根 => node.staticRoot = true，否则为非静态根
    if (node.static && node.children.length && !(
      node.children.length === 1 &&
      node.children[0].type === 3
    )) {
      node.staticRoot = true
      //找到静态根直接返回
      return
    } else {
      node.staticRoot = false
    }
    // 当前节点不是静态根节点的时候，递归遍历其子节点，标记静态根
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}

function isStatic (node: ASTNode): boolean {
  //文本存在表达式的情况，不是静态节点， 比如：{{ msg }}
  if (node.type === 2) { // expression
    return false
  }
  //纯文本节点是静态节点
  if (node.type === 3) { // text
    return true
  }
  //存在v-pre或者是pre标签就是静态节点
  //或者满足以下条件：
  //1.hasBindings不是true，不能存在事件绑定，v-bind属性绑定
  //2.不能存在v-if和v-for
  //3.不能是slot和component标签
  //4.需要是内置标签div、span.......,不能是组件
  //5.不能在v-for的template标签内
  //6.查看ast节点上属性的每一个key是都满足是静态节点key
  return !!(node.pre || (
    !node.hasBindings && // no dynamic bindings
    !node.if && !node.for && // not v-if or v-for or v-else
    !isBuiltInTag(node.tag) && // not a built-in
    isPlatformReservedTag(node.tag) && // not a component
    !isDirectChildOfTemplateFor(node) &&
    Object.keys(node).every(isStaticKey)
  ))
}

function isDirectChildOfTemplateFor (node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent
    if (node.tag !== 'template') {
      return false
    }
    if (node.for) {
      return true
    }
  }
  return false
}
