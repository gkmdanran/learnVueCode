//markGKM 为标记待注释的

const Astelement = {
    type: 1,
    tag: "div",
    attrsList: [{ name: 'name', value: '222', start: 5, end: 15 }],
    attrsMap: { name: "222" },
    rawAttrsMap: {
        name: { name: 'name', value: '222', start: 5, end: 15 }
    },
    parent: undefined,
    //处理标记
    processed: true,
    // v-if="flag===true"
    ifConditions: [{ exp: "(flag===true)", block: Astelement }],
    if:"(flag===true)",
    else:true,
    elseif:"xxx===xxx",
    // v-for="(val,key,index) in obj"
    for: 'obj', 
    alias: 'val', 
    iterator1: 'key', 
    iterator2: 'index'
}
