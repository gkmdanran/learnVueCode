/* @flow */

import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize, hyphenate } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex
} from '../helpers'

export const onRE = /^@|^v-on:/
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
const stripParensRE = /^\(|\)$/g
const dynamicArgRE = /^\[.*\]$/

const argRE = /:(.*)$/
export const bindRE = /^:|^\.|^v-bind:/
const propBindRE = /^\./
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g

const slotRE = /^v-slot(:|$)|^#/

const lineBreakRE = /[\r\n]/
const whitespaceRE = /[ \f\t\r\n]+/g

const invalidAttributeRE = /[\s"'<>\/=]/

const decodeHTMLCached = cached(he.decode)

export const emptySlotScopeToken = `_empty_`

// configurable state
export let warn: any
let delimiters
let transforms
let preTransforms
let postTransforms
let platformIsPreTag
let platformMustUseProp
let platformGetTagNamespace
let maybeComponent

export function createASTElement (
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1,
    tag,
    attrsList: attrs,
    attrsMap: makeAttrsMap(attrs),
    rawAttrsMap: {},
    parent,
    children: []
  }
}

/**
 * Convert HTML string to AST.
 */
export function parse (
  template: string,
  options: CompilerOptions
): ASTElement | void {
  warn = options.warn || baseWarn

  platformIsPreTag = options.isPreTag || no  //是否是pre标签
  platformMustUseProp = options.mustUseProp || no
  platformGetTagNamespace = options.getTagNamespace || no
  const isReservedTag = options.isReservedTag || no   //是否是内置标签
  //判断是否是组件，ast上有component，属性存在is表示动态组件
  maybeComponent = (el: ASTElement) => !!(
    el.component ||
    el.attrsMap[':is'] ||
    el.attrsMap['v-bind:is'] ||
    !(el.attrsMap.is ? isReservedTag(el.attrsMap.is) : isReservedTag(el.tag))
  )
  transforms = pluckModuleFunction(options.modules, 'transformNode')  //style、class
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode') //model
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode')//无

  delimiters = options.delimiters

  const stack = [] //用来维护ast父子关系的栈
  const preserveWhitespace = options.preserveWhitespace !== false
  const whitespaceOption = options.whitespace
  let root
  let currentParent
  let inVPre = false
  let inPre = false
  let warned = false

  function warnOnce (msg, range) {
    if (!warned) {
      warned = true
      warn(msg, range)
    }
  }

  function closeElement (element) {
    // 移除节点末尾的空格，当前 pre 标签内的元素除外
    trimEndingWhitespace(element)
    // 当前元素不再 pre 节点内，并且也没有被处理过
    if (!inVPre && !element.processed) {
      // 分别处理元素节点的 key、ref、插槽、自闭合的 slot 标签、动态组件、class、style、v-bind、v-on、其它指令和一些原生属性 
      element = processElement(element, options)
    }
    // tree management
    // 处理根节点上存在 v-if、v-else-if、v-else 指令的情况
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      //如果根节点存在 v-if 指令，则必须还提供一个具有 v-else-if 或者 v-else 的同级别节点，防止根元素不存在
      if (root.if && (element.elseif || element.else)) {
        if (process.env.NODE_ENV !== 'production') {
          // 检查根元素
          checkRootConstraints(element)
        }
        // 给根元素设置 ifConditions 属性，root.ifConditions = [{ exp: element.elseif, block: element }, ...]
        addIfCondition(root, {
          exp: element.elseif,
          block: element
        })
      } else if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          `Component template should contain exactly one root element. ` +
          `If you are using v-if on multiple elements, ` +
          `use v-else-if to chain them instead.`,
          { start: element.start }
        )
      }
    }
    // 让自己和父元素产生关系
    // 将自己放到父元素的 children 数组中，然后设置自己的 parent 属性为 currentParent
    if (currentParent && !element.forbidden) {
      //存在elseif和else时，需要添加到el.ifConditions中
      if (element.elseif || element.else) {
        processIfConditions(element, currentParent)
      } else {
        //处理插槽的ast
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          const name = element.slotTarget || '"default"'
          ;(currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        }
        currentParent.children.push(element)
        element.parent = currentParent
      }
    }

    // final children cleanup
    // filter out scoped slots
    // 设置自己的子元素
    // 将自己的所有非插槽的子元素设置到 element.children 数组中
    element.children = element.children.filter(c => !(c: any).slotScope)
    // remove trailing whitespace node again
    trimEndingWhitespace(element)

    // check pre state
    //重置inVPre
    if (element.pre) {
      inVPre = false
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    // 分别为 element 执行 model、class、style 三个模块的 postTransform 方法
    // 但是 web 平台没有提供该方法
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options)
    }
  }

  function trimEndingWhitespace (el) {
    //删除元素中空白的文本节点，比如：<div> </div>，删除 div 元素中的空白节点，将其从元素的 children 属性中移出去
    // remove trailing whitespace node
    if (!inPre) {
      let lastNode
      while (
        (lastNode = el.children[el.children.length - 1]) &&
        lastNode.type === 3 &&
        lastNode.text === ' '
      ) {
        el.children.pop()
      }
    }
  }

  function checkRootConstraints (el) {
     // 不能使用 slot 和 template 标签作为组件的根元素
    if (el.tag === 'slot' || el.tag === 'template') {
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
        'contain multiple nodes.',
        { start: el.start }
      )
    }
    // 不能在有状态组件的 根元素 上使用 v-for，因为它会渲染出多个元素
    if (el.attrsMap.hasOwnProperty('v-for')) {
      warnOnce(
        'Cannot use v-for on stateful component root element because ' +
        'it renders multiple elements.',
        el.rawAttrsMap['v-for']
      )
    }
  }

  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,
    start (tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }
    
      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      // {
      //   type: 1,
      //   tag:"div"
      //   attrsList:[{name: 'name', value: '222', start: 5, end: 15}],
      //   attrsMap: {name:"222"},
      //   rawAttrsMap: {
      //     name: {name: 'name', value: '222', start: 5, end: 15}
      //   },
      //   parent:undefined
      //   children: []
      // }
      if (ns) {
        element.ns = ns
      }

      if (process.env.NODE_ENV !== 'production') {
        if (options.outputSourceRange) {
          element.start = start
          element.end = end
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr
            return cumulated
          }, {})
        }
        attrs.forEach(attr => {
          if (invalidAttributeRE.test(attr.name)) {
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
              `spaces, quotes, <, >, / or =.`,
              {
                start: attr.start + attr.name.indexOf(`[`),
                end: attr.start + attr.name.length
              }
            )
          }
        })
      }

      if (isForbiddenTag(element) && !isServerRendering()) {
        element.forbidden = true
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.',
          { start: element.start }
        )
      }

      // apply pre-transforms
      //处理存在 v-model 指令的 input 标签，分别处理 input 为 checkbox、radio、其它的情况。
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element
      }

      if (!inVPre) {
        // 表示 element 是否存在 v-pre 指令，存在则设置 element.pre = true
        processPre(element)
        if (element.pre) {
           // 存在 v-pre 指令，则设置 inVPre 为 true
          inVPre = true
        }
      }
      // 如果 pre 标签，则设置 inPre 为 true
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }
      //说明标签上存在 v-pre 指令，这样的节点只会渲染一次，将节点上的属性都设置到 el.attrs 数组对象中，作为静态属性，数据更新时不会渲染这部分内容
      // 设置 el.attrs 数组对象，每个元素都是一个属性对象 { name: attrName, value: attrVal, start, end }
      if (inVPre) {
        processRawAttrs(element)
      } else if (!element.processed) { //元素未被处理过
        // structural directives
        // 处理 v-for 属性，得到 element.for = 可迭代对象 element.alias = 别名
        processFor(element)
         /**
         * 处理 v-if、v-else-if、v-else
         * 得到 element.if = "exp"，element.elseif = exp, element.else = true
         * v-if 属性会额外在 element.ifConditions 数组中添加 { exp, block } 对象
         */
        processIf(element)
        // 处理 v-once 指令，得到 element.once = true 
        processOnce(element)
      }
      // 如果 root 不存在
      if (!root) {
        //则表示当前处理的元素为第一个元素，即组件的 根 元素
        root = element
        if (process.env.NODE_ENV !== 'production') {
          // 检查根元素，对根元素有一些限制，比如：不能使用 slot 和 template 作为根元素，也不能在有状态组件的根元素上使用 v-for 指令
          checkRootConstraints(root)
        }
      }

      if (!unary) {
        // 非自闭合标签，通过 currentParent 记录当前元素，下一个元素在处理的时候，就知道自己的父元素是谁
        currentParent = element
        // 然后将 element push 到 stack 数组，将来处理到当前元素的闭合标签时再拿出来
        // 将当前标签的 ast 对象 push 到 stack 数组中，这里需要注意，在调用 options.start 方法
        // 之前也发生过一次 push 操作，那个 push 进来的是当前标签的一个基本配置信息
        stack.push(element)
      } else {
        /**
         * 说明当前元素为自闭合标签，主要做了 3 件事：
         *   1、如果元素没有被处理过，即 el.processed 为 false，则调用 processElement 方法处理节点上的众多属性
         *   2、让自己和父元素产生关系，将自己放到父元素的 children 数组中，并设置自己的 parent 属性为 currentParent
         *   3、设置自己的子元素，将自己所有非插槽的子元素放到自己的 children 数组中
         */
        closeElement(element)
      }
    },

    end (tag, start, end) {
      //记录statck的最后一个ast元素，及结束标签对应的ast元素
      const element = stack[stack.length - 1]
      // pop stack
      //因为已经处理到结束标签了，所以对应的ast元素已经处理完，栈长度-1
      stack.length -= 1
      //更新当前的父元素：就是当前栈的最后一个ast元素
      currentParent = stack[stack.length - 1]
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        element.end = end
      }
      /**
       * 主要做了 3 件事：
       *   1、如果元素没有被处理过，即 el.processed 为 false，则调用 processElement 方法处理节点上的众多属性
       *   2、让自己和父元素产生关系，将自己放到父元素的 children 数组中，并设置自己的 parent 属性为 currentParent
       *   3、设置自己的子元素，将自己所有非插槽的子元素放到自己的 children 数组中
       */
      closeElement(element)
    },

    chars (text: string, start: number, end: number) {
      // 异常处理，currentParent 不存在说明这段文本没有父元素
      if (!currentParent) {
        if (process.env.NODE_ENV !== 'production') {
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.',
              { start }
            )
          } else if ((text = text.trim())) {
            warnOnce(
              `text "${text}" outside root element will be ignored.`,
              { start }
            )
          }
        }
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      // 当前父元素的所有孩子节点
      const children = currentParent.children
      // 对 text 进行一系列的处理，比如删除空白字符，或者存在 whitespaceOptions 选项，则 text 直接置为空或者空格
      // 文本在 pre 标签内 或者 text.trim() 不为空
      if (inPre || text.trim()) {
        //判断父元素是否是script或style标签
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text)
      } else if (!children.length) {
        // 说明文本不在 pre 标签内而且 text.trim() 为空，而且当前父元素也没有孩子节点，
        // remove the whitespace-only node right after an opening tag
        // 则将 text 置为空
        text = ''
      } else if (whitespaceOption) {
         // 压缩处理
        if (whitespaceOption === 'condense') {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          text = lineBreakRE.test(text) ? '' : ' '
        } else {
          text = ' '
        }
      } else {
        text = preserveWhitespace ? ' ' : ''
      }
      // 如果经过处理后 text 还存在
      if (text) {
        // 不在 pre 节点中，并且配置选项中存在压缩选项，则将多个连续空格压缩为单个
        if (!inPre && whitespaceOption === 'condense') {
          // condense consecutive whitespaces into single space
          text = text.replace(whitespaceRE, ' ')
        }
        let res
        let child: ?ASTNode
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          // 文本中存在表达式（即有界定符）
          //3232<222{{msg}}
          child = {
            type: 2,
            expression: res.expression, //  \"3232<222\"+_s(msg)
            tokens: res.tokens,  //["3232<222",{@binding: "msg"}]
            text   //3232<222{{msg}}
          }
        } else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
           // 纯文本节点
          child = {
            type: 3,
            text
          }
        }
        // child 存在，则将 child 放到父元素的children 数组中
        if (child) {
          if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
            child.start = start
            child.end = end
          }
          children.push(child)
        }
      }
    },
    comment (text: string, start, end) {
      // adding anything as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      if (currentParent) {
        const child: ASTText = {
          type: 3,
          text,
          isComment: true
        }
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          child.start = start
          child.end = end
        }
        currentParent.children.push(child)
      }
    }
  })
  return root
}

