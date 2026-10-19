// The parts of Obsidian's runtime API that editor and reading-view code uses, for bundling it in
// tests (the obsidian package has types only). Live preview is on while `livePreview.on` is true.
import { StateField } from "@codemirror/state";

export const livePreview = { on: false };

/** A phone while `isMobile` is true */
export const Platform = { isMobile: false, isDesktop: true };

export const editorLivePreviewField = StateField.define<boolean>({
  create: () => livePreview.on,
  update: () => livePreview.on,
});

export class Component {
  private children: Component[] = [];
  private cleanups: (() => void)[] = [];
  load(): void {}
  unload(): void {
    for (const child of this.children) child.unload();
    for (const cleanup of this.cleanups) cleanup();
  }
  addChild<T extends Component>(child: T): T {
    this.children.push(child);
    child.load();
    return child;
  }
  register(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }
}

export class MarkdownRenderChild extends Component {
  constructor(readonly containerEl: HTMLElement) {
    super();
  }
}

export class MarkdownView {}
