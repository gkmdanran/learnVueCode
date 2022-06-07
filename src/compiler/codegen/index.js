/* @flow */

import { genHandlers } from './events'
import baseDirectives from '../directives/index'
import { camelize, no, extend } from 'shared/util'
import { baseWarn, pluckModuleFunction } from '../helpers'
import { emptySlotScopeToken } from '../parser/index'

type TransformFunction = (el: ASTElement, code: string) => string;
type DataGenFunction = (el: ASTElement) => string;
type DirectiveFunction = (el: ASTElement, dir: ASTDirective, warn: Function) => boolean;

export class CodegenState {
  options: CompilerOptions;
  warn: Function;
  transforms: Array<TransformFunction>;
  dataGenFns: Array<DataGenFunction>;
  directives: { [key: string]: DirectiveFunction };
  maybeComponent: (el: ASTElement) => boolean;
  onceId: number;
  staticRenderFns: Array<string>;
  pre: boolean;

  constructor (options: CompilerOptions) {
    this.options = options
    this.warn = options.warn || baseWarn
    this.transforms = pluckModuleFunction(options.modules, 'transformCode')
    this.dataGenFns = pluckModuleFunction(options.modules, 'genData') //style，class
    this.directives = extend(extend({}, baseDirectives), options.directives)
    // baseDirectives：v-on、v-bind、v-cloak:
    // options.directives：v-model、v-text、v-html
    const isReservedTag = options.isReservedTag || no
    this.maybeComponent = (el: ASTElement) => !!el.component || !isReservedTag(el.tag)
    this.onceId = 0
    this.staticRenderFns = []
    this.pre = false
  }
}

export type CodegenResult = {
  render: string,
  staticRenderFns: Array<string>
};

export function generate (
  ast: ASTElement | void,
  options: CompilerOptions
): CodegenResult {
  const state = new CodegenState(options)
  // fix #11483, Root level <script> tags should not be rendered.
  // 生成字符串格式的代码，比如：'_c(tag, data, children, normalizationType)'
  // data 为节点上的属性组成 JSON 字符串，比如 '{ key: xx, ref: xx, ... }'
  // children 为所有子节点的字符串格式的代码组成的字符串数组，格式：
  //     `['_c(tag, data, children)', ...],normalizationType`，
  // 最后的 normalization 是 _c 的第四个参数，表示节点的规范化类型
  // 当然 code 并不一定就是 _c，也有可能是其它的，比如整个组件都是静态的，则结果就为 _m(0)
  const code = ast ? (ast.tag === 'script' ? 'null' : genElement(ast, state)) : '_c("div")'
  return {
    render: `with(this){return ${code}}`,
    staticRenderFns: state.staticRenderFns
  }
}