function processPre (el) {
  //从attrsMap上获取v-pre的值，并且从attrsList中移除v-pre
  //如果元素上存在 v-pre 指令，则设置 el.pre = true 
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}

function processRawAttrs (el) {
  //将el.attrsList中所有的属性都添加到el.attrs
  const list = el.attrsList
  const len = list.length
  if (len) {
    const attrs: Array<ASTAttr> = el.attrs = new Array(len)
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        value: JSON.stringify(list[i].value)
      }
      if (list[i].start != null) {
        attrs[i].start = list[i].start
        attrs[i].end = list[i].end
      }
    }
  } else if (!el.pre) {
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}

export function processElement (
  element: ASTElement,
  options: CompilerOptions
) {
  //处理key element.key=xxx
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  // 确定 element 是否为一个普通元素
  element.plain = (
    !element.key &&
    !element.scopedSlots &&
    !element.attrsList.length
  )
  //处理ref，判断ref是否在for中
  processRef(element)
  // 处理作为插槽传递给组件的内容，得到  插槽名称、是否为动态插槽、作用域插槽的值，以及插槽中的所有子元素，子元素放到插槽对象的 children 属性中
  processSlotContent(element)
  // 处理自闭合的 slot 标签，得到插槽名称 => el.slotName = xx
  processSlotOutlet(element)
  // 处理动态组件，<component :is="compoName"></component>得到 el.component = compName，
  // 以及标记是否存在内联模版，el.inlineTemplate = true of false
  processComponent(element)
  //处理style和class的transformNode
  // 分别存放静态 style 属性的值、动态 style 属性的值，以及静态 class 属性的值和动态 class 属性的值
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  /**
   * 处理元素上的所有属性：
   * v-bind 指令变成：el.attrs 或 el.dynamicAttrs = [{ name, value, start, end, dynamic }, ...]，
   *                或者是必须使用 props 的属性，变成了 el.props = [{ name, value, start, end, dynamic }, ...]
   * v-on 指令变成：el.events 或 el.nativeEvents = { name: [{ value, start, end, modifiers, dynamic }, ...] }
   * 其它指令：el.directives = [{name, rawName, value, arg, isDynamicArg, modifier, start, end }, ...]
   * 原生属性：el.attrs = [{ name, value, start, end }]，或者一些必须使用 props 的属性，变成了：
   *         el.props = [{ name, value: true, start, end, dynamic }]
  */
  processAttrs(element)
  return element
}

