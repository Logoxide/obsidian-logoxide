import { Modal, Notice, Setting, SuggestModal, type App } from "obsidian";
import type { CatalogEntry } from "biblix";
import type ToposPlugin from "../main.ts";
import { message } from "./packages.ts";

/** A license in words: public domain, else the copyright statement or SPDX expression */
function license(entry: CatalogEntry): string {
  if (entry.license === "LicenseRef-PublicDomain") return "public domain";
  const copyright = entry.copyright?.trim();
  if (copyright) return copyright.length > 60 ? `${copyright.slice(0, 59)}…` : copyright;
  return entry.license ?? "no license given";
}

/** Installs a catalog entry or a repository, saying how it went */
async function installing(what: string, run: () => Promise<string>, done: () => void): Promise<void> {
  const notice = new Notice(`Installing ${what}…`, 0);
  try {
    const name = await run();
    notice.hide();
    new Notice(`Installed ${name}`);
  } catch (error) {
    notice.hide();
    new Notice(`Couldn't install ${what}: ${message(error)}`, 10000);
  }
  done();
}

/** Searches the vault's catalogs (else eBible.org's list) and installs the Bible chosen */
export class AddBibleModal extends SuggestModal<CatalogEntry> {
  constructor(
    app: App,
    private readonly plugin: ToposPlugin,
    /** Called once it's installed (or failed) */
    private readonly done: () => void,
  ) {
    super(app);
    this.setPlaceholder("Search Bibles by name, abbreviation, or language: world english, KJV, español…");
    this.emptyStateText = "No Bible found in the catalogs";
  }

  async getSuggestions(query: string): Promise<CatalogEntry[]> {
    try {
      return await this.plugin.bibleManager.search(query, 100);
    } catch (error) {
      this.emptyStateText = `The catalogs couldn't be read: ${message(error)}`;
      return [];
    }
  }

  renderSuggestion(entry: CatalogEntry, el: HTMLElement): void {
    const installed = this.plugin.packages.installed.some((p) => p.id === entry.id);
    el.createDiv({ text: `${entry.name} (${entry.abbreviation})${installed ? " — installed" : ""}` });
    const language = entry.languageName ?? entry.language;
    const from = entry.source.tag === "Ebible" ? "eBible.org" : entry.source.tag === "FetchBible" ? "fetch.bible" : entry.source.url;
    el.createEl("small", { text: [language, license(entry), from].join(" · "), cls: "topos-muted" });
  }

  onChooseSuggestion(entry: CatalogEntry): void {
    void installing(entry.name, () => this.plugin.bibleManager.addEntry(entry), this.done);
  }
}

/** Adds a biblix package from its git repository's URL (its newest release) */
export class GitUrlModal extends Modal {
  private url = "";

  constructor(
    app: App,
    private readonly plugin: ToposPlugin,
    private readonly done: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("Add a Bible from its repository");
    new Setting(this.contentEl)
      .setName("Git URL")
      .setDesc("A biblix package's repository (https://github.com/…): its newest release is installed.")
      .addText((t) => t.setPlaceholder("https://").onChange((value) => (this.url = value.trim())));
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Add")
        .setCta()
        .onClick(() => {
          if (!this.url) return;
          this.close();
          void installing(this.url, () => this.plugin.bibleManager.addGit(this.url), this.done);
        }),
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
