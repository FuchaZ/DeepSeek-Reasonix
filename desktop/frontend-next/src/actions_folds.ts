import type { UIAction } from "./actions";

// Fold toggles name a visible state change and reach nothing else.
export const FOLD_ACTIONS: UIAction[] = [
  // The keys card folds shut and stands last on its page.
  { id: "settings.keys-fold", kind: "view", target: "none", proof: "interaction" },
  // The per-model tuning blocks fold shut behind their own headings.
  { id: "provider.model-fold", kind: "view", target: "none", proof: "interaction" },
];
