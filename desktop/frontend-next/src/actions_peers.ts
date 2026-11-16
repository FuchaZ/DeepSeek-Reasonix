import type { UIAction } from "./actions";

// The two dispatch ceilings on the session cross-chat page. The input commits on
// blur the way the reference-size row does — one Enter, one save, and what the
// kernel keeps comes back to the box — so the canonical change is the proof.
export const PEERS_ACTIONS: UIAction[] = [
  { id: "peers.dispatch-depth", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  { id: "peers.dispatched-sessions", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
  // The outgoing cross-project seg on the switches block: it saves the whole
  // answer through the same settings POST as the switches beside it.
  { id: "peers.cross-project", kind: "kernel-mutation", target: "none", proof: "authority-effect" },
];
