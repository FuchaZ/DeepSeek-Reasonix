// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";

afterEach(cleanup);

// The pill lives in its own row above the composer card; the sidebar's project
// rows share its words, so the guide is looked up in that row alone.
const pillQuery = () => {
  const row = document.querySelector(".composer-top");
  return row ? row.querySelector("button.worktree-trigger") : null;
};

// The second folder the fixture remembers — the row a switch has to name.
const SECOND = "~/projects/my-website";

// The composer's project pill: which project this conversation belongs to, and
// how it moves. The pane's own port is where a switch lands, so the fixture
// stubs the two port calls a pick can make and records them; the kernel-side
// contract (a fresh conversation, the old transcript left behind) is the
// kernel's to prove, and this window's job is to make the right call at all.
describe("the composer's project pill", () => {
  let hub: MockHub;
  let switched: string[];
  let autos: number;

  function buildHub({ content = false, canSwitch = true }: { content?: boolean; canSwitch?: boolean } = {}) {
    hub = new MockHub();
    switched = [];
    autos = 0;
    const build = hub.portFor.bind(hub);
    hub.portFor = (rt) => {
      const port = build(rt);
      port.providerSetup = async () => null;
      port.welcomeSeen = async () => true;
      if (content) {
        const base = port.status.bind(port);
        port.status = async () => ({ ...(await base()), sessionPath: "/sessions/mock.jsonl" });
      }
      port.workspaces = async () => ({ current: rt.root ?? "", canSwitch, canIsolate: true, recents: [] });
      port.setWorkspace = async (path: string) => { switched.push(path); };
      port.setWorkspaceAuto = async () => { autos++; return "~/workspaces/auto"; };
      return port;
    };
  }

  // Past onboarding, one pane on screen. The pill's name is the project it
  // carries; its popup is the dialog headed 会话所属项目.
  async function openPalette(user: ReturnType<typeof userEvent.setup>, trigger: RegExp | string) {
    render(<App hub={hub} />);
    await screen.findByRole("combobox", { name: "任务输入" });
    await user.click(screen.getByRole("button", { name: trigger }));
    return screen.findByRole("dialog", { name: "会话所属项目" });
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    buildHub();
  });

  it("carries the pane's project, and offers this machine's remembered ones", async () => {
    const user = userEvent.setup();
    const palette = await openPalette(user, "DeepSeek-Reasonix");

    expect(within(palette).getByRole("option", { name: /my-website/ })).toBeTruthy();
    // The pane's own row is the current one, named as such.
    const here = within(palette).getByRole("option", { name: /DeepSeek-Reasonix/ });
    expect(here.getAttribute("data-current")).toBe("");
    expect(here.getAttribute("aria-selected")).toBe("true");
    // A project saved on another machine cannot serve this pane's kernel.
    expect(within(palette).queryByRole("option", { name: /training/ })).toBeNull();
    expect(within(palette).getByRole("button", { name: "添加新项目" })).toBeTruthy();
    expect(within(palette).getByRole("button", { name: "不使用项目" })).toBeTruthy();
  });

  it("reads 进入项目工作 when the pane works outside every remembered project", async () => {
    const user = userEvent.setup();
    buildHub();
    const stub = hub.portFor.bind(hub);
    hub.portFor = (rt) => {
      const port = stub(rt);
      const base = port.status.bind(port);
      port.status = async () => ({ ...(await base()), workspaceRoot: "~/workspaces/auto" });
      return port;
    };
    render(<App hub={hub} />);
    await screen.findByRole("combobox", { name: "任务输入" });

    // The label follows /status, which lands a beat after the pane mounts.
    await user.click(await screen.findByRole("button", { name: /进入项目工作/ }));
    const palette = await screen.findByRole("dialog", { name: "会话所属项目" });
    // The auto workspace is nobody's project, so no row is the current one.
    const rows = within(palette).queryAllByRole("option");
    expect(rows.some((row) => row.getAttribute("data-current") === "")).toBe(false);
  });

  it("switches to the picked project without asking when nothing was said yet", async () => {
    const user = userEvent.setup();
    const palette = await openPalette(user, "DeepSeek-Reasonix");

    await user.click(within(palette).getByRole("option", { name: /my-website/ }));
    await waitFor(() => expect(switched).toEqual([SECOND]));
    expect(autos).toBe(0);
    expect(screen.queryByRole("dialog", { name: "会话所属项目" })).toBeNull();
  });

  it("asks the pane's kernel for its auto workspace from 不使用项目", async () => {
    const user = userEvent.setup();
    const palette = await openPalette(user, "DeepSeek-Reasonix");

    await user.click(within(palette).getByRole("button", { name: "不使用项目" }));
    await waitFor(() => expect(autos).toBe(1));
    expect(switched).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "会话所属项目" })).toBeNull();
  });

  it("shows nothing once the conversation carries a transcript", async () => {
    buildHub({ content: true });
    render(<App hub={hub} />);
    await screen.findByRole("combobox", { name: "任务输入" });
    // The pill is the fresh conversation's guide: a pane that has already
    // said something is placed, wherever it lives, and shows no guide. The
    // content flag rides the status read, so its departure is awaited.
    await waitFor(() => expect(pillQuery()).toBeNull());
    expect(screen.queryByRole("dialog", { name: "会话所属项目" })).toBeNull();
  });

  it("goes away once the pane has been placed in a project", async () => {
    const user = userEvent.setup();
    const palette = await openPalette(user, "DeepSeek-Reasonix");

    await user.click(within(palette).getByRole("option", { name: /my-website/ }));
    await waitFor(() => expect(switched).toEqual([SECOND]));
    expect(pillQuery()).toBeNull();
  });

  it("goes away after 不使用项目 confirms the task", async () => {
    const user = userEvent.setup();
    const palette = await openPalette(user, "DeepSeek-Reasonix");

    await user.click(within(palette).getByRole("button", { name: "不使用项目" }));
    await waitFor(() => expect(autos).toBe(1));
    expect(pillQuery()).toBeNull();
  });

  it("hands 使用现有文件夹 to the folder adder, and the session opens through it", async () => {
    const user = userEvent.setup();
    hub.pickFolder = async () => "/work/picked-project";
    const added = vi.spyOn(hub, "addWorkspace");
    const palette = await openPalette(user, "DeepSeek-Reasonix");

    await user.click(within(palette).getByRole("button", { name: "添加新项目" }));
    await user.click(within(palette).getByRole("button", { name: "使用现有文件夹" }));
    await waitFor(() => expect(added).toHaveBeenCalledWith("/work/picked-project"));
  });

  it("stands down where the kernel refuses to be repointed", async () => {
    buildHub({ canSwitch: false });
    render(<App hub={hub} />);
    await screen.findByRole("combobox", { name: "任务输入" });

    await waitFor(() => expect((screen.getByRole("button", { name: "DeepSeek-Reasonix" }) as HTMLButtonElement).disabled).toBe(true));
  });

  it("closes on Escape without switching", async () => {
    const user = userEvent.setup();
    await openPalette(user, "DeepSeek-Reasonix");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "会话所属项目" })).toBeNull();
    expect(switched).toEqual([]);
    expect(autos).toBe(0);
  });
});
