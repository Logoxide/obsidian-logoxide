import { MarkdownView, Menu, setIcon, type TFile, type WorkspaceLeaf } from "obsidian";
import type { BookInfo } from "logoxide";
import type { Bible } from "../core/bibles.ts";
import type ToposPlugin from "../main.ts";
import { BibleView } from "./view.ts";

const SWITCHER = "topos-switcher";

/**
 * A button in the header of a Bible tab and of a book's notes (before Obsidian's *Current view*):
 * it says what the tab shows (*Notes*, or the Bible's name) and switches it, in the same tab, to
 * the book's notes or the book in another Bible, at the same chapter
 */
export function registerSwitcher(plugin: ToposPlugin): void {
  const { workspace, metadataCache } = plugin.app;
  let queued = 0;
  const refresh = () => {
    window.cancelAnimationFrame(queued);
    queued = window.requestAnimationFrame(() => workspace.iterateAllLeaves((leaf) => place(plugin, leaf)));
  };
  plugin.registerEvent(workspace.on("layout-change", refresh));
  plugin.registerEvent(workspace.on("active-leaf-change", refresh));
  plugin.registerEvent(workspace.on("file-open", refresh));
  plugin.registerEvent(metadataCache.on("changed", refresh));
  plugin.register(() => {
    window.cancelAnimationFrame(queued);
    for (const el of Array.from(document.querySelectorAll(`.${SWITCHER}`))) el.remove();
  });
  refresh();
}

/** What a tab shows, for the switcher: a book in a Bible, or a book's notes */
type Shown = { kind: "bible"; book: BookInfo; bible: Bible; view: BibleView } | { kind: "notes"; book: BookInfo; translation: string | null; file: TFile; view: MarkdownView };

function shownIn(plugin: ToposPlugin, leaf: WorkspaceLeaf): Shown | null {
  const view = leaf.view;
  if (view instanceof BibleView && view.file) {
    const of = plugin.notes.bookOf(view.file.path);
    return of ? { kind: "bible", ...of, view } : null;
  }
  if (view instanceof MarkdownView && view.file) {
    const of = plugin.notes.notesOf(view.file);
    return of ? { kind: "notes", ...of, file: view.file, view } : null;
  }
  return null;
}

/** Puts the switcher in a tab's header (or takes it away), saying what the tab shows */
function place(plugin: ToposPlugin, leaf: WorkspaceLeaf): void {
  const actions = leaf.view.containerEl.querySelector<HTMLElement>(".view-header .view-actions");
  let button = actions?.querySelector<HTMLElement>(`:scope > .${SWITCHER}`) ?? null;
  const shown = actions ? shownIn(plugin, leaf) : null;
  if (!shown) {
    button?.remove();
    return;
  }
  if (!button) {
    button = createDiv({ cls: `clickable-icon ${SWITCHER}` });
    button.addEventListener("click", (e) => {
      const now = shownIn(plugin, leaf);
      if (now) openMenu(plugin, leaf, now, e);
    });
    actions!.prepend(button);
  }
  const label = shown.kind === "notes" ? "Notes" : shown.bible.name;
  if (button.dataset.label === label) return;
  button.dataset.label = label;
  button.empty();
  setIcon(button.createSpan({ cls: `${SWITCHER}-icon` }), shown.kind === "notes" ? "notebook-pen" : "book-open");
  button.createSpan({ cls: `${SWITCHER}-label`, text: label });
  setIcon(button.createSpan({ cls: `${SWITCHER}-chevron` }), "chevron-down");
  button.setAttribute("aria-label", `${shown.book.name}: ${shown.kind === "notes" ? "your notes" : `the ${shown.bible.name}`}. Switch to your notes or another Bible`);
}

/** The chapter the tab is at: the verse in view in a Bible, the heading above the cursor (or at the top) in notes */
function chapterOf(plugin: ToposPlugin, shown: Shown): { chapter: number; verse: number | null } | null {
  if (shown.kind === "bible") {
    const verse = shown.view.reader?.verseInView();
    return verse ? { chapter: verse.chapter, verse: verse.verse } : null;
  }
  const editor = shown.view.editor;
  const headings = plugin.app.metadataCache.getFileCache(shown.file)?.headings ?? [];
  const line = shown.view.getMode() === "source" ? editor.getCursor().line : (shown.view.currentMode.getScroll?.() ?? 0);
  let chapter: number | null = null;
  for (const h of headings) {
    if (h.position.start.line > line) break;
    chapter = plugin.notes.headingChapter(h.heading, shown.book) ?? chapter;
  }
  return chapter ? { chapter, verse: null } : null;
}

function openMenu(plugin: ToposPlugin, leaf: WorkspaceLeaf, shown: Shown, e: MouseEvent): void {
  const menu = new Menu();
  const at = chapterOf(plugin, shown);
  const here = shown.kind === "bible" ? shown.bible : null;
  menu.addItem((item) =>
    item
      .setTitle("Your notes")
      .setIcon("notebook-pen")
      .setSection("open")
      .setChecked(shown.kind === "notes")
      .onClick(async () => {
        if (shown.kind === "notes") return;
        const file = await plugin.notes.open(shown.book, here);
        const heading = at ? `${shown.book.name} ${at.chapter}` : null;
        const has = heading && plugin.app.metadataCache.getFileCache(file)?.headings?.some((h) => h.heading === heading);
        await leaf.openFile(file, { active: true, eState: has ? { subpath: `#${heading}` } : undefined });
      }),
  );
  const bibles = plugin.bibles.all().filter((b) => b.books.has(shown.book.id));
  // Bibles of one name (a folder's and a package's): their folders tell them apart
  const named = (bible: Bible) => (bibles.filter((b) => b.name === bible.name).length > 1 ? `${bible.name} · ${bible.folder}` : bible.name);
  for (const bible of bibles) {
    menu.addItem((item) =>
      item
        .setTitle(named(bible))
        .setIcon("book-open")
        .setSection("view")
        .setChecked(shown.kind === "bible" && shown.bible.folder === bible.folder)
        .onClick(async () => {
          if (shown.kind === "bible" && shown.bible.folder === bible.folder) return;
          const file = await plugin.bibles.bookFile(shown.book.id, bible);
          if (!file) return;
          const subpath = at ? (at.verse ? `#v=${at.chapter}:${at.verse}` : `#v=${at.chapter}`) : undefined;
          await leaf.openFile(file, { active: true, eState: subpath ? { subpath } : undefined });
        }),
    );
  }
  menu.showAtMouseEvent(e);
}
