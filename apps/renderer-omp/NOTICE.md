# NOTICE — OMP Studio fork

`apps/renderer-omp` 以及 `apps/renderer-omp/vendor/omp/packages/*` 是
[the-snowpear/omp-studio](https://github.com/the-snowpear/omp-studio) 的衍生副本，
基线为 v0.2.8（MIT License，版权归 the-snowpear 及其贡献者）。

- 上游许可证全文见 `vendor/omp/LICENSE`，上游 NOTICE 见 `vendor/omp/NOTICE`。
- 本仓库对上游的修改集中在：
  - `src/main.tsx`：客户端创建改为 `createDshStudioClient()`（`src/dsh/client.ts`）。
  - 删除上游的多余 harness HTML 入口与 `graphic-vendor-plugin` / `file-viewer-vendor-plugin`。
  - `package.json` / `vite.config.ts` 指向本地 vendor 包与 `omp-patch/vendor` 下的 `@oh-my-pi` 源码。
- `omp-patch/vendor/oh-my-pi` 中的文件取自 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)（`main` 分支），
  仅包含渲染层直接 import 的模块及其 DOM 解析依赖；`html-form/model.ts` 是本仓库新增的兼容 shim。

除上述说明外，衍生部分同样以 MIT 许可证发布。
