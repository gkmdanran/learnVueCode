/* @flow */

import { hasOwn } from 'shared/util'
import { warn, hasSymbol } from '../util/index'
import { defineReactive, toggleObserving } from '../observer/index'

export function initProvide (vm: Component) {
  const provide = vm.$options.provide
  if (provide) {
    //provide是函数则调用函数获得到provide对象，存放在实例的_provided上，供inject获取
    vm._provided = typeof provide === 'function'
      ? provide.call(vm)
      : provide
  }
}

export function initInjections (vm: Component) {
  const result = resolveInject(vm.$options.inject, vm)
  //result是inject中每一个key及对应的value
  if (result) {
    toggleObserving(false)   //markGKM
    Object.keys(result).forEach(key => {
      /* istanbul ignore else */
      if (process.env.NODE_ENV !== 'production') {
        defineReactive(vm, key, result[key], () => {
          warn(
            `Avoid mutating an injected value directly since the changes will be ` +
            `overwritten whenever the provided component re-renders. ` +
            `injection being mutated: "${key}"`,
            vm
          )
        })
      } else {
        defineReactive(vm, key, result[key])  //将key和value添加到实例上
      }
    })
    toggleObserving(true)
  }
}

export function resolveInject (inject: any, vm: Component): ?Object {
  if (inject) {
    // inject is :any because flow is not smart enough to figure out cached
    const result = Object.create(null)
    //兼容key为Symbol类型，获取inject上所有的key
    const keys = hasSymbol
      ? Reflect.ownKeys(inject)
      : Object.keys(inject)
    //遍历所有的key
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      // #6574 in case the inject object is observed...
      if (key === '__ob__') continue   //响应式标记的key跳过
      const provideKey = inject[key].from  //根据from的值从下到上一层层查找所有父类中的_provided是否有对应的key，然后获取_provided[key]对应的值
      let source = vm
      while (source) {
        if (source._provided && hasOwn(source._provided, provideKey)) {
          result[key] = source._provided[provideKey]
          break
        }
        source = source.$parent
      }
      //如果没有父类在_provided提供相应的值
      if (!source) {
        //查看inject[key]中是否有default值，default是函数则调用函数获取默认值
        if ('default' in inject[key]) {
          const provideDefault = inject[key].default
          result[key] = typeof provideDefault === 'function'
            ? provideDefault.call(vm)
            : provideDefault
        } else if (process.env.NODE_ENV !== 'production') {
          //没找到值并且也没默认值则抛出警告
          warn(`Injection "${key}" not found`, vm)
        }
      }
    }
    return result
  }
}
