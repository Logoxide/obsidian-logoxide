import { App, Notice, type DropdownComponent, Platform, Setting } from "obsidian";
import { BookStyle, PackageKind } from "biblix";
import { DEFAULT_FORMAT, written, type FormatSettings } from "./core/format.ts";
import { parseQuery } from "./core/query.ts";
import type { BookCompletion } from "./core/completions.ts";
import { FILTERS, linkUrl, PLACEHOLDERS, SITES, templateError } from "./core/links.ts";
import { bookStyle, type StyleName } from "./core/settings.ts";
import type ToposPlugin from "./main.ts";
import { AddBibleModal, GitUrlModal } from "./bible/add.ts";
import { mkdirs } from "./bible/packages.ts";

export { bookStyle, DEFAULT_SETTINGS, type StyleName, type ToposSettings } from "./core/settings.ts";

/**
 * topos's settings, shown first in the plugin's settings tab (file-plus-plus's tab, which adds
 * the Bible tab's reading, highlight, and link settings after them)
 */
export class ToposSettingsPanel {
  private readonly app: App;

  constructor(
    private readonly plugin: ToposPlugin,
    private readonly containerEl: HTMLElement,
    private readonly refresh: () => void,
  ) {
    this.app = plugin.app;
  }

  /** Draws the whole settings tab again */
  private display(): void {
    this.refresh();
  }

