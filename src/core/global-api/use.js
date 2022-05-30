/* @flow */

import { toArray } from '../util/index'

export function initUse (Vue: GlobalAPI) {
  Vue.use = function (plugin: Function | Object) {
    // 已经安装过的插件列表
    const installedPlugins = (this._installedPlugins || (this._installedPlugins = []))
    // 判断 plugin 是否已经安装，保证不重复安装
    if (installedPlugins.indexOf(plugin) > -1) {
      return this
    }

    // additional parameters
    // 将 Vue 构造函数放到第一个参数位置，然后将这些参数传递给 install 方法
    const args = toArray(arguments, 1)
    args.unshift(this)
    if (typeof plugin.install === 'function') {
      // plugin 是一个对象，则执行其 install 方法安装插件
      plugin.install.apply(plugin, args)
    } else if (typeof plugin === 'function') {
       //plugin 是一个函数，直接执行 plugin 方法安装插件
      plugin.apply(null, args)
    }
    // 在 插件列表中 添加新安装的插件
    installedPlugins.push(plugin)
    return this
  }
}
