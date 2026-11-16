// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";

afterEach(cleanup);

// The second folder the fixture remembers; the per-project 新建 names it.
const SECOND = "~/projects/my-website";

// The picker that used to stand between 新建会话 and the kernel is gone: every
// rootless entry — the sidebar's head button, the palette command, the panes
// area's own button — opens the pane at once and sends no root at all, which is
// the kernel's contract for its own auto workspace. The fixture then lands the
// pane in its first folder, so the claim here is the request shape, not the
// folder it resolved to. The per-project 新建 in the tree was never gated and
// still names its root.
describe("every rootless 新建会话 entry opens the pane directly", () => {
  let hub: MockHub;
  let asked: (string | undefined)[];

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    asked = [];
    hub = new MockHub();
    const open = hub.open.bind(hub);
    hub.open = async (req) => {
      asked.push(req.root);
      return open(req);
    };
    // Past onboarding: a window still asking for a key draws neither the rail
    // nor a panes area, and this is a claim about a window that is working.
    const build = hub.portFor.bind(hub);
    hub.portFor = (rt) => {
      const port = build(rt);
      port.providerSetup = async () => null;
      port.welcomeSeen = async () => true;
      return port;
    };
  });

  // The head button is the one 新建会话 with no folder of its own to belong to.
  it("opens a session with no root at all from the head button", async () => {
    const user = userEvent.setup();
    render(<App hub={hub} />);
    await screen.findByRole("combobox", { name: "任务输入" });

    const head = document.querySelector(".studio-rail-head") as HTMLElement;
    await user.click(within(head).getByRole("button", { name: /新建会话/ }));
    await waitFor(() => expect(asked).toEqual([undefined]));
    expect(await screen.findByRole("combobox", { name: "任务输入" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "选择项目" })).toBeNull();
  });

  it("opens a session with no root at all from the palette command", async () => {
    render(<App hub={hub} />);
    await screen.findByRole("combobox", { name: "任务输入" });

    await act(async () => void fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true }));
    const palette = await screen.findByRole("dialog", { name: "搜索与快捷操作" });
    await userEvent.click([...palette.querySelectorAll("button")].find((b) => b.textContent?.includes("新建会话"))!);
    await waitFor(() => expect(asked).toEqual([undefined]));
    expect(screen.queryByRole("dialog", { name: "选择项目" })).toBeNull();
  });

  it("opens a session with no root at all from the panes area", async () => {
    hub.runtimes = async () => [];
    const { container } = render(<App hub={hub} />);
    await screen.findByText("没有打开的会话");

    const empty = container.querySelector<HTMLElement>(".panes-empty")!;
    await act(async () => { empty.querySelector<HTMLButtonElement>('button[data-action="session.new"]')!.click(); });
    await waitFor(() => expect(asked).toEqual([undefined]));
    expect(screen.queryByRole("dialog", { name: "选择项目" })).toBeNull();
  });

  it("does not gate the per-project 新建 in the tree", async () => {
    const user = userEvent.setup();
    render(<App hub={hub} />);
    await screen.findByRole("combobox", { name: "任务输入" });

    await user.click(screen.getByRole("button", { name: "在 my-website 下新建会话" }));
    await waitFor(() => expect(asked).toEqual([SECOND]));
    expect(screen.queryByRole("dialog", { name: "选择项目" })).toBeNull();
  });
});
