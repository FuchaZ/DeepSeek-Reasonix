import type { BrowserTab } from "../port/port";
import { t } from "../i18n";

export type Surface =
  | { kind: "manual"; id: string }
  | { kind: "browser"; tab: BrowserTab }
  | { kind: "file"; path: string }
  | { kind: "agent"; ref: string; name: string }
  | { kind: "job"; id: string; name: string }
  | { kind: "terminal"; id: string; name: string; busy: boolean }
  | { kind: "changes" };
export function keyOf(s: Surface) {
  if (s.kind === "changes") return "changes:";
  return `${s.kind}:${s.kind === "manual" || s.kind === "job" || s.kind === "terminal" ? s.id : s.kind === "browser" ? s.tab.target : s.kind === "agent" ? s.ref : s.path}`;
}
/** Whether a page has a title worth showing, as opposed to a token standing in
 *  for one. `about:blank` is the shell's placeholder for "nothing loaded yet"
 *  and `reasonix://start` is the panel's own opening screen: neither is a page,
 *  so neither names a tab. */
const UNTITLED = /^(?:about:blank|reasonix:\/\/start)$/i;

/** The name a tab shows. A page names itself; a page with no name yet is the
 *  blank page, not the url it happens to be sitting on. */
export function pageTitle(tab: { title?: string; url?: string }): string {
  const title = tab.title?.trim();
  if (title) return title;
  const url = tab.url?.trim();
  if (!url || UNTITLED.test(url)) return t("common.blank_page");
  return url;
}

export function labelOf(s: Surface, hosts: Record<string, string>) {
  if (s.kind === "changes") return t("common.changes");
  return s.kind === "manual"
    ? hosts[s.id] || t("workbench.browser")
    : s.kind === "browser"
      ? pageTitle(s.tab)
      : s.kind === "agent" || s.kind === "job" || s.kind === "terminal"
        ? s.name
        : s.path.split("/").at(-1) || s.path;
}
