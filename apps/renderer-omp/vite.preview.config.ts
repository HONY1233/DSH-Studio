import { createRendererConfig } from "./vite.config";

/** Local fixture harness only; never used by the packaged product entry. */
export default createRendererConfig(true);
