import esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rewritePrefix } from "file-plus-plus/build";

const production = process.argv[2] === "production";
const outdir = fileURLToPath(new URL("./dist/", import.meta.url));
mkdirSync(outdir, { recursive: true });

/**
 * file-plus-plus (the Bible tab, previews, embeds) names its classes, data attributes, and CSS
 * variables `fpp-…`; in this plugin they are `tpb-…`, so plugins on other versions of it (EPUB++,
 * Transcript++) never share styles. Its CSS comes first in styles.css, then this plugin's.
 */
const PREFIX = "tpb";
const library = realpathSync(fileURLToPath(new URL("./node_modules/file-plus-plus/", import.meta.url)));
const filePlusPlus = {
  name: "file-plus-plus",
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, (args) => {
      const real = realpathSync(args.path);
      if (!real.startsWith(join(library, "src"))) return undefined;
      return { contents: rewritePrefix(readFileSync(real, "utf8"), PREFIX), loader: "ts" };
    });
    build.onEnd(() => {
      const css = rewritePrefix(readFileSync(join(library, "styles.css"), "utf8"), PREFIX);
      const own = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
      writeFileSync(join(outdir, "styles.css"), `/* file-plus-plus */\n${css}\n/* topos */\n${own}`);
      copyFileSync(new URL("./manifest.json", import.meta.url), join(outdir, "manifest.json"));
    });
  },
};
const pkg = fileURLToPath(new URL("./node_modules/logoxide/", import.meta.url));

const alias = {
  "logoxide": `${pkg}logoxide.js`,
  "logoxide-wasm": `${pkg}logoxide_bg.wasm`,
};

/**
 * Bundles the Web Worker on each build and exposes its code as `import source from
 * "topos-worker-source"`, so main.js stays a single file. The worker gets the WebAssembly from
 * the plugin at startup, so it is not embedded twice.
 */
const workerSource = {
  name: "worker-source",
  setup(build) {
    build.onResolve({ filter: /^topos-worker-source$/ }, (args) => ({ path: args.path, namespace: "worker" }));
    build.onLoad({ filter: /.*/, namespace: "worker" }, async () => {
      const result = await esbuild.build({
        entryPoints: ["src/indexers/worker.ts"],
        bundle: true,
        write: false,
        format: "iife",
        target: "es2022",
        minify: production,
        alias,
      });
      return { contents: result.outputFiles[0].text, loader: "text", watchFiles: ["src/indexers/worker.ts", "src/core/search.ts"] };
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  plugins: [workerSource, filePlusPlus],
  bundle: true,
  // Obsidian and CodeMirror are provided by the app
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ],
  // The package's core module (no automatic loading) and its WebAssembly, embedded in main.js
  alias,
  loader: { ".wasm": "binary" },
  format: "cjs",
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  outfile: join(outdir, "main.js"),
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
