import { Notice, SuggestModal, setIcon, type App } from "obsidian";
import type { DocumentView } from "file-plus-plus/obsidian";
import { BOOK_EXTENSIONS, type Bible } from "../core/bibles.ts";
import type ToposPlugin from "../main.ts";
import type { BibleBook, BibleReader } from "./reader.ts";

type BibleView = DocumentView<BibleBook, BibleReader>;

/** Picks a Bible */
class BibleModal extends SuggestModal<Bible> {
  constructor(
    app: App,
    private readonly bibles: Bible[],
    private readonly chosen: (bible: Bible) => void,
  ) {
    super(app);
    this.setPlaceholder("Open in which Bible?");
  }

  getSuggestions(query: string): Bible[] {
    const q = query.toLowerCase();
    return this.bibles.filter((b) => b.name.toLowerCase().includes(q) || b.folder.toLowerCase().includes(q));
  }

  renderSuggestion(bible: Bible, el: HTMLElement): void {
    el.addClass("topos-suggestion");
    setIcon(el.createSpan({ cls: "topos-suggestion-icon" }), "book-open");
    const main = el.createDiv({ cls: "topos-suggestion-main" });
    main.createDiv({ cls: "topos-suggestion-label", text: bible.name });
    main.createDiv({ cls: "topos-suggestion-text", text: bible.folder });
    el.createSpan({ cls: "topos-suggestion-kind", text: `${bible.books.size + bible.unknown.length} books` });
  }

  onChooseSuggestion(bible: Bible): void {
    this.chosen(bible);
  }
}

/** The Bible tab in front, if it is one */
function activeBibleView(plugin: ToposPlugin): BibleView | null {
  const leaf = plugin.app.workspace.getMostRecentLeaf();
  return plugin.views().find((v) => v.leaf === leaf && BOOK_EXTENSIONS.includes(v.file?.extension ?? "")) ?? null;
}

/**
 * Keeps two Bible tabs on the same verse: when one scrolls, the verse at its top goes to the top of
 * the other (a verse locator, `v=3:16`, is the same in any translation). Stops when either tab
 * closes
 */
function link(plugin: ToposPlugin, a: BibleView, b: BibleView): void {
  // Moving one tab scrolls the other, which then reports where it is: that echo is ignored
  const quietUntil = new Map<BibleView, number>();
  const follow = (from: BibleView, to: BibleView) =>
    from.reader?.on("relocated", (loc) => {
      if (Date.now() < (quietUntil.get(from) ?? 0) || !loc.locator || !to.reader?.isRendered) return;
      const range = to.reader.resolve(loc.locator.split("&")[0]);
      if (!range) return;
      quietUntil.set(to, Date.now() + 800);
      to.reader.scrollToRange(range, { flash: false, position: "top" });
    });
  const offs = [follow(a, b), follow(b, a)];
  const stop = () => {
    for (const off of offs) off?.();
    plugin.app.workspace.offref(ref);
  };
  const ref = plugin.app.workspace.on("layout-change", () => {
    const open = plugin.views();
    if (!open.includes(a) || !open.includes(b)) stop();
  });
  plugin.registerEvent(ref);
}

/** Opens the Bible tab's book in another Bible, at the same verse (beside it, kept on the same verse) */
async function openIn(plugin: ToposPlugin, view: BibleView, bible: Bible, beside: boolean): Promise<void> {
  const bookId = view.reader?.bible.bookId;
  const file = bookId ? await plugin.bibles.bookFile(bookId, bible) : null;
  if (!file) {
    new Notice(`${bible.name} doesn't have this book.`);
    return;
  }
  const locator = (view.file ? plugin.settings.positions[view.file.path] : undefined)?.split("&")[0] ?? "";
  await plugin.openDocument(file, locator, beside ? "split" : false);
  if (!beside) return;
  const other = plugin.views().find((v) => v.file?.path === file.path && v !== view);
  if (other) link(plugin, view, other as BibleView);
}

/** "Open this book in another Bible", in its tab or beside it */
export function addParallelCommands(plugin: ToposPlugin): void {
  const command = (beside: boolean) => (checking: boolean) => {
    const view = activeBibleView(plugin);
    const current = view?.file ? plugin.bibles.ofFile(view.file.path) : null;
    const others = plugin.bibles.all().filter((b) => b.folder !== current?.folder);
    if (!view || others.length === 0) return false;
    if (!checking) {
      const open = (bible: Bible) => void openIn(plugin, view, bible, beside);
      if (others.length === 1) open(others[0]!);
      else new BibleModal(plugin.app, others, open).open();
    }
    return true;
  };
  plugin.addCommand({ id: "open-in-another-bible", name: "Open this book in another Bible", checkCallback: command(false) });
  plugin.addCommand({ id: "open-beside-in-another-bible", name: "Open this book in another Bible beside it, on the same verse", checkCallback: command(true) });
}
