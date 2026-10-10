import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import { strongsAt } from "../core/strongs.ts";
import type ToposPlugin from "../main.ts";
import { renderEntries } from "../bible/strongs.ts";

/**
 * A Strong's number in a note (`G25`, `H430`, `G0025`) shows its entries from the vault's
 * dictionaries on hover, while the `strongsHover` setting is on and the vault has a Strong's
 * dictionary. The cursor's number also follows (`ToposPlugin.followCursor`)
 */
export function strongsHover(plugin: ToposPlugin) {
  return [
    hoverTooltip((view, pos): Tooltip | null => {
      if (!plugin.settings.strongsHover || !plugin.packages.hasStrongs()) return null;
      const line = view.state.doc.lineAt(pos);
      const found = strongsAt(line.text, pos - line.from);
      if (!found) return null;
      return {
        pos: line.from + found.start,
        end: line.from + found.end,
        above: true,
        create: () => {
          const dom = createDiv({ cls: "topos-strongs-tooltip", text: "…" });
          void plugin.packages.entries(found.key, { notes: false, headings: false, classPrefix: "topos-" }).then((entries) => renderEntries(dom, found.key, entries));
          return { dom };
        },
      };
    }),
    // The commentary view follows the reference under the cursor
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) plugin.followCursor(update.view);
    }),
  ];
}
