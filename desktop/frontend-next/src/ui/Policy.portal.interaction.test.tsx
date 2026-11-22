// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { Policy } from "./Policy";
import type { AgentPort, SessionStatus } from "../port/port";

afterEach(cleanup);

const STATUS = { preset: "balanced", effort: "medium", toolApprovalMode: "ask" } as SessionStatus;

describe("the policy menu renders through a portal", () => {
  it("renders the open menu into the body, so no ancestor stacking context can trap it under the meter rail", async () => {
    const port = {
      setApprovalMode: vi.fn(async () => {}),
    } as unknown as AgentPort;
    const { container } = render(<Policy port={port} status={STATUS} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "执行权限：询问" }));
    expect(document.body.querySelector(":scope > .polmenu")).toBeTruthy();
    expect(container.querySelector(".polmenu")).toBeNull();
  });

  it("keeps the portaled menu open when a press lands on the menu itself", async () => {
    const port = {
      setApprovalMode: vi.fn(async () => {}),
    } as unknown as AgentPort;
    render(<Policy port={port} status={STATUS} onChanged={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "执行权限：询问" });
    await userEvent.click(trigger);
    const menu = document.body.querySelector(":scope > .polmenu")!;
    menu.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
