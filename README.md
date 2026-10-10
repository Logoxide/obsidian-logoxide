# Logoxide for Obsidian

Find, search, filter, and autocomplete Bible references in your vault, and open them in
[Literal Word](https://app.literalword.com), BibleHub, lets.bible, BibleGateway, YouVersion, or any site with
a link template. Built on [topos-bible](https://github.com/MasterTemple/topos-bible) (Rust compiled
to WebAssembly, embedded in the plugin, so it works offline and on mobile). The design is in
[doc/plan.md](doc/plan.md).

## Features

**Verse search**, the CLI as a GUI, in the sidebar (the ribbon's book icon, or *Open verse
search*) or in a tab (see below). Both are the same search: in the sidebar, and on phones, the
filters, saved searches, and display options fold away (the sliders button in the query bar shows
the display options), and the window button moves the search into a tab.

- Search the whole vault, the current note, or some folders and files (*Paths*, below)
- Open **Filters** to filter by testament (click OT/NT to include, again to exclude), genre,
  and book, each included or excluded, like `-t`, `-g`, `-b`, and `--exclude-*`. A testament
  narrows the rest (NT + Pauline Epistles is Paul's letters), included genres and books add up
  (Pentateuch + Revelation), and exclusions always win. The header shows how many filters are on
  and how many books they leave, and warns when they contradict each other: OT + Pauline
  Epistles, Books: Genesis with Inside: Romans 8, or Inside: John 3:16 with Not: John 3
- Filter by passage, each with as many passages as you like:
  - **Inside**: entirely within the passage (`-i`)
  - **Names**: names one of its verses; a whole chapter like `John 3` doesn't count for
    `John 3:16` (`-o`)
  - **Overlaps**: shares any verse, whole chapters included (`--any-overlap`)
  - **Exactly**: the same verses, however written (`--exact-overlap`)
  - **Not**: shares no verse (`--exclude-overlap`)
- Every filter input lists its options as soon as you click it (every book, then every chapter,
  then every verse, up to 176), narrowing as you type. In passage inputs, Enter adds a finished
  reference (`Add "John 3:16"` is the first choice) and Tab completes. Remove a chip with × or a
  middle-click
- Sort by order in your notes or order in the Bible; group by note or by book; show lines of
  context around each result (±1 to ±10 lines, read from the notes). All remembered
- **Saved searches**: name the current filters (and folder) with *Save*, pick one from the list,
  or open one with the *Open a saved search* command. Each is stored as the CLI's options, like
  `Sermons --nt -g "Pauline Epistles" -o "John 1"`, which you can also write or edit under
  *Settings → Saved searches*; the filter panel shows the current filters in that form. The same
  text works as a CLI named query (`~/.config/topos/queries.toml`, `topos -q NAME`). Saved searches
  from before 0.4.0, when `-o` meant any overlap, are rewritten once to keep their meaning
- Results update as notes change

**Verse search in a tab** (*Open verse search in a tab*, *… in a new tab*, or the window button in
the sidebar, which takes the sidebar's search along) has room to read results:

- Every filter beside the results (above them, folded, on phones and narrow tabs), and a query bar
  that shows the filters as the CLI's options and takes them typed: `--nt -b John -o "John 3"
  Sermons/2025`, then Enter
- **Paths** searches some folders and files (any type the settings search: suggestions come from
  the vault's folders and the files with references), and files that patterns pick: globs with
  ripgrep's rules (`*.srt`, `Sermons/**`, a name like `drafts` at any depth), or `/regular
  expressions/` matched anywhere in the path (`/…/i`, or *Aa*, ignores case). `!` before a pattern
  leaves its files out (`!drafts`), and clicking a pattern switches it. A pattern that can't be
  read is marked, and the search goes on without it. Saved searches keep them as the CLI's
  `--glob`, `--iglob`, and `--path-regex`, after the paths, so they work in the CLI too
- A chip for each file type the settings search (EPUBs too, when they're searched), with how many
  references each has: click to toggle a type, Ctrl/Cmd-click for only that type, *All* for every
  type
- Each result shows its lines as they look in the note (Markdown rendered, references marked,
  the result highlighted among them), or their source with line numbers; *Verses* (or the book
  icon on a result) shows the passage's text from your Bibles
- *Merge nearby* (on by default) shows references next to each other as one result, counting how
  many it has: on the same line with no context, or whose context lines meet (±2: lines 3 and 7
  join). The context is counted from the first and last of them, so the result shows lines 1–9;
  click one of its references to go to that one. Which references a merged result has is hidden
  until you click its count (or turn on *References* for every result)
- On a result: open it beside the search (Ctrl/Cmd-click: in a new tab), open the passage in the
  Bible, copy the reference, find references that share a verse with it, or open its link
- The counts and *Collapse all* / *Expand all* stay above the results as they scroll. *Collapse all*
  keeps new groups collapsed too (from *Show more*, or as files change) until you open them; *Show
  more* keeps loading while all it adds goes into groups already collapsed
- Saved searches are listed by name, with their options; each tab remembers its search and look

**In the editor**

- Autocomplete while typing: chapters after a book (`John ` → `John 1`…), verses after a colon,
  range ends after a dash, and book names (`1 Co` → `1 Corinthians`). Book names only complete
  for capitalized words by default, so ordinary prose isn't interrupted. With a Bible in the
  vault, each verse suggestion shows the verse
- References glow faintly with a dashed underline in your accent color (or one you pick), and
  highlight on hover; Ctrl/Cmd-click or a middle click opens their links (a setting allows plain
  clicks, and another lets a tap open them on mobile when you aren't typing). With links turned off, they aren't marked
- Right-click a reference: open its link, find references to those verses, copy as OSIS
- In reading view, callouts, tables, and embedded notes, references are marked the same way, not
  as ordinary links: Ctrl/Cmd-click opens them on desktop, and a tap on mobile

**Commands**

| Command | |
|---|---|
| Open verse search | The sidebar |
| Open verse search in a tab | Verse search in a tab (the open one, if any) |
| Open verse search in a new tab | Another search tab |
| Search references in the current note | The sidebar, scoped to the note |
| Open a saved search | The sidebar with a saved search's filters |
| Go to a reference in the vault | Type a passage, pick a note that references it (each with its line) |
| Insert a verse reference | A dialog with autocomplete (verses show their text); books and chapters keep it open to refine |
| Find references to the verses under the cursor | The sidebar, filtered to overlapping references |
| Open the reference under the cursor in the browser | Its link (see [Links](#links)) |
| Copy the reference under the cursor as OSIS | `John.3.16-John.3.18` |
| Normalize references in the selection or note | `jn 3:16` → `John 3:16`, in the chosen style |

**Settings**: reference style (`John 3:16`, `Jn 3:16`, or `John.3.16`), where references open
(see [Links](#links)), the references' color, editor and reading-view links, whether editor clicks
need Ctrl/Cmd, whether a tap opens references in the editor on mobile (when the keyboard isn't open), autocomplete and book-name completion, number of suggestions, the reference format
(the CLI's `--psg-fmt` fields: separators, joining adjacent verses, the chapter in single-chapter
books, with a preview; used by completions, the sidebar, the dialogs, and normalizing), file
extensions to
search, whether to search EPUBs (below), excluded folders, and the search engine.

### Bible text

Install a Bible under *Settings → Add a Bible*: **Search** finds translations by name,
abbreviation, or language (eBible.org's and fetch.bible's, about 2,900, and any catalogs you add
under *Catalogs*: a `catalog.toml`'s URL, or a file in the vault) and installs the one you pick; **Git URL** adds a [logoxide](https://github.com/Logoxide/logoxide)
package from its repository. Packages are installed in a hidden folder, `.logoxide/` (*Library
folder*), which isn't synced: each device installs what `Logoxide/logoxide.lock` pins by itself (from
the web; local repositories need `lx`). The vault's `Logoxide/` folder (*Packages folder*) holds
`logoxide.toml` and `logoxide.lock`, saying exactly which text the vault uses, and what you open:
each Bible is named by its abbreviation (`BSB`, `KJV`), and the trash button removes it.
*Hide the packages folder* leaves `Logoxide/` out of the file explorer and Obsidian's search.

*Registries* name catalogs (a `catalog.toml`'s URL, which `lx registry init` prints): their
packages are searched first, and a registry's releases install as single archives, checked by
their hash.

Books are packages too (`kind = "book"`, an EPUB), and a collection brings in several (listed
under it in the settings). Each book's EPUB is copied into the packages folder
(`Logoxide/the-dorean-principle/epub/the-dorean-principle.epub`), where EPUB++ opens it, and verse
search reads it whether or not *Search EPUB files* is on, so its references show in the book and
in search results.

Each book of an installed Bible opens through a small stub in the packages folder, named by the
book's title (`Logoxide/bsb/John.bible`; a book's EPUB likewise, `Logoxide/the-dorean-principle/The
Dorean Principle.epub`). Stubs and copies named the older way are renamed, with links and
annotation files following. Links, highlights, and annotation files point at the stub, which
names the package and the book but not its version, so they keep working when the Bible is
updated, and annotation files sit beside it rather than among the package's files. A link to a
passage of a package's Bible remembers the version it was made with and its verse's words
(`#v=3:16&ver=1.0.2&vh=…`): after an update that renumbers that verse, the link opens where the
words are now and says so, and if the words changed it says that. *Toggle plain
text* on a stub shows the book's file, read-only. If a package's own files are edited, the plugin
says so; *Restore edited Bible packages* downloads them again (notes beside them stay).

Or put a Bible in the vault as a folder of USX or USFM files, one per book (`Bibles/BSB/JHN.usx`,
as Paratext, the Digital Bible Library, and eBible.org publish them; the
[BSB](https://github.com/gracious-tech/fetch_collection/tree/main/bibles/eng_bsb) is public domain),
named after the folder. Pick the one references use under *Settings → Bible*. Then:

| In a note | |
|---|---|
| `[some text](John 1:1)` | A link to the passage. The target is any reference topos reads: `Jn 1:1`, OSIS `John.1.1`, USFM `JHN 1:1`, or `<John 1:1>` |
| `[John 1:1]` | A link too, showing the reference |
| `![John 1:1]` (or `![text](John 1:1)`) | The passage's text, embedded in the note |
| `John 1:1` | Still found and marked, with its text on hover, but not a link |

Links open the book in its own tab at the passage (or, with *Open reference links in: the link
site*, the site from [Links](#links)); hovering any of them shows the passage, through Obsidian's
page preview (*Settings → Page preview → Logoxide: Bible references in notes*). In live preview
the brackets and target are hidden unless the cursor is in them, like Obsidian's own links.

References are also found in other documents built on file-plus-plus: in EPUBs (with *Search
EPUB files*, through EPUB++) and transcripts (Transcript++), they are marked the same way and
preview the passage on hover (*Mark references in other documents*).

#### Several translations

With more than one Bible, a reference can name the one it means, right after it: `John 3:16 KJV`,
`John 3:16, KJV`, `[John 3:16 (KJV)]`, `![John 3:16 KJV]`, or `[text](Jn 3:16 KJV)`. Its link opens
that Bible, its hover and embed show that Bible's text, and completion offers the names
(`John 3:16 K` → `KJV`). References that name none use the Bible in *Settings → Bible*.

- Each folder's name is a translation; *Translations* adds other names and aliases, one per line
  (`KJV: AV, King James`). A name the vault has no Bible for (`ESV`) still counts: its links open
  the site with `{translation}` in the link template (see [Links](#links)), and its text comes from
  your Bible
- A reference is checked against its Bible's own verse counts (read from each book's verse
  markers in the background and kept in the plugin's folder), so a verse one translation numbers
  and another doesn't is a reference only in the one that has it
- *Compare in embeds* (`KJV, NET`) shows those Bibles' text after the named one in every embed
- In a Bible tab, the commands *Open this book in another Bible* and *Open this book in another
  Bible beside it, on the same verse* open the same verse in another translation; beside it, the
  two tabs keep the verse at the top of either one at the top of the other as you scroll

#### Recordings

A package can list recordings of its books (its `[media]`: each audio or video file's URL, size,
and SHA-256, and WebVTT timings giving each verse's place in it). A book with one shows
**Listen** (headphones) in its tab's toolbar, which plays from the verse at the top of the page:

- The first time a recording is played, the plugin says how big it is and asks before
  downloading it. It's checked against the size and hash the package lists and kept on this
  device only, in the library folder (`.logoxide/media/`, not synced), so it's downloaded once
  however many versions of the package list it. *Downloaded recordings* in the settings says how
  much is kept and removes it
- The verse being read is highlighted and kept in view (*Follow along*, also the target button in
  the player; scrolling by hand pauses it for a few seconds). The line above the player names the
  verse; tapping it goes back there
- To play from a verse: tap its verse number while the player is open (Ctrl/Cmd-click any time),
  or right-click it for **Play from 3:16**; a selection also gives **Play 3:16-18**, which stops at
  its end. Following a link or the contents while it plays moves the playback there
- `![John 3:16-18 AUD]` embeds a play button when the Bible has a recording of the passage: it
  plays the passage in the note. In the editor, *Play John 3:16 (AUD)* in the menu of a reference
  (and the command *Play the reference under the cursor*) opens the book and plays the passage

A USX file opens in a reading tab built on file-plus-plus (the engine of EPUB++): the book
as one page with a chapter list, search, verse numbers, headings (footnotes optional), and
highlights. Links into a book are `[[JHN.usx#v=3:16-18]]` (verses, `v=3` for a chapter, `;` between
parts), which work in any translation's file; selecting part of a verse keeps the exact words
(`v=3:16:~:text=so%20loved`), so only they are highlighted. Comments on highlights work as in EPUB++; they show as highlights in the tab, and
`![[JHN.usx#v=3:16-18]]` embeds the verses. The tab's reading and highlight settings follow the
plugin's own, under *Reading*, *Highlights*, and *Links* in the settings.

Bible text keeps every USX marker as a `data-style` (`<span class="topos-l" data-style="q2">`,
`<span class="topos-char" data-style="pn">`, `<p class="topos-p" data-style="pi1">`), and the
plugin styles the common ones (poetry levels, indented, centered, and list paragraphs, footnotes'
quotations; a footnote's `3:16` is hidden, being right beside its verse). To style them yourself,
name a CSS file in the vault under **Bible stylesheet**: it applies to Bible tabs, previews, and
embeds (which Obsidian's CSS snippets don't reach), wins over the plugin's own rules, and applies
as soon as you save it:

```css
[data-style="q2"] { padding-left: 4em; }
[data-style="pn"] { text-decoration: underline dotted; }
.topos-note [data-style="fr"] { display: inline; font-weight: bold; }
```

### EPUBs

With **Search EPUB files** on (off by default), EPUBs in the vault are searched too. topos reads
each book itself (paragraphs kept apart, so a reference never runs from one into the next) and
finds each reference's CFI, exactly as the [EPUB++](https://github.com/MasterTemple/epub-plus-plus)
plugin, which opens EPUBs in Obsidian, writes them. With EPUB++ enabled:

- The sidebar lists EPUB results with their chapter, and clicking one opens the book there.
- In the book, references get the same dashed underline and glow as in notes (in the reference
  color). Hovering shows the reference; Ctrl/Cmd-click (or middle-click) opens its link.
- EPUB++'s **Bible references** sidebar tab lists the book's references by chapter, each in its
  sentence, with a filter; hover one to preview its verses, right-click it for its menu.
- Right-click a reference (tap or hold it on mobile) to open it, find references to the same
  verses, copy it as OSIS, or **Save as highlight** / **Save with comment**, which turn it into an
  EPUB++ highlight in the book's annotation file.

Books are searched once, on any device (see below), in a background thread (with the CLI engine,
by the `topos` command, several at a time); the few that topos can't read (a damaged ZIP) go
through EPUB++. A phone or tablet doesn't search books at all unless **Search new EPUBs on this
device** is on: it uses what a computer indexed.

### The reference index

Every file's references are kept in an index in the plugin's folder (`index/`), which syncs with
the rest of your settings. So each file is searched once, on whichever device sees it first, and
Obsidian starts without searching anything that hasn't changed. Another device (like your phone)
uses those results too: files synced to it have new modification times, so a note is matched by
its contents and a book by its size. Each device writes its own files (`index/packs/<device>-*.bin`),
so syncing never conflicts; EPUBs' CFIs and the text around each reference are kept per book
(`index/details/`) and read only when shown.

The index is compact (about 15 bytes a reference; a million references take 16 MB), and the
sidebar's filtering, sorting, and counting run in the engine, a page at a time. **Rebuild** in the
settings searches every file again.

### Large vaults

New and changed files are searched in a background thread (a Web Worker), so Obsidian stays
responsive; results appear in the sidebar as batches finish. On desktop, **Search engine → topos
CLI** runs the native [`topos`](https://github.com/MasterTemple/topos-bible/tree/main/crates/topos-cli) command on them instead, which is much faster
for many files and EPUBs and can cache results between runs (`--cache`):

```sh
cargo install topos-bible-cli
```

The plugin looks for `~/.cargo/bin/topos`, then `topos` on your PATH; set the path in the settings
otherwise (the **Test** button checks it). It runs `topos -m index` on the files that need
searching, named one by one (so a `.gitignore` can't skip them). It needs a `topos` new enough to
have `-m index`; with an older one, or if it fails, the plugin says so and uses the built-in
engine. Notes you edit are always searched by the built-in engine.

## Links

References open in Literal Word by default. The settings offer BibleHub, lets.bible,
BibleGateway, and YouVersion, no links at all, or a link template of your own, with a preview as you type:

| Site | Template |
|---|---|
| Literal Word | `https://app.literalword.com/{book.id}/{chapter}[/{verse}]` |
| BibleHub | `https://biblehub.com/{book.biblehub}/{chapter}[-{verse}].htm` |
| lets.bible | `https://lets.bible/bible/{book\|lower\|kebab}/{chapter}[?v={verse}]` |
| BibleGateway | `https://www.biblegateway.com/passage/?search={reference}` |
| YouVersion | `https://www.bible.com/bible/59/{book.usfm}.{chapter}[.{verse}][-{end_verse}]` |

Edit one to choose a translation: `https://app.literalword.com/esv/...`, `...?search={reference}&version=NIV`,
or YouVersion's number for it (59 is the ESV, 111 the NIV, 1 the KJV).

Placeholders, for 1 Corinthians 13:4-7 (values are URL-encoded):

| Placeholder | Value |
|---|---|
| `{book}`, `{book.name}` | `1 Corinthians` |
| `{book.abbreviation}` | `1 Cor` |
| `{book.osis}` | `1Cor` |
| `{book.id}` | `46` (1-66) |
| `{book.usfm}` | `1CO` (YouVersion's codes) |
| `{book.biblehub}` | `1_corinthians` (BibleHub's names: `psalms`, `songs`) |
| `{chapter}`, `{verse}` | `13`, `4`: where the reference starts (no verse for a whole chapter) |
| `{end_verse}` | `7`: the end of the first range, when it is in one chapter |
| `{end_chapter}` | The last chapter of the first part, when it spans chapters (`Gen 1-2` → `2`) |
| `{reference}` | `1 Corinthians 13:4-7`, the whole reference |
| `{osis}` | `1Cor.13.4-1Cor.13.7`, the whole reference |
| `{translation}` | The translation the reference names (`1 Cor 13:4-7 ESV` → `ESV`), none otherwise: `[&version={translation}]` |

Filters change a value before it goes in: `{book|lower|kebab}` is `1-corinthians`. They are
`lower`, `upper`, `snake` (spaces to `_`), `kebab` (spaces to `-`), and `compact` (no spaces).

A part in `[ ]` is left out when a placeholder in it has no value, so `{chapter}[/{verse}]` is
`3/16` for John 3:16 and `3` for John 3. A placeholder with no value outside `[ ]` means no link
(`{book.usfm}` for a book outside the 66, from custom data). Most sites open one verse or
chapter, so a reference like `John 3:16; 4:1` opens at its first verse; `{reference}` and
`{osis}` carry all of it. Changing the site updates open notes, reading view, and the sidebar
right away.

## Build and install

It also needs file-plus-plus (the engine of EPUB++ and Transcript++) checked out at
`../obsidian-plus-plus/file-plus-plus` (run `bun install` there once).

The plugin uses the `logoxide` package (logoxide's bindings, with all of
[topos](https://github.com/MasterTemple/topos-bible)'s) built from a logoxide checkout at
`../../rust/logoxide`, which builds against topos at `../../rust/topos` (`~/Development/rust/...` when
this repository is `~/Development/typescript/obsidian-logoxide`):

```sh
# Once: cargo install boltffi_cli --version 0.31.0, rustup target add wasm32-unknown-unknown
(cd ../../rust/logoxide/crates/logoxide-ffi && npm install && npm run pack:wasm)

npm install
scripts/install.sh ~/path/to/vault   # builds, then copies main.js, manifest.json, styles.css
```

Then enable **Logoxide** under *Settings → Community plugins*. Once `logoxide` is released on
npm, the dependency can point at it instead (`package.json`).

## Development

- `npm run dev` rebuilds `dist/` (`main.js`, `styles.css` with file-plus-plus's styles first,
  `manifest.json`) on every change
- `npm test` runs the tests with Node: the core logic, the bundled WebAssembly loading, the
  bundled worker (in a Node worker thread), verse search in a DOM (happy-dom: inputs, chips,
  context lines), the built plugin against a stand-in for Obsidian's
  API (loading, indexing with both engines, commands, and autocomplete), and the sidebar rendered
  to HTML. The shared completion cases come from topos's
  `crates/topos-lib/tests/cases/complete.txt`, and the CLI tests use its `target/debug/topos`
  (`cargo build -p topos-bible-cli`; skipped without it). The checkout is `$TOPOS_DIR` if set, else
  `../../rust/topos`; `$TOPOS_CLI` overrides the CLI
- `npm run typecheck`

`src/indexers/` has the Web Worker (`worker.ts`, bundled separately and embedded in `main.js` by
`esbuild.config.mjs`), the CLI runner, and `vault.ts`, which keeps the index on disk and up to
date. `src/core/` has no Obsidian imports (filters, the index's wrapper, sorting, completions, link
templates, settings data), so it is tested directly; the rest connects it to Obsidian.