export function genElement (el: ASTElement, state: CodegenState): string {
  if (el.parent) {
    el.pre = el.pre || el.parent.pre
  }

  if (el.staticRoot && !el.staticProcessed) {
    /**
     * 处理静态根节点，生成节点的渲染函数
     *   1、将当前静态节点的渲染函数放到 staticRenderFns 数组中
     *   2、返回一个可执行函数 _m(idx, true or '') 
     */
    return genStatic(el, state)
  } else if (el.once && !el.onceProcessed) {
     /**
     * 处理带有 v-once 指令的节点，结果会有三种：
     *   1、当前节点存在 v-if 指令，得到一个三元表达式，condition ? render1 : render2
     *   2、当前节点是一个包含在 v-for 指令内部的静态节点，得到 `_o(_c(tag, data, children), number, key)`
     *   3、当前节点就是一个单纯的 v-once 节点，得到 `_m(idx, true of '')`
     */
    return genOnce(el, state)
  } else if (el.for && !el.forProcessed) {
     /**
     * 处理节点上的 v-for 指令  
     * 得到 `_l(exp, function(val, key, index){return _c(tag, data, children)})`
     */
    return genFor(el, state)
  } else if (el.if && !el.ifProcessed) {
    /**
     * 处理带有 v-if 指令的节点，最终得到一个三元表达式：condition ? render1 : render2
     */
    return genIf(el, state)
  } else if (el.tag === 'template' && !el.slotTarget && !state.pre) {
     /**
     * 当前节点是 template 标签并且不是插槽和带有 v-pre 指令
     * 生成所有子节点的渲染函数，返回一个数组，格式如：
     * [_c(tag, data, children, normalizationType), ...] 
     */
    return genChildren(el, state) || 'void 0'
  } else if (el.tag === 'slot') {
    /**
     * 生成插槽的渲染函数，得到
     * _t(slotName, children, attrs, bind)
     */
    return genSlot(el, state)
  } else {
    // component or element
    let code
    if (el.component) {
      /**
       * 处理动态组件，生成动态组件的渲染函数
       * 得到 `_c(compName, data, children)`
       */
      code = genComponent(el.component, el, state)
    } else {
      // 自定义组件和原生标签走这里
      let data
      if (!el.plain || (el.pre && state.maybeComponent(el))) {
        // 非普通元素或者带有 v-pre 指令的组件走这里，处理节点的所有属性，返回一个 JSON 字符串，
        // 比如 '{ key: xx, ref: xx, ... }'
        data = genData(el, state)
      }

      const children = el.inlineTemplate ? null : genChildren(el, state, true)
      code = `_c('${el.tag}'${
        data ? `,${data}` : '' // data
      }${
        children ? `,${children}` : '' // children
      })`
    }
    // module transforms
    for (let i = 0; i < state.transforms.length; i++) {
      code = state.transforms[i](el, code)
    }
    return code
  }
}

// hoist static sub-trees out
function genStatic (el: ASTElement, state: CodegenState): string {
  // 标记当前静态节点已经被处理过了
  el.staticProcessed = true
  // Some elements (templates) need to behave differently inside of a v-pre
  // node.  All pre nodes are static roots, so we can use this as a location to
  // wrap a state change and reset it upon exiting the pre node.
  const originalPreState = state.pre
  if (el.pre) {
    state.pre = el.pre
  }
  // 将静态根节点的渲染函数 push 到 staticRenderFns 数组中，比如：
  // [`with(this){return _c(tag, data, children)}`]
  state.staticRenderFns.push(`with(this){return ${genElement(el, state)}}`)
  state.pre = originalPreState
  // 返回一个可执行函数：_m(idx, true or '')
  // idx = 当前静态节点的渲染函数在 staticRenderFns 数组中下标
  return `_m(${
    state.staticRenderFns.length - 1
  }${
    el.staticInFor ? ',true' : ''
  })`
}

// v-once
function genOnce (el: ASTElement, state: CodegenState): string {
  // 标记当前节点的 v-once 指令已经被处理过了
  el.onceProcessed = true
  if (el.if && !el.ifProcessed) {
    // 如果含有 v-if 指令 && if 指令没有被处理过，则走这里
    // 处理带有 v-if 指令的节点，最终得到一个三元表达式，condition ? render1 : render2 
    return genIf(el, state)
  } else if (el.staticInFor) {
    // 说明当前节点是被包裹在 v-for节点内的静态节点
    let key = ''
    let parent = el.parent
    while (parent) {
      if (parent.for) {
        // 获取 v-for 指令的 key
        key = parent.key
        break
      }
      parent = parent.parent
    }
    if (!key) {
      // key 不存在则给出提示，v-once 节点只能用于带有 key 的 v-for 节点内部
      process.env.NODE_ENV !== 'production' && state.warn(
        `v-once can only be used inside v-for that is keyed. `,
        el.rawAttrsMap['v-once']
      )
      return genElement(el, state)
    }
    return `_o(${genElement(el, state)},${state.onceId++},${key})`
  } else {
    // 上面几种情况都不符合，说明就是一个简单的静态节点，和处理静态根节点时的操作一样,
    // 得到 _m(idx, true or '')
    return genStatic(el, state)
  }
}

export function genIf (
  el: any,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  // 标记当前节点的 v-if 指令已经被处理过
  el.ifProcessed = true // avoid recursion
  // 得到三元表达式，condition ? render1 : render2
  return genIfConditions(el.ifConditions.slice(), state, altGen, altEmpty)
}

