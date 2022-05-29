/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'
import config from '../config'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
export default class Dep {
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor () {
    this.id = uid++
    //new Dep时会在dep实例上创建一个subs数组，用来存放派发更新时需要通知的watcher
    this.subs = []
  }
  //添加watcher
  addSub (sub: Watcher) {
    this.subs.push(sub)
  }
  //移除指定watcher
  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }
  //收集依赖，Dep.target表示当前的watcher，在当前watcher上添加这个依赖
  depend () {
    if (Dep.target) {
      Dep.target.addDep(this)
    }
  }
  //派发更新
  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    //循环subs数组，调用每一个watcher的update方法去更新
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}

// The current target watcher being evaluated.
// This is globally unique because only one watcher
// can be evaluated at a time.
Dep.target = null
//存放watcher的栈
const targetStack = []
//watcher入栈，并且Dep.target指向当前watcher
export function pushTarget (target: ?Watcher) {
  targetStack.push(target)
  Dep.target = target
}
//watcher出栈，Dep.target指向前一个watcher
export function popTarget () {
  targetStack.pop()
  Dep.target = targetStack[targetStack.length - 1]
}
