//markGKM 为标记待注释的

const Astelement = {
    type: 1,
    tag: "div",
    attrsList: [{ name: 'name', value: '222', start: 5, end: 15 }],
    attrsMap: { name: "222" },
    rawAttrsMap: {
        name: { name: 'name', value: '222', start: 5, end: 15 }
    },
    //处理标记
    processed: true,
    // v-if="flag===true"
    ifConditions: [{ exp: "(flag===true)", block: Astelement }],
    if: "(flag===true)",
    else: true,
    elseif: "xxx===xxx",
    // v-for="(val,key,index) in obj"
    for: 'obj',
    alias: 'val',
    iterator1: 'key',
    iterator2: 'index',
    key: "keyval",
    //是否是普通元素
    plain: false,
    //ref
    ref: "xxx",
    refInFor: false, //ref是否在for中
    //插槽在template情况
    slotScope: "scope", //作用域插槽
    slotTarget: "default", //具名插槽
    slotTargetDynamic: false,//是否是动态插槽名
    //插槽v-slot在组件上的情况
    scopedSlots: {
        testName: {
            slotTarget: "testName",
            slotTargetDynamic: false,
            slotScope: "scope",
            children: [
                {
                    parent: "指向的是testName这个对象"
                }
            ]
        },
        testName2: {
            //.....
        }
        //....
    },
    // 动态组件
    component: "cmp",
    inlineTemplate: false,
    // class
    staticClass: "testclass",
    classBinding: "动态class",
    // style
    staticStyle: "{\"height\":\"200px\"}",
    styleBinding: "动态style",
    //processAttr
    hasBindings: true,
    events: {
        "update:visible": { value: "addVisible=$event", dynamic: undefined, start: 48, end: 74 }//对象或数组
    },
    nativeEvents: {
        "change": { value: "msg=''", dynamic: false, start: 75, end: 98, modifiers: { stop: true } }//对象或数组
    },
    props: [
        { name: "value", value: "msg", dynamic: false, start: 62, end: 74 }
    ],
    attrs: [{ name: "attrname", value: "attrname", dynamic: false, start: 62, end: 74 }],
    dynamicAttrs: [{ name: "attrname", value: "attrname", dynamic: true, start: 62, end: 74 }],
    directives: [{
        arg: null,
        end: 38,
        isDynamicArg: false,
        modifiers: undefined,
        name: "text",
        rawName: "v-text",
        start: 26,
        value: "msg"
    }],
    // v-pre
    pre: true,
    // v-once
    once: true,
    parent:"parentAST",
    children: [],
}
