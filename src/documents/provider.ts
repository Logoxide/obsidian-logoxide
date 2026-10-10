import { Platform, type Menu } from "obsidian";
import type { Annotation, AnnotationProvider } from "file-plus-plus/obsidian";
import type { Passage } from "logoxide";
import type ToposPlugin from "../main.ts";

export const PROVIDER_ID = "logoxide";

/**
 * Bible references as annotations of another plugin's documents (EPUB++'s books, Transcript++'s
 * transcripts, this plugin's own Bible tab): drawn like references in notes, previewing the passage
 * on hover, with menu items to open, find, and copy them. `annotations` finds them; `passageOf`
 * reads one's passage back.
 */
export function referenceProvider<T>(
  plugin: ToposPlugin,
  annotations: AnnotationProvider<T>["annotations"],
  passageOf: (annotation: Annotation<T>) => Passage,
): AnnotationProvider<T> {
  const color = () => {
    const body = activeDocument.body;
    const get = (name: string) => getComputedStyle(body).getPropertyValue(name).trim();
    return plugin.settings.referenceColor || get("--interactive-accent") || "#7c3aed";
  };
  return {
    id: PROVIDER_ID,
    name: "Bible references",
    noun: "Bible references",
    icon: "book-open",
    get color() {
      return color();
    },
    // Like references in notes: a soft glow and a dashed underline
    style: (c) =>
      `text-decoration: underline dashed 1.5px ${c}; text-underline-offset: 3px; text-shadow: 0 0 8px color-mix(in srgb, ${c} 55%, transparent);`,
    annotations,
    // Ctrl/Cmd-click or a middle click opens the reference (taps on mobile open the menu)
    onClick: (list, event) => {
      if (!Platform.isDesktop || !plugin.clickOpens(event, false)) return false;
      plugin.openReference(passageOf(list[0]!));
      return true;
    },
    menu: (menu: Menu, list) => {
      for (const a of list) {
        const passage = passageOf(a);
        const section = `topos-${a.id}`;
        if (plugin.bibles.current())
          menu.addItem((item) =>
            item
              .setTitle(`Open ${a.label} in the Bible`)
              .setIcon("book-open-text")
              .setSection(section)
              .onClick(() => void plugin.openPassage(passage, "tab")),
          );
        if (plugin.referenceUrl(passage))
          menu.addItem((item) =>
            item
              .setTitle(`Open ${a.label} in ${plugin.linkSite()}`)
              .setIcon("external-link")
              .setSection(section)
              .onClick(() => plugin.openReference(passage)),
          );
        menu.addItem((item) =>
          item
            .setTitle("Find references to these verses")
            .setIcon("search")
            .setSection(section)
            .onClick(() => void plugin.findInVault(passage)),
        );
        menu.addItem((item) =>
          item
            .setTitle(`Copy as OSIS (${passage.osis})`)
            .setIcon("copy")
            .setSection(section)
            .onClick(() => void plugin.copyText(passage.osis)),
        );
      }
    },
    // The passage's text from the Bible (else the tooltip below)
    preview: (a) => (plugin.settings.previewBare ? plugin.passageLink(passageOf(a)) : null),
    tooltip: (a) => {
      const site = plugin.referenceUrl(passageOf(a)) ? plugin.linkSite() : "";
      if (!site || !Platform.isDesktop) return a.label;
      return `${a.label}\n${plugin.settings.clickNeedsModifier ? "Ctrl/Cmd-click" : "Click"} to open in ${site}`;
    },
  };
}
