# Formatting USX: which tags matter

Notes for whoever next works on how Bible text looks (October 2026). Bible text is USX (USFM is
converted to USX by biblix first), rendered to HTML by topos-bible-markup and styled by this
plugin.

## Where each part lives

- **What an element is** (its `Kind`): topos, `crates/topos-markup/src/classify.rs` (`fn usx`).
- **What HTML it becomes**: topos, `crates/topos-markup/src/html.rs`, specified in
  `crates/topos-markup/docs/spec/html.md` (change the spec first; `GOLDEN_BLESS=1 cargo test -p
  topos-bible-markup --test golden` rewrites the golden files, then check the diff).
- **How it looks**: here, `src/bible/reader.ts`: the reader's CSS and `USX_CSS`, in
  file-plus-plus's `document` layer. The vault's **Bible stylesheet** (`bibleCss`,
  `src/bible/styles.ts`) is outside any layer, so a user's rules always win.
- **Which kinds are shown**: `bookTextOptions()` in `src/main.ts`. Headings (`Title`) and notes
  (`Note`) are dropped unless the settings turn them on; metadata always is.

Every USX `para`, `char`, `note`, `cell`, and `sidebar` keeps its `style` as `data-style`. So CSS
can tell apart markers whose kind is shared (`q1` and `q2` are both `topos-l`), and a missing
style is usually a CSS-only fix here. A missing *attribute* (an alternate number, a gloss, a link
target) needs a change in topos.

## The tags real Bibles use

Counted in the BSB (USX) and the KJV (USFM) from biblix. Get these right first.

| Tag | BSB | KJV | Becomes | Notes |
|---|---|---|---|---|
| `verse` | 31,086 | 31,102 | empty `span.topos-verse[data-n]` | The number is `::before`. A number that starts a poetry line gets `tpb-line-start` (set in `indexMarkers`) and hangs left |
| `w` (`\w`) | | 627,626 | `span.topos-w` + `data-strong`, `data-lemma` | Unstyled. Strong's numbers are there for hover or interlinear features |
| `para q1`, `q2` (`qm`, `q3`, `q4`) | 24,112 | 2,461 | `span.topos-l` then `br.topos-l` | Lines are inline-block with a hanging indent: q1 at 1em, each level 2em more. `display: block` would make the `br`s blank lines |
| `para p` | 12,507 | 4,635 | `p.topos-p` | |
| `note f` + `char fr`, `ft`, `fqa`, `fq`, `fv` | 4,854 | 6,959 | `span.topos-note.topos-footnote` with `span.topos-char` | Shown inline in `[ ]`. `fr`/`xo` are hidden (the note is beside its verse). Pop-up footnotes would need a reader change, not just CSS |
| `char add` | | 41,774 | `span.topos-added` | Italic (KJV italics) |
| `char nd` | | 13,752 | `span.topos-divine-name` | Small caps |
| `char wj` | | 4,076 | `span.topos-woj` | Color from `--tpb-woj-color` (unset, so it inherits) |
| `para b` | 3,303 | 209 | `br.topos-lb[data-style=b]` | A stanza break: one `br` after a line's own `br` gives a blank line |
| `para s1`, `s2`, `ms`, `mt1`, `mt2`, `d`, `qa` | 3,327 | 220 | `div.topos-title.topos-<style>` | `d` (Psalm titles) often holds verse 1, so hiding headings can hide a verse's start |
| `para li1`, `li2` | 1,537 | | `p.topos-p` | Hanging list indent |
| `chapter` | 1,189 | 1,189 | empty `span.topos-chapter` | The reader adds its own `.tpb-chapter` heading per section |
| `para qr` | 223 | | `span.topos-l` | Right-aligned (Selah) |
| `char tl` | | 44 | `span.topos-foreign` | Unstyled |
| `para pc` | 11 | | `p.topos-p` | Centered |
| `id`, `h`, `toc1`–`3`, `usfm` | 66 each | | dropped (`Metadata`) | `h` is the book's running header and could be its display name |

## Wrong or lost today

Found by rendering samples through the HTML renderer. Each item says where to fix it.

- **`optbreak`** becomes `<br class="topos-lb">`, a hard line break. It is an *optional* break:
  it should be `<wbr>` or nothing. Fix in topos (`classify.rs` makes it a `LineBreak`).
- **Alternate and published numbers**: `char va`/`vp` and `para ca`/`cp` render as plain text
  (`5` then `4` then `5a`), and the `altnumber`/`pubnumber` attributes of `verse` and `chapter`
  are lost. `vp`/`cp` should *replace* the number shown, and `va`/`ca` should be in parentheses
  or hidden. A CSS stopgap: `[data-style="va"], [data-style="ca"] { display: none }`. The real
  fix is in topos: put the attributes in `data-` attributes and let the reader's `::before` use
  them.
- **`cl`** (a chapter's label, "Psalm 1") is a `Title`: it shows only with headings on, and the
  reader's own chapter heading shows as well. The reader could use it as the section's heading.
- **Tables**: `table`, `row`, `cell` become `p` with `span.topos-cell[data-style=th1|tc1|tcr1…]`.
  There's no table layout, and `row` has no `data-style`. Rendering `table`/`tr`/`td` belongs in
  topos.
- **`figure`**: only its caption text is written, with no `data-style` and no image (`file` is
  lost). The caption runs into the text.
- **Quotation milestones** `ms qt-s`/`qt-e` (with `who="Jesus"`) are dropped, so words of Jesus
  marked this way aren't red. The `WordsOfJesus` milestone logic in `html.rs` would carry it if
  `classify.rs` mapped them.
- **Endnotes** (`note fe`) and **study notes** (`ef`) show inline like footnotes.
- **Lost attributes**: `rb`/`w` `gloss` (ruby text), `jmp` `link-href`, `periph` `id`/`alt`,
  `cell` `align`, `figure` `file`/`ref`.
- **Introductions** (`imt`, `is`, `ip`, `io1`, `iot`, `ili`…) have their `data-style` but no
  styles. Outlines (`io1`–`io3`) need indents like `li`.
- **Unstyled characters** worth defaults: `tl`, `pro`, `fw`, `xt` (a cross reference's
  targets), `w` (nothing, by design). Among highlights, `it`, `em`, and `bk` are `<i>` and `bd`
  is `<b>`, so the browser styles them. `sc` (`span.topos-hi.topos-small-caps`) and `bdit`
  (`span.topos-hi.topos-bold-italic`) are spans with no style yet.

## Checking a change

Open `test-vault/Bibles/BSB/PSA.usx` (poetry, `d`, `qr`, `qa` in Psalm 119), `JHN.usx` (`wj`,
footnotes with headings and notes on), and `test-vault/Bibles/KJV/JHN.usx` (`add`, `nd`, `w`) in headless Obsidian,
desktop and `mobile`. In the reader's shadow root, `[data-style="…"]` finds an example of any
marker.
