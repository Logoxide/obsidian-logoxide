import { ItemView, sanitizeHTMLToDom, setIcon, type HoverPopover, type WorkspaceLeaf } from "obsidian";
import { OffsetUnit, PackageKind, type Passage } from "logoxide";
import { bookStyle } from "../core/settings.ts";
import { noteVerses, weightLabel } from "../core/study.ts";
import { strongsKeys } from "../core/strongs.ts";
import type ToposPlugin from "../main.ts";
import { markStrongs, renderEntries, strongsPopups } from "./strongs.ts";

export const COMMENTARY_VIEW = "logoxide-commentary";

/**
 * The vault's commentaries on a passage (its `kind = "commentary"` packages' notes, each labeled
 * with the commentary and its verses), its cross-references as links, and a Strong's entry when
 * one was looked up. In the sidebar; it follows the Bible tab's verse and the editor's reference
 * under the cursor while `commentaryFollows` is on (`ToposPlugin.followPassage`).
 */
export class CommentaryView extends ItemView {
  hoverPopover: HoverPopover | null = null;
  passage: Passage | null = null;
  /** A Strong's number (or headword) looked up, shown above the notes */
  entryKey: string | null = null;
  /** Each render's number: a slower one that finishes after a newer one started is dropped */
  private rendering = 0;
  private offPopups: ReturnType<typeof strongsPopups> | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ToposPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return COMMENTARY_VIEW;
  }

  getDisplayText(): string {
    return "Commentary";
  }

  getIcon(): string {
    return "message-square-quote";
  }

  override getState(): Record<string, unknown> {
    return { reference: this.passage?.osis ?? null, entry: this.entryKey };
  }

  override async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
    const { reference, entry } = (state ?? {}) as { reference?: string | null; entry?: string | null };
    if (reference) this.passage = this.plugin.topos?.parse(reference, bookStyle(this.plugin.settings.style)) ?? null;
    this.entryKey = entry ?? null;
    await super.setState(state, result);
    await this.render();
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.addClass("topos-commentary");
    this.offPopups = strongsPopups(this.contentEl, this.contentEl, {
      lookup: (key) => this.plugin.packages.entries(key, this.textOptions()),
      enabled: () => this.plugin.settings.strongsHover,
      click: true,
      container: this.contentEl.doc.body,
    });
    await this.render();
  }

  protected override async onClose(): Promise<void> {
    this.offPopups?.();
    this.offPopups = null;
  }

  /** Shows a passage's notes (when it isn't the one shown) */
  async show(passage: Passage): Promise<void> {
    if (this.passage?.osis === passage.osis) return;
    this.passage = passage;
    this.app.workspace.requestSaveLayout();
    await this.render();
  }

  /** Shows a key's dictionary entries above the notes */
  async showEntry(key: string): Promise<void> {
    this.entryKey = key;
    this.app.workspace.requestSaveLayout();
    await this.render();
  }

  private textOptions() {
    return { notes: false, headings: false, classPrefix: "topos-" };
  }

  /** Draws the view again: the entry looked up, then the passage's notes and cross-references */
  async render(): Promise<void> {
    const n = ++this.rendering;
    const el = createDiv();
    const packages = this.plugin.packages;
    const passage = this.passage;
    if (this.entryKey) {
      const key = this.entryKey;
      const entries = await packages.entries(key, this.textOptions());
      const section = el.createDiv({ cls: "topos-commentary-section topos-commentary-entry" });
      const head = section.createDiv({ cls: "topos-commentary-heading" });
      head.createSpan({ text: strongsKeys(key) ? `Strong's ${key}` : key });
      const close = head.createSpan({ cls: "clickable-icon topos-commentary-close", attr: { "aria-label": "Close" } });
      setIcon(close, "x");
      close.addEventListener("click", () => {
        this.entryKey = null;
        this.app.workspace.requestSaveLayout();
        void this.render();
      });
      const body = section.createDiv();
      renderEntries(body, key, entries);
      for (const text of Array.from(body.querySelectorAll<HTMLElement>(".topos-strongs-body"))) markStrongs(text);
    }
    if (!passage) {
      el.createDiv({ cls: "topos-commentary-empty", text: "Open a Bible, or put the cursor on a reference in a note, to read the commentaries on it." });
    } else {
      el.createEl("h4", { cls: "topos-commentary-passage", text: passage.reference });
      const options = this.textOptions();
      const commentaries = await packages.commentaryNotes(passage, options);
      const book = this.plugin.topos.books().find((b) => b.id === passage.bookId)?.name ?? "";
      for (const { commentary, title, notes } of commentaries) {
        const section = el.createDiv({ cls: "topos-commentary-section" });
        for (const note of notes) {
          const item = section.createDiv({ cls: "topos-commentary-note" });
          const label = item.createDiv({ cls: "topos-commentary-label", attr: { title } });
          label.createSpan({ cls: "topos-commentary-name", text: commentary });
          label.appendText(" · ");
          const where = `${book} ${noteVerses(note)}`;
          const at = label.createSpan({ cls: "topos-commentary-verses", text: where });
          const target = this.plugin.topos.parse(where.replace(/(\d)[a-z]\b/, "$1"), bookStyle("name"));
          if (target) this.linkTo(at, target);
          const body = item.createDiv({ cls: "topos-commentary-body" });
          body.append(sanitizeHTMLToDom(note.html));
          this.linkReferences(body, passage);
          markStrongs(body);
        }
      }
      const crossRefs = await packages.crossReferences(passage.osis);
      if (crossRefs.length > 0) {
        const section = el.createDiv({ cls: "topos-commentary-section topos-commentary-xrefs" });
        section.createDiv({ cls: "topos-commentary-heading", text: "Cross references" });
        for (const { name, title, references } of crossRefs) {
          const list = section.createEl("ul", { cls: "topos-commentary-xref-list", attr: { title } });
          for (const ref of references) {
            const target = this.plugin.topos.parse(ref.to, bookStyle(this.plugin.settings.style));
            const li = list.createEl("li");
            const link = li.createSpan({ cls: "topos-commentary-ref", text: target?.reference ?? ref.to });
            if (target) this.linkTo(link, target);
            const weight = weightLabel(ref.weight);
            li.createSpan({ cls: "topos-commentary-meta", text: weight ? ` ${name} · ${weight}` : ` ${name}` });
          }
        }
      }
      if (commentaries.length === 0 && crossRefs.length === 0) {
        const has = packages.hasKind(PackageKind.Commentary) || packages.hasKind(PackageKind.CrossReferences);
        el.createDiv({
          cls: "topos-commentary-empty",
          text: has ? "The vault's commentaries have nothing on this passage." : "The vault has no commentaries or cross-references yet: add one under Settings → Logoxide → Add.",
        });
      }
    }
    if (n !== this.rendering) return;
    this.offPopups?.hide();
    this.contentEl.replaceChildren(...Array.from(el.childNodes));
  }

  /** Makes an element open a passage on a click (Ctrl/Cmd or a middle click: a new tab) and preview it on hover */
  private linkTo(el: HTMLElement, passage: Passage): void {
    el.addClass("topos-commentary-link");
    el.setAttribute("role", "link");
    el.addEventListener("click", (e) => {
      e.preventDefault();
      void this.plugin.openPassage(passage, e.ctrlKey || e.metaKey ? "tab" : false);
    });
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) void this.plugin.openPassage(passage, "tab");
    });
    el.addEventListener("mouseover", (e) => void this.plugin.previewPassage(e, el, passage, this));
  }

  /** Links the references in a note's text (`compare Romans 5:8`), but not to the passage shown */
  private linkReferences(el: HTMLElement, shown: Passage): void {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const found = this.plugin.topos.search(node.data, OffsetUnit.Utf16).filter((m) => m.passage.osis !== shown.osis);
      if (found.length === 0) continue;
      const fragment = document.createDocumentFragment();
      let last = 0;
      for (const m of found) {
        if (m.start < last) continue;
        fragment.append(node.data.slice(last, m.start));
        const ref = createSpan({ text: node.data.slice(m.start, m.end) });
        this.linkTo(ref, m.passage);
        fragment.append(ref);
        last = m.end;
      }
      fragment.append(node.data.slice(last));
      node.replaceWith(fragment);
    }
  }
}
