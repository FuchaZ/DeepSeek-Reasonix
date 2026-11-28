import { useRef, useState } from "react";

const KEY = "rx-sidebar-folds";

function read(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

// The writer takes the held set as well as a replacement: two clicks in one
// tick both read the set the other just wrote, instead of the one this render
// started from.
type Folded = Set<string> | ((held: Set<string>) => Set<string>);

export function useSidebarFolds(): [Set<string>, (next: Folded) => void] {
  const [folded, setFolded] = useState(read);
  const held = useRef(folded);
  held.current = folded;
  const save = (next: Folded) => {
    const value = typeof next === "function" ? next(held.current) : next;
    held.current = value;
    setFolded(value);
    try {
      localStorage.setItem(KEY, JSON.stringify([...value]));
    } catch {
      // Folding remains available when this window cannot persist its choices.
    }
  };
  return [folded, save];
}
