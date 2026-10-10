import { App, Notice, type ColorComponent, type DropdownComponent, Platform, Setting, setIcon } from "obsidian";
import { BookStyle, PackageKind } from "logoxide";
import { DEFAULT_FORMAT, written, type FormatSettings } from "./core/format.ts";
import { parseQuery } from "./core/query.ts";
import type { BookCompletion } from "./core/completions.ts";
import { FILTERS, linkUrl, PLACEHOLDERS, SITES, templateError } from "./core/links.ts";
import { bookStyle, type StyleName } from "./core/settings.ts";
import { notesShown } from "./core/display.ts";
import type ToposPlugin from "./main.ts";
import { kindName } from "./bible/add.ts";
import { mkdirs, type InstalledPackage } from "./bible/packages.ts";
import { formatSize } from "./core/timings.ts";
import { badge, chips, errorText, filteredList, lead, md, section, setMd, Tabs, type TabSpec } from "./settings/kit.ts";
import { CatalogBrowser, gitForm } from "./settings/browse.ts";

export { bookStyle, DEFAULT_SETTINGS, type StyleName, type ToposSettings } from "./core/settings.ts";

export type SettingsTab = "bibles" | "display" | "library" | "add" | "references" | "search" | "reader" | "highlights";

const TABS: TabSpec<SettingsTab>[] = [
  { id: "bibles", name: "Bibles", icon: "book-open" },
  { id: "display", name: "Display", icon: "type" },
  { id: "library", name: "Library", icon: "library" },
  { id: "add", name: "Add Bibles", icon: "package-plus" },
  { id: "references", name: "References", icon: "link-2" },
  { id: "search", name: "Search", icon: "search" },
  { id: "reader", name: "Reader", icon: "book-open-text" },
  { id: "highlights", name: "Highlights", icon: "highlighter" },
];

/** file-plus-plus's sections of the settings, by heading, and the tab each goes in (the rest: Highlights) */
const FPP_SECTIONS: Record<string, SettingsTab> = {
  Reading: "reader",
  "Jumping to a passage": "reader",
  Previews: "reader",
  Mobile: "reader",
};

/** The tab showing, kept while the settings are redrawn and between visits */
let activeTab: SettingsTab = "bibles";

/** Opens the plugin's settings at a tab */
export function openSettings(plugin: ToposPlugin, tab: SettingsTab): void {
  activeTab = tab;
  const setting = (plugin.app as App & { setting?: { open(): void; openTabById(id: string): void } }).setting;
  setting?.open();
  setting?.openTabById(plugin.manifest.id);
}

/** A button that asks again before it removes something: the first click arms it for a few seconds */
function removeButton(el: HTMLElement, tooltip: string, remove: () => Promise<void>): void {
  const button = el.createDiv({ cls: "clickable-icon topos-remove", attr: { "aria-label": tooltip } });
  setIcon(button, "trash-2");
  let armed: number | null = null;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (armed === null) {
      button.addClass("is-armed");
      button.setAttr("aria-label", "Click again to remove");
      armed = window.setTimeout(() => {
        armed = null;
        button.removeClass("is-armed");
        button.setAttr("aria-label", tooltip);
      }, 3000);
      return;
    }
    window.clearTimeout(armed);
    button.addClass("is-busy");
    await remove();
  });
}

/**
 * topos's settings, in tabs: what file-plus-plus's settings tab shows first. Its own settings
 * (reading, highlights, links to passages) are moved into the last two tabs once it has drawn them
 */
export class ToposSettingsPanel {
  private readonly app: App;
  private tabs!: Tabs<SettingsTab>;
  /** Which installed packages the Library tab lists: all, or only those on or off */
  private packageState: "all" | "on" | "off" = "all";
  /** The tabs drawn so far (the Add Bibles tab is drawn when it's first shown, since it downloads the catalogs) */
  private readonly drawn = new Set<SettingsTab>();

  constructor(
    private readonly plugin: ToposPlugin,
    private readonly containerEl: HTMLElement,
    /** Draws the whole settings tab again (unused: tabs draw their parts again themselves) */
    _refresh: () => void,
  ) {
    this.app = plugin.app;
  }

  render(): void {
    const { containerEl } = this;
    containerEl.addClass("topos-settings");
    this.tabs = new Tabs(containerEl, TABS, activeTab, (id) => {
      activeTab = id;
      this.draw(id);
    });
    lead(this.panel("reader"), "How Bible books read in their own tab: the look of the text (for each device), jumping to a passage, and previews.");
    lead(this.panel("highlights"), "Highlighting Bible text, links to passages, copying, menus, and the annotation files beside each book.");
    for (const tab of ["bibles", "display", "library", "references", "search"] as const) this.draw(tab);
    this.draw(this.tabs.current);
    queueMicrotask(() => this.adoptFilePlusPlus());
  }

  private panel(tab: SettingsTab): HTMLElement {
    return this.tabs.panels.get(tab)!;
  }

  /** Draws a tab's settings (once; `redraw` draws them again) */
  private draw(tab: SettingsTab): void {
    if (this.drawn.has(tab)) return;
    const el = this.panel(tab);
    switch (tab) {
      case "bibles":
        this.biblesTab(el);
        break;
      case "display":
        this.displayTab(el);
        break;
      case "library":
        this.libraryTab(el);
        break;
      case "add":
        this.addTab(el);
        break;
      case "references":
        this.referencesTab(el);
        break;
      case "search":
        this.searchTab(el);
        break;
      default:
        return;
    }
    this.drawn.add(tab);
  }

  /** Draws tabs again (after what they show changed), keeping the rest as it is */
  private redraw(...tabs: SettingsTab[]): void {
    for (const tab of tabs) {
      if (tab === "reader" || tab === "highlights") continue;
      const wasDrawn = this.drawn.delete(tab);
      this.panel(tab).empty();
      if (wasDrawn || tab === this.tabs.current) this.draw(tab);
    }
  }

  /**
   * file-plus-plus draws its settings after these, under a heading of their own: they're moved
   * into the Reader and Highlights tabs by their headings, each heading's settings in a card like
   * these (it draws them right after this, in the same task, so nothing shows before they move)
   */
  private adoptFilePlusPlus(): void {
    if (!this.containerEl.parentElement) return;
    const before = this.containerEl.previousElementSibling;
    if (before instanceof HTMLElement && before.hasClass("setting-item-heading")) before.remove();
    let group: HTMLElement | null = null;
    let items: HTMLElement | null = null;
    const newGroup = (tab: SettingsTab) => {
      group = this.panel(tab).createDiv("setting-group");
      items = null;
      return group;
    };
    for (let node = this.containerEl.nextSibling; node; ) {
      const next = node.nextSibling;
      if (node instanceof HTMLElement && node.hasClass("setting-item-heading")) {
        const name = node.querySelector(".setting-item-name")?.textContent?.trim() ?? "";
        newGroup(FPP_SECTIONS[name] ?? "highlights").append(node);
      } else if (node instanceof HTMLElement && node.hasClass("setting-item")) {
        const into: HTMLElement = group ?? newGroup("reader");
        if (!items || into.lastElementChild !== items) items = into.createDiv("setting-items");
        items.append(node);
      } else if (node instanceof HTMLElement) {
        const into: HTMLElement = group ?? newGroup("reader");
        // A block of settings of its own (the appearance controls, a menu's items): a card of its own
        if (node.tagName === "DIV" && node.querySelector(":scope > .setting-item")) node.addClass("setting-items");
        else node.addClass("topos-group-text");
        into.append(node);
        items = null;
      } else node.remove();
      node = next;
    }
    for (const tab of ["reader", "highlights"] as const) {
      for (const el of this.panel(tab).querySelectorAll<HTMLElement>(".setting-item-description, .topos-group-text")) codeLiterals(el);
    }
  }

