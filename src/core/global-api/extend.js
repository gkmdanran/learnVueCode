/* @flow */

import { ASSET_TYPES } from 'shared/constants'
import { defineComputed, proxy } from '../instance/state'
import { extend, mergeOptions, validateComponentName } from '../util/index'

export function initExtend (Vue: GlobalAPI) {
  /**
   * Each instance constructor, including Vue, has a unique
   * cid. This enables us to create wrapped "child
   * constructors" for prototypal inheritance and cache them.
   */
  Vue.cid = 0
  let cid = 1

  /**
   * Class inheritance
   */
  Vue.extend = function (extendOptions: Object): Function {
    //传入的extendOptions
    extendOptions = extendOptions || {}
    //基类
    const Super = this
    //基类id
    const SuperId = Super.cid
    /**
     * 利用缓存，如果存在则直接返回缓存中的构造函数
     * 什么情况下可以利用到这个缓存？
     *   如果你在多次调用 Vue.extend 时使用了同一个配置项（extendOptions），这时就会启用该缓存
    */
    const cachedCtors = extendOptions._Ctor || (extendOptions._Ctor = {})
    if (cachedCtors[SuperId]) {
      return cachedCtors[SuperId]
    }

    const name = extendOptions.name || Super.options.name
    if (process.env.NODE_ENV !== 'production' && name) {
      validateComponentName(name)
    }
    // 定义 Sub 构造函数，和 Vue 构造函数一样
    const Sub = function VueComponent (options) {
      this._init(options)
    }
    // 通过原型继承的方式继承 Vue
    Sub.prototype = Object.create(Super.prototype)
    Sub.prototype.constructor = Sub
    Sub.cid = cid++
    //基类options和extendOptions合并
    Sub.options = mergeOptions(
      Super.options,
      extendOptions
    )
    //记录自己的基类
    Sub['super'] = Super

    // For props and computed properties, we define the proxy getters on
    // the Vue instances at extension time, on the extended prototype. This
    // avoids Object.defineProperty calls for each instance created.
    if (Sub.options.props) {
      //处理props
      initProps(Sub)
    }
    if (Sub.options.computed) {
      //处理computed
      initComputed(Sub)
    }

    // allow further extension/mixin/plugin usage
    // 定义 extend、mixin、use 这三个静态方法，允许在 Sub 基础上再进一步构造子类
    Sub.extend = Super.extend
    Sub.mixin = Super.mixin
    Sub.use = Super.use

    // create asset registers, so extended classes
    // can have their private assets too.
     // 定义 component、filter、directive 三个静态方法
    ASSET_TYPES.forEach(function (type) {
      Sub[type] = Super[type]
    })
    // enable recursive self-lookup
    // 递归组件的原理，如果组件设置了 name 属性，则将自己注册到自己的 components 选项中
    if (name) {
      Sub.options.components[name] = Sub
    }

    // keep a reference to the super options at extension time.
    // later at instantiation we can check if Super's options have
    // been updated.
    Sub.superOptions = Super.options //记录基类的options
    Sub.extendOptions = extendOptions //extendOptions
    Sub.sealedOptions = extend({}, Sub.options) //密封保存自己的options

    // cache constructor
    //缓存
    cachedCtors[SuperId] = Sub
    return Sub
  }
}

function initProps (Comp) {
  const props = Comp.options.props
  for (const key in props) {
    // 初始化 props，将 props 配置代理到 Sub.prototype._props 对象上
    // 在组件内通过 this._props 方式可以访问
    proxy(Comp.prototype, `_props`, key)
  }
}

function initComputed (Comp) {
  const computed = Comp.options.computed
  for (const key in computed) {
    // 初始化 computed，将 computed 配置代理到 Sub.prototype 对象上
    // 在组件内可以通过 this.computedKey 的方式访问
    defineComputed(Comp.prototype, key, computed[key])
  }
}
