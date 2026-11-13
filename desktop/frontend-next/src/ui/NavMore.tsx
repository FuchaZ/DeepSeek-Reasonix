import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { setNavLayout } from "../state/navEntries";
import { useDismiss } from "./dismiss";
import { listenAction } from "./listen";
import { useBarLayout, type BarEntry } from "./navdest";
import { pinToViewport } from "./place";
import { ICON, type Section } from "./prefsnav";
import { StudioIcon, type StudioIconName } from "./StudioIcon";
import { Switch } from "./Switch";

/** The mark a bar row carries: the two commands have their own, the rest borrow
 *  the settings table's, so a place is drawn the same way everywhere. */
export function barIcon(entry: BarEntry) {
  if (entry.key === "new") return <StudioIcon name="plus" />;
  if (entry.key === "search") return <StudioIcon name="search" />;
  if (entry.key === "files") return <StudioIcon name="file" />;
  // A row that names a section's anchor carries "session:scheduled-runs", which
  // is not a Section and has no entry in the settings table's icon map.
  if (entry.key === "scheduled") return <StudioIcon name="repeat" />;
  // The foot's rows carry no section of their own; settings is the one that
  // does, and drawing it as "common" would leave it blank.
  if (entry.key === "advanced") return <StudioIcon name="settings" />;
  if (entry.key === "account") return <StudioIcon name="user" />;
  return ICON[(entry.section ?? "common") as Section];
}

/** The nav bar's arrangement: one flat list, a switch and a handle on every
 *  row. It opens from the row that sits after the last entry — a "…" on the
 *  icon rail, 更多 where names are spelled out — and stands in the middle of
 *  the window, because it arranges things rather than picks one. New session
 *  is the bar's way out of anything, so its switch is off the table; every
 *  other row, search included, can be hidden and moved. */
