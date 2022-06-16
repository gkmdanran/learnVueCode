/* @flow */

import { isRegExp, remove } from 'shared/util'
import { getFirstComponentChild } from 'core/vdom/helpers/index'

type CacheEntry = {
  name: ?string;
  tag: ?string;
  componentInstance: Component;
};

type CacheEntryMap = { [key: string]: ?CacheEntry };

//获取组件名
function getComponentName (opts: ?VNodeComponentOptions): ?string {
  return opts && (opts.Ctor.options.name || opts.tag)
}

//匹配组件名
function matches (pattern: string | RegExp | Array<string>, name: string): boolean {
  if (Array.isArray(pattern)) {
    return pattern.indexOf(name) > -1
  } else if (typeof pattern === 'string') {
    return pattern.split(',').indexOf(name) > -1
  } else if (isRegExp(pattern)) {
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}

function pruneCache (keepAliveInstance: any, filter: Function) {
  //从当前keepAlive实例上获得cache，keys
  const { cache, keys, _vnode } = keepAliveInstance
  for (const key in cache) {
    const entry: ?CacheEntry = cache[key]
    if (entry) {
      const name: ?string = entry.name
      if (name && !filter(name)) {
        //销毁不在include或在exclude中的vnode
        pruneCacheEntry(cache, key, keys, _vnode)
      }
    }
  }
}

//清空缓存,销毁组件
function pruneCacheEntry (
  cache: CacheEntryMap,
  key: string,
  keys: Array<string>,
  current?: VNode
) {
  //如果当前key对应vnode存在缓存中
  const entry: ?CacheEntry = cache[key]
  if (entry && (!current || entry.tag !== current.tag)) {
    //那么销毁vnode的组件实例
    entry.componentInstance.$destroy()
  }
  //清空缓存
  cache[key] = null
  //key队列中移除
  remove(keys, key)
}

const patternTypes: Array<Function> = [String, RegExp, Array]

export default {
  name: 'keep-alive',
  //是一个抽象组件，在组件实例建立父子关系的时候会被忽略，发生在 initLifecycle 的过程中
  abstract: true,

  props: {
    include: patternTypes,
    exclude: patternTypes,
    max: [String, Number]
  },

  methods: {
    //添加缓存
    cacheVNode() {
      const { cache, keys, vnodeToCache, keyToCache } = this
      //vnodeToCache，被缓存的vnode
      if (vnodeToCache) {
        const { tag, componentInstance, componentOptions } = vnodeToCache
        //keyToCache 被缓存vnode的key
        cache[keyToCache] = {
          name: getComponentName(componentOptions),
          tag,
          componentInstance,
        }
        keys.push(keyToCache)
        // prune oldest entry
        if (this.max && keys.length > parseInt(this.max)) {
          //如果配置了 max 并且缓存的长度超过了 this.max，还要从缓存中删除第一个
          pruneCacheEntry(cache, keys[0], keys, this._vnode)
        }
        this.vnodeToCache = null
      }
    }
  },

  created () {
    //cache用来缓存已经创建过的 vnode
    this.cache = Object.create(null)
    this.keys = []
  },

  destroyed () {
    //销毁缓存中所有的组件实例
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys)
    }
  },

  mounted () {
    //添加缓存
    this.cacheVNode()
    //监听
    this.$watch('include', val => {
      pruneCache(this, name => matches(val, name))
    })
    this.$watch('exclude', val => {
      pruneCache(this, name => !matches(val, name))
    })
  },

  updated () {
    //添加缓存
    this.cacheVNode()
  },

  render () {
    //默认插槽的内容都是keep-alive组件的子节点
    const slot = this.$slots.default
    //子节点列表中找到第一个是组件的vnode
    const vnode: VNode = getFirstComponentChild(slot)
    //获取组件vnode的componentOptions
    const componentOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions
    if (componentOptions) {
      // check pattern
      //获取组件名
      const name: ?string = getComponentName(componentOptions)
      const { include, exclude } = this
      //组件名如果满足了配置 include 且不匹配或者是配置了 exclude 且匹配，那么就直接返回这个组件的 vnode
      if (
        // not included
        (include && (!name || !matches(include, name))) ||
        // excluded
        (exclude && name && matches(exclude, name))
      ) {
        return vnode
      }

      const { cache, keys } = this
      const key: ?string = vnode.key == null
        // same constructor may get registered as different local components
        // so cid alone is not enough (#3269)
        ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '')
        : vnode.key
      if (cache[key]) {
        //如果缓存中存在，则直接返回缓存，获取组件实例
        vnode.componentInstance = cache[key].componentInstance
        // make current key freshest
        //重新调整了 key 的顺序，将key放在key队列最后
        remove(keys, key)
        keys.push(key)
      } else {
        // delay setting the cache until update
        //添加进缓存
        this.vnodeToCache = vnode
        this.keyToCache = key
      }
      // 组件添加keepAlive标记
      vnode.data.keepAlive = true
    }
    return vnode || (slot && slot[0])
  }
}
