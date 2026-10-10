// Recordings (src/bible/media.ts), bundled with a stand-in for Obsidian: asked about once, downloaded
// once, checked against the package's size and SHA-256 (logoxide), kept by hash, and reused
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

/** The parts of Obsidian media.ts uses (and what it imports uses at load) */
const OBSIDIAN = `
export const log = { notices: [], requests: [], answer: "Download", asked: [] };
export const responses = {};
export class Notice {
  constructor(message) { log.notices.push(message); }
  hide() {}
}
const el = () => ({ setText() {}, createEl: () => el(), empty() {} });
export class Modal {
  constructor(app) { this.app = app; this.titleEl = el(); this.contentEl = el(); this.buttons = []; Modal.current = this; }
  open() {
    this.onOpen();
    log.asked.push(this.buttons.map((b) => b.text).join("/"));
    this.buttons.find((b) => b.text === log.answer)?.click?.();
    if (!this.closed) this.close();
  }
  close() { this.closed = true; this.onClose(); }
}
export class Setting {
  constructor() {}
  addButton(build) {
    const button = { text: "", setButtonText(t) { this.text = t; return this; }, setCta() { return this; }, onClick(f) { this.click = f; return this; } };
    build(button);
    Modal.current.buttons.push(button);
    return this;
  }
}
export async function requestUrl({ url }) {
  log.requests.push(url);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const bytes = new TextEncoder().encode(responses[url] ?? "");
  return { status: responses[url] === undefined ? 404 : 200, arrayBuffer: bytes.buffer };
}
export class TFile {}
export class TFolder {}
export function setIcon() {}
`;

async function load() {
  const dir = new URL("../node_modules/.cache/media-test/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "obsidian.js"), OBSIDIAN);
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    `export { BibleMedia } from ${JSON.stringify(new URL("../src/bible/media.ts", import.meta.url).pathname)};
     export { log, responses } from "obsidian";`,
  );
  const out = join(dir, "media.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["logoxide"],
    alias: { obsidian: join(dir, "obsidian.js") },
    nodePaths: [new URL("../node_modules", import.meta.url).pathname],
    outfile: out,
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

/** The vault's adapter, in memory */
function memoryAdapter() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([""]);
  return {
    files,
    async exists(path: string) {
      return files.has(path) || dirs.has(path);
    },
    async mkdir(path: string) {
      dirs.add(path);
    },
    async writeBinary(path: string, data: ArrayBuffer) {
      files.set(path, new Uint8Array(data));
    },
    async list(path: string) {
      const under = (p: string) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes("/");
      return { files: [...files.keys()].filter(under), folders: [...dirs].filter(under) };
    },
    async stat(path: string) {
      return { size: files.get(path)?.byteLength ?? 0 };
    },
    async rmdir(path: string) {
      for (const p of [...files.keys()]) if (p.startsWith(`${path}/`)) files.delete(p);
      for (const p of [...dirs]) if (p === path || p.startsWith(`${path}/`)) dirs.delete(p);
    },
    getResourcePath: (path: string) => `app://local/${path}`,
  };
}

test("a recording is downloaded once, checked, kept by hash, and reused", async () => {
  const { BibleMedia, log, responses } = await load();
  const adapter = memoryAdapter();
  const plugin = { packages: { libraryDir: () => ".logoxide" }, app: { vault: { adapter } } };
  const media = new BibleMedia(plugin);
  // "hello", as `lx media add` lists it
  const file = { path: "JHN.mp3", url: "https://example.org/JHN.mp3", mirrors: [], size: 5n, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", book: "JHN", timings: null };
  const recording = { file, bible: "AUD", timings: [] };
  const stored = ".logoxide/media/2c/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  responses[file.url] = "hello";

  // Declined: nothing is downloaded
  log.answer = "Cancel";
  assert.equal(await media.source(recording, "John (AUD)"), null);
  assert.deepEqual(log.asked, ["Cancel/Download"]);
  assert.equal(log.requests.length, 0);

  // Accepted: downloaded, checked, and kept by its hash
  log.answer = "Download";
  assert.equal(await media.source(recording, "John (AUD)"), `app://local/${stored}`);
  assert.equal(log.requests.length, 1);
  assert.equal(new TextDecoder().decode(adapter.files.get(stored)), "hello");
  assert.ok(await media.has(file));

  // Played again: neither asked nor downloaded
  assert.equal(await media.source(recording, "John (AUD)"), `app://local/${stored}`);
  assert.equal(log.requests.length, 1);
  assert.equal(log.asked.length, 2);
  assert.deepEqual(await media.downloaded(), { count: 1, bytes: 5 });

  // Removed: downloaded again when next played; two plays at once download it once
  await media.clear();
  assert.deepEqual(await media.downloaded(), { count: 0, bytes: 0 });
  const both = await Promise.all([media.source(recording, "John (AUD)", false), media.source(recording, "John (AUD)", false)]);
  assert.deepEqual(both, [`app://local/${stored}`, `app://local/${stored}`]);
  assert.equal(log.requests.length, 2);

  // Bytes that aren't the listed file are refused and not kept
  const other = { ...file, url: "https://example.org/other.mp3", sha256: "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969" };
  responses[other.url] = "hellO";
  assert.equal(await media.source({ ...recording, file: other }, "John (AUD)", false), null);
  assert.match(log.notices.at(-1), /couldn't download the recording of John \(AUD\)/);
  assert.equal(await media.has(other), false);

  // A failed download (404) says so too
  const missing = { ...file, url: "https://example.org/missing.mp3", sha256: "0".repeat(64) };
  assert.equal(await media.source({ ...recording, file: missing }, "John (AUD)", false), null);
  assert.match(log.notices.at(-1), /404/);
});
