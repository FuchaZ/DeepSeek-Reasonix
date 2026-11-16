import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HubPort, TreeSession, TreeWorkspace } from "../port/hub";
import { SessionHoverCard } from "./SessionHoverCard";

export type SessionRowHover = { ws: TreeWorkspace; session: TreeSession; rect: DOMRect };

export type SessionHover = {
  hover: SessionRowHover | null;
  enter: (ws: TreeWorkspace, session: TreeSession, el: HTMLElement) => void;
  leave: () => void;
  keepOpen: () => void;
  close: () => void;
};

/** What a session row's hover opens, after a pause long enough that a pointer
 *  crossing the list does not flash a card for every row it crossed. A search
 *  or the picking mode reads as no hover at all: those rows are read or
 *  chosen, not browsed. */
export function useSessionRowHover(enabled: boolean): SessionHover {
  const [hover, setHover] = useState<SessionRowHover | null>(null);
  const timer = useRef(0);
  const enter = (ws: TreeWorkspace, session: TreeSession, el: HTMLElement) => {
    if (!enabled) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover({ ws, session, rect: el.getBoundingClientRect() }), 450);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(null), 350);
  };
  const keepOpen = () => window.clearTimeout(timer.current);
  return { hover, enter, leave, keepOpen, close: () => setHover(null) };
}

/** The card itself, portalled to the body: it outlives the row it describes
 *  while the pointer is inside it, which is how a task line stays clickable. */
export function SessionHoverLayer({ hub, card, onOpen }: {
  hub: HubPort;
  card: SessionHover;
  onOpen: (req: { root?: string; sessionPath?: string }) => Promise<void>;
}) {
  if (!card.hover) return null;
  const { ws, session, rect } = card.hover;
  return createPortal(
    <SessionHoverCard hub={hub} ws={ws} session={session} anchor={rect} onClose={card.close} onKeepOpen={card.keepOpen}
      onOpenSession={(path) => { card.close(); void onOpen({ sessionPath: path }); }} />,
    document.body,
  );
}
