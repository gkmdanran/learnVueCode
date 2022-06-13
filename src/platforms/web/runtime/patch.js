/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules)
// patch 工厂函数，为其传入平台特有的一些操作，然后返回一个 patch 函数
// nodeOps里封装的都是web 平台的 DOM 操作 API
// modules：attr、class、style、event 等，还有核心的 directive 和 ref，
// 它们会向外暴露一些特有的方法，比如：create、activate、update、remove、destroy，这些方法在 patch 阶段时会被调用
export const patch: Function = createPatchFunction({ nodeOps, modules })
