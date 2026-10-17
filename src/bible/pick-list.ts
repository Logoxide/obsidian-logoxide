import { Platform, setIcon } from "obsidian";
import { moveTo, pickOrder } from "../core/pick.ts";

/** One of a pick list's choices */
export interface PickItem {
  id: string;
  label: string;
  /** Shown faded after the label (a full name, a folder), and searched too */
  detail?: string;
}

/** What a pick list does with the choices */
export interface PickListOptions {
  items: PickItem[];
  /** The ids picked, in order */
  picked: string[];
  /** Called on each change, with the ids picked (a new one last) */
  onChange(picked: string[]): void;
  /** Its own choices at the bottom (`Reset`), each closing it */
  actions?: { label: string; run(): void }[];
  placeholder?: string;
  /** Called once it's closed, however */
  onClose?(): void;
}

/**
 * A popup of choices to tick, below a button: a search field over them (typing filters them,
 * Enter ticks the first shown; its × clears it), *All* and *None*, and each change made at once.
 * The picked ones are listed first, in their order, which their handles drag to change (while
 * nothing is searched). It stays open until a press outside it or Escape. Returns a function that
 * closes it
 */
export function openPickList(anchor: HTMLElement, options: PickListOptions): () => void {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  const picked = [...options.picked];
  const { el: popup, close, place } = openPopover(anchor, "topos-pick-list", () => options.onClose?.());
  const field = popup.createDiv({ cls: "search-input-container topos-pick-search" });
  const search = field.createEl("input", { attr: { type: "search", placeholder: options.placeholder ?? "Search…", spellcheck: "false", enterkeyhint: "done" } });
  const clear = field.createDiv({ cls: "search-input-clear-button", attr: { "aria-label": "Clear search" } });
  clear.addEventListener("click", () => {
    search.value = "";
    draw();
    search.focus();
  });
  const tools = popup.createDiv({ cls: "topos-pick-tools" });
  const count = tools.createSpan({ cls: "topos-pick-count" });
  const all = tools.createEl("button", { text: "All" });
  const none = tools.createEl("button", { text: "None" });
  const list = popup.createDiv({ cls: "topos-pick-items" });

  const matches = () => {
    const q = search.value.trim().toLowerCase();
    return options.items.filter((i) => !q || i.label.toLowerCase().includes(q) || (i.detail ?? "").toLowerCase().includes(q));
  };
  const changed = () => {
    options.onChange([...picked]);
    draw();
  };
  const toggle = (id: string) => {
    const at = picked.indexOf(id);
    if (at >= 0) picked.splice(at, 1);
    else picked.push(id);
    changed();
  };
  const draw = () => {
    // Drawn again on each change: where the list was scrolled to stays
    const scrolled = list.scrollTop;
    list.empty();
    const searching = search.value.trim() !== "";
    clear.toggle(searching);
    const shown = new Map(matches().map((i) => [i.id, i]));
    count.setText(`${picked.length} of ${options.items.length}`);
    const order = pickOrder(options.items.map((i) => i.id), picked).filter((id) => shown.has(id));
    for (const id of order) {
      const item = shown.get(id)!;
      const on = picked.includes(id);
      const row = list.createDiv({ cls: "topos-pick-item", attr: { "data-id": id } });
      if (on && !searching && picked.length > 1) dragHandle(row.createSpan({ cls: "topos-pick-grip", attr: { "aria-label": "Drag to reorder" } }), row);
      else row.createSpan({ cls: "topos-pick-grip is-empty" });
      const label = row.createEl("label", { cls: "topos-pick-choice" });
      const box = label.createEl("input", { attr: { type: "checkbox" } });
      box.checked = on;
      box.addEventListener("change", () => toggle(id));
      label.createSpan({ cls: "topos-pick-label", text: item.label });
      if (item.detail) label.createSpan({ cls: "topos-pick-detail", text: item.detail });
    }
    // The picked ones above a line, the rest below it
    const firstOff = list.querySelector(`.topos-pick-item:nth-child(${picked.filter((id) => shown.has(id)).length + 1})`);
    if (picked.length > 0) firstOff?.addClass("is-first-off");
    if (order.length === 0) list.createDiv({ cls: "topos-pick-none", text: "Nothing matches." });
    list.scrollTop = scrolled;
  };

  /**
   * Drags a picked row up or down among the picked ones (a mouse, a finger, or a pen): a copy of it
   * follows the pointer, lifted, over a gap where it will go, and the rows it passes slide out of
   * the way; let go, the copy settles into the gap. The list scrolls while it's held near an edge
   */
  const dragHandle = (grip: HTMLElement, row: HTMLElement) => {
    setIcon(grip, "grip-vertical");
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const id = row.dataset.id!;
      const rows = () => Array.from(list.querySelectorAll<HTMLElement>(".topos-pick-item")).filter((r) => picked.includes(r.dataset.id ?? ""));
      const start = row.getBoundingClientRect();
      const offset = e.clientY - start.top;
      // The copy that follows the pointer, and the gap the row leaves
      const ghost = row.cloneNode(true) as HTMLElement;
      ghost.addClass("topos-pick-ghost");
      Object.assign(ghost.style, { left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px` });
      popup.append(ghost);
      row.addClass("is-placeholder");
      doc.body.addClass("topos-pick-dragging");
      let pointerY = e.clientY;

      /** Moves the gap before the first other row whose middle is below the copy's, sliding the rows it passes */
      const place = () => {
        const middle = pointerY - offset + start.height / 2;
        const others = rows().filter((r) => r !== row);
        const before = others.find((r) => {
          const box = r.getBoundingClientRect();
          return middle < box.top + box.height / 2;
        });
        if (before ? row.nextElementSibling === before : others[others.length - 1]?.nextElementSibling === row) return;
        // Where each was, then from there to where it is (FLIP)
        const was = new Map(others.map((r) => [r, r.getBoundingClientRect().top]));
        if (before) list.insertBefore(row, before);
        else others[others.length - 1]?.after(row);
        for (const r of others) {
          const by = was.get(r)! - r.getBoundingClientRect().top;
          if (!by) continue;
          r.style.transition = "none";
          r.style.transform = `translateY(${by}px)`;
          void r.offsetHeight;
          r.style.transition = "";
          r.style.transform = "";
        }
      };
      const move = (ev: PointerEvent) => {
        pointerY = ev.clientY;
        // Kept to the list
        const box = list.getBoundingClientRect();
        const top = Math.max(box.top - start.height / 2, Math.min(pointerY - offset, box.bottom - start.height / 2));
        ghost.style.top = `${top}px`;
        place();
      };
      // Scrolls while held near the list's top or bottom
      let frame = win.requestAnimationFrame(function scroll() {
        const box = list.getBoundingClientRect();
        const by = pointerY < box.top + 24 ? -6 : pointerY > box.bottom - 24 ? 6 : 0;
        if (by) {
          list.scrollTop += by;
          place();
        }
        frame = win.requestAnimationFrame(scroll);
      });
      // On the document: moving the row loses a pointer capture
      const up = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        doc.removeEventListener("pointercancel", up);
        win.cancelAnimationFrame(frame);
        doc.body.removeClass("topos-pick-dragging");
        // The copy settles into the gap, then the change is made
        const to = row.getBoundingClientRect();
        ghost.addClass("is-dropping");
        ghost.style.top = `${to.top}px`;
        win.setTimeout(() => {
          ghost.remove();
          row.removeClass("is-placeholder");
          const next = moveTo(picked, id, rows().indexOf(row));
          if (next.join("\n") !== picked.join("\n")) {
            picked.splice(0, picked.length, ...next);
            changed();
          } else draw();
        }, 150);
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", up);
      doc.addEventListener("pointercancel", up);
    });
  };
  search.addEventListener("input", draw);
  search.addEventListener("keydown", (e) => {
    const first = matches()[0];
    if (e.key === "Enter" && first) {
      e.preventDefault();
      toggle(first.id);
    }
  });
  // All and None act on those the search shows
  all.addEventListener("click", () => {
    for (const item of matches()) if (!picked.includes(item.id)) picked.push(item.id);
    changed();
  });
  none.addEventListener("click", () => {
    const shown = new Set(matches().map((i) => i.id));
    picked.splice(0, picked.length, ...picked.filter((id) => !shown.has(id)));
    changed();
  });
  for (const action of options.actions ?? []) {
    const b = popup.createEl("button", { cls: "topos-pick-action", text: action.label });
    b.addEventListener("click", () => {
      close();
      action.run();
    });
  }

  draw();
  place();
  // Not on a phone: its keyboard would cover the choices
  if (!Platform.isMobile) search.focus();
  return close;
}

/**
 * A popup below a button (`cls` styles it), kept on screen, that stays open until a press outside it
 * (or on the button) or Escape. `place` puts it below the button again (once it's filled)
 */
export function openPopover(anchor: HTMLElement, cls: string, onClose: () => void): { el: HTMLElement; close: () => void; place: () => void } {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  const el = doc.body.createDiv({ cls: `topos-popover ${cls}` });
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const width = Math.min(el.offsetWidth, win.innerWidth - 16);
    el.style.left = `${Math.max(8, Math.min(r.left, win.innerWidth - width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(r.bottom + 4, win.innerHeight - el.offsetHeight - 8))}px`;
  };
  const onDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!el.contains(target) && !anchor.contains(target)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.remove();
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("keydown", onKey, true);
    win.removeEventListener("resize", place);
    onClose();
  };
  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("keydown", onKey, true);
  win.addEventListener("resize", place);
  return { el, close, place };
}

/** A bar button that opens a popover (`fill` fills it each time) and closes it when pressed again */
export function popoverButton(parent: HTMLElement, label: { text?: string; icon?: string; tooltip: string }, cls: string, fill: (el: HTMLElement, close: () => void) => void): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "topos-rows-pick", attr: { "aria-label": label.tooltip } });
  if (label.icon) setIcon(button.createSpan({ cls: "topos-rows-pick-glyph" }), label.icon);
  if (label.text) button.createSpan({ text: label.text });
  let close: (() => void) | null = null;
  button.addEventListener("click", () => {
    if (close) return close();
    button.addClass("is-active");
    const popover = openPopover(button, cls, () => {
      close = null;
      button.removeClass("is-active");
    });
    close = popover.close;
    fill(popover.el, popover.close);
    popover.place();
  });
  return button;
}

/** A bar button that opens a pick list (`open` makes its options each time) and closes it when pressed again */
export function pickListButton(parent: HTMLElement, text: string, open: () => PickListOptions): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "topos-rows-pick" });
  button.createSpan({ text });
  setIcon(button.createSpan({ cls: "topos-rows-pick-icon" }), "chevron-down");
  let close: (() => void) | null = null;
  button.addEventListener("click", () => {
    if (close) return close();
    button.addClass("is-active");
    const options = open();
    close = openPickList(button, {
      ...options,
      onClose: () => {
        close = null;
        button.removeClass("is-active");
        options.onClose?.();
      },
    });
  });
  return button;
}
