/* @flow */

/**
 * Runtime helper for rendering static trees.
 */
export function renderStatic (
  index: number,
  isInFor: boolean
): VNode | Array<VNode> {
  //缓存
  const cached = this._staticTrees || (this._staticTrees = [])
  //获取缓存
  let tree = cached[index]
  // if has already-rendered static tree and not inside v-for,
  // we can reuse the same tree.
  if (tree && !isInFor) {
    return tree
  }
  // otherwise, render a fresh tree.
  //执行 staticRenderFns 数组中指定下标的渲染函数，生成静态树的 VNode 并缓存
  tree = cached[index] = this.$options.staticRenderFns[index].call(
    this._renderProxy,
    null,
    this // for render fns generated for functional component templates
  )
  //打上静态标记
  markStatic(tree, `__static__${index}`, false)
  return tree
}

/**
 * Runtime helper for v-once.
 * Effectively it means marking the node as static with a unique key.
 */
export function markOnce (
  tree: VNode | Array<VNode>,
  index: number,
  key: string
) {
  //v-once节点标记成静态节点
  markStatic(tree, `__once__${index}${key ? `_${key}` : ``}`, true)
  return tree
}
/**
 * 为 VNode 打静态标记，在 VNode 上添加三个属性：
 * { isStatick: true, key: xx, isOnce: true or false } 
 */
function markStatic (
  tree: VNode | Array<VNode>,
  key: string,
  isOnce: boolean
) {
  //如果是vnode数组，循环处理
  if (Array.isArray(tree)) {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i] && typeof tree[i] !== 'string') {
        markStaticNode(tree[i], `${key}_${i}`, isOnce)
      }
    }
  } else {
    markStaticNode(tree, key, isOnce)
  }
}
//静态标记isStatic，v-once标记isOnce，key值
function markStaticNode (node, key, isOnce) {
  node.isStatic = true
  node.key = key
  node.isOnce = isOnce
}
