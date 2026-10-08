import { ItemView, type HoverPopover, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type ToposPlugin from "../main.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { DEFAULT_LOOK, PaneApp, type PaneHost, type PaneLook } from "./PaneApp.tsx";
import { keepScroll, newTabLeaf, viewHost } from "./SearchPane.tsx";

export const SEARCH_VIEW = "topos-bible-search";

/**
 * Verse search in the sidebar: the search tab's app, narrow (the filters and display options fold
 * away), on the plugin's own search (`plugin.search`, which commands and menus set)
 */
export class SearchView extends ItemView {
  private readonly plugin: ToposPlugin;
  private root: Root | null = null;
  private look: PaneLook = { ...DEFAULT_LOOK };
  /** Hover previews of references in results belong to this view */
  hoverPopover: HoverPopover | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ToposPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.look.style = plugin.settings.style;
  }

  getViewType(): string {
    return SEARCH_VIEW;
  }

  getDisplayText(): string {
    return "Verse search";
  }

  getIcon(): string {
    return "book-open";
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), look: this.look };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved = (state ?? {}) as { look?: Partial<PaneLook> };
    if (saved.look) this.look = { ...this.look, ...saved.look };
    await super.setState(state, result);
    this.render();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("topos-pane-view", "topos-sidebar-view");
    keepScroll(this);
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
            key={JSON.stringify(this.look)}
            plugin={this.plugin}
            store={this.plugin.search}
            host={this.host}
            look={this.look}
            onLook={(look) => {
              this.look = look;
              this.app.workspace.requestSaveLayout();
            }}
            onOpenTab={() => void this.plugin.openSearchPane(this.plugin.search.get(), true)}
          />
        </ErrorBoundary>
      </StrictMode>,
    );
  }

  /** Results open in the main area: the current tab, or a new one */
  private readonly host: PaneHost = viewHost(this, () => this.plugin, (hit, newTab) =>
    void this.plugin.openHit(hit, newTab ? newTabLeaf(this.app.workspace) : undefined),
  );
}
