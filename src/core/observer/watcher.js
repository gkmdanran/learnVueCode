/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      //如果时渲染watcher，那么就将当前的watcher实例添加到vue实例的_watcher上
      vm._watcher = this
    }
    //并将当前watcher添加到vue实例的_watchers中。
    vm._watchers.push(this)
    // options
    if (options) {
      //将options中的每一个配置项准换微boolean类型
      this.deep = !!options.deep //深度监听
      this.user = !!options.user //用户watcher
      this.lazy = !!options.lazy //lazyWatcher，computed对应的watcher
      this.sync = !!options.sync //同步更新，一般不用
      this.before = options.before  //渲染watcher会传入这个函数，更新前调用beforeUpdate生命周期函数
    } else {
      //不传options默认都是false
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    //computed对应的lazyWatcher的缓存标记
    this.dirty = this.lazy // for lazy watchers
    //watcher对应的依赖，及id
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    //expOrFn是函数，直接赋值给getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      //如果是字符串的话，比如“obj.name”,getter就是一个解析字符串成对象的函数
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    //如果不是lazyWatcher，调用get函数获取值，实际就是调用getter函数
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  get () {
    //表示当前的watcher就是当前实例
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      //getter绑定到vue实例，如果expOrFn字符串，那么value其实就是this.obj.name的值；否则调用expOrFn获取值。
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      //深度监听
      if (this.deep) {
        //递归读取对象或数组内的每个值，触发Object.defineProperty的get，来收集依赖
        traverse(value)
      }
      //操作完毕，指向前一个watcher
      popTarget()
      //清除依赖
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  //watcher上添加dep依赖，与dep相互绑定
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        //dep上也会添加这个watcher，相互形成绑定
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  //清除依赖
  cleanupDeps () {
    let i = this.deps.length
    //这个watcher上所有的dep都移除这个watcher
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    //清除deps
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  //更新
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      //lazyWatcher，缓存标记重置为true，下次调用comouted时会重新计算
      this.dirty = true
    } else if (this.sync) {
      //同步更新直接调用run
      this.run()
    } else {
      //通常都是异步更新
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    if (this.active) {
      //重新调用getter函数，获取新值
      const value = this.get()
      //如果新值与就值不同，value是对象或数组，深度监听都会走这里
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        //老值就是之前存放的value
        const oldValue = this.value
        //更新值
        this.value = value
        if (this.user) {
          //用户watcher会重新执行回调
          const info = `callback for watcher "${this.expression}"`
          invokeWithErrorHandling(this.cb, this.vm, [value, oldValue], this.vm, info)
        } else {
          //执行其他watcher的回调
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate () {
    //computed计算时会执行这里
    this.value = this.get()
    //dirty置为false，那么computed下次获取值的时候就不会执行evaluate来重新计算了
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  //当前watcher对应的所有deps依赖收集这个watcher
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  //取消监听
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        //从_watchers中移除
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        //这个watcher对应的所有dep上都移除当前的watcher
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