function genIfConditions (
  conditions: ASTIfConditions,
  state: CodegenState,
  altGen?: Function,
  altEmpty?: string
): string {
  if (!conditions.length) {
    // 长度若为空，则直接返回一个空节点渲染函数
    return altEmpty || '_e()'
  }

  // 从 conditions 数组中拿出第一个条件对象 { exp, block }
  const condition = conditions.shift()
  if (condition.exp) {
    // 如果 condition.exp 条件成立，则得到一个三元表达式，
    // 如果条件不成立，则通过递归的方式找 conditions 数组中下一个元素，
    // 直到找到条件成立的元素，然后返回一个三元表达式
    return `(${condition.exp})?${
      genTernaryExp(condition.block)
    }:${
      genIfConditions(conditions, state, altGen, altEmpty)
    }`
  } else {
    return `${genTernaryExp(condition.block)}`
  }

  // v-if with v-once should generate code like (a)?_m(0):_m(1)
  function genTernaryExp (el) {
    return altGen
      ? altGen(el, state)
      : el.once
        ? genOnce(el, state)
        : genElement(el, state)
  }
}

export function genFor (
  el: any,
  state: CodegenState,
  altGen?: Function,
  altHelper?: string
): string {
  const exp = el.for
  const alias = el.alias
  const iterator1 = el.iterator1 ? `,${el.iterator1}` : ''
  const iterator2 = el.iterator2 ? `,${el.iterator2}` : ''

  // 提示，v-for 指令在组件上时必须使用 key
  if (process.env.NODE_ENV !== 'production' &&
    state.maybeComponent(el) &&
    el.tag !== 'slot' &&
    el.tag !== 'template' &&
    !el.key
  ) {
    state.warn(
      `<${el.tag} v-for="${alias} in ${exp}">: component lists rendered with ` +
      `v-for should have explicit keys. ` +
      `See https://vuejs.org/guide/list.html#key for more info.`,
      el.rawAttrsMap['v-for'],
      true /* tip */
    )
  }

  // 标记当前节点上的 v-for 指令已经被处理过了
  el.forProcessed = true // avoid recursion
  return `${altHelper || '_l'}((${exp}),` +
    `function(${alias}${iterator1}${iterator2}){` +
      `return ${(altGen || genElement)(el, state)}` +
    '})'
}

export function genData (el: ASTElement, state: CodegenState): string {
  let data = '{'

  // directives first.
  // directives may mutate the el's other properties before they are generated.
  // 首先先处理指令，因为指令可能在生成其它属性之前改变这些属性
  const dirs = genDirectives(el, state)
  if (dirs) data += dirs + ','

  // key
  if (el.key) {
    data += `key:${el.key},`
  }
  // ref
  if (el.ref) {
    data += `ref:${el.ref},`
  }
  if (el.refInFor) {
    data += `refInFor:true,`
  }
  // pre
  if (el.pre) {
    data += `pre:true,`
  }
  // record original tag name for components using "is" attribute
  if (el.component) {
    data += `tag:"${el.tag}",`
  }
  // module data generation functions
  // 为节点执行模块(class、style)的 genData 方法，
  // 得到 data = { staticClass: xx, class: xx, staticStyle: xx, style: xx }
  for (let i = 0; i < state.dataGenFns.length; i++) {
    data += state.dataGenFns[i](el)
  }
  // attributes
  //处理attrs
  if (el.attrs) {
    data += `attrs:${genProps(el.attrs)},`
  }
  // DOM props
  //处理props
  if (el.props) {
    data += `domProps:${genProps(el.props)},`
  }
  // event handlers
  //处理事件
  if (el.events) {
    data += `${genHandlers(el.events, false)},`
  }
  //处理native事件
  if (el.nativeEvents) {
    data += `${genHandlers(el.nativeEvents, true)},`
  }
  // slot target
  // only for non-scoped slots
  if (el.slotTarget && !el.slotScope) {
    data += `slot:${el.slotTarget},`
  }
  // scoped slots
  // scoped slots，作用域插槽，data = { scopedSlots: '_u(xxx)' }
  if (el.scopedSlots) {
    data += `${genScopedSlots(el, el.scopedSlots, state)},`
  }
  // component v-model
  // 处理 v-model 属性，得到
  // data = { model: { value, callback, expression } }
  if (el.model) {
    data += `model:{value:${
      el.model.value
    },callback:${
      el.model.callback
    },expression:${
      el.model.expression
    }},`
  }
  // inline-template
  if (el.inlineTemplate) {
    // inline-template，处理内联模版，得到
    // data = { inlineTemplate: { render: function() { render 函数 }, staticRenderFns: [ function() {}, ... ] } }
    const inlineTemplate = genInlineTemplate(el, state)
    if (inlineTemplate) {
      data += `${inlineTemplate},`
    }
  }
  // 删掉 JSON 字符串最后的 逗号，然后加上闭合括号 }
  data = data.replace(/,$/, '') + '}'
  // v-bind dynamic argument wrap
  // v-bind with dynamic arguments must be applied using the same v-bind object
  // merge helper so that class/style/mustUseProp attrs are handled correctly.
  if (el.dynamicAttrs) {
    // 存在动态属性，data = `_b(data, tag, 静态属性字符串或者_d(静态属性字符串, 动态属性字符串))`
    data = `_b(${data},"${el.tag}",${genProps(el.dynamicAttrs)})`
  }
  // v-bind data wrap
  if (el.wrapData) {
    data = el.wrapData(data)
  }
  // v-on data wrap
  if (el.wrapListeners) {
    data = el.wrapListeners(data)
  }
  return data
}

