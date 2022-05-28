/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'

const arrayProto = Array.prototype
//原型式继承Array
export const arrayMethods = Object.create(arrayProto)

const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
methodsToPatch.forEach(function (method) {
  // cache original method
  //保存数组原有的方法 
  const original = arrayProto[method]
  //重写数组方法
  def(arrayMethods, method, function mutator (...args) {
    //调用原有的方法获得返回值
    const result = original.apply(this, args)
    //获取数组上的Observer实例，因为需要获取实例上的dep
    const ob = this.__ob__
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    //对于push，unshift，splice这三个插入值的方法，需要通过observeArray对插入的值进行侦测。
    if (inserted) ob.observeArray(inserted)
    // notify change
    //使用数组对应的dep来派发更新
    ob.dep.notify()
    //返回原方法的结果
    return result
  })
})
