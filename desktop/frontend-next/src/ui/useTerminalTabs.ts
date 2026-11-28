import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { t } from "../i18n";
import { reason } from "../i18n/kernel";
import { host } from "../port/host";
import type { AgentPort } from "../port/port";
import type { ShellChoice, TerminalInfo } from "../port/terminal";
import { openPage } from "./browser_open";
import { lastShell, rememberShell } from "./terminal_prefs";
import type { Surface } from "./workbench_tabs";

export type TerminalTab = Extract<Surface, { kind: "terminal" }>;

const POLL_MS = 2000;

// A fence and a shell kind spell the same family differently; a snippet typed
// into another family is a syntax error the reader did not write.
const POSIX = new Set(["bash", "sh", "shell", "zsh", "fish", "ksh"]);

function shellFamily(name: string): "posix" | "powershell" | "cmd" | "" {
  const kind = name.toLowerCase();
  if (POSIX.has(kind)) return "posix";
  if (kind === "pwsh" || kind === "powershell" || kind === "ps1") return "powershell";
  if (kind === "cmd" || kind === "bat" || kind === "batch") return "cmd";
  return "";
}

/** A shell snippet from the conversation, with the fence's language and a
 *  counter so the same words twice are two runs. */
export interface RunRequest {
  command: string;
  lang: string;
  n: number;
}

interface Props {
  port: AgentPort;
  shown: boolean;
  pick: (key: string) => void;
  setDismissed: Dispatch<SetStateAction<Set<string>>>;
  onExternal: (url: string) => void;
  onError: (message: string) => void;
  // Counts the presses that ask for a terminal: the one most recently used, or a first one.
  request: number;
  runRequest?: RunRequest | null;
}

/** The person's terminals as workbench tabs. The kernel holds the list, so a
 *  terminal opened from another window, or before this one reloaded, is a tab
 *  here too; a tab is named for the command last submitted while it is busy. */