  render(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveToposSettings();
    this.bibleSettings(containerEl);
    new Setting(containerEl).setName("References").setHeading();

    new Setting(containerEl)
      .setName("Reference style")
      .setDesc("How completions, normalized references, and search results are written.")
      .addDropdown((d) =>
        d
          .addOptions({
            name: "Full name (John 3:16)",
            abbreviation: "Abbreviation (Jn 3:16)",
            osis: "OSIS (John.3.16)",
          })
          .setValue(settings.style)
          .onChange((value) => {
            settings.style = value as StyleName;
            void save();
          }),
      );

    this.links(containerEl);
    new Setting(containerEl)
      .setName("Link references in the editor")
      .setDesc("Highlight references while editing, and open their links when clicked.")
      .addToggle((t) =>
        t.setValue(settings.linkInEditor).onChange((value) => {
          settings.linkInEditor = value;
          void save();
        }),
      );
    new Setting(containerEl)
      .setName("Require Ctrl/Cmd to open references")
      .setDesc(
        "On desktop, plain clicks place the cursor (or do nothing in reading view); Ctrl/Cmd-click opens the reference.",
      )
      .addToggle((t) =>
        t.setValue(settings.clickNeedsModifier).onChange((value) => {
          settings.clickNeedsModifier = value;
          void save();
        }),
      );
    new Setting(containerEl)
      .setName("Tap to open references in the editor")
      .setDesc(
        "On mobile, the tap that would place the cursor and open the keyboard opens the reference's link instead. Once you're typing, taps move the cursor as usual. Taps outside the editor always open references.",
      )
      .addToggle((t) =>
        t.setValue(settings.tapOpensInEditor).onChange((value) => {
          settings.tapOpensInEditor = value;
          void save();
        }),
      );
    new Setting(containerEl)
      .setName("Link references in reading view")
      .addToggle((t) =>
        t.setValue(settings.linkInReading).onChange((value) => {
          settings.linkInReading = value;
          void save();
        }),
      );
    this.referenceColor(containerEl);

    new Setting(containerEl).setName("Autocomplete").setHeading();
    new Setting(containerEl)
      .setName("Suggest references while typing")
      .setDesc("After a book name, suggest chapters, then verses, then range ends.")
      .addToggle((t) =>
        t.setValue(settings.autocomplete).onChange((value) => {
          settings.autocomplete = value;
          void save();
        }),
      );
    new Setting(containerEl)
      .setName("Complete book names")
      .setDesc("In prose, completing every word would be noisy, so by default only words that start with a capital letter or number complete to book names.")
      .addDropdown((d) =>
        d
          .addOptions({ off: "Never", capitalized: "When capitalized", always: "Always" })
          .setValue(settings.bookCompletion)
          .onChange((value) => {
            settings.bookCompletion = value as BookCompletion;
            void save();
          }),
      );
    new Setting(containerEl)
      .setName("Number of suggestions")
      .addSlider((s) =>
        s
          .setLimits(5, 100, 5)
          .setValue(settings.suggestionLimit)
          .setDynamicTooltip()
          .onChange((value) => {
            settings.suggestionLimit = value;
            void save();
          }),
      );

    this.formatSettings(containerEl);

    new Setting(containerEl).setName("Search").setHeading();
    new Setting(containerEl)
      .setName("File extensions")
      .setDesc("Files to search, separated by commas.")
      .addText((t) =>
        t.setValue(settings.extensions).onChange((value) => {
          settings.extensions = value;
          void save().then(() => this.plugin.reindexSoon());
        }),
      );
    new Setting(containerEl)
      .setName("Search EPUB files")
      .setDesc(
        `Find references in EPUBs too. With the EPUB++ plugin, which opens EPUBs in Obsidian, their references show in the book, with a sidebar tab to step through them and save one as a highlight, and results open in the book.${this.plugin.epubs.api ? "" : " (EPUB++ isn't enabled.)"}`,
      )
      .addToggle((t) =>
        t.setValue(settings.searchEpubs).onChange((value) => {
          settings.searchEpubs = value;
          void save().then(() => this.plugin.epubs.toggled());
        }),
      );
    if (!Platform.isDesktopApp && settings.searchEpubs) {
      new Setting(containerEl)
        .setName("Search new EPUBs on this device")
        .setDesc(
          "Books a computer has indexed are never searched here: their references sync with the vault. Turn this on to also search books no other device has indexed yet (slow for a big library).",
        )
        .addToggle((t) =>
          t.setValue(settings.searchEpubsOnMobile).onChange((value) => {
            settings.searchEpubsOnMobile = value;
            void save().then(() => this.plugin.reindex());
          }),
        );
    }
    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName("Search engine")
        .setDesc(
          "Built in: searches in a background thread, everywhere. topos CLI: runs the native command-line tool, which is much faster for many files and EPUBs (install it with cargo install topos-bible-cli). Either way, only new and changed files are searched; edits are always searched by the built-in engine.",
        )
        .addDropdown((d) =>
          d
            .addOptions({ builtin: "Built in", cli: "topos CLI" })
            .setValue(settings.engine)
            .onChange((value) => {
              settings.engine = value as "builtin" | "cli";
              void save().then(() => {
                this.display();
                this.plugin.indexer.resetCli();
              });
            }),
        );
      if (settings.engine === "cli") {
        new Setting(containerEl)
          .setName("topos command")
          .setDesc("Leave empty to use ~/.cargo/bin/topos, or topos from PATH.")
          .addText((t) =>
            t
              .setPlaceholder(this.plugin.cliPath())
              .setValue(settings.cliPath)
              .onChange((value) => {
                settings.cliPath = value.trim();
                void save();
              }),
          )
          .addButton((b) =>
            b.setButtonText("Test").onClick(() => {
              void this.plugin.testCli().then((message) => new Notice(message));
            }),
          );
        new Setting(containerEl)
          .setName("Cache CLI results")
          .setDesc("Reuse results for files that have not changed since the last run (topos --cache).")
          .addToggle((t) =>
            t.setValue(settings.cliCache).onChange((value) => {
              settings.cliCache = value;
              void save();
            }),
          );
      }
    }

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("One folder per line.")
      .addTextArea((t) =>
        t.setValue(settings.excludeFolders).onChange((value) => {
          settings.excludeFolders = value;
          void save().then(() => this.plugin.reindexSoon());
        }),
      );

    new Setting(containerEl)
      .setName("Reference index")
      .setDesc(
        `${this.plugin.refs.referenceCount.toLocaleString()} references in ${this.plugin.refs.fileCount.toLocaleString()} files. The index is kept in the plugin's folder and syncs with your settings, so each file is searched once (on any device). Rebuilding searches every file again.`,
      )
      .addButton((b) =>
        b.setButtonText("Rebuild").onClick(() => {
          void this.plugin.reindex(true).then(() => this.display());
        }),
      );

