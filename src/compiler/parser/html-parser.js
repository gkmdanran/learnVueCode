/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'

// Regular Expressions for parsing tags and attributes
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const dynamicArgAttribute = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
const startTagOpen = new RegExp(`^<${qnameCapture}`)
const startTagClose = /^\s*(\/?)>/
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
const doctype = /^<!DOCTYPE [^>]+>/i
// #7298: escape - to avoid being passed as HTML comment when inlined in page
const comment = /^<!\--/
const conditionalComment = /^<!\[/

// Special Elements (can contain anything)
export const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// #5992
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

function decodeAttr (value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

export function parseHTML (html, options) {
  const stack = []
  const expectHTML = options.expectHTML
  // 是否是自闭合标签
  const isUnaryTag = options.isUnaryTag || no
  // 是否可以只有开始标签
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  // 记录当前在原始 html 字符串中的开始位置
  let index = 0
  let last, lastTag
  while (html) {
    last = html
    // Make sure we're not in a plaintext content element like script/style
    // 确保不是在 script、style、textarea 这样的纯文本元素中
    if (!lastTag || !isPlainTextElement(lastTag)) {
      //获取第一个<的位置索引
      let textEnd = html.indexOf('<')
      //如果在开头就找到了
      if (textEnd === 0) {
        // Comment:
        //处理注释
        if (comment.test(html)) {
          const commentEnd = html.indexOf('-->')

          if (commentEnd >= 0) {
            //如果需要保留注释，就调用comment钩子生成一个，注释的ast{ type: 3,text:xxxx,isComment: true}
            if (options.shouldKeepComment) {
              options.comment(html.substring(4, commentEnd), index, index + commentEnd + 3)
            }
            //截取html，index往前移
            advance(commentEnd + 3)
            continue
          }
        }
        
        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        //处理条件注释
        if (conditionalComment.test(html)) {
          const conditionalEnd = html.indexOf(']>')

          if (conditionalEnd >= 0) {
            //截取html，index往前移
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype:
        //处理Doctype
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          //截取html，index往前移
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        // 处理结束标签，比如 </div>
        const endTagMatch = html.match(endTag)
        if (endTagMatch) {
          const curIndex = index
          //截取html，index往前移
          advance(endTagMatch[0].length)
          //解析结束标签
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        //解析开始标签
        const startTagMatch = parseStartTag()
        //{attrs: [],end: 39,start: 33,tagName: "span",unarySlash: ""}
        if (startTagMatch) {
          //处理开始标签，处理attrs，调用钩子函数start
          handleStartTag(startTagMatch)
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          continue
        }
      }

      let text, rest, next
      // 能走到这儿，说明虽然在 html 中匹配到到了 <xx，但是这不属于上述几种情况，
      // 它就只是一个普通的一段文本：<我是文本
      // 于是从 html 中找到下一个 <，直到 <xx 是上述几种情况的标签，则结束，
      // 在这整个过程中一直在调整 textEnd 的值，作为 html 中下一个有效标签的开始位置
      // 例如 <span style="height:200px">3232<222</span>
      // textEnd：4
      if (textEnd >= 0) {
        // html：3232<222</span>
        rest = html.slice(textEnd)
        // rest：<222</span>
        // 这个 while 循环就是处理 <xx 之后的纯文本情况
        // 截取文本内容，并找到有效标签的开始位置（textEnd）
        // 这里会循环寻找 < ,看 < 之后是否是有效标签。循环直到找不到 < , 或者找到有效标签，那就根据textEnd来截取文本。
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          //认为 < 后面的内容为纯文本，然后在这些纯文本中再次找 <
          next = rest.indexOf('<', 1)
          // 如果没找到 <，则直接结束循环
          if (next < 0) break
          // 走到这儿说明在后续的字符串中找到了 <，索引位置为 textEnd
          textEnd += next
          // 截取 html 字符串模版 textEnd 之后的内容赋值给 rest，继续判断之后的字符串是否存在标签
          rest = html.slice(textEnd)
        }
        //截取文本
        text = html.substring(0, textEnd)
      }
      // 如果 textEnd < 0，说明 html 中就没找到 <，那说明 html 就是一段文本
      if (textEnd < 0) {
        text = html
      }
      // 将文本内容从 html 模版字符串上截取掉
      if (text) {
        advance(text.length)
      }
      // 处理文本：调用chars钩子函数生成ast，
      // 基于文本生成 ast 对象，然后将该 ast 放到它的父元素的children 数组中
      if (options.chars && text) {
        options.chars(text, index - text.length, index)
      }
    } else {
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    if (html === last) {
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, { start: index + html.length })
      }
      break
    }
  }

  // Clean up any remaining tags
  parseEndTag()

  function advance (n) {
    index += n
    html = html.substring(n)
  }

  function parseStartTag () {
    const start = html.match(startTagOpen)
    if (start) {
      const match = {
        tagName: start[1],
        attrs: [],
        start: index
      }
      advance(start[0].length)
      let end, attr
      // 处理 开始标签 内的各个属性，并将这些属性放到 match.attrs 数组中
      while (!(end = html.match(startTagClose)) && (attr = html.match(dynamicArgAttribute) || html.match(attribute))) {
        attr.start = index
        advance(attr[0].length)
        attr.end = index
        match.attrs.push(attr)
      }
      // 开始标签的结束，end = '>' 或 end = ' />'
      if (end) {
        match.unarySlash = end[1]
        advance(end[0].length)
        match.end = index
        return match
      }
    }
  }

  function handleStartTag (match) {
    const tagName = match.tagName
    const unarySlash = match.unarySlash

    if (expectHTML) {
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag)
      }
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }
    //判断是否是自闭合标签
    const unary = isUnaryTag(tagName) || !!unarySlash

    const l = match.attrs.length
    //处理attrs
    const attrs = new Array(l)
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i]
      const value = args[3] || args[4] || args[5] || ''
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
      //attrs变成[{name:"name",value:"xiaoming"},...]
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }
    // 如果不是自闭合标签，则将标签信息放到 stack 数组中，待将来处理到它的闭合标签时再将其弹出 stack
    // 如果是自闭合标签，则标签信息就没必要进入 stack 了，直接处理众多属性，将他们都设置到 element ast 对象上，就没有处理 结束标签的那一步了，这一步在处理开始标签的过程中就进行了
    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs, start: match.start, end: match.end })
      lastTag = tagName
    }
    /**
     * 调用 start 方法，主要做了以下 6 件事情:
     *   1、创建 AST 对象
     *   2、处理存在 v-model 指令的 input 标签，分别处理 input 为 checkbox、radio、其它的情况
     *   3、处理标签上的众多指令，比如 v-pre、v-for、v-if、v-once
     *   4、如果根节点 root 不存在则设置当前元素为根节点
     *   5、如果当前元素为非自闭合标签则将自己 push 到 stack 数组，并记录 currentParent，在接下来处理子元素时用来告诉子元素自己的父节点是谁
     *   6、如果当前元素为自闭合标签，则表示该标签要处理结束了，让自己和父元素产生关系，以及设置自己的子元素
     */
    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }

  function parseEndTag (tagName, start, end) {
    let pos, lowerCasedTagName
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    // 倒序遍历 stack 数组，找到第一个和当前结束标签相同的标签，该标签就是结束标签对应的开始标签的描述对象
    // 理论上，不出异常，stack 数组中的最后一个元素就是当前结束标签的开始标签的描述对象
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    //如果在 stack 中一直没有找到相同的标签名，则 pos 就会 < 0，进行后面的 else 分支
    if (pos >= 0) {
      // 这个 for 循环负责关闭 stack 数组中索引 >= pos 的所有标签
      // 为什么要用一个循环，上面说到正常情况下 stack 数组的最后一个元素就是我们要找的开始标签，
      // 但是有些异常情况，就是有些元素没有给提供结束标签，比如：
      // 假如当前的stack = ['span', 'div', 'span', 'h1']，当前处理的结束标签 tagName = div
      // 匹配到 div，pos = 1，那索引为 2 和 3 的两个标签（span、h1）说明就没提供结束标签
      // 这个 for 循环就负责关闭 div、span 和 h1 这三个标签，
      // 并在开发环境为 span 和 h1 这两个标签给出 ”未匹配到结束标签的提示”
      // Close all the open elements, up the stack
      for (let i = stack.length - 1; i >= pos; i--) {
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`,
            { start: stack[i].start, end: stack[i].end }
          )
        }
        if (options.end) {
          //调用end钩子韩素end("div",start,end)
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      stack.length = pos//stack = ['span']
      lastTag = pos && stack[pos - 1].tag //span
    } else if (lowerCasedTagName === 'br') {
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