  // ─── Display ─────────────────────────────────────────────────────────────

  private displayTab(el: HTMLElement): void {
    const settings = this.plugin.settings;
    lead(el, "How Bible text looks in its tab, hover previews, and embeds.");
    /** A toggle; `rendered` settings change the HTML (open Bible tabs render again), the rest only its look */
    /** A setting changed: restyle readers, and render open Bible tabs again when it changed what's rendered (headings, notes) */
    const changed = async (change: () => void) => {
      const before = [settings.bibleHeadings, notesShown(settings)].join();
      change();
      this.plugin.bibleStyles.apply();
      await this.plugin.saveToposSettings();
      if ([settings.bibleHeadings, notesShown(settings)].join() !== before) this.plugin.rerenderBibles();
    };
    const toggle = (items: HTMLElement, name: string, desc: string, key: "bibleHeadings" | "bibleRedLetters") =>
      new Setting(items)
        .setName(name)
        .setDesc(md(desc))
        .addToggle((t) => t.setValue(settings[key]).onChange((value) => changed(() => (settings[key] = value))));

    const text = section(el, "Text").items;
    toggle(text, "Section headings", "The translation's headings, like *The Word Became Flesh*.", "bibleHeadings");
    this.markLook(text, "Verse numbers", "The small number before each verse.", "verseNumbers", changed);
    toggle(text, "Red letters", "The words of Jesus in red, in Bibles that mark them.", "bibleRedLetters");

    const notes = section(el, "Notes", "A mark in the text: footnotes are lettered, cross references are †. Hover over one, or tap it, to read the note.").items;
    this.markLook(notes, "Footnotes", "The translation's footnotes: other readings, literal meanings, and study notes.", "footnotes", changed);
    this.markLook(notes, "Cross references", "Other passages the translation points to.", "crossRefs", changed);

    const css = section(el, "Stylesheet").items;
    new Setting(css)
      .setName("Bible stylesheet")
      .setDesc(
        md(
          "A CSS file in the vault for Bible text: its tab, previews, and embeds (Obsidian's CSS snippets don't reach them). Every USX marker is a `data-style`: `[data-style=\"q2\"]`, `[data-style=\"pn\"]`, `.topos-note [data-style=\"fr\"]`. Its rules win over the settings above. Changes to the file apply at once.",
        ),
      )
      .addText((t) => {
        t.inputEl.addClass("topos-code-input");
        t.setPlaceholder("Bibles/bible.css")
          .setValue(settings.bibleCss)
          .onChange((value) => {
            settings.bibleCss = value.trim();
            void this.plugin.bibleStyles.load();
            void this.plugin.saveToposSettings();
          });
      });
  }

  /** How a mark shows (verse numbers, footnotes, cross references): not at all, faded, in the accent color, or a color picked */
  private markLook(items: HTMLElement, name: string, desc: string, key: "verseNumbers" | "footnotes" | "crossRefs", changed: (change: () => void) => Promise<void>): void {
    const settings = this.plugin.settings;
    const choice = () => (["none", "faded", "accent"].includes(settings[key]) ? settings[key] : "custom");
    const setting = new Setting(items).setName(name).setDesc(md(desc));
    let picker: ColorComponent | null = null;
    // The picker shows for a color of your own (ColorComponent's input isn't in the API's types)
    const showPicker = () => setting.controlEl.querySelector<HTMLElement>('input[type="color"]')?.toggle(choice() === "custom");
    setting
      .addDropdown((d) =>
        d
          .addOptions({ none: "None", faded: "Faded text", accent: "Accent color", custom: "Custom" })
          .setValue(choice())
          .onChange((value) =>
            changed(() => {
              settings[key] = value === "custom" ? (picker?.getValue() ?? themeColor(items, "--text-accent")) : value;
              showPicker();
            }),
          ),
      )
      .addColorPicker((c) => {
        picker = c;
        c.setValue(choice() === "custom" ? settings[key] : themeColor(items, "--text-accent")).onChange((value) => changed(() => (settings[key] = value)));
      });
    showPicker();
  }

  // ─── Bibles ──────────────────────────────────────────────────────────────

