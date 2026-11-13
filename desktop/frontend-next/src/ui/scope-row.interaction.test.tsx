// @vitest-environment jsdom
import "./testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScopeAway, ScopeRow } from "./CapabilityScope";
import type { CapabilityScope } from "../port/port";

const VIEW = { width: 1560, height: 878 };
const realView = { width: window.innerWidth, height: window.innerHeight };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: realView.width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: realView.height });
});

// jsdom lays nothing out, so a portaled list would measure zero against zero
// and the clamp would be indistinguishable from no clamp at all.
const rect = (left: number, top: number, width: number, height: number) =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect;

/** mockBoxes answers the two measurements placement needs — the pill it hangs
 *  from and the box it draws — and nothing else. */
function mockBoxes(boxes: { pill: DOMRect; list: DOMRect }) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: VIEW.width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: VIEW.height });
  const real = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("scope-pick")) return boxes.list;
    if (this.dataset.action === "ext.scope") return boxes.pill;
    return real.call(this);
  });
}

const scope = (over: Partial<CapabilityScope> = {}): CapabilityScope => ({
  key: "a", root: "/work/app", name: "app", label: "", repo: true, trees: 1, current: true, overrides: 0, branch: "main", ...over,
}) as CapabilityScope;
const scopes = [scope(), scope({ key: "b", root: "/work/site", name: "site", current: false, overrides: 2 })];

describe("the extension scope row in settings", () => {
  it("names the project in a pill, with where it is and what it carries below", () => {
    render(<ScopeRow scope={scope({ trees: 15 })} scopes={scopes} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /app/ })).toBeTruthy();
    expect(screen.getByText("管理哪个项目的扩展")).toBeTruthy();
    const info = document.querySelector(".scopeinfo")!;
    expect(info.textContent).toContain("/work/app");
    expect(info.textContent).toContain("main");
    expect(info.textContent).toContain("15 个工作树共用这份设置");
    expect(info.textContent).toContain("没有本项目的例外");
  });

  it("counts the exceptions a project carries", () => {
    render(<ScopeRow scope={scope({ overrides: 3 })} scopes={scopes} onPick={() => {}} />);
    expect(document.querySelector(".scopeinfo")!.textContent).toContain("3 项只在这里生效");
  });

  it("opens the project list from the pill and hands back the chosen root", async () => {
    const onPick = vi.fn();
    render(<ScopeRow scope={scope()} scopes={scopes} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /app/ }));
    await userEvent.click(screen.getByRole("option", { name: /site/ }));
    expect(onPick).toHaveBeenCalledWith("/work/site");
    expect(screen.queryByRole("option")).toBeNull();
  });

  // The settings page is an overflow:auto scroll box, so a list left in its
  // flow is cut at that edge however it is positioned inside. It has to leave.
  it("draws the project list outside the page that would clip it", async () => {
    mockBoxes({ pill: rect(800, 600, 96, 24), list: rect(0, 0, 320, 240) });
    render(<ScopeRow scope={scope()} scopes={scopes} onPick={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /app/ }));
    const list = screen.getByRole("listbox");
    expect(list.parentElement).toBe(document.body);
    expect(list.style.left).toBe("800px");
    expect(Number.parseFloat(list.style.left) + 320).toBeLessThanOrEqual(1560 - 6);
    expect(Number.parseFloat(list.style.top) + 240).toBeLessThanOrEqual(878 - 6);
  });

  it("opens upward when the bottom of the window is closer than the list is tall", async () => {
    mockBoxes({ pill: rect(800, 780, 96, 24), list: rect(0, 0, 320, 240) });
    render(<ScopeRow scope={scope()} scopes={scopes} onPick={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /app/ }));
    const list = screen.getByRole("listbox");
    const top = Number.parseFloat(list.style.top);
    expect(top).toBeLessThan(780);
    expect(top + 240).toBeLessThanOrEqual(878 - 6);
    expect(Number.parseFloat(list.style.left) + 320).toBeLessThanOrEqual(1560 - 6);
  });

  it("closes the list on Escape and leaves the pill ready for the next pick", async () => {
    mockBoxes({ pill: rect(800, 300, 96, 24), list: rect(0, 0, 320, 240) });
    render(<ScopeRow scope={scope()} scopes={scopes} onPick={() => {}} />);
    const pill = screen.getByRole("button", { name: /app/ });
    await userEvent.click(pill);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(pill.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the extension page naming another project", () => {
  it("says whose list it is and offers the way back", async () => {
    const onBack = vi.fn();
    render(<ScopeAway scope={scope({ name: "site", current: false })} onBack={onBack} />);
    expect(screen.getByRole("note").textContent).toContain("正在管理 site 的扩展，不是当前会话所在的项目。");
    await userEvent.click(screen.getByRole("button", { name: "回到当前项目" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("the project pill on the extension page", () => {
  it("opens the same list in place and hands back the chosen root", async () => {
    const { ScopePill } = await import("./CapabilityScope");
    const onPick = vi.fn();
    render(<ScopePill scope={scope()} scopes={scopes} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /app/ }));
    await userEvent.click(screen.getByRole("option", { name: /site/ }));
    expect(onPick).toHaveBeenCalledWith("/work/site");
  });
});