function processKey (el) {
  //从attrsMap上获取key的值，并且从attrsList中移除key
  const exp = getBindingAttr(el, 'key')
  if (exp) {
    if (process.env.NODE_ENV !== 'production') {
      //key不能添加在template上
      if (el.tag === 'template') {
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, 'key')
        )
      }
      if (el.for) {
        // 不要在 <transition-group> 的子元素上使用 v-for 的 index 作为 key，这和没用 key 没什么区别
        const iterator = el.iterator2 || el.iterator1
        const parent = el.parent
        if (iterator && iterator === exp && parent && parent.tag === 'transition-group') {
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
            `this is the same as not using keys.`,
            getRawBindingAttr(el, 'key'),
            true /* tip */
          )
        }
      }
    }
    //key添加到ast上
    el.key = exp
  }
}

function processRef (el) {
  //从attrsMap上获取ref的值，并且从attrsList中移除ref
  const ref = getBindingAttr(el, 'ref')
  if (ref) {
    el.ref = ref
    //检测是否在v-for循环中
    el.refInFor = checkInFor(el)
  }
}

export function processFor (el: ASTElement) {
  let exp
  //从attrsMap上获取v-for的值，并且从attrsList中移除v-for,exp="(val,key,index) in obj"
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    const res = parseFor(exp)
    //res={for: 'obj', alias: 'val', iterator1: 'key', iterator2: 'index'}
    if (res) {
      //添加到ast上
      extend(el, res)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`,
        el.rawAttrsMap['v-for']
      )
    }
  }
}

type ForParseResult = {
  for: string;
  alias: string;
  iterator1?: string;
  iterator2?: string;
};

export function parseFor (exp: string): ?ForParseResult {
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res = {}
  res.for = inMatch[2].trim()
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    res.alias = alias.replace(forIteratorRE, '').trim()
    res.iterator1 = iteratorMatch[1].trim()
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    res.alias = alias
  }
  return res
}

function processIf (el) {
  //从attrsMap上获取v-if的值，并且从attrsList中移除v-if
  const exp = getAndRemoveAttr(el, 'v-if')
  if (exp) {
    el.if = exp
    // 在 el.ifConditions 数组中添加 { exp, block }
    addIfCondition(el, {
      exp: exp,
      block: el
    })
  } else {
    //从attrsMap上获取v-else的值，并且从attrsList中移除v-else
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    //从attrsMap上获取v-else-if的值，并且从attrsList中移除v-else-if
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif
    }
  }
}

function processIfConditions (el, parent) {
  // 找到 parent.children 中的最后一个元素节点
  const prev = findPrevElement(parent.children)
  //如果元素节点存在，并且有v-if，那就加入到el.ifConditions中
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (process.env.NODE_ENV !== 'production') {
    //否则报错，v-else和v-else-if前的元素节点必须有v-if
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? 'v-else-if' : 'v-else']
    )
  }
}
//找到 children 中的最后一个元素节点 
function findPrevElement (children: Array<any>): ASTElement | void {
  let i = children.length
  //从后往前循环children，判断是否是1，及是否元素节点
  while (i--) {
    if (children[i].type === 1) {
      //找到最后一个元素节点返回
      return children[i]
    } else {
      if (process.env.NODE_ENV !== 'production' && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`,
          children[i]
        )
      }
      //不是元素节点则移除，因为在v-if与 v-else或v-else-if 间的文本元素会被忽略
      children.pop()
    }
  }
}

