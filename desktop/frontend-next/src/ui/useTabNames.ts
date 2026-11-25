import { useState } from "react";
import { keyOf, type Surface } from "./workbench_tabs";

// The names a person gave tabs: held by the tab's stable key for the window's session, and
// stored only when they differ from the page's own label, so leaving the field untouched never
// turns a title that is still changing into a name the person chose.
export function useTabNames(ownLabel: (surface: Surface) => string) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState("");
  // The draft lives here, not in the input: the header is remounted when it
  // changes home, and an uncontrolled field would lose what was typed.
  const [renameDraft, setRenameDraft] = useState("");
  const labelFor = (surface: Surface) => names[keyOf(surface)] || ownLabel(surface);
  const startRename = (surface: Surface) => {
    setRenameDraft(labelFor(surface));
    setRenaming(keyOf(surface));
  };
  const nameTab = (surface: Surface, value: string) => {
    const key = keyOf(surface);
    const next = value.trim();
    const keep = next !== "" && next !== ownLabel(surface);
    setNames((cur) => { const { [key]: _gone, ...rest } = cur; return keep ? { ...rest, [key]: next } : rest; });
    setRenaming("");
  };
  return { renaming, setRenaming, labelFor, nameTab, renameDraft, setRenameDraft, startRename };
}