  private biblesTab(el: HTMLElement): void {
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveToposSettings();
    const bibles = this.plugin.bibles.all();
    lead(el, "Which Bible references open in, the translations they can name, and their embeds and previews.");

    const main = section(el, "Default Bible").items;
    if (bibles.length === 0) {
      const empty = main.createDiv("setting-item mod-empty-state topos-empty-state");
      setIcon(empty.createDiv("topos-empty-state-icon"), "book-open");
      empty.createDiv({ cls: "topos-empty-state-title", text: "No Bible in this vault yet" });
      empty
        .createDiv("topos-empty-state-text")
        .append(md("Install one from the catalogs, or add a folder of USX or USFM files (one per book, like `JHN.usx`). References then open in it, and show its text on hover and in embeds (`![John 1:1]`)."));
      empty.createEl("button", { cls: "mod-cta", text: "Browse Bibles" }).addEventListener("click", () => this.tabs.select("add"));
    } else {
      new Setting(main)
        .setName("Bible")
        .setDesc(
          md(
            "References open in this translation and show its text on hover and in embeds, unless they name another (`John 3:16 KJV`). A Bible is a folder of USX or USFM files (one per book, like `JHN.usx`), named after its folder, or a package in the library.",
          ),
        )
        .addDropdown((d) => {
          for (const bible of bibles) d.addOption(bible.folder, `${bible.name} (${bible.books.size + bible.unknown.length} books)`);
          d.setValue(this.plugin.bibles.current()?.folder ?? "").onChange((value) => {
            settings.bible = value;
            void save();
          });
        });
    }
    new Setting(main)
      .setName("Open reference links in")
      .setDesc(md("Where `[John 1:1]` and `[text](John 1:1)` open. Bare references open in the link site (*References → Links*)."))
      .addDropdown((d) =>
        d
          .addOptions({ bible: "The Bible", site: "The link site" })
          .setValue(settings.referenceLinks)
          .onChange((value) => {
            settings.referenceLinks = value as "bible" | "site";
            void save();
          }),
      );

    const picker = section(el, "Go to a passage", "The *Go to a book, chapter, and verse* command, ribbon button, and Bible toolbar button pick a passage by tapping (or typing).").items;
    new Setting(picker)
      .setName("Choose the testament first")
      .setDesc("Pick the Old or New Testament before its books, so they have room for their full names. Off, every book shows at once.")
      .addToggle((t) =>
        t.setValue(settings.pickerTestament).onChange((value) => {
          settings.pickerTestament = value;
          void this.plugin.saveData(settings);
        }),
      );
    new Setting(picker)
      .setName("Chapters and verses")
      .setDesc(md("A grid of numbers to tap, or a field that brings up the number pad (a chapter and verse at once: `3:16` or `3.16`)."))
      .addDropdown((d) =>
        d
          .addOptions({ grid: "Grid", keypad: "Number pad" })
          .setValue(settings.pickerNumbers)
          .onChange((value) => {
            settings.pickerNumbers = value as "grid" | "keypad";
            void this.plugin.saveData(settings);
          }),
      );
    new Setting(picker)
      .setName("Ask for a verse")
      .setDesc("After the chapter, pick a verse. Off, it opens at the chapter's start.")
      .addToggle((t) =>
        t.setValue(settings.pickerVerse).onChange((value) => {
          settings.pickerVerse = value;
          void this.plugin.saveData(settings);
        }),
      );

    const translations = section(el, "Translations", "A reference can name its translation: `John 3:16 KJV`, `[John 3:16 (KJV)]`, `![John 3:16 KJV]`. Each Bible's folder name is one.").items;
    new Setting(translations)
      .setName("Names and aliases")
      .setDesc(md("One per line, like `KJV: AV, King James`. A name the vault has no Bible for still opens its link, with `{translation}` in the link template."))
      .setClass("topos-tall-setting")
      .addTextArea((t) => {
        t.inputEl.rows = 4;
        t.inputEl.addClass("topos-code-input");
        t.setPlaceholder("KJV: AV, King James")
          .setValue(settings.bibleAliases)
          .onChange((value) => {
            settings.bibleAliases = value;
            void save();
          });
      });
    new Setting(translations)
      .setName("Compare in embeds")
      .setDesc(md("Bibles whose text embeds (`![John 1:1]`) also show, after the one the reference names, separated by commas: `KJV, NET`."))
      .addText((t) =>
        t
          .setPlaceholder("KJV, NET")
          .setValue(settings.compareBibles)
          .onChange((value) => {
            settings.compareBibles = value;
            void save();
          }),
      );

    const embeds = section(el, "Embeds and previews").items;
    new Setting(embeds)
      .setName("Preview bare references")
      .setDesc("Show a reference's text when hovering it in the text, not only in links.")
      .addToggle((t) =>
        t.setValue(settings.previewBare).onChange((value) => {
          settings.previewBare = value;
          void save();
        }),
      );
    const counts = (none: string) => {
      const options: Record<string, string> = { 0: none };
      for (let n = 1; n <= 5; n++) options[n] = `${n} line${n > 1 ? "s" : ""}`;
      return options;
    };
    const alone: Setting[] = [];
    const showAlone = () => alone.forEach((s) => s.settingEl.toggleClass("topos-hidden", !settings.embedAlone));
    new Setting(embeds)
      .setName("Embed references on their own line")
      .setDesc(md("A reference alone on its line shows its text, like `![John 1:1]`. In the editor, it shows the reference again while the cursor is near it."))
      .addToggle((t) =>
        t.setValue(settings.embedAlone).onChange((value) => {
          settings.embedAlone = value;
          void save();
          showAlone();
        }),
      );
    alone.push(
      new Setting(embeds)
        .setClass("topos-subsetting")
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
        ),
      new Setting(embeds)
        .setClass("topos-subsetting")
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
        ),
    );
    showAlone();

    const recordings = section(el, "Recordings", "Package Bibles with a recording have a *Listen* button in their toolbar, and a play button in embeds of the passages it reads.").items;
    new Setting(recordings)
      .setName("Follow along")
      .setDesc("While a recording plays, keep the verse being read in view.")
      .addToggle((t) =>
        t.setValue(settings.followPlayback).onChange((value) => {
          settings.followPlayback = value;
          void this.plugin.saveData(settings);
        }),
      );
  }

  // ─── Library ─────────────────────────────────────────────────────────────

  private libraryTab(el: HTMLElement): void {
    const packages = this.plugin.packages;
    lead(el, "The packages the vault's `logoxide.toml` asks for, pinned by `logoxide.lock`: Bibles, commentaries, and books. Each device installs what the lock pins.");

    const all = packages.installed.filter((p) => p.dependencyOf === null);
    const more = packages.installed.length - all.length;
    const off = all.filter((p) => !p.enabled).length;
    const summary = `${all.length} package${all.length === 1 ? "" : "s"}${more > 0 ? `, and ${more} more in collections` : ""}${off > 0 ? `; ${off} turned off` : ""}.`;
    const installed = section(el, "Installed", all.length > 0 ? summary : undefined);
    // All, or only those on or off
    if (off > 0 || this.packageState !== "all") {
      // Beside the filter field, which the list adds after them
      const filters = installed.search.createDiv("setting-group-search-control topos-package-filters");
      chips(filters, [["all", "All"], ["on", "On"], ["off", "Off"]], this.packageState, (state) => {
        this.packageState = state;
        this.redraw("library");
      });
    }
    const top = all.filter((p) => this.packageState === "all" || p.enabled === (this.packageState === "on"));
    installed.heading?.addButton((b) =>
      b
        .setButtonText("Add Bibles")
        .setCta()
        .onClick(() => this.tabs.select("add")),
    );
    filteredList(installed, top, {
      key: "packages",
      placeholder: "Filter by name, abbreviation, license, or folder",
      noun: ["package", "packages"],
      empty: "Nothing installed yet. Find Bibles, commentaries, and books in *Add Bibles*, or write a `logoxide.toml` and run `lx install`.",
      text: (pkg) =>
        [pkg, ...packages.installed.filter((p) => p.dependencyOf === pkg.name)]
          .map((p) => [p.id, p.name, p.version, p.dir, p.info?.name, p.info?.abbreviation, p.info?.license, p.info ? kindName(p.info.kind) : "", p.enabled ? "" : "off"].join(" "))
          .join(" "),
      render: (pkg, items) => this.packageRow(items, pkg, packages.installed.filter((p) => p.dependencyOf === pkg.name)),
    });

    const imports = packages.installed.some((p) => p.path && p.dependencyOf === null && p.dir.includes("/imports/"));
    const fromGit = packages.installed.some((p) => !p.path);
    if (fromGit || imports || packages.changedPackages.length > 0) {
      const updates = section(el, "Updates").items;
      if (packages.changedPackages.length > 0) {
        new Setting(updates)
          .setName("Restore edited Bibles")
          .setDesc(md(`The files of ${packages.changedPackages.map((p) => `\`${p}\``).join(", ")} were edited in the library. Restoring downloads them again; notes and annotations beside them stay.`))
          .setClass("topos-warning-setting")
          .addButton((b) =>
            b
              .setButtonText("Restore")
              .setCta()
              .onClick(async () => {
                b.setDisabled(true).setButtonText("Restoring…");
                await this.plugin.restorePackages();
                this.redraw("library", "bibles");
              }),
          );
      }
      if (fromGit) {
        new Setting(updates)
          .setName("Update Bibles")
          .setDesc(md("Moves each package installed from a repository to its newest release that `logoxide.toml` allows (imports stay as they are)."))
          .addButton((b) =>
            b.setButtonText("Update").onClick(async () => {
              b.setDisabled(true).setButtonText("Checking…");
              try {
                const changed = await this.plugin.bibleManager.update();
                new Notice(changed.length > 0 ? `Updated ${changed.join(", ")}` : "Every Bible is up to date");
              } catch (error) {
                new Notice(`Couldn't update: ${errorText(error)}`, 10000);
              }
              this.redraw("library", "bibles");
            }),
          );
      }
      if (imports) {
        const setting = new Setting(updates)
          .setName("Update imports")
          .setDesc("Makes each imported Bible (from eBible.org, fetch.bible, CCEL, or a SWORD repository) again from its publisher's download, and replaces those that changed. Notes beside them stay.");
        const output = setting.infoEl.createEl("pre", { cls: "topos-output topos-hidden" });
        const run = async (checkOnly: boolean, button: HTMLButtonElement) => {
          const label = button.textContent ?? "";
          button.disabled = true;
          button.setText(checkOnly ? "Checking…" : "Updating…");
          try {
            const lines = await this.plugin.bibleManager.updateImports(checkOnly);
            output.setText(lines.join("\n") || "This vault has no imports");
            output.removeClass("topos-hidden");
          } catch (error) {
            new Notice(`Couldn't update imports: ${errorText(error)}`, 10000);
          }
          button.disabled = false;
          button.setText(label);
        };
        setting.addButton((b) => b.setButtonText("Check").onClick(() => void run(true, b.buttonEl)));
        setting.addButton((b) => b.setButtonText("Update").onClick(() => void run(false, b.buttonEl)));
      }
    }

    this.storageSettings(el);
  }

  /** An installed package: its names, version, kind, license, and folder (with a collection's packages under it) */
  private packageRow(items: HTMLElement, pkg: InstalledPackage, members: InstalledPackage[]): HTMLElement {
    const row = items.createDiv("setting-item topos-package");
    const info = row.createDiv("setting-item-info");
    this.packageTitle(info, pkg);
    if (members.length > 0) {
      const list = info.createDiv("topos-package-members");
      list.createDiv({ cls: "topos-package-members-label", text: `In this collection (${members.length})` });
      for (const member of members) this.packageTitle(list.createDiv("topos-package-member"), member);
    }
    row.toggleClass("is-disabled", !pkg.enabled);
    const control = row.createDiv("setting-item-control");
    // Off keeps it installed and locked: its Bible, books, and stubs leave the vault until it's on again
    const name = pkg.info?.abbreviation ?? pkg.id;
    const toggle = control.createDiv({ cls: `checkbox-container${pkg.enabled ? " is-enabled" : ""}`, attr: { "aria-label": pkg.enabled ? `Turn ${name} off (it stays installed)` : `Turn ${name} on` } });
    toggle.createEl("input", { type: "checkbox", attr: { tabindex: "0" } });
    toggle.addEventListener("click", async () => {
      toggle.toggleClass("is-enabled", !pkg.enabled);
      try {
        await this.plugin.bibleManager.setEnabled(pkg.name, !pkg.enabled);
        new Notice(pkg.enabled ? `Turned ${name} off (still installed)` : `Turned ${name} on`);
      } catch (error) {
        new Notice(`Couldn't turn ${name} ${pkg.enabled ? "off" : "on"}: ${errorText(error)}`);
      }
      this.redraw("library", "bibles");
    });
    const keepsFolder = pkg.path && !pkg.dir.split("/").includes("imports");
    removeButton(control, keepsFolder ? "Remove from logoxide.toml (its folder stays)" : `Remove ${pkg.info?.abbreviation ?? pkg.id}`, async () => {
      try {
        await this.plugin.bibleManager.remove(pkg.id);
        new Notice(`Removed ${pkg.info?.abbreviation ?? pkg.id}`);
      } catch (error) {
        new Notice(`Couldn't remove ${pkg.id}: ${errorText(error)}`);
      }
      this.redraw("library", "bibles");
    });
    return row;
  }

  private packageTitle(el: HTMLElement, pkg: InstalledPackage): void {
    const info = pkg.info;
    const title = el.createDiv("setting-item-name topos-package-title");
    title.createSpan({ cls: "topos-package-name", text: info?.name ?? pkg.id });
    if (info?.abbreviation) badge(title, info.abbreviation, "is-code");
    badge(title, pkg.version, "is-version");
    if (info && info.kind !== PackageKind.Bible) badge(title, kindName(info.kind), "is-kind");
    if (pkg.path) badge(title, pkg.dir.includes("/imports/") ? "import" : "path");
    if (!pkg.enabled) badge(title, "off", "is-off");
    const meta = el.createDiv("setting-item-description topos-package-meta");
    if (pkg.problem) {
      meta.addClass("is-problem");
      setIcon(meta.createSpan("topos-meta-icon"), "alert-triangle");
      meta.createSpan({ text: pkg.problem });
      return;
    }
    meta.createSpan({ text: info?.license === "LicenseRef-PublicDomain" ? "public domain" : (info?.license ?? "no license given") });
    meta.createSpan({ cls: "topos-dot", text: "·" });
    meta.createEl("code", { text: pkg.dir });
  }

  /** Where packages are kept, and recordings downloaded on this device */
  private storageSettings(el: HTMLElement): void {
    const settings = this.plugin.settings;
    const storage = section(el, "Storage").items;
    new Setting(storage)
      .setName("Packages folder")
      .setDesc(
        md(
          "Each Bible book shows here as a stub (`<package>/<title>.bible`), which opens the book and which links and annotations point at, so updates don't move them; book packages' EPUBs too. `logoxide.toml` and `logoxide.lock` are here unless they're at the vault's root. Renaming it moves the folder and updates links to it.",
        ),
      )
      .addText((t) => {
        t.inputEl.addClass("topos-code-input");
        t.setPlaceholder("Logoxide").setValue(settings.logoxideBooks);
        // Moved when the field is left (not as each letter is typed)
        t.inputEl.addEventListener("change", () => void this.moveBooks(t.getValue()));
      });
    new Setting(storage)
      .setName("Library folder")
      .setDesc(
        md(
          "Where packages are installed (`packages/<id>/<version>/`). A folder whose name starts with a dot is hidden and isn't synced: each device installs what `logoxide.lock` pins, by itself. Renaming it moves what's installed.",
        ),
      )
      .addText((t) => {
        t.inputEl.addClass("topos-code-input");
        t.setPlaceholder(".logoxide").setValue(settings.logoxideLibrary);
        t.inputEl.addEventListener("change", () => void this.moveLibrary(t.getValue()));
      });
    new Setting(storage)
      .setName("Hide the packages folder")
      .setDesc("Leave it out of the file explorer, and out of Obsidian's search, quick switcher, and graph (as an excluded file). Bibles and books still open from references, and verse search still reads them.")
      .addToggle((t) =>
        t.setValue(settings.hideLogoxideBooks).onChange(async (value) => {
          settings.hideLogoxideBooks = value;
          await this.plugin.saveToposSettings();
          this.plugin.applyLogoxideHiding();
        }),
      );
    const downloaded = new Setting(storage)
      .setName("Downloaded recordings")
      .setDesc("Recordings are downloaded the first time they're played, and kept in the library folder on this device (not synced).");
    void this.plugin.media.downloaded().then(({ count, bytes }) => {
      if (count === 0) return;
      downloaded.setDesc(
        md(`${count} recording${count === 1 ? "" : "s"} (${formatSize(bytes)}) kept in \`${this.plugin.media.dir()}\` on this device (not synced). Each is downloaded again when it's next played.`),
      );
      downloaded.addButton((b) =>
        b
          .setButtonText("Remove")
          .setWarning()
          .onClick(async () => {
            await this.plugin.media.clear();
            this.redraw("library");
          }),
      );
    });
  }

  /** Moves the packages folder (links to its files are updated) and reads the packages again */
  private async moveBooks(value: string): Promise<void> {
    const packages = this.plugin.packages;
    const from = packages.booksDir();
    this.plugin.settings.logoxideBooks = value;
    const to = packages.booksDir();
    if (from !== to) {
      const folder = this.app.vault.getFolderByPath(from);
      try {
        if (folder && !this.app.vault.getAbstractFileByPath(to)) await this.app.fileManager.renameFile(folder, to);
      } catch (error) {
        new Notice(`Couldn't move ${from} to ${to}: ${errorText(error)}`);
      }
    }
    await this.plugin.saveData(this.plugin.settings);
    this.plugin.applyLogoxideHiding();
    await packages.load();
    this.redraw("library", "bibles");
  }

  /** Moves the library (what's installed) and reads the packages again */
  private async moveLibrary(value: string): Promise<void> {
    const packages = this.plugin.packages;
    const adapter = this.app.vault.adapter;
    const from = packages.libraryDir();
    this.plugin.settings.logoxideLibrary = value;
    const to = packages.libraryDir();
    if (from !== to && (await adapter.exists(from)) && !(await adapter.exists(to))) {
      try {
        await mkdirs(this.plugin, to.slice(0, Math.max(0, to.lastIndexOf("/"))));
        await adapter.rename(from, to);
      } catch (error) {
        new Notice(`Couldn't move ${from} to ${to}: ${errorText(error)}`);
      }
    }
    await this.plugin.saveData(this.plugin.settings);
    await packages.load();
    this.redraw("library", "bibles");
  }

  // ─── Add Bibles ──────────────────────────────────────────────────────────

  private addTab(el: HTMLElement): void {
    const installed = () => this.redraw("library", "bibles");
    lead(el, "Search eBible.org's and fetch.bible's 2,000+ translations, CCEL's Bibles, CrossWire's SWORD Bibles and commentaries, and the registries and catalogs below. Select a result for its details.");
    new CatalogBrowser(this.plugin, section(el, "Search the catalogs"), installed).render();
    gitForm(section(el, "From a git repository").items, this.plugin, installed);
    void this.sourceSettings(el.createDiv("topos-sources"));
  }

  /** The registries and catalogs the browser searches: each with buttons to browse or remove it, and forms to add one */
  private async sourceSettings(el: HTMLElement): Promise<void> {
    const manager = this.plugin.bibleManager;
    const failed = (what: string, error: unknown) => new Notice(`${what}: ${errorText(error)}`, 10000);
    let registries: { name: string; location: string }[];
    let catalogs: { location: string; isDefault: boolean }[];
    try {
      [registries, catalogs] = await Promise.all([manager.registryList(), manager.catalogList()]);
    } catch (error) {
      section(el).items.createDiv({ cls: "setting-item mod-empty-state topos-list-empty is-error", text: `The vault's registries and catalogs couldn't be read: ${errorText(error)}` });
      return;
    }
    const redrawBrowser = () => this.redraw("add");

    const registryList = section(el, "Registries", "Catalogs with a name, searched first: `lx add <name>:<id>` adds their packages too.");
    filteredList(registryList, registries, {
      key: "registries",
      placeholder: "Filter registries",
      noun: ["registry", "registries"],
      empty: "No registries yet. `lx registry init` makes one, and prints its catalog's URL.",
      text: (r) => `${r.name} ${r.location}`,
      render: ({ name, location }, items) => {
        const readable = /^https?:\/\//.test(location) || location.endsWith(".toml");
        const setting = new Setting(items).setName(name).setDesc(md(readable ? `\`${location}\`` : `\`${location}\` (a folder of repositories: only \`lx\` reads it)`));
        setting.addExtraButton((b) =>
          b
            .setIcon("search")
            .setTooltip("Browse its packages")
            .onClick(() => {
              CatalogBrowser.showSource(`registry:${name}`);
              redrawBrowser();
              this.panel("add").scrollIntoView({ block: "start" });
            }),
        );
        removeButton(setting.controlEl, `Remove ${name}`, async () => {
          try {
            await manager.removeRegistry(name);
          } catch (error) {
            failed(`Couldn't remove ${name}`, error);
          }
          redrawBrowser();
        });
        return setting.settingEl;
      },
    });
    this.addForm(
      registryList.group.createDiv("setting-items"),
      "Add a registry",
      [{ placeholder: "name", cls: "is-short" }, { placeholder: "https://github.com/owner/repo/releases/download/index/catalog.toml" }],
      "Its `catalog.toml`'s URL (`lx registry init` prints it), or a file's path relative to `logoxide.toml`.",
      async ([name, location]) => {
        if (!name || !location) throw new Error("give it a name and a URL");
        const count = await manager.addRegistry(name, location);
        new Notice(`Added ${name}: ${count} package${count === 1 ? "" : "s"}`);
        redrawBrowser();
      },
    );

    const catalogList = section(el, "Catalogs", "Lists of packages to search. Downloaded catalogs are kept a day.");
    catalogList.heading?.addExtraButton((b) =>
      b
        .setIcon("refresh-cw")
        .setTooltip("Download the catalogs and registries again")
        .onClick(async () => {
          await manager.refreshCatalogs();
          new Notice("Catalogs will be downloaded again");
          redrawBrowser();
        }),
    );
    filteredList(catalogList, catalogs, {
      key: "catalogs",
      placeholder: "Filter catalogs",
      noun: ["catalog", "catalogs"],
      empty: "No catalogs: only registries are searched.",
      text: (c) => c.location,
      render: ({ location, isDefault }, items) => {
        const setting = new Setting(items).setName(md(`\`${location}\``)).setDesc(isDefault ? "One of the defaults (removing it keeps the others)" : md("Added in `logoxide.toml`"));
        setting.settingEl.addClass("topos-catalog");
        if (isDefault) badge(setting.nameEl, "default");
        removeButton(setting.controlEl, "Stop searching it", async () => {
          try {
            await manager.removeCatalog(location);
          } catch (error) {
            failed(`Couldn't remove ${location}`, error);
          }
          redrawBrowser();
        });
        return setting.settingEl;
      },
    });
    this.addForm(
      catalogList.group.createDiv("setting-items"),
      "Add a catalog",
      [{ placeholder: "https://example.org/catalog.toml" }],
      "A `catalog.toml`'s URL (anyone can host one), eBible.org's `translations.csv`, fetch.bible's `manifest.json`, a SWORD repository's `mods.d.tar.gz`, or a file's path relative to `logoxide.toml`.",
      async ([location]) => {
        if (!location) throw new Error("give its URL");
        const count = await manager.addCatalog(location);
        new Notice(`Added ${location}: ${count} package${count === 1 ? "" : "s"}`);
        redrawBrowser();
      },
    );
  }

  /** A row of a card with fields and an Add button, and a hint under them */
  private addForm(
    items: HTMLElement,
    label: string,
    fields: { placeholder: string; cls?: string }[],
    hint: string,
    add: (values: string[]) => Promise<void>,
  ): void {
    const row = items.createDiv("setting-item topos-add-row");
    const info = row.createDiv("setting-item-info");
    info.createDiv({ cls: "setting-item-name", text: label });
    info.createDiv("setting-item-description").append(md(hint));
    const form = info.createDiv("topos-inline-form");
    const inputs = fields.map((f) => form.createEl("input", { cls: f.cls ?? "", attr: { type: "text", placeholder: f.placeholder, spellcheck: "false" } }));
    const button = form.createEl("button", { text: "Add" });
    const submit = async () => {
      button.disabled = true;
      button.setText("Adding…");
      try {
        await add(inputs.map((i) => i.value.trim()));
      } catch (error) {
        new Notice(`Couldn't add it: ${errorText(error)}`, 10000);
        button.disabled = false;
        button.setText("Add");
      }
    };
    button.addEventListener("click", () => void submit());
    for (const input of inputs) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void submit();
      });
    }
  }

  // ─── References ──────────────────────────────────────────────────────────

  private referencesTab(el: HTMLElement): void {
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveToposSettings();
    lead(el, "How references are written, where they link to, and how they look and behave in notes.");
    this.formatSettings(el.createDiv());
    this.links(el.createDiv());

    const notes = section(el, "In notes").items;
    new Setting(notes)
      .setName("Link references in the editor")
      .setDesc("Highlight references while editing, and open their links when clicked.")
      .addToggle((t) =>
        t.setValue(settings.linkInEditor).onChange((value) => {
          settings.linkInEditor = value;
          void save();
        }),
      );
    new Setting(notes).setName("Link references in reading view").addToggle((t) =>
      t.setValue(settings.linkInReading).onChange((value) => {
        settings.linkInReading = value;
        void save();
      }),
    );
    new Setting(notes)
      .setName("Require Ctrl/Cmd to open references")
      .setDesc("On desktop: plain clicks place the cursor (or do nothing in reading view); Ctrl/Cmd-click opens the reference.")
      .addToggle((t) =>
        t.setValue(settings.clickNeedsModifier).onChange((value) => {
          settings.clickNeedsModifier = value;
          void save();
        }),
      );
    new Setting(notes)
      .setName("Tap to open references in the editor")
      .setDesc(
        "On phones and tablets: the tap that would place the cursor and open the keyboard opens the reference's link instead. Once you're typing, taps move the cursor as usual. Taps outside the editor always open references.",
      )
      .addToggle((t) =>
        t.setValue(settings.tapOpensInEditor).onChange((value) => {
          settings.tapOpensInEditor = value;
          void save();
        }),
      );
    this.referenceColor(notes);
    new Setting(notes)
      .setName("Mark references in other documents")
      .setDesc(md("Find references in transcripts (Transcript++) and other file-plus-plus documents as they open, and mark them like references in notes. EPUBs follow *Search → Search EPUB files*."))
      .addToggle((t) =>
        t.setValue(settings.markInDocuments).onChange((value) => {
          settings.markInDocuments = value;
          void save();
        }),
      );

    const complete = section(el, "Autocomplete").items;
    new Setting(complete)
      .setName("Suggest references while typing")
      .setDesc("After a book name, suggest chapters, then verses, then range ends.")
      .addToggle((t) =>
        t.setValue(settings.autocomplete).onChange((value) => {
          settings.autocomplete = value;
          void save();
        }),
      );
    new Setting(complete)
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
    new Setting(complete).setName("Number of suggestions").addSlider((s) =>
      s
        .setLimits(5, 100, 5)
        .setValue(settings.suggestionLimit)
        .setDynamicTooltip()
        .onChange((value) => {
          settings.suggestionLimit = value;
          void save();
        }),
    );
  }

  /** The references' color: the accent color until one is picked */
  private referenceColor(items: HTMLElement): void {
    const settings = this.plugin.settings;
    const setting = new Setting(items).setName("Reference color");
    const draw = () => {
      setting.controlEl.empty();
      setting.setDesc(
        settings.referenceColor
          ? "The glow, dashed underline, and hover highlight of references."
          : "The glow, dashed underline, and hover highlight of references. Your accent color until you pick one.",
      );
      setting
        .addExtraButton((b) =>
          b
            .setIcon("rotate-ccw")
            .setTooltip("Use the accent color")
            .onClick(() => {
              settings.referenceColor = "";
              void this.plugin.saveToposSettings();
              draw();
            }),
        )
        .addColorPicker((c) =>
          c.setValue(settings.referenceColor || accentColor(items)).onChange((value) => {
            settings.referenceColor = value;
            void this.plugin.saveToposSettings();
          }),
        );
    };
    draw();
  }

  /** Where references open: a site, a template of your own, or nowhere */
  private links(box: HTMLElement): void {
    const settings = this.plugin.settings;
    const choice = (template: string) => (!template.trim() ? "none" : (SITES.find((site) => site.template === template)?.id ?? "custom"));
    box.empty();
    const items = section(box, "Links").items;
    let sites: DropdownComponent | undefined;
    new Setting(items)
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
          this.links(box);
        });
      });
    if (!settings.linkTemplate.trim()) return;
    const template = new Setting(items).setName("Link template").setClass("topos-tall-setting");
    const preview = () => {
      const error = templateError(settings.linkTemplate);
      const examples = ["John 3:16-18", "Psalm 23"].map((reference) => {
        const passage = this.plugin.topos.parse(reference, BookStyle.Name);
        return (passage && linkUrl(settings.linkTemplate, passage)) ?? `no link for ${reference}`;
      });
      template.setDesc(error ? `Can't be used: ${error}` : md(`Preview: ${examples.map((e) => `\`${e}\``).join("   ")}`));
      template.descEl.toggleClass("topos-query-error", error !== null);
    };
    let input: HTMLInputElement | undefined;
    template.addText((t) => {
      input = t.inputEl;
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
    // What a template can hold: each placeholder inserts itself where the cursor was
    const help = template.settingEl.createEl("details", { cls: "topos-help" });
    help.createEl("summary", { text: "Placeholders and filters" });
    help
      .createEl("p")
      .append(
        md(
          `Select one to insert it. Filters change a value: \`{book|lower|kebab}\` (${Object.keys(FILTERS)
            .map((f) => `\`${f}\``)
            .join(", ")}). A part in \`[ ]\` is left out when a placeholder in it has no value, like \`{verse}\` for a whole chapter.`,
        ),
      );
    const list = help.createDiv("topos-placeholder-list");
    for (const [name, what] of Object.entries(PLACEHOLDERS)) {
      const row = list.createEl("button", { cls: "topos-placeholder", attr: { type: "button" } });
      row.createEl("code", { text: `{${name}}` });
      row.createSpan({ text: what });
      row.addEventListener("click", () => {
        if (!input) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        input.setRangeText(`{${name}}`, start, end, "end");
        input.dispatchEvent(new Event("input"));
        input.focus();
      });
    }
  }

  /**
   * How references are written (the CLI's --psg-fmt fields), with a preview: completions, the
   * sidebar, the dialogs, and "Normalize references" all use it
   */
  private formatSettings(box: HTMLElement): void {
    const { settings } = this.plugin;
    const format = settings.format;
    box.empty();
    const writing = section(box, "Writing references", "How completions, normalized references (the *Normalize references* command), and search results are written.");
    writing.heading?.addExtraButton((b) =>
      b
        .setIcon("rotate-ccw")
        .setTooltip("Reset the format")
        .onClick(() => {
          settings.format = { ...DEFAULT_FORMAT };
          void this.plugin.saveToposSettings();
          this.formatSettings(box);
        }),
    );
    const items = writing.items;
    const previewSetting = new Setting(items).setName("Format preview").setClass("topos-format-preview");
    const preview = () => {
      const topos = this.plugin.topos;
      const style = bookStyle(settings.style);
      const samples = ["John 3:16,17,18; 4:1-5:3", "Jude 5"]
        .map((text) => topos.parse(text, BookStyle.Name))
        .filter((passage) => passage !== null)
        .map((passage) => written(topos, passage, style, format));
      previewSetting.setDesc(md(samples.map((s) => `\`${s}\``).join("   ")));
    };
    const save = () => {
      void this.plugin.saveToposSettings();
      preview();
    };
    new Setting(items).setName("Book names").addDropdown((d) =>
      d
        .addOptions({
          name: "Full name (John 3:16)",
          abbreviation: "Abbreviation (Jn 3:16)",
          osis: "OSIS (John.3.16)",
        })
        .setValue(settings.style)
        .onChange((value) => {
          settings.style = value as StyleName;
          save();
        }),
    );
    const texts: [keyof FormatSettings, string, string][] = [
      ["bookSeparator", "Between the book and chapter", "John␣3:16"],
      ["chapterVerse", "Between chapter and verse", "3:16"],
      ["range", "Range", "3:16-18"],
      ["verseSeparator", "Between verses in a chapter", "3:16,18"],
      ["chapterSeparator", "Between chapters", "3:16; 4:1"],
    ];
    for (const [key, name, example] of texts) {
      new Setting(items)
        .setName(name)
        .setDesc(md(`\`${example}\``))
        .addText((t) => {
          t.inputEl.addClass("topos-separator-input");
          t.setPlaceholder(JSON.stringify(DEFAULT_FORMAT[key]))
            .setValue(String(format[key]))
            .onChange((value) => {
              // Separators can be spaces, so only an empty field means the default
              (format[key] as string) = value === "" ? (DEFAULT_FORMAT[key] as string) : value;
              save();
            });
        });
    }
    const toggles: [keyof FormatSettings, string, string, string][] = [
      ["joinAdjacent", "Join adjacent verses", "3:16-18", "3:16,17,18"],
      ["omitFirstVerseOfChapterRange", "Leave out the first verse of chapter ranges", "1-2:3", "1:1-2:3"],
      ["chapterInSingleChapterBooks", "Chapter in single-chapter books", "Jude 1:5", "Jude 5"],
    ];
    for (const [key, name, on, off] of toggles) {
      new Setting(items)
        .setName(name)
        .setDesc(md(`\`${on}\`, not \`${off}\``))
        .addToggle((t) =>
          t.setValue(format[key] as boolean).onChange((value) => {
            (format[key] as boolean) = value;
            save();
          }),
        );
    }
    preview();
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  private searchTab(el: HTMLElement): void {
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveToposSettings();
    lead(el, "Which files are searched for references, how, and the searches saved for the sidebar.");

    const files = section(el, "What's searched").items;
    new Setting(files)
      .setName("File extensions")
      .setDesc(md("Files to search, separated by commas: `md, txt, srt`."))
      .addText((t) => {
        t.inputEl.addClass("topos-code-input");
        t.setValue(settings.extensions).onChange((value) => {
          settings.extensions = value;
          void save().then(() => this.plugin.reindexSoon());
        });
      });
    new Setting(files)
      .setName("Excluded folders")
      .setDesc("One folder per line.")
      .setClass("topos-tall-setting")
      .addTextArea((t) => {
        t.inputEl.rows = 3;
        t.inputEl.addClass("topos-code-input");
        t.setPlaceholder("Templates\nArchive")
          .setValue(settings.excludeFolders)
          .onChange((value) => {
            settings.excludeFolders = value;
            void save().then(() => this.plugin.reindexSoon());
          });
      });
    let onMobile: Setting | null = null;
    new Setting(files)
      .setName("Search EPUB files")
      .setDesc(
        `Find references in EPUBs too. With the EPUB++ plugin, which opens EPUBs in Obsidian, their references show in the book, with a sidebar tab to step through them and save one as a highlight, and results open in the book.${this.plugin.epubs.api ? "" : " (EPUB++ isn't enabled.)"}`,
      )
      .addToggle((t) =>
        t.setValue(settings.searchEpubs).onChange((value) => {
          settings.searchEpubs = value;
          void save().then(() => this.plugin.epubs.toggled());
          onMobile?.settingEl.toggleClass("topos-hidden", !value);
        }),
      );
    if (!Platform.isDesktopApp) {
      onMobile = new Setting(files)
        .setClass("topos-subsetting")
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
      onMobile.settingEl.toggleClass("topos-hidden", !settings.searchEpubs);
    }

    const index = section(el, "Index").items;
    new Setting(index)
      .setName("Reference index")
      .setDesc(
        `${this.plugin.refs.referenceCount.toLocaleString()} references in ${this.plugin.refs.fileCount.toLocaleString()} files. The index is kept in the plugin's folder and syncs with your settings, so each file is searched once (on any device). Rebuilding searches every file again.`,
      )
      .addButton((b) =>
        b.setButtonText("Rebuild").onClick(async () => {
          b.setDisabled(true).setButtonText("Rebuilding…");
          await this.plugin.reindex(true);
          this.redraw("search");
        }),
      );
    if (Platform.isDesktopApp) this.engineSettings(index.createDiv("topos-setting-block"));

    this.savedSearches(el.createDiv());
  }

  /** The built-in engine or the topos CLI (desktop only) */
  private engineSettings(box: HTMLElement): void {
    const settings = this.plugin.settings;
    const save = () => this.plugin.saveToposSettings();
    box.empty();
    new Setting(box)
      .setName("Search engine")
      .setDesc(
        md(
          "*Built in* searches in a background thread, everywhere. *topos CLI* runs the native command-line tool, which is much faster for many files and EPUBs (install it with `cargo install topos-bible-cli`). Either way, only new and changed files are searched; edits are always searched by the built-in engine.",
        ),
      )
      .addDropdown((d) =>
        d
          .addOptions({ builtin: "Built in", cli: "topos CLI" })
          .setValue(settings.engine)
          .onChange((value) => {
            settings.engine = value as "builtin" | "cli";
            void save().then(() => this.plugin.indexer.resetCli());
            this.engineSettings(box);
          }),
      );
    if (settings.engine !== "cli") return;
    const command = new Setting(box)
      .setClass("topos-subsetting")
      .setName("topos command")
      .setDesc(md("Leave empty to use `~/.cargo/bin/topos`, or `topos` from `PATH`."))
      .addText((t) => {
        t.inputEl.addClass("topos-code-input");
        t.setPlaceholder(this.plugin.cliPath())
          .setValue(settings.cliPath)
          .onChange((value) => {
            settings.cliPath = value.trim();
            void save();
          });
      });
    command.addButton((b) =>
      b.setButtonText("Test").onClick(async () => {
        setMd(command.descEl, await this.plugin.testCli());
      }),
    );
    new Setting(box)
      .setClass("topos-subsetting")
      .setName("Cache CLI results")
      .setDesc(md("Reuse results for files that have not changed since the last run (`topos --cache`)."))
      .addToggle((t) =>
        t.setValue(settings.cliCache).onChange((value) => {
          settings.cliCache = value;
          void save();
        }),
      );
  }

  /** Each saved search is a name and the CLI's filter options, editable here */
  private savedSearches(box: HTMLElement): void {
    const { settings } = this.plugin;
    const persist = () => {
      void this.plugin.saveData(settings).then(() => this.plugin.search.set({}));
    };
    box.empty();
    const saved = section(box, "Saved searches");
    saved.heading?.addButton((b) =>
      b.setButtonText("Add a search").onClick(() => {
        settings.queries.push({ name: `Search ${settings.queries.length + 1}`, query: "" });
        persist();
        this.savedSearches(box);
      }),
    );
    const help = saved.heading?.infoEl.createEl("details", { cls: "topos-help" });
    help?.createEl("summary", { text: "How to write a search" });
    help
      ?.createEl("p")
      .append(
        md(
          'Filters are written like the topos CLI\'s options, after any folders or files to search: `Sermons --nt -g "Pauline Epistles" -b John --exclude-book Philemon -i "Romans 8" -o "John 1" --exclude-overlap "Psalm 23"`. `-o` is explicit overlap; `--any-overlap` counts whole chapters too, and `--exact-overlap` means exactly that passage. `--glob`, `--iglob` (a `!` before the glob leaves its files out), and `--path-regex` pick files by path. Save the sidebar\'s filters with its *Save* button, or add one here.',
        ),
      );
    filteredList(saved, settings.queries, {
      key: "queries",
      placeholder: "Filter saved searches",
      noun: ["search", "searches"],
      empty: "No saved searches yet: save the sidebar's filters with its *Save* button, or add one here.",
      text: (q) => `${q.name} ${q.query}`,
      render: (query, items) => {
        const setting = new Setting(items).setClass("topos-saved-search");
        const showErrors = () => {
          const { errors } = parseQuery(query.query);
          setting.setDesc(errors.join("; "));
          setting.descEl.toggleClass("topos-query-error", errors.length > 0);
        };
        setting
          .addText((t) => {
            t.inputEl.addClass("topos-saved-search-name");
            t.setPlaceholder("Name")
              .setValue(query.name)
              .onChange((value) => {
                query.name = value;
                persist();
              });
          })
          .addText((t) => {
            t.inputEl.addClass("topos-query-input");
            t.setPlaceholder('--nt -g "Pauline Epistles"')
              .setValue(query.query)
              .onChange((value) => {
                query.query = value;
                showErrors();
                persist();
              });
          })
          .addExtraButton((b) =>
            b
              .setIcon("search")
              .setTooltip("Show in the sidebar")
              .onClick(() => void this.plugin.openQuery(query)),
          )
          .addExtraButton((b) =>
            b
              .setIcon("trash-2")
              .setTooltip("Delete")
              .onClick(() => {
                settings.queries.splice(settings.queries.indexOf(query), 1);
                persist();
                this.savedSearches(box);
              }),
          );
        showErrors();
        return setting.settingEl;
      },
    });
  }
}

/** Literals in file-plus-plus's descriptions (`{{text}}`, `"&color=<name>"`, `[[Wikilinks]]`, `v=3:16-18`) shown as code, like these settings' */
function codeLiterals(el: HTMLElement): void {
  const literal = /\{\{\w+\}\}|"[^"]*[&<>=[\]{}][^"]*"|\[\[\w+\]\]|\bv=[\d:-]+/g;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement?.closest("code")) texts.push(node as Text);
  for (const text of texts) {
    const value = text.data;
    if (!literal.test(value)) continue;
    literal.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const match of value.matchAll(literal)) {
      fragment.append(value.slice(at, match.index));
      const code = document.createElement("code");
      code.textContent = match[0].replace(/^"|"$/g, "");
      fragment.append(code);
      at = match.index + match[0].length;
    }
    fragment.append(value.slice(at));
    text.replaceWith(fragment);
  }
}

/** The theme's accent color as `#rrggbb` (what the color picker takes) */
function accentColor(el: HTMLElement): string {
  return themeColor(el, "--text-accent");
}

/** A theme color (a CSS variable) as `#rrggbb` */
function themeColor(el: HTMLElement, variable: string): string {
  try {
    const probe = el.createDiv();
    probe.style.color = `var(${variable})`;
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