function genDirectives (el: ASTElement, state: CodegenState): string | void {
  // 获取指令数组
  const dirs = el.directives
  if (!dirs) return
  let res = 'directives:['
  // 标记，用于标记指令是否需要在运行时完成的任务，比如 v-model 的 input 事件
  let hasRuntime = false
  let i, l, dir, needRuntime
  for (i = 0, l = dirs.length; i < l; i++) {
    dir = dirs[i]
    needRuntime = true
    // 获取节点当前指令的处理方法
    const gen: DirectiveFunction = state.directives[dir.name]
    if (gen) {
      // compile-time directive that manipulates AST.
      // returns true if it also needs a runtime counterpart.
      // 执行指令的编译方法，如果指令还需要运行时完成一部分任务，则返回 true，比如 v-model
      needRuntime = !!gen(el, dir, state.warn)
    }
    if (needRuntime) {
      // 表示该指令在运行时还有任务
      hasRuntime = true
      // res = directives:[{ name, rawName, value, arg, modifiers }, ...]
      res += `{name:"${dir.name}",rawName:"${dir.rawName}"${
        dir.value ? `,value:(${dir.value}),expression:${JSON.stringify(dir.value)}` : ''
      }${
        dir.arg ? `,arg:${dir.isDynamicArg ? dir.arg : `"${dir.arg}"`}` : ''
      }${
        dir.modifiers ? `,modifiers:${JSON.stringify(dir.modifiers)}` : ''
      }},`
    }
  }
  if (hasRuntime) {
    //只有指令存在运行时任务时，才会返回 res
    return res.slice(0, -1) + ']'
  }
}

function genInlineTemplate (el: ASTElement, state: CodegenState): ?string {
  const ast = el.children[0]
  if (process.env.NODE_ENV !== 'production' && (
    el.children.length !== 1 || ast.type !== 1
  )) {
    state.warn(
      'Inline-template components must have exactly one child element.',
      { start: el.start }
    )
  }
  if (ast && ast.type === 1) {
    const inlineRenderFns = generate(ast, state.options)
    return `inlineTemplate:{render:function(){${
      inlineRenderFns.render
    }},staticRenderFns:[${
      inlineRenderFns.staticRenderFns.map(code => `function(){${code}}`).join(',')
    }]}`
  }
}

