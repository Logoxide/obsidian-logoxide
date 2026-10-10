import { Logoxide, LogoxideBook } from "logoxide";
import type { TranslationCounts } from "../core/translations.ts";
import type ToposPlugin from "../main.ts";

/** A book file's verse counts, and the file's size and time they were read at */
interface Saved {
  mtime: number;
  size: number;
  bookId: number;
  counts: number[];
}

/**
 * Each Bible book's verse counts, from its USX markers (`LogoxideBook.usxChapterVerses`, without
 * parsing the book), so a reference naming a translation is checked against that translation (with
 * an ESV, `3 John 1:15 ESV` exists, though the default counts, the KJV's, end at verse 14). They're
 * read in the background and kept in the plugin's folder, so only changed books are read again.
 */
export class VerseCounts {
  private saved: Record<string, Saved> = {};
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly plugin: ToposPlugin,
    /** Called when counts were read */
    private readonly changed: () => void,
  ) {}

  private get file(): string | null {
    const dir = this.plugin.manifest?.dir;
    return dir ? `${dir}/verse-counts.json` : null;
  }

  /** The counts of every book in the vault's Bibles that has them */
  all(): TranslationCounts[] {
    const counts: TranslationCounts[] = [];
    for (const bible of this.plugin.bibles.all()) {
      // A package's counts come from logoxide
      if (bible.package) continue;
      for (const [bookId, path] of bible.books) {
        const saved = this.saved[path];
        if (saved && saved.bookId === bookId) counts.push({ translation: bible.name, bookId, counts: saved.counts });
      }
    }
    return counts;
  }

  /** A book file's verse counts, one per chapter in order, once read */
  of(path: string, bookId: number): number[] | null {
    const saved = this.saved[path];
    return saved && saved.bookId === bookId ? saved.counts : null;
  }

  /** Reads the saved counts, then any books that are new or changed */
  async start(): Promise<void> {
    const file = this.file;
    const adapter = this.plugin.app.vault.adapter;
    try {
      if (file && (await adapter.exists(file))) this.saved = JSON.parse(await adapter.read(file)) as Record<string, Saved>;
    } catch {
      this.saved = {};
    }
    if (Object.keys(this.saved).length > 0) this.changed();
    await this.update();
  }

  /** Reads the books whose counts are missing or out of date (once at a time) */
  async update(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.read().finally(() => (this.running = null));
    await this.running;
    if (this.again) {
      this.again = false;
      await this.update();
    }
  }

  private async read(): Promise<void> {
    const { vault } = this.plugin.app;
    let read = false;
    const paths = new Set<string>();
    for (const bible of this.plugin.bibles.all()) {
      if (bible.package) continue;
      for (const [bookId, path] of bible.books) {
        paths.add(path);
        const file = vault.getFileByPath(path);
        if (!file) continue;
        const saved = this.saved[path];
        if (saved && saved.bookId === bookId && saved.mtime === file.stat.mtime && saved.size === file.stat.size) continue;
        let text = await vault.cachedRead(file);
        if (file.extension === "usfm") {
          try {
            text = Logoxide.new().usfmToUsx(text);
          } catch {
            continue;
          }
        }
        const counts = Array.from(LogoxideBook.usxChapterVerses(text));
        this.saved[path] = { mtime: file.stat.mtime, size: file.stat.size, bookId, counts };
        read = true;
        // A Bible is 66 files: let the app breathe between them
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const removed = Object.keys(this.saved).filter((path) => !paths.has(path));
    for (const path of removed) delete this.saved[path];
    if (!read && removed.length === 0) return;
    const file = this.file;
    if (file) await vault.adapter.write(file, JSON.stringify(this.saved));
    this.changed();
  }
}
