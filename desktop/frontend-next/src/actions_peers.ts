import type { UIAction } from "./actions";

// Everything the session cross-chat page answers a person with: the switches
// block, the dispatch ceilings, and the row menu the transcript's peer cards
// open. The input commits on blur the way the reference-size row does — one
// Enter, one save, and what the kernel keeps comes back to the box — so the
// canonical change is the proof.
export const PEERS_ACTIONS: UIAction[] = [
  { id: "peers.expand", kind: "view", target: "none", proof: "interaction" },
  { id: "peers.approve", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.approve-project", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.incoming", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.enable", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.dispatch", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.open-nested", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.dispatch-depth", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.dispatched-sessions", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  // The outgoing cross-project seg on the switches block: it saves the whole
  // answer through the same settings POST as the switches beside it.
  { id: "peers.cross-project", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.release-revoke", kind: "kernel-mutation", target: "entity", proof: "authority-effect" },
  { id: "peers.release-add", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.release-pick", kind: "view", target: "none", proof: "interaction" },
  { id: "peers.deny", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
];
