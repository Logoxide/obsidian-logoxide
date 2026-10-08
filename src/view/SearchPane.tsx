import { Component, ItemView, MarkdownRenderer, Platform, setIcon, type HoverPopover, type ViewStateResult, type Workspace, type WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Passage } from "topos-bible";
import type { Hit } from "../core/search.ts";
import { linkElement } from "../reading.ts";
import type ToposPlugin from "../main.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { DEFAULT_LOOK, PaneApp, type PaneHost, type PaneLook } from "./PaneApp.tsx";
import { SearchStore, type SearchState } from "./store.ts";

export const SEARCH_PANE_VIEW = "topos-bible-search-pane";

/** What a search tab saves with the workspace */
interface PaneState {
  search?: Partial<SearchState>;
  look?: Partial<PaneLook>;
}

/** Verse search in a tab: the sidebar's search with room for file types and previews */
export class SearchPane extends ItemView {
  private readonly plugin: ToposPlugin;
  private root: Root | null = null;
  readonly store = new SearchStore({ context: 1 });
  private look: PaneLook = { ...DEFAULT_LOOK };
  /** Hover previews of references in results belong to this view */
  hoverPopover: HoverPopover | null = null;
  /** Where results open, beside this tab, once one has opened */
  private target: WorkspaceLeaf | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ToposPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.look.style = plugin.settings.style;
    this.store.subscribe(() => this.app.workspace.requestSaveLayout());
  }

  getViewType(): string {
    return SEARCH_PANE_VIEW;
  }

  getDisplayText(): string {
    return "Verse search";
  }

  getIcon(): string {
    return "book-open";
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), search: this.store.get(), look: this.look } satisfies PaneState;
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved = (state ?? {}) as PaneState;
    if (saved.search) this.store.set(saved.search);
    if (saved.look) this.look = { ...this.look, ...saved.look };
    await super.setState(state, result);
    this.render();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("topos-pane-view");
    this.root = createRoot(this.contentEl);
    this.render();
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  private render(): void {
    this.root?.render(
      <StrictMode>
        <ErrorBoundary>
          <PaneApp
            // A new look (restored with the workspace) starts the app again with it
            key={JSON.stringify(this.look)}
            plugin={this.plugin}
            store={this.store}
            host={this.host}
            look={this.look}
            onLook={(look) => {
              this.look = look;
              this.app.workspace.requestSaveLayout();
            }}
          />
        </ErrorBoundary>
      </StrictMode>,
    );
  }

  /**
   * The leaf results open in: with `newTab`, a new tab; else the one they opened in before, if it's
   * still open, or a note's tab in another tab group, or a new split beside this tab (a new tab on
   * phones), so the results stay in view
   */
  private resultLeaf(newTab: boolean): WorkspaceLeaf {
    const { workspace } = this.app;
    if (newTab) return newTabLeaf(workspace);
    const open = (leaf: WorkspaceLeaf | null) => {
      let found = false;
      workspace.iterateAllLeaves((l) => {
        if (l === leaf) found = true;
      });
      return found;
    };
    if (this.target && this.target !== this.leaf && open(this.target)) return this.target;
    const group = this.leaf.parent;
    const others = workspace.getLeavesOfType("markdown").filter((leaf) => leaf.parent !== group && leaf.getRoot() === this.leaf.getRoot());
    const recent = others.sort((a, b) => activeTime(b) - activeTime(a))[0];
    this.target = recent ?? (Platform.isPhone ? newTabLeaf(workspace) : workspace.createLeafBySplit(this.leaf, "vertical"));
    return this.target;
  }

  private readonly host: PaneHost = {
    markdown: (el, markdown, sourcePath) => {
      const owner = this.addChild(new Component());
      const done = MarkdownRenderer.render(this.app, markdown, el, sourcePath, owner).then(() => {
        // References are linked even with linking in reading view turned off
        linkElement(this.plugin, el, owner, sourcePath);
      });
      return { done, unload: () => this.removeChild(owner) };
    },
    verses: (el: HTMLElement, passage: Passage, label: string) => {
      const owner = this.addChild(new Component());
      void this.plugin.embedPassage(el, passage, label, owner);
      return { unload: () => this.removeChild(owner) };
    },
    icon: (el, name) => setIcon(el, name),
    open: (hit: Hit, newTab: boolean) => void this.plugin.openHit(hit, this.resultLeaf(newTab)),
    openPassage: (passage: Passage, newTab: boolean) => void this.plugin.openPassage(passage, newTab ? "tab" : false),
    copy: (text) => void navigator.clipboard.writeText(text),
    folders: () =>
      this.app.vault
        .getAllFolders(false)
        .map((folder) => folder.path)
        .sort((a, b) => a.localeCompare(b)),
  };
}

/** When a leaf was last active (Obsidian keeps it, unofficially) */
function activeTime(leaf: WorkspaceLeaf): number {
  return (leaf as WorkspaceLeaf & { activeTime?: number }).activeTime ?? 0;
}

/** A new tab, or the current one where there's no tab group to add to (on mobile, with no tab open) */
export function newTabLeaf(workspace: Workspace): WorkspaceLeaf {
  try {
    return workspace.getLeaf("tab");
  } catch {
    return workspace.getLeaf(false);
  }
}
