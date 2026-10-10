import init, { Topos } from "logoxide";
import wasm from "logoxide-wasm";

/**
 * Loads the embedded WebAssembly module and creates the engine.
 * esbuild points `logoxide` at the package's core module (no automatic loading) and embeds
 * the `.wasm` file, so this works offline and on mobile.
 */
export async function loadTopos(): Promise<Topos> {
  // Once: initializing again would replace the module that existing objects live in
  ready ??= init(wasm);
  await ready;
  return Topos.new();
}

let ready: Promise<void> | null = null;

/** The engine's WebAssembly, to start background workers with */
export const engineWasm: Uint8Array = wasm;