export function addIfCondition (el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  //ast的ifConditions对应的数组添加:{exp:"xxx===xxx",block:对应的ast}
  el.ifConditions.push(condition)
}

function processOnce (el) {
  //从attrsMap上获取v-once的值，并且从attrsList中移除v-once
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
function processSlotContent (el) {
  //作用域插槽处理
  let slotScope
  if (el.tag === 'template') {
    //从attrsMap上获取scope的值，并且从attrsList中移除scope
    slotScope = getAndRemoveAttr(el, 'scope')
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && slotScope) {
      //如果template 标签上使用 scope 属性，则会提示scope已经弃用
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
        `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
        `can also be used on plain elements in addition to <template> to ` +
        `denote scoped slots.`,
        el.rawAttrsMap['scope'],
        true
      )
    }
    //从attrsMap上获取slot-scope的值，并且从attrsList中移除slot-scope
    el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
  } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
    //slot-scope可以在其他标签上
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
      // 元素不能同时使用 slot-scope 和 v-for，v-for 具有更高的优先级
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
        `(v-for takes higher priority). Use a wrapper <template> for the ` +
        `scoped slot to make it clearer.`,
        el.rawAttrsMap['slot-scope'],
        true
      )
    }
    el.slotScope = slotScope
  }

  // slot="xxx"
  //处理老版具名插槽
  //从attrsMap上获取slot的值，并且从attrsList中移除slot
  const slotTarget = getBindingAttr(el, 'slot')
  if (slotTarget) {
    //名字是空字符串，那就处理成"default"
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
    //插槽名是否是动态的
    el.slotTargetDynamic = !!(el.attrsMap[':slot'] || el.attrsMap['v-bind:slot'])
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    if (el.tag !== 'template' && !el.slotScope) {
      //el.attrs上添加slot及对应的值
      addAttr(el, 'slot', slotTarget, getRawBindingAttr(el, 'slot'))
    }
  }

  // 2.6 v-slot syntax
  if (process.env.NEW_SLOT_SYNTAX) {
    if (el.tag === 'template') {
      // v-slot on <template>
      // 新版具名插槽
      // v-slot 在 tempalte 标签上，得到 v-slot 的值，并从attrsList中移除v-slot，这里也有可能是#xxx=xxx的形式
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (process.env.NODE_ENV !== 'production') {
          if (el.slotTarget || el.slotScope) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          // <template v-slot> 只能出现在组件的根位置，比如：
          // <comp>
          //   <template v-slot>xx</template>
          // </comp>
          // 而不能是
          // <comp>
          //   <div>
          //     <template v-slot>xxx</template>
          //   </div>
          // </comp>
          if (el.parent && !maybeComponent(el.parent)) {
            warn(
              `<template v-slot> can only appear at the root level inside ` +
              `the receiving component`,
              el
            )
          }
        }
        //解析插槽名
        const { name, dynamic } = getSlotName(slotBinding)
        //插槽名
        el.slotTarget = name
        //是否动态插槽
        el.slotTargetDynamic = dynamic
        //作用域插槽处理，没有则是_empty_
        el.slotScope = slotBinding.value || emptySlotScopeToken // force it into a scoped slot for perf
      }
    } else {
      // v-slot on component, denotes default slot
      // 处理组件上的 v-slot，<current-user v-slot:default="slotProps">123</current-user>
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (process.env.NODE_ENV !== 'production') {
          //v-slot 只能使用在组件或template上
          if (!maybeComponent(el)) {
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            )
          }
          if (el.slotScope || el.slotTarget) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          if (el.scopedSlots) {
            //只有默认插槽时，组件的标签才可以被当作插槽的模板来使用。比如<current-user v-slot:default="slotProps">123</current-user>
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
              `<template> syntax when there are other named slots.`,
              slotBinding
            )
          }
        }
        // add the component's children to its default slot
        //将组件的孩子添加到它的默认插槽内
        const slots = el.scopedSlots || (el.scopedSlots = {})
        const { name, dynamic } = getSlotName(slotBinding)
        //创建一个template的ast
        const slotContainer = slots[name] = createASTElement('template', [], el)
        //templateAST添加插槽名
        slotContainer.slotTarget = name
        //templateAST添加是否动态插槽
        slotContainer.slotTargetDynamic = dynamic
        // 所有的孩子，将每一个孩子的 parent 属性都设置为 slotContainer
        slotContainer.children = el.children.filter((c: any) => {
          if (!c.slotScope) {
            // 给插槽内元素设置 parent 属性为 slotContainer，也就是 templateAST
            c.parent = slotContainer
            return true
          }
        })
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken
        // remove children as they are returned from scopedSlots now
        //移除组件的children
        el.children = []
        // mark el non-plain so data gets generated
        //不是一个普通标签
        el.plain = false
      }
    }
  }
}

function getSlotName (binding) {
  let name = binding.name.replace(slotRE, '')
  if (!name) {
    if (binding.name[0] !== '#') {
      name = 'default'
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `v-slot shorthand syntax requires a slot name.`,
        binding
      )
    }
  }
  return dynamicArgRE.test(name)
    // dynamic [name]
    ? { name: name.slice(1, -1), dynamic: true }
    // static name
    : { name: `"${name}"`, dynamic: false }
}

// handle <slot/> outlets
// 处理 <slot/>标签，得到插槽名称，el.slotName
function processSlotOutlet (el) {
  if (el.tag === 'slot') {
    el.slotName = getBindingAttr(el, 'name')
    if (process.env.NODE_ENV !== 'production' && el.key) {
      // 提示信息，不要在 slot 标签上使用 key 属性
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, 'key')
      )
    }
  }
}

function processComponent (el) {
  let binding
   //从attrsMap上获取is的值，并且从attrsList中移除is
  if ((binding = getBindingAttr(el, 'is'))) {
    //值添加到ast的component
    el.component = binding
  }
  //从attrsMap上获取inline-template的值，并且从attrsList中移除inline-template
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    //有值表示内联模板
    el.inlineTemplate = true
  }
}

function processAttrs (el) {
  const list = el.attrsList
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic
  //循环attrsList
  for (i = 0, l = list.length; i < l; i++) {
    //属性名
    name = rawName = list[i].name
    //属性值
    value = list[i].value
    //如果属性是一个指令
    if (dirRE.test(name)) {
      // mark element as dynamic
      //标记为动态元素
      el.hasBindings = true
      // modifiers
      // 解析属性上的修饰符,v-model.lazy;
      //name.replace(dirRE, '')=model.lazy;
      //modifiers={lazy:true}
      modifiers = parseModifiers(name.replace(dirRE, ''))
      // support .foo shorthand syntax for the .prop modifier
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) { //markGKM
        (modifiers || (modifiers = {})).prop = true
        name = `.` + name.slice(1).replace(modifierRE, '')
      } else if (modifiers) {
        //如果存在修饰符，属性名去掉修饰符
        name = name.replace(modifierRE, '')
      }
      //如果属性名存在v-bind指令
      if (bindRE.test(name)) { // v-bind
        //属性名去除v-bind
        name = name.replace(bindRE, '')
        value = parseFilters(value)
        // 是否为动态属性 <div :[id]="test"></div>
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          // 如果是动态属性，则去掉属性两侧的方括号 []
          name = name.slice(1, -1)
        }
        // 提示，动态属性值不能为空字符串
        if (
          process.env.NODE_ENV !== 'production' &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          )
        }
        if (modifiers) {
          //处理.prop修饰符
          if (modifiers.prop && !isDynamic) {
            //短横线处理成驼峰
            name = camelize(name)
            //innerHTML特殊处理
            if (name === 'innerHtml') name = 'innerHTML'
          }
          //处理.camel修饰符
          if (modifiers.camel && !isDynamic) {
            name = camelize(name)
          }
          //处理.sync修饰符
          if (modifiers.sync) {
            // <cmp :visible.sync="addVisible"/>
            syncGen = genAssignmentCode(value, `$event`)
            if (!isDynamic) {
              addHandler(
                el,
                `update:${camelize(name)}`,//"update:visible"
                syncGen, //"addVisible=$event"
                null,
                false,
                warn,
                list[i]
              )
              //el.events={
              //  "update:visible": {value: "addVisible=$event", dynamic: undefined, start: 48, end: 74}
              //}
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`,
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                )
              }
            } else {
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // 动态属性
              )
            }
          }
        }
        //如果有.prop修饰符或者 当前ast不是组件并且是必须通过props设置的属性
        if ((modifiers && modifiers.prop) || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          //添加到el.props
          //el.props = [{ name, value, start, end, dynamic }, ...]
          addProp(el, name, value, list[i], isDynamic)
        } else {
          // 将属性添加到 el.attrs 数组或者 el.dynamicAttrs 数组
          addAttr(el, name, value, list[i], isDynamic)
        }
      } else if (onRE.test(name)) { // v-on
        //处理事件得到事件名
        name = name.replace(onRE, '')
        //是否动态事件
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          // 动态属性，则获取 [] 中的属性名
          name = name.slice(1, -1)
        }
        // 处理事件属性，将属性的信息添加到 el.events 或者 el.nativeEvents 对象上
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic)
      } else { // normal directives
        //处理其它的普通指令
        name = name.replace(dirRE, '')
        console.log(name)
        // parse arg
        const argMatch = name.match(argRE)
        let arg = argMatch && argMatch[1]
        isDynamic = false
        if (arg) {
          name = name.slice(0, -(arg.length + 1))
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1)
            isDynamic = true
          }
        }
        // 得到 el.directives = [{name, rawName, value, arg, isDynamicArg, modifier, start, end }, ...]
        addDirective(el, name, rawName, value, arg, isDynamic, modifiers, list[i])
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    } else {
      // literal attribute
      // 当前属性不是指令
      if (process.env.NODE_ENV !== 'production') {
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          )
        }
      }
      // 将属性对象放到 el.attrs 数组中，el.attrs = [{ name, value, start, end }]
      addAttr(el, name, JSON.stringify(value), list[i])
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      if (!el.component &&
          name === 'muted' &&
          platformMustUseProp(el.tag, el.attrsMap.type, name)) {
        addProp(el, name, 'true', list[i])
      }
    }
  }
}

function checkInFor (el: ASTElement): boolean {
  let parent = el
  //不断向上层ast找，如果找到for属性则返回true，没找到返回false
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function parseModifiers (name: string): Object | void {
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    match.forEach(m => { ret[m.slice(1)] = true })
    return ret
  }
}

function makeAttrsMap (attrs: Array<Object>): Object {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== 'production' &&
      map[attrs[i].name] && !isIE && !isEdge
    ) {
      warn('duplicate attribute: ' + attrs[i].name, attrs[i])
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag (el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}

function isForbiddenTag (el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' && (
      !el.attrsMap.type ||
      el.attrsMap.type === 'text/javascript'
    ))
  )
}

const ieNSBug = /^xmlns:NS\d+/
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
function guardIESVGBug (attrs) {
  const res = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, '')
      res.push(attr)
    }
  }
  return res
}

function checkForAliasModel (el, value) {
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap['v-model']
      )
    }
    _el = _el.parent
  }
}
