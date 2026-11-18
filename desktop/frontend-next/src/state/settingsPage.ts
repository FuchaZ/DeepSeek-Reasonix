import type { Section } from "../ui/prefsnav";

// The section the settings sheet was last read on. It lives in browser storage
// rather than the config file because it is where the reader was, not what the
// kernel does: a second window may be on a different page and neither answer is
// wrong.
const KEY = "rx-settings-page";

const SECTIONS: readonly Section[] = [
  "common", "display", "controls", "session", "persona", "model", "providers",
  "tools", "peers", "ext", "network", "remote", "memory", "usage", "storage",
  "account", "versions", "appearance", "advanced",
];

/** The section settings was last left on, or "" when this window has not
 *  opened it yet — which is what makes the first visit land on 常用. */
export function lastSettingsPage(): Section | "" {
  try {
    const raw = localStorage.getItem(KEY);
    return SECTIONS.find((s) => s === raw) ?? "";
  } catch {
    return "";
  }
}

export function rememberSettingsPage(section: Section): void {
  try {
    localStorage.setItem(KEY, section);
  } catch {
    /* a private window keeps the choice for this session only */
  }
}
