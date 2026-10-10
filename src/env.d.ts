/** The logoxide WebAssembly module (logoxide with topos), embedded by esbuild's binary loader */
/** The background indexer's bundled code (see esbuild.config.mjs) */
declare module "topos-worker-source" {
  const source: string;
  export default source;
}

declare module "logoxide-wasm" {
  const bytes: Uint8Array;
  export default bytes;
}
