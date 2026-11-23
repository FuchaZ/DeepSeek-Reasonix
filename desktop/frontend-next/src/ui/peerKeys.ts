import type { PeerHeld, PeerView } from "../port/port";

export const peerLabel = (p: Pick<PeerView, "title" | "project" | "key">) =>
  p.project && p.title ? `${p.project} / ${p.title}` : p.title || p.key;

/**
 * The sentence a held message's card shows about its sender: what that session
 * is for, and whether it is busy now. Both come from the peer list the card's
 * poll refreshed, never from the message, which cannot know either.
 */
export const peerNote = (p: Pick<PeerView, "busy" | "purpose"> | undefined): string => {
  if (!p) return "";
  if (p.purpose && p.busy) return "remote.peer_role_and_busy";
  if (p.purpose) return "remote.peer_role";
  if (p.busy) return "remote.peer_busy";
  return "";
};

export const heldLabel = (h: PeerHeld) =>
  peerLabel({ title: h.fromTitle ?? "", project: h.fromProject, key: h.fromSession });
