// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./testkit";
import { WorkbenchPanel } from "./WorkbenchPanel";
import { useConversationFiles } from "./useConversationFiles";
import { MockPort } from "../port/mock";
import { host } from "../port/host";
import type { AgentPort } from "../port/port";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const tabs = () => [...document.querySelectorAll("[role=tab]")].map((e) => e.textContent?.trim());

// A conversation link, opened the way the transcript opens one: through
// useConversationFiles, into the panel that reads the file.
function Harness({ port, link, root = "/w", remote = false }: { port: AgentPort; link: string; root?: string; remote?: boolean }) {
  const files = useConversationFiles(port, root, remote, true, () => {}, () => {});
  return (
    <>
      <button onClick={() => files.refs.link?.(link)?.()}>link</button>
      <WorkbenchPanel scheme="dark" shown changes={[]} onCloseManual={vi.fn()} onExternal={vi.fn()}
        manual tabs={[]} port={port} fileRequest={files.request} workspaceRoot={root} />
    </>
  );
}

async function draw(port: MockPort, link: string, remote = false) {
  vi.spyOn(host(), "describe").mockResolvedValue({ ...await host().describe(), platform: "darwin" });
  render(<Harness port={port} link={link} remote={remote} />);
  await userEvent.click(screen.getByText("link"));
}

describe("a file the conversation spelled from another directory", () => {
  it("opens where it really lives instead of reporting it gone", async () => {
    const spelled = "target/release/app.exe";
    const real = "misyrup-rs/target/release/app.exe";
    const port = new MockPort();
    vi.spyOn(port, "workspaceFile").mockImplementation(async (path) => {
      if (path !== real) throw Object.assign(new Error("missing"), {});
      return { path, content: "the file that is really there", revision: "1" };
    });
    const resolve = vi.spyOn(port, "workspaceResolvePath").mockResolvedValue({ path: real });
    await draw(port, spelled);

    await waitFor(() => expect(resolve).toHaveBeenCalledWith(spelled));
    await waitFor(() => expect(tabs()).toContain("app.exe"));
    expect(screen.queryByText("文件已不在原处")).toBeNull();
  });

  it("takes the path as written when it is already right, without a second tab", async () => {
    const spelled = "docs/notes.md";
    const port = new MockPort();
    vi.spyOn(port, "workspaceResolvePath").mockResolvedValue({ path: spelled });
    await draw(port, spelled);
    await waitFor(() => expect(tabs()).toContain("notes.md"));
    expect(tabs()).toHaveLength(1);
  });

  it("leaves the missing state standing when the workspace cannot say where it is", async () => {
    const port = new MockPort();
    vi.spyOn(port, "workspaceFile").mockRejectedValue(Object.assign(new Error("missing"), {}));
    const resolve = vi.spyOn(port, "workspaceResolvePath").mockResolvedValue(null);
    await draw(port, "target/release/gone.exe");
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("does not ask a remote workspace, whose path names its own disk", async () => {
    const port = new MockPort();
    const resolve = vi.spyOn(port, "workspaceResolvePath");
    await draw(port, "a/b.md", true);
    await waitFor(() => expect(tabs()).toContain("b.md"));
    expect(resolve).not.toHaveBeenCalled();
  });
});
