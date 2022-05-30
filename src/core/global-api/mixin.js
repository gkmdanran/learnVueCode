/* @flow */

import { mergeOptions } from '../util/index'

export function initMixin (Vue: GlobalAPI) {
  Vue.mixin = function (mixin: Object) {
    //mixin混入的option与实例的options合并后添加到实例的options上
    this.options = mergeOptions(this.options, mixin)
    return this
  }
}
