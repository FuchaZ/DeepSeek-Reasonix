// @vitest-environment jsdom
import "./testkit";
import { useCallback, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MockPort } from "../port/mock";
import type { SessionStatus } from "../port/port";
import { Chrome } from "./Chrome";
import { Pane, type PaneReport } from "./Pane";

afterEach(() => { cleanup(); localStorage.clear(); });
Element.prototype.getAnimations ??= () => [];

/** Chrome and a docked pane in one window, which is the only arrangement in
 *  which the workbench's strip can reach the slot the chrome draws. A pane on
 *  its own finds no slot and keeps the strip in place, so a test that renders
 *  Pane alone proves nothing about the move. */
async function mount() {
  const port = new MockPort();
  const snapshot: SessionStatus = await port.status();
  vi.spyOn(port, "status").mockImplementation(async () => snapshot);
  function Window() {
    const [report, setReport] = useState<PaneReport | null>(null);
    const onReport = useCallback((_: string, next: PaneReport) => setReport(next), []);
    const [browser, setBrowser] = useState(true);
    return <>
      <Chrome port={port} status={report?.status ?? null} workspace={report?.workspace ?? null}
        title="active" steer={0} theme="light" onTheme={() => {}} onFind={() => {}}
        view={browser ? "browser" : "flow"} rows={0} onView={() => {}} />
      <Pane port={port} rt={{ id: "r1", base: "/rt/r1", root: snapshot.workspaceRoot!, name: "workspace" }}
        title="active" active visible sideHost={null} side={false} onFocus={() => {}} onReport={onReport}
        onSessionChanged={() => {}} pulse={0} findPulse={0} onSettings={() => {}} onOpenProject={() => {}}
        theme="light" dockW={520} dockMax={880} onDockW={() => {}}
        manualBrowser={browser} onManualBrowser={setBrowser} />
    </>;
  }
  const view = render(<Window />);
  // The docked workbench mounts its launcher; opening a browser surface gives
  // the strip a tab and makes it discoverable by role.
  const launcher = view.container.querySelector<HTMLElement>('[data-action="workbench.launch-browser"]');
  if (launcher) fireEvent.click(launcher);
  await waitFor(() => expect(screen.getByRole("button", { name: "全屏工作台" })).toBeTruthy());
  return { view, port };
}

const strip = () => document.querySelector(".workbench-tabs");
// The slot is found by its class: the panel reaches it through the registry,
// so the id is no longer part of the contract and asserting on it would pin the
// wrong thing.
const slot = () => document.querySelector<HTMLElement>(".wb-dock-head");

it("puts the docked strip in the window bar's slot, and returns it to the workbench when expanded", async () => {
  await mount();

  const head = slot();
  expect(head, "the chrome draws the slot").toBeTruthy();
  expect(strip()?.parentElement, "docked: the strip lives on the window bar").toBe(head);

  // Expanding the workbench takes the whole window: there is no dock column
  // left for the bar to mirror, so the strip goes back over the canvas.
  act(() => { fireEvent.click(screen.getByRole("button", { name: "全屏工作台" })); });
  await waitFor(() => expect(screen.getByRole("button", { name: "退出工作台全屏" })).toBeTruthy());
  expect(strip()?.parentElement?.classList.contains("workbench"), "expanded: the strip returns to the panel").toBe(true);
  expect(slot()?.childElementCount, "expanded: nothing is left in the slot").toBe(0);
});

it("hands the strip back to the window bar when the workbench returns from full width", async () => {
  await mount();
  act(() => { fireEvent.click(screen.getByRole("button", { name: "全屏工作台" })); });
  await waitFor(() => expect(screen.getByRole("button", { name: "退出工作台全屏" })).toBeTruthy());

  act(() => { fireEvent.click(screen.getByRole("button", { name: "退出工作台全屏" })); });
  await waitFor(() => expect(strip()?.parentElement).toBe(slot()));
});

it("keeps focus on the full-width control across the move between its two homes", async () => {
  await mount();
  const toggle = screen.getByRole("button", { name: "全屏工作台" });
  toggle.focus();
  expect(document.activeElement).toBe(toggle);

  act(() => { fireEvent.click(toggle); });
  // The button is unmounted and mounted again inside the panel; focus follows
  // it rather than falling to the body.
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("退出工作台全屏"));
});

it("returns focus to the control when it goes back to the window bar", async () => {
  await mount();
  act(() => { fireEvent.click(screen.getByRole("button", { name: "全屏工作台" })); });
  const exit = await screen.findByRole("button", { name: "退出工作台全屏" });
  exit.focus();
  act(() => { fireEvent.click(exit); });
  // Expanding put the button in the panel; collapsing mounts it in the dock
  // head, which the panel's own frame no longer contains.
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("全屏工作台"));
});

it("leaves focus alone when the workbench opened by mouse, whichever home the strip is in", async () => {
  // The hand-off belongs to a press, not to mounting: a panel put on screen by
  // a click must not pull focus away from wherever the person is.
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  await mount();
  expect(document.activeElement, "mounting does not steal focus").toBe(outside);
  outside.remove();
});

it("keeps the strip in the panel when the dock has stacked into the pane's whole width", async () => {
  // Stacked, there is no second column for the bar to mirror: the strip has to
  // stay over the canvas. jsdom loads no stylesheet, so the flag that CSS would
  // set is written here instead — but it is read through the same property, so
  // dropping the stacked check in the panel turns this red.
  await mount();
  expect(strip()?.parentElement, "docked first: the strip is on the bar").toBe(slot());

  const column = document.querySelector<HTMLElement>('.pane > .scroll[data-pane="browser"]')!;
  act(() => {
    column.style.setProperty("--dock-stacked", "1");
    // The panel re-reads on a fold change; the property write alone emits no
    // event jsdom would forward.
    document.documentElement.setAttribute("data-fold", "rail side scene");
  });

  await waitFor(() => expect(strip()?.parentElement?.classList.contains("workbench"), "stacked: the strip returns to the panel").toBe(true));
  expect(slot()?.childElementCount, "stacked: the bar has nothing to mirror").toBe(0);
});
