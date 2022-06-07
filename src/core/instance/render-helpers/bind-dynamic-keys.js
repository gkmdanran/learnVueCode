/* @flow */

// helper to process dynamic keys for dynamic arguments in v-bind and v-on.
// For example, the following template:
//
// <div id="app" :[key]="value">
//
// compiles to the following:
//
// _c('div', { attrs: bindDynamicKeys({ "id": "app" }, [key, value]) })

import { warn } from 'core/util/debug'

export function bindDynamicKeys (baseObj: Object, values: Array<any>): Object {
  //循环动态属性数组values
  for (let i = 0; i < values.length; i += 2) {
    //偶数项是key及属性名
    const key = values[i]
    if (typeof key === 'string' && key) {
      //将key和value合并到静态属性对象上
      baseObj[values[i]] = values[i + 1]
    } else if (process.env.NODE_ENV !== 'production' && key !== '' && key !== null) {
      // null is a special value for explicitly removing a binding
      warn(
        `Invalid value for dynamic directive argument (expected string or null): ${key}`,
        this
      )
    }
  }
  //返回静态属性和动态属性合并后的对象
  return baseObj
}

// helper to dynamically append modifier runtime markers to event names.
// ensure only append when value is already string, otherwise it will be cast
// to string and cause the type check to miss.
//处理事件名，对于一些事件修饰符拼接！～ & 符号
export function prependModifier (value: any, symbol: string): any {
  return typeof value === 'string' ? symbol + value : value
}