export function NavMorePanel({ onClose, onRun }: {
  onClose: () => void;
  onRun: (entry: BarEntry) => void;
}) {
  const { list, hidden } = useBarLayout();
  const stored = list.map((entry) => entry.key);
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // The order while a drag is in flight. Nothing is written while the pointer
  // moves — a write per pointer event re-renders the whole bar from storage and
  // is what made the rows flicker — so the drag keeps its own list and only the
  // release commits it.
  const [draft, setDraft] = useState<string[] | null>(null);
  const order = draft ?? stored;
  const [dragging, setDragging] = useState<string | null>(null);
  /** Where in the row it was pressed, and the transform the lifted row is
   *  carrying. The row is placed from where the pointer is rather than from how
   *  far it has travelled: it also changes place in the list, so travel added on
   *  top of that would move it twice. */
  const grabDY = useRef(0);
  const dragOffset = useRef(0);
  /** Fixed geometry taken at the press: where each row sits inside the
   *  scroller, measured from the scroller's own top plus its scroll offset —
   *  the same origin `localY` uses. `offsetTop` was the bug here: it answers to
   *  the nearest positioned ancestor, which is the fixed layer behind the whole
   *  panel, so every pointer position compared against the first slot and a
   *  drag jumped straight to the top. */
  const slots = useRef<{ key: string; top: number; height: number }[]>([]);
  /** The scroller's screen top at the press, so scrolling mid-drag does not
   *  shift the measurement under the pointer. */
  const origin = useRef(0);
  const held = useRef<{ key: string; pointer: number; from: number } | null>(null);
  const was = useRef(new Map<string, number>());

  useDismiss(true, box, onClose);

  const write = (next: string[], nextHidden: string[]) => setNavLayout({ order: next, hidden: nextHidden });
  const step = (key: string, by: -1 | 1) => {
    const at = order.indexOf(key);
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[at], next[to]] = [next[to]!, next[at]!];
    write(next, [...hidden]);
  };
  const toggle = (key: string) => {
    write(order, hidden.has(key) ? [...hidden].filter((k) => k !== key) : [...hidden, key]);
  };

  /** Where the dragged row would be dropped: the index of the first slot whose
   *  middle is below the pointer, or the end. A row it crosses is pushed aside,
   *  which is what "inserted" looks like rather than swapped. */
  const slotAt = (y: number): number => {
    const list = slots.current;
    for (let i = 0; i < list.length; i++) {
      const slot = list[i]!;
      if (y < slot.top + slot.height / 2) return i;
    }
    return list.length;
  };

  /** Pointer y inside the scroller, on the same origin the slots were taken on. */
  const localY = (clientY: number): number => {
    const el = body.current;
    return clientY - origin.current + (el?.scrollTop ?? 0);
  };

  /** A row's place in the scroller's layout — `offsetTop`, which transform does
   *  not touch. Measuring with a client rect was the bug behind rows flickering
   *  into each other on a fast drag: the rect of a row already sliding carries
   *  that slide, so every frame took its "before" from the middle of the last
   *  animation and the deltas compounded. The scroller is the positioning
   *  ancestor, so this is the same origin the slots use. */
  const measure = (row: HTMLElement): number => row.offsetTop;

  // Rows that changed place are put back where they were and animated forward,
  // so they slide into their slot instead of jumping to it.
  useLayoutEffect(() => {
    const rows = [...(body.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    for (const row of rows) {
      const key = row.dataset.row!;
      const now = measure(row);
      const from = was.current.get(key);
      if (draft && key !== dragging && from !== undefined && Math.abs(from - now) > 0.5) {
        row.style.transition = "none";
        row.style.transform = `translateY(${from - now}px)`;
        // Read-back keeps the painted position; a second write in the same
        // frame would otherwise collapse into no movement at all.
        void row.offsetHeight;
        row.style.transition = "";
        row.style.transform = "";
      }
      was.current.set(key, now);
    }
  }, [order.join("|"), draft, dragging]);

  // A grip drags the row it belongs to. Pointer events rather than HTML5 drag
  // and drop: a row holds a button and a switch, and `draggable` on the parent
  // never fires once the press lands on one of them.
  useEffect(() => {
    if (!dragging) return;
    const place = (clientY: number) => {
      const row = body.current?.querySelector<HTMLElement>(`[data-row="${dragging}"]`);
      if (!row) return;
      // The row is placed from where the pointer is, not from how far it has
      // travelled: it also changes place in the list, and adding the travel on
      // top of that moves it twice. Measured against the row's painted top, the
      // correction stays right across a reorder.
      const wanted = clientY - grabDY.current;
      dragOffset.current += wanted - row.getBoundingClientRect().top;
      row.style.transform = `translateY(${dragOffset.current}px)`;
    };
    const at = (event: PointerEvent) => {
      const held0 = held.current;
      if (!held0 || event.pointerId !== held0.pointer) return;
      place(event.clientY);
      const slot = slotAt(localY(event.clientY));
      if (slot < 0) return;
      setDraft((now) => {
        const current = now ?? stored;
        const from = current.indexOf(held0.key);
        if (from < 0) return now;
        // The slot index was measured with the dragged row still in the list, so
        // taking it out first shifts every slot below it up by one.
        const insertAt = from < slot ? slot - 1 : slot;
        if (insertAt === from) return now;
        const next = current.filter((k) => k !== held0.key);
        next.splice(insertAt, 0, held0.key);
        return next;
      });
    };
    const up = () => {
      // One write at the end: the arrangement this machine keeps is the list the
      // drag was building, not every intermediate one.
      setDraft((now) => {
        if (now) write(now, [...hidden]);
        return null;
      });
      const row = body.current?.querySelector<HTMLElement>(`[data-row="${dragging}"]`);
      if (row) row.style.transform = "";
      dragOffset.current = 0;
      held.current = null;
      setDragging(null);
    };
    // One gesture, three registrations: they carry the grip's own id, because
    // the drag is not a second thing a person can start.
    const offMove = listenAction(window, "pointermove", { action: "appearance.nav-entry-move", listener: at as EventListener });
    const offUp = listenAction(window, "pointerup", { action: "appearance.nav-entry-move", listener: up as EventListener });
    const offCancel = listenAction(window, "pointercancel", { action: "appearance.nav-entry-move", listener: up as EventListener });
    return () => { offMove(); offUp(); offCancel(); };
  }, [dragging, stored, hidden]);

  const begin = (key: string, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    // Capture keeps the drag alive when the pointer leaves the grip; a pointer
    // id the browser does not consider active makes it throw, and that must not
    // take the rest of the press with it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* the window listeners below carry the drag either way */
    }
    const rows = [...(body.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    // Geometry measured on the same origin as localY: the scroller's own top,
    // plus each row's place inside it. `offsetTop` is not that — it answers to
    // the nearest positioned ancestor, which here is the fixed layer behind the
    // whole panel.
    const scroller = body.current;
    const top = scroller?.getBoundingClientRect().top ?? 0;
    origin.current = top;
    const scroll = scroller?.scrollTop ?? 0;
    slots.current = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return { key: row.dataset.row!, top: rect.top - top + scroll, height: rect.height };
    });
    was.current = new Map(slots.current.map((slot) => [slot.key, slot.top]));
    const grabbed = rows.find((row) => row.dataset.row === key);
    grabDY.current = event.clientY - (grabbed?.getBoundingClientRect().top ?? event.clientY);
    dragOffset.current = 0;
    held.current = { key, pointer: event.pointerId, from: event.clientY };
    setDraft(order);
    setDragging(key);
  };

  const byKey = new Map(list.map((entry) => [entry.key, entry]));
  return createPortal(
    <div className="studio-menubar-layer" data-action="layer.dismiss" onMouseDown={onClose}>
      <div className="studio-navbar" ref={box} role="dialog" aria-modal="true" aria-label={t("settings.compose_the_nav_bar")}
        data-action="layer.dismiss" onMouseDown={(event) => event.stopPropagation()}>
        <div className="studio-navbar-head">
          <b>{t("settings.compose_the_nav_bar")}</b>
          <button type="button" className="studio-navbar-close" data-action="nav.close" aria-label={t("common.close")} onClick={onClose}>
            <StudioIcon name="close" />
          </button>
        </div>
        <div className="studio-navbar-body" ref={body}>
          {order.map((key) => {
            const entry = byKey.get(key);
            if (!entry) return null;
            return (
            <div
              key={entry.key}
              data-row={entry.key}
              className="studio-navbar-row"
              data-dragging={dragging === entry.key ? "" : undefined}
              data-hidden={hidden.has(entry.key) ? "" : undefined}
              style={dragging === entry.key ? { zIndex: 3 } : undefined}
            >
              <button type="button" className="studio-navbar-go" data-action="nav.go" onClick={() => { onClose(); onRun(entry); }}>
                {barIcon(entry)}
                <span>{t(entry.label)}</span>
              </button>
              {entry.fixed
                ? <span className="studio-navbar-fixed">{t("settings.always_shown")}</span>
                : <Switch data-action="appearance.nav-entry-visible" on={!hidden.has(entry.key)} label={t("settings.show_name", { name: t(entry.label) })} onClick={() => toggle(entry.key)} />}
              <span
                className="studio-navbar-grip"
                role="button"
                tabIndex={0}
                aria-label={t("settings.drag_name", { name: t(entry.label) })}
                data-action-pointerdown="appearance.nav-entry-move"
                data-action-keydown="appearance.nav-entry-move"
                onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => begin(entry.key, event)}
                onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  step(entry.key, event.key === "ArrowUp" ? -1 : 1);
                }}
              >
                <StudioIcon name="menu" />
              </span>
            </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The bar's own menu: a right press on it offers 自定义导航栏, and choosing
 *  that opens the arrangement panel. Two steps rather than one, because a right
 *  press on a menu bar is where people expect a menu, and the panel is a place
 *  to arrange things rather than something a stray right click should throw
 *  open in the middle of the window. */
export function useNavBarMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const openAt = (event: { preventDefault(): void; clientX: number; clientY: number }) => {
    event.preventDefault();
    setAt({ x: event.clientX, y: event.clientY });
  };
  const customize = () => {
    setAt(null);
    setOpen(true);
  };
  return { at, open, openAt, customize, closeMenu: () => setAt(null), close: () => setOpen(false) };
}

/** The one item the bar's right press offers, placed where the press landed. */
export function NavBarMenu({ at, onPick, onClose }: {
  at: { x: number; y: number };
  onPick: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(true, box, onClose);
  useLayoutEffect(() => {
    if (box.current) pinToViewport(box.current, at.x, at.y);
  }, [at]);
  return createPortal(
    <div className="studio-barmenu" ref={box} role="menu" aria-label={t("settings.main_navigation")}>
      <button type="button" role="menuitem" data-action="nav.customize" onClick={onPick}>
        <StudioIcon name="sliders" />
        <span>{t("settings.compose_the_nav_bar")}</span>
      </button>
    </div>,
    document.body,
  );
}

export type { StudioIconName };