function genScopedSlots (
  el: ASTElement,
  slots: { [key: string]: ASTElement },
  state: CodegenState
): string {
  // by default scoped slots are considered "stable", this allows child
  // components with only scoped slots to skip forced updates from parent.
  // but in some cases we have to bail-out of this optimization
  // for example if the slot contains dynamic names, has v-if or v-for on them...
  let needsForceUpdate = el.for || Object.keys(slots).some(key => {
    const slot = slots[key]
    return (
      slot.slotTargetDynamic ||
      slot.if ||
      slot.for ||
      containsSlotChild(slot) // is passing down slot from parent which may be dynamic
    )
  })

  // #9534: if a component with scoped slots is inside a conditional branch,
  // it's possible for the same component to be reused but with different
  // compiled slot content. To avoid that, we generate a unique key based on
  // the generated code of all the slot contents.
  let needsKey = !!el.if

  // OR when it is inside another scoped slot or v-for (the reactivity may be
  // disconnected due to the intermediate scope variable)
  // #9438, #9506
  // TODO: this can be further optimized by properly analyzing in-scope bindings
  // and skip force updating ones that do not actually use scope variables.
  if (!needsForceUpdate) {
    let parent = el.parent
    while (parent) {
      if (
        (parent.slotScope && parent.slotScope !== emptySlotScopeToken) ||
        parent.for
      ) {
        needsForceUpdate = true
        break
      }
      if (parent.if) {
        needsKey = true
      }
      parent = parent.parent
    }
  }

  const generatedSlots = Object.keys(slots)
    .map(key => genScopedSlot(slots[key], state))
    .join(',')

  return `scopedSlots:_u([${generatedSlots}]${
    needsForceUpdate ? `,null,true` : ``
  }${
    !needsForceUpdate && needsKey ? `,null,false,${hash(generatedSlots)}` : ``
  })`
}

function hash(str) {
  let hash = 5381
  let i = str.length
  while(i) {
    hash = (hash * 33) ^ str.charCodeAt(--i)
  }
  return hash >>> 0
}

function containsSlotChild (el: ASTNode): boolean {
  if (el.type === 1) {
    if (el.tag === 'slot') {
      return true
    }
    return el.children.some(containsSlotChild)
  }
  return false
}

function genScopedSlot (
  el: ASTElement,
  state: CodegenState
): string {
  const isLegacySyntax = el.attrsMap['slot-scope']
  if (el.if && !el.ifProcessed && !isLegacySyntax) {
    return genIf(el, state, genScopedSlot, `null`)
  }
  if (el.for && !el.forProcessed) {
    return genFor(el, state, genScopedSlot)
  }
  const slotScope = el.slotScope === emptySlotScopeToken
    ? ``
    : String(el.slotScope)
  const fn = `function(${slotScope}){` +
    `return ${el.tag === 'template'
      ? el.if && isLegacySyntax
        ? `(${el.if})?${genChildren(el, state) || 'undefined'}:undefined`
        : genChildren(el, state) || 'undefined'
      : genElement(el, state)
    }}`
  // reverse proxy v-slot without scope on this.$slots
  const reverseProxy = slotScope ? `` : `,proxy:true`
  return `{key:${el.slotTarget || `"default"`},fn:${fn}${reverseProxy}}`
}

export function genChildren (
  el: ASTElement,
  state: CodegenState,
  checkSkip?: boolean,
  altGenElement?: Function,
  altGenNode?: Function
): string | void {
  const children = el.children
  if (children.length) {
    // 获取第一个子节点
    const el: any = children[0]
    // optimize single v-for
    // 优化，只有一个子节点 && 子节点的上有 v-for 指令 && 子节点的标签不为 template 或者 slot
    // 优化的方式是直接调用 genElement 生成该节点的渲染函数，不需要走下面的循环然后调用 genCode 最后得到渲染函数
    if (children.length === 1 &&
      el.for &&
      el.tag !== 'template' &&
      el.tag !== 'slot'
    ) {
      const normalizationType = checkSkip
        ? state.maybeComponent(el) ? `,1` : `,0`
        : ``
      return `${(altGenElement || genElement)(el, state)}${normalizationType}`
    }
    const normalizationType = checkSkip
      ? getNormalizationType(children, state.maybeComponent)
      : 0
    const gen = altGenNode || genNode
    // 返回一个数组，数组的每个元素都是一个子节点的渲染函数，
    // 格式：['_c(tag, data, children, normalizationType)', ...]
    return `[${children.map(c => gen(c, state)).join(',')}]${
      normalizationType ? `,${normalizationType}` : ''
    }`
  }
}