    this.savedSearches(containerEl);
  }

  /**
   * How references are written (the CLI's --psg-fmt fields), with a preview: completions, the
   * sidebar, the dialogs, and "Normalize references" all use it
   */
  /** The references' color: the accent color until one is picked */
  /** Moves the packages folder (links to its files are updated) and reads the packages again */
  private async moveBooks(value: string): Promise<void> {
    const packages = this.plugin.packages;
    const from = packages.booksDir();
    this.plugin.settings.biblixBooks = value;
    const to = packages.booksDir();
    if (from !== to) {
      const folder = this.app.vault.getFolderByPath(from);
      try {
        if (folder && !this.app.vault.getAbstractFileByPath(to)) await this.app.fileManager.renameFile(folder, to);
      } catch (error) {
        new Notice(`Couldn't move ${from} to ${to}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await this.plugin.saveData(this.plugin.settings);
    this.plugin.applyBiblixHiding();
    await packages.load();
    this.display();
  }

  /** Moves the library (what's installed) and reads the packages again */
  private async moveLibrary(value: string): Promise<void> {
    const packages = this.plugin.packages;
    const adapter = this.app.vault.adapter;
    const from = packages.libraryDir();
    this.plugin.settings.biblixLibrary = value;
    const to = packages.libraryDir();
    if (from !== to && (await adapter.exists(from)) && !(await adapter.exists(to))) {
      try {
        await mkdirs(this.plugin, to.slice(0, Math.max(0, to.lastIndexOf("/"))));
        await adapter.rename(from, to);
      } catch (error) {
        new Notice(`Couldn't move ${from} to ${to}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await this.plugin.saveData(this.plugin.settings);
    await packages.load();
    this.display();
  }

  /** The library's packages: each one (with a button to remove it), and adding more */
  private packageSettings(containerEl: HTMLElement): void {
    const packages = this.plugin.packages;
    for (const pkg of packages.installed) {
      const info = pkg.info;
      const kind = info && info.kind !== PackageKind.Bible ? kindName(info.kind) : null;
      const setting = new Setting(containerEl)
        .setName(info ? `${info.abbreviation} ${pkg.version}` : `${pkg.id} ${pkg.version}`)
        .setDesc(pkg.problem ?? [kind, info?.name, info?.license ?? "no license given", pkg.dir].filter(Boolean).join(" · "));
      // A collection's packages are listed under it, and go with it
      if (pkg.dependencyOf !== null) {
        setting.settingEl.addClass("topos-package-member");
        setting.setDesc(`In ${pkg.dependencyOf} · ${setting.descEl.getText()}`);
        continue;
      }
      setting.addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip(pkg.path && !pkg.dir.split("/").includes("imports") ? "Remove from biblix.toml (its folder stays)" : "Remove")
            .onClick(async () => {
              try {
                await this.plugin.bibleManager.remove(pkg.id);
                new Notice(`Removed ${info?.abbreviation ?? pkg.id}`);
              } catch (error) {
                new Notice(`Couldn't remove ${pkg.id}: ${error instanceof Error ? error.message : String(error)}`);
              }
              this.display();
            }),
        );
    }
    new Setting(containerEl)
      .setName("Add a Bible")
      .setDesc(
        "Search the catalogs (eBible.org's and fetch.bible's 2,000+ translations, and any added below) and install one into the library, or add a biblix package from its git repository.",
      )
      .addButton((b) => b.setButtonText("Search").onClick(() => new AddBibleModal(this.app, this.plugin, () => this.display()).open()))
      .addButton((b) => b.setButtonText("Git URL").onClick(() => new GitUrlModal(this.app, this.plugin, () => this.display()).open()));
    void this.catalogSettings(containerEl.createDiv());
    if (packages.changedPackages.length > 0) {
      new Setting(containerEl)
        .setName("Restore edited Bibles")
        .setDesc(`The files of ${packages.changedPackages.join(", ")} were edited in the library. Restoring downloads them again; notes and annotations beside them stay.`)
        .addButton((b) =>
          b
            .setButtonText("Restore")
            .setCta()
            .onClick(async () => {
              await this.plugin.restorePackages();
              this.display();
            }),
        );
    }
    if (packages.installed.some((p) => !p.path)) {
      new Setting(containerEl)
        .setName("Update Bibles")
        .setDesc("Moves each Bible installed from a repository to its newest release that biblix.toml allows (imports stay as they are).")
        .addButton((b) =>
          b.setButtonText("Update").onClick(async () => {
            const notice = new Notice("Checking for updates…", 0);
            try {
              const changed = await this.plugin.bibleManager.update();
              notice.hide();
              new Notice(changed.length > 0 ? `Updated ${changed.join(", ")}` : "Every Bible is up to date");
            } catch (error) {
              notice.hide();
              new Notice(`Couldn't update: ${error instanceof Error ? error.message : String(error)}`, 10000);
            }
            this.display();
          }),
        );
    }
  }

  /** The catalogs Add a Bible searches: each with a remove button, and a field to add one */
  private async catalogSettings(containerEl: HTMLElement): Promise<void> {
    const manager = this.plugin.bibleManager;
    const failed = (what: string, error: unknown) => new Notice(`${what}: ${error instanceof Error ? error.message : String(error)}`, 10000);
    let catalogs: { location: string; isDefault: boolean }[];
    try {
      catalogs = await manager.catalogList();
    } catch (error) {
      failed("Couldn't read the catalogs", error);
      return;
    }
    new Setting(containerEl).setName("Catalogs").setHeading();
    for (const { location, isDefault } of catalogs) {
      new Setting(containerEl)
        .setName(location)
        .setDesc(isDefault ? "One of the defaults: removing it keeps the other" : "Added in biblix.toml")
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip("Stop searching it")
            .onClick(async () => {
              try {
                await manager.removeCatalog(location);
              } catch (error) {
                failed(`Couldn't remove ${location}`, error);
              }
              this.display();
            }),
        );
    }
    let location = "";
    new Setting(containerEl)
      .setName("Add a catalog")
      .setDesc("A list of packages to search too: a catalog.toml's URL (anyone can host one), eBible.org's translations.csv, fetch.bible's manifest.json, or a file's path relative to biblix.toml.")
      .addText((t) => t.setPlaceholder("https://example.org/catalog.toml").onChange((value) => (location = value.trim())))
      .addButton((b) =>
        b.setButtonText("Add").onClick(async () => {
          if (!location) return;
          try {
            const count = await manager.addCatalog(location);
            new Notice(`Added ${location}: ${count} package${count === 1 ? "" : "s"}`);
          } catch (error) {
            failed(`Couldn't add ${location}`, error);
          }
          this.display();
        }),
      );
  }

  private bibleSettings(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveToposSettings();
    const bibles = this.plugin.bibles.all();
    new Setting(containerEl)
      .setName("Bible")
      .setDesc(
        bibles.length > 0
          ? "References open in this translation and show its text on hover and in embeds, unless they name another (John 3:16 KJV). A Bible is a folder of USX or USFM files (one per book, like JHN.usx), named after its folder, or a biblix package in the library."
          : "No Bible in this vault yet. Add a folder of USX or USFM files (one per book, like JHN.usx), or install a biblix package in the library, and references open in it and show its text on hover and in embeds (![John 1:1]).",
      )
      .addDropdown((d) => {
        for (const bible of bibles) d.addOption(bible.folder, `${bible.name} (${bible.books.size + bible.unknown.length} books)`);
        if (bibles.length === 0) d.addOption("", "None found");
        d.setValue(this.plugin.bibles.current()?.folder ?? "").onChange((value) => {
          settings.bible = value;
          void save();
        });
      });
    new Setting(containerEl)
      .setName("Packages folder")
      .setDesc(
        "Bible packages show here: each Bible book as a stub (<package>/usx/JHN.bible), which opens the book and which links and annotations point at, so updates don't move them, and each book package's EPUBs. This vault's biblix.toml and biblix.lock are here unless they're at its root. Renaming it moves the folder and updates links to it.",
      )
      .addText((t) => {
        t.setPlaceholder("Biblix").setValue(settings.biblixBooks);
        // Moved when the field is left (not as each letter is typed)
        t.inputEl.addEventListener("change", () => void this.moveBooks(t.getValue()));
      });
    new Setting(containerEl)
      .setName("Library folder")
      .setDesc(
        "Where packages are installed (packages/<id>/<version>/). A folder whose name starts with a dot is hidden and isn't synced: each device installs what biblix.lock pins, by itself. Renaming it moves what's installed.",
      )
      .addText((t) => {
        t.setPlaceholder(".biblix").setValue(settings.biblixLibrary);
        t.inputEl.addEventListener("change", () => void this.moveLibrary(t.getValue()));
      });
    new Setting(containerEl)
      .setName("Hide the packages folder")
      .setDesc("Leave it out of the file explorer, and out of Obsidian's search, quick switcher, and graph (as an excluded file). Bibles and books still open from references, and verse search still reads them.")
      .addToggle((t) =>
        t.setValue(settings.hideBiblixBooks).onChange(async (value) => {
          settings.hideBiblixBooks = value;
          await save();
          this.plugin.applyBiblixHiding();
        }),
      );
    this.packageSettings(containerEl);
    new Setting(containerEl)
      .setName("Translations")
      .setDesc(
        "A reference can name its translation: John 3:16 KJV, [John 3:16 (KJV)], ![John 3:16 KJV]. Each Bible's folder name is one; add other names and aliases here, one per line, like \"KJV: AV, King James\". A name the vault has no Bible for still opens its link with {translation} in the link template.",
      )
      .addTextArea((t) =>
        t
          .setPlaceholder("KJV: AV, King James")
          .setValue(settings.bibleAliases)
          .onChange((value) => {
            settings.bibleAliases = value;
            void save();
          }),
      );
    new Setting(containerEl)
      .setName("Compare in embeds")
      .setDesc("Bibles whose text embeds (![John 1:1]) also show, after the one the reference names, separated by commas: KJV, NET.")
      .addText((t) =>
        t.setValue(settings.compareBibles).onChange((value) => {
          settings.compareBibles = value;
          void save();
        }),
      );
    new Setting(containerEl)
      .setName("Open reference links in")
      .setDesc("Where [John 1:1] and [text](John 1:1) open. Bare references open like before (see Link template).")
      .addDropdown((d) =>
        d
          .addOptions({ bible: "The Bible", site: "The link site" })
          .setValue(settings.referenceLinks)
          .onChange((value) => {
            settings.referenceLinks = value as "bible" | "site";
            void save();
          }),
      );
    new Setting(containerEl)
      .setName("Preview bare references")
      .setDesc("Show a reference's text when hovering it in the text, not only in links.")
      .addToggle((t) =>
        t.setValue(settings.previewBare).onChange((value) => {
          settings.previewBare = value;
          void save();
        }),
      );
    new Setting(containerEl)
      .setName("Embed references on their own line")
      .setDesc("A reference alone on its line shows its text, like ![John 1:1]. In the editor, it shows the reference again while the cursor is near it.")
      .addToggle((t) =>
        t.setValue(settings.embedAlone).onChange((value) => {
          settings.embedAlone = value;
          void save();
          this.display();
        }),
      );
    if (settings.embedAlone) {
      const counts = (none: string) => {
        const options: Record<string, string> = { 0: none };
        for (let n = 1; n <= 5; n++) options[n] = `${n} line${n > 1 ? "s" : ""}`;
        return options;
      };
      new Setting(containerEl)
        .setName("Blank lines around them")
        .setDesc("How many blank lines must be above and below the reference (the start and end of the note count).")
        .addDropdown((d) =>
          d
            .addOptions(counts("None, just its own line"))
            .setValue(String(settings.embedAloneBlankLines))
            .onChange((value) => {
              settings.embedAloneBlankLines = Number(value);
              void save();
            }),
        );
      new Setting(containerEl)
        .setName("Cursor distance")
        .setDesc("How many lines away the cursor shows the reference to edit it, instead of its text.")
        .addDropdown((d) =>
          d
            .addOption("same", "As many as the blank lines")
            .addOptions(counts("Only on its line"))
            .setValue(settings.embedAloneCursorLines === null ? "same" : String(settings.embedAloneCursorLines))
            .onChange((value) => {
              settings.embedAloneCursorLines = value === "same" ? null : Number(value);
              void save();
            }),
        );
    }
    new Setting(containerEl)
      .setName("Mark references in other documents")
      .setDesc("Find references in transcripts (Transcript++) and other file-plus-plus documents as they open, and mark them like references in notes. EPUBs follow Search EPUB files.")
      .addToggle((t) =>
        t.setValue(settings.markInDocuments).onChange((value) => {
          settings.markInDocuments = value;
          void save();
        }),
      );
    new Setting(containerEl)
      .setName("Section headings")
      .setDesc("Show the translation's headings in Bible text.")
      .addToggle((t) =>
        t.setValue(settings.bibleHeadings).onChange((value) => {
          settings.bibleHeadings = value;
          void save();
        }),
      );
    new Setting(containerEl)
      .setName("Footnotes")
      .setDesc("Show the translation's footnotes and cross references in Bible text.")
      .addToggle((t) =>
        t.setValue(settings.bibleNotes).onChange((value) => {
          settings.bibleNotes = value;
          void save();
        }),
      );
  }

  private referenceColor(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    new Setting(containerEl)
      .setName("Reference color")
      .setDesc(
        settings.referenceColor
          ? "The glow, dashed underline, and hover highlight of references."
          : "The glow, dashed underline, and hover highlight of references. Your accent color until you pick one.",
      )
      .addColorPicker((c) =>
        c.setValue(settings.referenceColor || accentColor(containerEl)).onChange((value) => {
          settings.referenceColor = value;
          void this.plugin.saveToposSettings();
        }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("rotate-ccw")
          .setTooltip("Use the accent color")
          .onClick(() => {
            settings.referenceColor = "";
            void this.plugin.saveToposSettings();
            this.display();
          }),
      );
  }

  /** Where references open: a site, a template of your own, or nowhere */
  private links(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const choice = (template: string) =>
      !template.trim() ? "none" : (SITES.find((site) => site.template === template)?.id ?? "custom");
    new Setting(containerEl)
      .setName("Links")
      .setHeading()
      .setDesc(
        `A link template is an address with placeholders: ${Object.keys(PLACEHOLDERS)
          .map((name) => `{${name}}`)
          .join(" ")}. Filters change a value: {book|${Object.keys(FILTERS).join("|")}}. ` +
          "A part in [ ] is left out when a placeholder in it has no value, like {verse} for a whole chapter.",
      );
    let sites: DropdownComponent | undefined;
    new Setting(containerEl)
      .setName("Open references in")
      .setDesc("Where clicking a reference, the sidebar's ↗ button, and reading view links go.")
      .addDropdown((d) => {
        sites = d;
        for (const site of SITES) d.addOption(site.id, site.name);
        d.addOption("custom", "A link template");
        d.addOption("none", "Nowhere (no links)");
        d.setValue(choice(settings.linkTemplate)).onChange((value) => {
          const site = SITES.find((s) => s.id === value);
          if (site) settings.linkTemplate = site.template;
          if (value === "none") settings.linkTemplate = "";
          if (value === "custom" && !settings.linkTemplate.trim()) settings.linkTemplate = "https://";
          void this.plugin.saveToposSettings();
          this.display();
        });
      });
    if (!settings.linkTemplate.trim()) return;
    const template = new Setting(containerEl).setName("Link template");
    const preview = () => {
      const error = templateError(settings.linkTemplate);
      const examples = ["John 3:16-18", "Psalm 23"].map((reference) => {
        const passage = this.plugin.topos.parse(reference, BookStyle.Name);
        return (passage && linkUrl(settings.linkTemplate, passage)) ?? `no link for ${reference}`;
      });
      template.setDesc(error ? `Can't be used: ${error}` : `Preview: ${examples.join("   ")}`);
      template.descEl.toggleClass("topos-query-error", error !== null);
    };
    template.addText((t) => {
      t.inputEl.addClass("topos-query-input");
      t.setPlaceholder("https://example.com/{book.id}/{chapter}[/{verse}]")
        .setValue(settings.linkTemplate)
        .onChange((value) => {
          settings.linkTemplate = value;
          sites?.setValue(choice(value));
          preview();
          void this.plugin.saveToposSettings();
        });
    });
    preview();
  }

  private formatSettings(containerEl: HTMLElement): void {
    const { settings } = this.plugin;
    const format = settings.format;
    const heading = new Setting(containerEl).setName("Reference format").setHeading();
    const preview = () => {
      const topos = this.plugin.topos;
      const style = bookStyle(settings.style);
      const samples = ["John 3:16,17,18; 4:1-5:3", "Jude 5"]
        .map((text) => topos.parse(text, BookStyle.Name))
        .filter((passage) => passage !== null)
        .map((passage) => written(topos, passage, style, format));
      heading.setDesc(`Preview: ${samples.join("   ")}`);
    };
    const save = () => {
      void this.plugin.saveToposSettings();
      preview();
    };
    const texts: [keyof FormatSettings, string, string][] = [
      ["bookSeparator", "Between the book and chapter", "John␣3:16"],
      ["chapterVerse", "Between chapter and verse", "3:16"],
      ["range", "Range", "3:16-18"],
      ["verseSeparator", "Between verses in a chapter", "3:16,18"],
      ["chapterSeparator", "Between chapters", "3:16; 4:1"],
    ];
    for (const [key, name, example] of texts) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(example)
        .addText((t) =>
          t
            .setPlaceholder(JSON.stringify(DEFAULT_FORMAT[key]))
            .setValue(String(format[key]))
            .onChange((value) => {
              // Separators can be spaces, so only an empty field means the default
              (format[key] as string) = value === "" ? (DEFAULT_FORMAT[key] as string) : value;
              save();
            }),
        );
    }
    const toggles: [keyof FormatSettings, string, string][] = [
      ["joinAdjacent", "Join adjacent verses", "3:16-18, not 3:16,17,18"],
      ["omitFirstVerseOfChapterRange", "Leave out the first verse of chapter ranges", "1-2:3, not 1:1-2:3"],
      ["chapterInSingleChapterBooks", "Chapter in single-chapter books", "Jude 1:5, not Jude 5"],
    ];
    for (const [key, name, example] of toggles) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(example)
        .addToggle((t) =>
          t.setValue(format[key] as boolean).onChange((value) => {
            (format[key] as boolean) = value;
            save();
          }),
        );
    }
    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Reset the format").onClick(() => {
        settings.format = { ...DEFAULT_FORMAT };
        void this.plugin.saveToposSettings();
        this.display();
      }),
    );
    preview();
  }

  /** Each saved search is a name and the CLI's filter options, editable here */
  private savedSearches(containerEl: HTMLElement): void {
    const { settings } = this.plugin;
    new Setting(containerEl)
      .setName("Saved searches")
      .setHeading()
      .setDesc(
          'Filters written like the topos CLI\'s options, after any folders or files to search: Sermons --nt -g "Pauline Epistles" -b John --exclude-book Philemon -i "Romans 8" -o "John 1" --exclude-overlap "Psalm 23" (-o is explicit overlap; --any-overlap counts whole chapters too, and --exact-overlap means exactly that passage). --glob, --iglob (a ! before the glob leaves its files out), and --path-regex pick files by path. Save the sidebar\'s filters with its Save button, or add one here.',
      );
    const persist = () => {
      void this.plugin.saveData(settings).then(() => this.plugin.search.set({}));
    };
    settings.queries.forEach((saved, i) => {
      const setting = new Setting(containerEl);
      const showErrors = () => {
        const { errors } = parseQuery(saved.query);
        setting.setDesc(errors.join("; "));
        setting.descEl.toggleClass("topos-query-error", errors.length > 0);
      };
      setting
        .addText((t) =>
          t
            .setPlaceholder("Name")
            .setValue(saved.name)
            .onChange((value) => {
              saved.name = value;
              persist();
            }),
        )
        .addText((t) => {
          t.inputEl.addClass("topos-query-input");
          t.setPlaceholder('--nt -g "Pauline Epistles"')
            .setValue(saved.query)
            .onChange((value) => {
              saved.query = value;
              showErrors();
              persist();
            });
        })
        .addExtraButton((b) =>
          b
            .setIcon("search")
            .setTooltip("Show in the sidebar")
            .onClick(() => void this.plugin.openQuery(saved)),
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip("Delete")
            .onClick(() => {
              settings.queries.splice(i, 1);
              persist();
              this.display();
            }),
        );
      showErrors();
    });
    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Add a saved search").onClick(() => {
        settings.queries.push({ name: `Search ${settings.queries.length + 1}`, query: "" });
        persist();
        this.display();
      }),
    );
  }
}

/** The theme's accent color as `#rrggbb` (what the color picker takes) */
function accentColor(el: HTMLElement): string {
  try {
    const probe = el.createDiv();
    probe.style.color = "var(--text-accent)";
    const color = getComputedStyle(probe).color;
    probe.remove();
    // `rgb(216, 180, 254)`, or `color(srgb 0.85 0.71 1)` with 0-1 channels
    const scale = color.startsWith("color(") ? 255 : 1;
    const channels = (color.match(/\d*\.?\d+/g) ?? []).slice(0, 3).map((n) => Number(n) * scale);
    if (channels.length < 3) return "#000000";
    return `#${channels.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "#000000";
  }
}

/** What a package kind is called, for the settings (`book`, `collection`) */
function kindName(kind: PackageKind): string {
  const name = Object.entries(PackageKind).find(([, value]) => value === kind)?.[0] ?? "";
  return name.replace(/(?<!^)([A-Z])/g, " $1").toLowerCase();
}
