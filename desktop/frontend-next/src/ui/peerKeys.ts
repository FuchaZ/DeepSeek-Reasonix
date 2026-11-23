import type { PeerHeld, PeerView } from "../port/port";

export const peerLabel = (p: Pick<PeerView, "title" | "project" | "key">) =>
  p.project && p.title ? `${p.project} / ${p.title}` : p.title || p.key;

/**
 * What to say about a peer beyond its name. Busy is the fact that matters before
 * writing: its side reads the message when the turn ends. The role is what a
 * dispatch opened it to do, so a person can tell two panes in one project apart.
 */
export const peerMeta = (p: Pick<PeerView, "busy" | "purpose">): string[] => {
  const out: string[] = [];
  if (p.purpose) out.push(p.purpose);
  if (p.busy) out.push("busy");
  return out;
};

export const heldLabel = (h: PeerHeld) =>
  peerLabel({ title: h.fromTitle ?? "", project: h.fromProject, key: h.fromSession });