// determine the normalization needed for the children array.
// 0: no normalization needed
// 1: simple normalization needed (possible 1-level deep nested array)
// 2: full normalization needed
function getNormalizationType (
  children: Array<ASTNode>,
  maybeComponent: (el: ASTElement) => boolean
): number {
  let res = 0
  for (let i = 0; i < children.length; i++) {
    const el: ASTNode = children[i]
    if (el.type !== 1) {
      continue
    }
    if (needsNormalization(el) ||
        (el.ifConditions && el.ifConditions.some(c => needsNormalization(c.block)))) {
      res = 2
      break
    }
    if (maybeComponent(el) ||
        (el.ifConditions && el.ifConditions.some(c => maybeComponent(c.block)))) {
      res = 1
    }
  }
  return res
}

function needsNormalization (el: ASTElement): boolean {
  return el.for !== undefined || el.tag === 'template' || el.tag === 'slot'
}

function genNode (node: ASTNode, state: CodegenState): string {
  if (node.type === 1) {
    //元素节点
    return genElement(node, state)
  } else if (node.type === 3 && node.isComment) {
    //注释
    return genComment(node)
  } else {
    //文本
    return genText(node)
  }
}

export function genText (text: ASTText | ASTExpression): string {
  return `_v(${text.type === 2
    ? text.expression // no need for () because already wrapped in _s()
    : transformSpecialNewlines(JSON.stringify(text.text))
  })`
}

export function genComment (comment: ASTText): string {
  return `_e(${JSON.stringify(comment.text)})`
}

function genSlot (el: ASTElement, state: CodegenState): string {
  //插槽名
  const slotName = el.slotName || '"default"'
  // 生成所有的子节点
  const children = genChildren(el, state)
  // 结果字符串，_t(slotName, children, attrs, bind)
  let res = `_t(${slotName}${children ? `,function(){return ${children}}` : ''}`
  const attrs = el.attrs || el.dynamicAttrs
    ? genProps((el.attrs || []).concat(el.dynamicAttrs || []).map(attr => ({
        // slot props are camelized
        name: camelize(attr.name),
        value: attr.value,
        dynamic: attr.dynamic
      })))
    : null
  const bind = el.attrsMap['v-bind']
  if ((attrs || bind) && !children) {
    res += `,null`
  }
  if (attrs) {
    res += `,${attrs}`
  }
  if (bind) {
    res += `${attrs ? '' : ',null'},${bind}`
  }
  return res + ')'
}

// componentName is el.component, take it as argument to shun flow's pessimistic refinement
function genComponent (
  componentName: string,
  el: ASTElement,
  state: CodegenState
): string {
  // 所有的子节点
  const children = el.inlineTemplate ? null : genChildren(el, state, true)
  // 返回 `_c(compName, data, children)`
  // compName 是 is 属性的值
  return `_c(${componentName},${genData(el, state)}${
    children ? `,${children}` : ''
  })`
}

function genProps (props: Array<ASTAttr>): string {
  let staticProps = ``
  let dynamicProps = ``
  for (let i = 0; i < props.length; i++) {
    const prop = props[i]
    const value = __WEEX__
      ? generateValue(prop.value)
      : transformSpecialNewlines(prop.value)
    if (prop.dynamic) {
      //动态属性拼接
      dynamicProps += `${prop.name},${value},`
    } else {
      //静态属性拼接
      staticProps += `"${prop.name}":${value},`
    }
  }
  // 去掉静态属性最后的逗号：{name1:value1,name2:value2}
  staticProps = `{${staticProps.slice(0, -1)}}`
  if (dynamicProps) {
    //存在动态属性返回：_d(静态属性字符串，动态属性字符串)
    return `_d(${staticProps},[${dynamicProps.slice(0, -1)}])`
  } else {
    // 说明属性数组中不存在动态属性，直接返回静态属性字符串
    return staticProps
  }
}

/* istanbul ignore next */
function generateValue (value) {
  if (typeof value === 'string') {
    return transformSpecialNewlines(value)
  }
  return JSON.stringify(value)
}

// #3895, #4268
function transformSpecialNewlines (text: string): string {
  return text
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
