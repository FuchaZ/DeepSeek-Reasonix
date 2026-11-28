// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPort } from "../port/port";
import type { ShellChoice, TerminalInfo } from "../port/terminal";
import { useTerminalTabs, type RunRequest } from "./useTerminalTabs";
import "./testkit";

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

const info = (id: string, over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id, name: "Git Bash", shell: "/usr/bin/bash", dir: "/work", cols: 80, rows: 24,
  running: true, busy: false, created: "2026-11-07T00:00:00Z", ...over,
});

// Only the calls a run makes. The rest of the port is never reached while
// nothing asks for a terminal to be drawn.
function fakePort(over: {
  terminals?: () => Promise<TerminalInfo[]>;
  openTerminal?: () => Promise<TerminalInfo>;
  terminalInput?: (id: string, data: string) => Promise<void>;
  terminalShells?: () => Promise<ShellChoice[]>;
} = {}) {
  return {
    terminals: vi.fn(over.terminals ?? (async () => [] as TerminalInfo[])),
    openTerminal: vi.fn(over.openTerminal ?? (async () => info("new"))),
    terminalInput: vi.fn(over.terminalInput ?? (async () => {})),
    terminalShells: vi.fn(over.terminalShells ?? (async () => [] as ShellChoice[])),
  };
}

function hook(port: ReturnType<typeof fakePort>, onError = vi.fn()) {
  const view = renderHook(({ request }: { request: RunRequest | null }) => useTerminalTabs({
    port: port as unknown as AgentPort, shown: false, pick: () => {}, setDismissed: () => {}, onExternal: () => {}, onError,
    request: 0, runRequest: request,
  }), { initialProps: { request: null as RunRequest | null } });
  return { ...view, onError };
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("a shell snippet from the conversation", () => {
  it("goes to an idle terminal that is already open", async () => {
    const port = fakePort({ terminals: async () => [info("t1")] });
    const view = hook(port);
    await act(async () => { await view.result.current.run("npm test\n", "bash"); });
    expect(port.openTerminal).not.toHaveBeenCalled();
    expect(port.terminalInput).toHaveBeenCalledWith("t1", "npm test\r");
  });

  it("opens one when there is none, and never types into a busy shell", async () => {
    const none = hook(fakePort());
    await act(async () => { await none.result.current.run("ls\n", "bash"); });
    expect(none.result.current.terminals.map((t) => t.id)).toEqual(["new"]);

    cleanup();
    const busy = fakePort({ terminals: async () => [info("running", { busy: true })] });
    const view = hook(busy);
    await act(async () => { await view.result.current.run("ls\n", "bash"); });
    expect(busy.openTerminal).toHaveBeenCalledOnce();
    expect(busy.terminalInput).toHaveBeenCalledWith("new", "ls\r");
    expect(busy.terminalInput).not.toHaveBeenCalledWith("running", expect.anything());
  });

  // A PowerShell snippet typed into Git Bash is a syntax error the reader did
  // not write, so a shell of the block's own family is worth opening.
  it("does not hand a snippet to an idle shell of another family", async () => {
    const port = fakePort({
      terminals: async () => [info("bash-tab", { shell: "/usr/bin/bash" })],
      terminalShells: async () => [
        { name: "Git Bash", kind: "bash", path: "/usr/bin/bash" },
        { name: "PowerShell", kind: "pwsh", path: "/usr/bin/pwsh" },
      ],
    });
    const view = hook(port);
    await act(async () => { await view.result.current.run("Get-Process\n", "powershell"); });
    expect(port.openTerminal).toHaveBeenCalledWith("pwsh", 0, 0);
    expect(port.terminalInput).toHaveBeenCalledWith("new", "Get-Process\r");
    expect(port.terminalInput).not.toHaveBeenCalledWith("bash-tab", expect.anything());
  });

  it("sends each line once and drops the control characters a shell would act on", async () => {
    const port = fakePort({ terminals: async () => [info("t1")] });
    const view = hook(port);
    await act(async () => { await view.result.current.run("echo one\r\necho two\n\n", "bash"); });
    expect(port.terminalInput).toHaveBeenLastCalledWith("t1", "echo one\recho two\r");
    await act(async () => { await view.result.current.run("ls\x1b[31m -la\n", "bash"); });
    expect(port.terminalInput.mock.calls[1][1]).toBe("ls[31m -la\r");
  });

  it("runs once per request, not again when the same one is redrawn", async () => {
    const port = fakePort({ terminals: async () => [info("t1")] });
    const view = hook(port);
    view.rerender({ request: { command: "ls", lang: "bash", n: 1 } });
    await settle();
    expect(port.terminalInput).toHaveBeenCalledTimes(1);
    view.rerender({ request: { command: "ls", lang: "bash", n: 1 } });
    await settle();
    expect(port.terminalInput).toHaveBeenCalledTimes(1);
    view.rerender({ request: { command: "pwd", lang: "bash", n: 2 } });
    await settle();
    expect(port.terminalInput).toHaveBeenLastCalledWith("t1", "pwd\r");
  });

  it("says why a run did not happen", async () => {
    const port = fakePort({ openTerminal: async () => { throw new Error("no shell here"); } });
    const view = hook(port);
    await act(async () => { await view.result.current.run("ls\n", "bash"); });
    expect(view.onError).toHaveBeenCalledWith(expect.stringContaining("no shell here"));
  });
});
