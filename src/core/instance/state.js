/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute,
  invokeWithErrorHandling
} from '../util/index'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}
//代理对象
export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState (vm: Component) {
  vm._watchers = []  //watcher存在这里
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)   //处理props
  if (opts.methods) initMethods(vm, opts.methods) //处理methods
  if (opts.data) {
    initData(vm)   //处理data
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  if (opts.computed) initComputed(vm, opts.computed) //处理computed
  if (opts.watch && opts.watch !== nativeWatch) { //防止和Firefox浏览器下的watch冲突
    initWatch(vm, opts.watch)  //处理watch
  }
}

function initProps (vm: Component, propsOptions: Object) {
  //propsData是在组件上传的props及value
  //<cmp name="test"/>
  //propsData={name:"test"}
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = []
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    toggleObserving(false)
  }
  //循环options.props
  for (const key in propsOptions) {
    //将props的key缓存到vm.$options._propKeys上
    keys.push(key)
    //获取props的值，从propsData中获取值，不存在则会找default的值，对于Boolean类型特殊处理
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
          config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      //将props的key和value设置到vm._props上
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      //代理，访问this.xxx时实际访问的是this._props.xxx的值
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

function initData (vm: Component) {
  let data = vm.$options.data
  //data是函数则调用函数获得data对象,并添加到vm._data上
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      //校验data上的key是否与methods中的key重复
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    //校验data上的key是否与props中的key重复
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      //代理_data，通过this.xxx时获取的实际是this._data.xxx的值
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  //侦测data，使data响应式
  observe(data, true /* asRootData */)
}

export function getData (data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    //调用data函数获得data对象
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

const computedWatcherOptions = { lazy: true }

function initComputed (vm: Component, computed: Object) {
  // $flow-disable-line
  const watchers = vm._computedWatchers = Object.create(null)//存放由computed创建的lazyWatcher
  // computed properties are just getters during SSR
  const isSSR = isServerRendering()

  for (const key in computed) {
    const userDef = computed[key]
    //如果用户定义的computed是一个函数那就直接当作getter，否则就是对象上的get当作getter
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      //创建一个lazyWatcher,传递的options:{lazy:true}，添加到vm._computedWatchers上
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    if (!(key in vm)) {
      //将computed处理后添加到Vue实例，通过this.xxx可以访问
      defineComputed(vm, key, userDef)
    } else if (process.env.NODE_ENV !== 'production') {
      //校验重复
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      } else if (vm.$options.methods && key in vm.$options.methods) {
        warn(`The computed property "${key}" is already defined as a method.`, vm)
      }
    }
  }
}

export function defineComputed (
  target: any,
  key: string,
  userDef: Object | Function
) {
  const shouldCache = !isServerRendering()
  if (typeof userDef === 'function') {
    //获取computed值时会从lazyWathcer上获取值，并在lazyWatcher上做了缓存处理
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : createGetterInvoker(userDef)
    sharedPropertyDefinition.set = noop
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop
    //修改computed值是会触发用户定义的set
    sharedPropertyDefinition.set = userDef.set || noop
  }
  if (process.env.NODE_ENV !== 'production' &&
      sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

function createComputedGetter (key) {
  return function computedGetter () {
    //找到key对应的lazyWatcher
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      //调用用户传入的get获取值，会根据dirty做缓存处理，只有dirty为true才会计算
      if (watcher.dirty) {
        watcher.evaluate()
      }
      //依赖收集
      if (Dep.target) {
        watcher.depend()
      }
      //返回computed值
      return watcher.value
    }
  }
}
//用于服务端渲染
function createGetterInvoker(fn) {
  return function computedGetter () {
    return fn.call(this, this)
  }
}

function initMethods (vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      //校验methods中每一项是否是函数
      if (typeof methods[key] !== 'function') {
        warn(
          `Method "${key}" has type "${typeof methods[key]}" in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      //校验methods中每一项是否与props的key重复
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {//是否与$ 和 _ 开头的内置方法重叠
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    //将函数通过bind绑定this到Vue实例
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
  }
}

function initWatch (vm: Component, watch: Object) {
  for (const key in watch) {
    const handler = watch[key]
    //watch[key]对应的是一个数组就循环调用createWatcher去创建用户watcher
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

function createWatcher (
  vm: Component,
  expOrFn: string | Function,
  handler: any,
  options?: Object
) {
  if (isPlainObject(handler)) {   //如果是一个对象，则会提取对象中handler的值做为cb回调函数，其余的则是options选项
    options = handler
    handler = handler.handler
  }
  if (typeof handler === 'string') {   //如果handler是一个字符串，则会在实例上找对应的方法作为cb回调函数。
    handler = vm[handler]
  }
  return vm.$watch(expOrFn, handler, options)  //通过$watch创建用户watcher。
}

export function stateMixin (Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }

  //$data和$props只读，不能设置。
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef) //this.$data实际访问的是this._data，并且不能设置$data。
  Object.defineProperty(Vue.prototype, '$props', propsDef)//this.$props实际访问的是this._props，并且不能设置$props。

  Vue.prototype.$set = set
  Vue.prototype.$delete = del


  //1.用户可以通过以下方式手动调用$watch；
  //   this.$watch('obj.b.c', function (newVal, oldVal) {}) 
  //或 this.$watch(()=>this.obj,function (newVal, oldVal) {})
  //2.对于定义在 watch:{ } 中的每一个watch也会调用$watch方法来创建watcher。
  Vue.prototype.$watch = function (
    expOrFn: string | Function,  
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this
    if (isPlainObject(cb)) {   //如果cb传入的是一个对象，则会通过createWatcher去处理。
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {}
    options.user = true   //用户watcher标记
    const watcher = new Watcher(vm, expOrFn, cb, options)
    if (options.immediate) {   //传入immediate为true时，立即执行watcher的回调函数。
      const info = `callback for immediate watcher "${watcher.expression}"`
      pushTarget() //Dep.target=这个watcher
      invokeWithErrorHandling(cb, vm, [watcher.value], vm, info)  //通过try catch包裹执行cb，用来抛出异常信息。
      popTarget()  //这个watcher出栈，Dep.target=前一个watcher
    }
    return function unwatchFn () {   //返回一个函数，用来取消watcher监听。
      watcher.teardown()
    }
  }
}
