/* @flow */

/**
 * Expand input[v-model] with dynamic type bindings into v-if-else chains
 * Turn this:
 *   <input v-model="data[type]" :type="type">
 * into this:
 *   <input v-if="type === 'checkbox'" type="checkbox" v-model="data[type]">
 *   <input v-else-if="type === 'radio'" type="radio" v-model="data[type]">
 *   <input v-else :type="type" v-model="data[type]">
 */

import {
  addRawAttr,
  getBindingAttr,
  getAndRemoveAttr
} from 'compiler/helpers'

import {
  processFor,
  processElement,
  addIfCondition,
  createASTElement
} from 'compiler/parser/index'

function preTransformNode (el: ASTElement, options: CompilerOptions) {
  //必须是带有v-model属性的input
  if (el.tag === 'input') {
    const map = el.attrsMap
    if (!map['v-model']) {
      return
    }

    let typeBinding
    if (map[':type'] || map['v-bind:type']) {
      //从attrsMap上获取:type或v-bind:type的值，并且从attrsList中移除对应的一项
      typeBinding = getBindingAttr(el, 'type')
    }
    //处理 obj={type:xxx,xxx:xxx}  v-bind="obj"的情况
    if (!map.type && !typeBinding && map['v-bind']) {
      typeBinding = `(${map['v-bind']}).type`
      //`(obj).type`
    }
    //获取到了type绑定到值
    if (typeBinding) {
      //从attrsMap上获取v-if对应的值，并且从attrsList和attrsMap中移除v-if
      const ifCondition = getAndRemoveAttr(el, 'v-if', true)
      //如果存在值，则字符串拼接 '&&(flag===true)'
      const ifConditionExtra = ifCondition ? `&&(${ifCondition})` : ``
      //从attrsMap上获取v-else对应的值，并且从attrsList和attrsMap中移除v-else，根据值的情况判断是否有v-else
      const hasElse = getAndRemoveAttr(el, 'v-else', true) != null
      //从attrsMap上获取v-else-if对应的值，并且从attrsList和attrsMap中移除v-else-if
      const elseIfCondition = getAndRemoveAttr(el, 'v-else-if', true)
      // 1. checkbox
      //克隆一个ast，处理type=checkbox的情况
      const branch0 = cloneASTElement(el)
      // process for on the main node
      //处理v-for，ast上添加for，alias，iterator1，iterator2
      processFor(branch0)
      //attrsMap上添加type:"checkbox",attrsList添加{name:"type",value:"checkbox"}
      addRawAttr(branch0, 'type', 'checkbox')
      //处理元素
      processElement(branch0, options)
      //表示已经处理过
      branch0.processed = true // prevent it from double-processed
      //ast上添加if属性 if:`(obj).type===checkbox&&(flag===true)`
      branch0.if = `(${typeBinding})==='checkbox'` + ifConditionExtra
      //ast上添加ifConditions
      addIfCondition(branch0, {
        exp: branch0.if,
        block: branch0
      })
      // 2. add radio else-if condition
      //克隆一个ast，处理type=radio的情况
      const branch1 = cloneASTElement(el)
      //从attrsList和attrsMap中移除v-for
      getAndRemoveAttr(branch1, 'v-for', true)
      //attrsMap上添加type:"radio",attrsList添加{name:"type",value:"radio"}
      addRawAttr(branch1, 'type', 'radio')
      processElement(branch1, options)
      addIfCondition(branch0, {
        exp: `(${typeBinding})==='radio'` + ifConditionExtra,
        block: branch1
      })
      // 3. other
      //其他情况
      const branch2 = cloneASTElement(el)
      getAndRemoveAttr(branch2, 'v-for', true)
      addRawAttr(branch2, ':type', typeBinding)
      processElement(branch2, options)
      addIfCondition(branch0, {
        exp: ifCondition,
        block: branch2
      })

      if (hasElse) {
        branch0.else = true
      } else if (elseIfCondition) {
        branch0.elseif = elseIfCondition
      }

      return branch0
    }
  }
}

function cloneASTElement (el) {
  return createASTElement(el.tag, el.attrsList.slice(), el.parent)
}

export default {
  preTransformNode
}
