/**
 * node 半。UI 插件在浏览器运行，node 侧可以是空的。
 * 但包必须提供这个入口：Loader 会把每个 row 当 Cordis 插件加载，缺了会报错。
 */
export function apply() {}
