import { FPP_API_READY, FPP_API_UNLOAD, fileApis, type FileApi } from "file-plus-plus/obsidian";
import type { TFile } from "obsidian";
import { OffsetUnit, type Passage } from "topos-bible";
import { written } from "../core/references.ts";
import { bookStyle } from "../core/settings.ts";
import { EPUB_PLUGIN_ID } from "../epub/api.ts";
import type ToposPlugin from "../main.ts";
import { PROVIDER_ID, referenceProvider } from "./provider.ts";

/**
 * Bible references in the documents of every file-plus-plus plugin (Transcript++'s transcripts, this
 * plugin's own Bible tab, and any later one): when a document opens, its text (the format's
 * `extractText`) is searched and the references are handed back as annotations, drawn like those in
 * notes and previewing the passage on hover. EPUBs go through `EpubSupport` instead, from the index.
 */
export class DocumentSupport {
  private readonly connected = new Map<FileApi, () => void>();

  constructor(private readonly plugin: ToposPlugin) {}

  start(): void {
    const { workspace } = this.plugin.app;
    const on = workspace.on.bind(workspace) as unknown as (name: string, cb: (api: FileApi) => void) => ReturnType<typeof workspace.on>;
    this.plugin.registerEvent(on(FPP_API_READY, (api) => this.connect(api)));
    this.plugin.registerEvent(on(FPP_API_UNLOAD, (api) => this.connected.delete(api)));
    for (const api of fileApis(this.plugin.app)) this.connect(api);
    // This plugin's own API (the Bible tab) isn't in the list while it is loading
    if (this.plugin.api) this.connect(this.plugin.api);
  }

  stop(): void {
    for (const unregister of this.connected.values()) unregister();
    this.connected.clear();
  }

  /** Redraws the references in open documents */
  refresh(): void {
    for (const api of this.connected.keys()) api.refreshAnnotations(PROVIDER_ID);
  }

  private connect(api: FileApi): void {
    if (this.connected.has(api) || api.pluginId === EPUB_PLUGIN_ID) return;
    const plugin = this.plugin;
    const annotations = async (file: TFile) => {
      if (!plugin.settings.markInDocuments) return [];
      const text = await api.extractText(file).catch(() => null);
      if (!text) return [];
      const style = bookStyle(plugin.settings.style);
      return text.sections.flatMap((section) =>
        plugin.topos.search(section.text, OffsetUnit.Utf16).flatMap((m) => {
          const locator = text.locator(section.index, m.start, m.end);
          if (!locator) return [];
          const label = written(plugin.topos, m.passage, style, plugin.settings.format);
          return [{ id: `${section.index}:${m.start}`, locator, label, data: m.passage }];
        }),
      );
    };
    this.connected.set(api, api.registerAnnotationProvider<Passage>(referenceProvider<Passage>(plugin, annotations, (a) => a.data as Passage)));
  }
}
