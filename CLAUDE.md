# obsidian-topos-bible

The Topos Bible plugin for Obsidian: finds, searches, links, and autocompletes Bible references in the vault. User-facing overview: `README.md`; design: `doc/plan.md`. It was topos's `obsidian/` folder until October 2026 (history kept with `git subtree split`).

## Where things live

- **topos** (`~/Development/rust/topos`, GitHub `MasterTemple/topos-bible`) finds and parses references, and nothing else; it must stay usable without this plugin. Bible *text* belongs here (or in what this plugin depends on), never in topos-bible itself. Changes the plugin needs in the bindings or the library go into topos (tell the user; don't push or publish topos unless asked).
- The plugin depends on topos's WebAssembly package built from that checkout: `"topos-bible": "file:../../rust/topos/crates/topos-ffi/dist/wasm/pkg"`. Rebuild it after changing topos's bindings: `(cd ../../rust/topos/crates/topos-ffi && npm run pack:wasm)`.
- Tests read topos's shared completion cases (`crates/topos-lib/tests/cases/complete.txt`) and run its CLI (`target/debug/topos`, `cargo build -p topos-bible-cli`); `test/topos.ts` finds them (`$TOPOS_DIR`, `$TOPOS_CLI`).
- EPUB++ and file-plus-plus are in `~/Development/typescript/obsidian-plus-plus/` (each with its own CLAUDE.md); EPUB++'s headless Obsidian scripts are the way to test in a real Obsidian.

## Commands

- `npm install`, `npm run build` (typecheck + esbuild to `main.js`), `npm run dev`, `npm test` (`node --test`), `npm run typecheck`.
- `scripts/install.sh ~/Obsidian`: builds and copies `main.js`, `manifest.json`, `styles.css` into the user's vault (`.obsidian/plugins/topos-bible/`). Do this after each commit.
- Use `rg` and `fd`, not `grep` and `find`.

## Layout

- `src/core/`: no Obsidian imports (filters, the index wrapper, sorting, completions, link templates, settings data), tested directly with Node.
- `src/indexers/`: the Web Worker (`worker.ts`, bundled separately and embedded in `main.js` by `esbuild.config.mjs`), the CLI runner, `vault.ts` (the reference index on disk).
- `src/editor/`: CodeMirror decorations and autocomplete; `src/reading.ts`: reading view; `src/view/`: the React sidebar; `src/epub/`: EPUB++ integration.
- `test/plugin.test.ts` loads the built `main.js` against a stand-in for Obsidian's API.

## Conventions

- Reference logic (parsing, completion, search rules) lives in topos, not here. The plugin only adds presentation and Obsidian glue.
- Offsets are UTF-16 (`OffsetUnit.Utf16`) everywhere.
- Mobile matters as much as desktop. Never test in the user's running Obsidian.
- The user may have uncommitted edits here; don't commit over them without asking.
- Commit messages end with a `Co-Authored-By` line.