export function useTerminalTabs({ port, shown, pick, setDismissed, onExternal, onError, request, runRequest }: Props) {
  const [list, setList] = useState<TerminalInfo[]>([]);
  const [shells, setShells] = useState<ShellChoice[]>([]);
  const [commands, setCommands] = useState<Record<string, string>>({});
  const changed = useRef(0);
  const held = useRef(list);
  held.current = list;

  useEffect(() => {
    if (!shown) return;
    let live = true;
    const read = () => {
      const since = changed.current;
      port.terminals().then((next) => {
        if (!live || since !== changed.current) return;
        // Not even an update that hands back the same value: it costs the
        // component another render, and the poll runs for as long as the panel.
        if (JSON.stringify(held.current) === JSON.stringify(next)) return;
        setList(next);
      }, () => {});
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [port, shown]);

  const loadShells = useCallback(() => { port.terminalShells().then(setShells, () => {}); }, [port]);
  useEffect(() => { if (shown) loadShells(); }, [shown, loadShells]);

  const add = useCallback((info: TerminalInfo) => {
    changed.current += 1;
    setList((v) => [...v.filter((x) => x.id !== info.id), info]);
    setDismissed((v) => { const n = new Set(v); n.delete(`terminal:${info.id}`); return n; });
    pick(`terminal:${info.id}`);
  }, [pick, setDismissed]);

  const open = useCallback(async (kind = lastShell()) => {
    try {
      const info = await port.openTerminal(kind, 0, 0);
      add(info);
      const used = kind || shells.find((s) => s.path === info.shell)?.kind;
      if (used) rememberShell(used);
    } catch (e) {
      onError(t("terminal.could_not_open", { why: reason(e) }));
    }
  }, [port, add, shells, onError]);

  const handled = useRef(request);
  useEffect(() => {
    if (request === handled.current) return;
    handled.current = request;
    const latest = list.at(-1);
    if (latest) pick(`terminal:${latest.id}`);
    else void open();
  }, [request, list, pick, open]);

  const restart = useCallback(async (id: string) => {
    const info = await port.restartTerminal(id);
    changed.current += 1;
    setList((v) => v.map((x) => (x.id === id ? info : x)));
  }, [port]);

  const openUrl = useCallback(async (url: string) => {
    if (!host().drawsBrowserViews()) return onExternal(url);
    try {
      pick(`browser:${(await openPage(port, url)).target}`);
    } catch (e) {
      onError(reason(e));
    }
  }, [port, pick, onExternal, onError]);

  const [asking, setAsking] = useState<{ anchor: HTMLElement; run: () => void } | null>(null);
  const cancelAsk = useCallback(() => setAsking(null), []);
  const confirmAsk = useCallback(() => { asking?.run(); setAsking(null); }, [asking]);
  // Closing a terminal with a command still running asks first; whichever way
  // the close was asked for, it goes through here.
  const guard = useCallback((targets: Surface[], run: (targets: Surface[]) => Promise<void>) => {
    const busy = targets.find((s) => s.kind === "terminal" && s.busy);
    if (!busy) return run(targets);
    const anchor = document.querySelector<HTMLElement>(`[data-key="terminal:${busy.kind === "terminal" ? busy.id : ""}"]`) ?? document.body;
    setAsking({ anchor, run: () => void run(targets) });
    return Promise.resolve();
  }, []);

  const submitted = useCallback((id: string, line: string) => setCommands((v) => ({ ...v, [id]: line })), []);

  // A snippet from the conversation is typed into an idle shell of its own
  // family that is already there, a new one of that family, or the closest
  // idle shell the machine has. A busy terminal is never a target: its stdin
  // belongs to the command still running. Control characters are dropped so a
  // hidden escape in model output cannot act on the shell.
  const run = useCallback(async (source: string, lang: string) => {
    const command = source
      .replace(/\r\n?/g, "\n")
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
      .replace(/\n+$/, "");
    if (!command.trim()) return;
    try {
      const family = shellFamily(lang);
      let known = shells;
      if (family && known.length === 0) {
        try {
          known = await port.terminalShells();
          setShells(known);
        } catch {
          // Matching is a preference; a listing that failed is not a refusal.
        }
      }
      let idle: TerminalInfo[] = [];
      try {
        idle = (await port.terminals()).filter((t) => t.running && !t.busy);
      } catch {
        // A listing that failed is no reason not to open a terminal.
      }
      const kindOf = (info: TerminalInfo) => known.find((s) => s.path === info.shell)?.kind ?? "";
      const newest = [...idle].reverse();
      const exact = newest.find((t) => kindOf(t).toLowerCase() === lang.toLowerCase());
      const same = exact ?? (family ? newest.find((t) => shellFamily(kindOf(t)) === family) : undefined);
      const wanted = family ? known.find((s) => shellFamily(s.kind) === family) : undefined;
      const target = same ?? (wanted ? undefined : idle.at(-1));
      const info = target ?? (await port.openTerminal(wanted?.kind ?? lastShell(), 0, 0));
      add(info);
      await port.terminalInput(info.id, command.replace(/\n/g, "\r") + "\r");
      submitted(info.id, command.split("\n")[0]);
    } catch (e) {
      onError(t("terminal.could_not_run", { why: reason(e) }));
    }
  }, [port, add, submitted, onError, shells]);

  // A remount is not the request happening again: the pane can be rebound to
  // another session while the request it already served is still in its state.
  const ran = useRef(runRequest?.n ?? 0);
  useEffect(() => {
    if (!runRequest || runRequest.n === ran.current) return;
    ran.current = runRequest.n;
    void run(runRequest.command, runRequest.lang);
  }, [runRequest, run]);

  const tabs = useMemo<TerminalTab[]>(() => list.map((info, i) => ({
    kind: "terminal", id: info.id, busy: info.busy,
    name: info.busy && commands[info.id] ? commands[info.id] : list.length === 1 ? t("terminal.name") : t("terminal.n", { n: i + 1 }),
  })), [list, commands]);

  return { terminals: list, tabs, shells, loadShells, open, run, restart, openUrl, submitted, asking, cancelAsk, confirmAsk, guard };
}
