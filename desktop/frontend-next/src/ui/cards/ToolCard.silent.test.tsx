// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "../testkit";
import { ToolCard } from "./ToolCard";

afterEach(cleanup);

const silentBash = {
  id: "b1", name: "bash", readOnly: false,
  args: JSON.stringify({ command: "mkdir -p build/out" }), output: "",
} as Parameters<typeof ToolCard>[0]["tool"];
const open = (container: HTMLElement) => {
  const details = container.querySelector("details")!;
  details.open = true;
  act(() => { details.dispatchEvent(new Event("toggle")); });
};

describe("a finished command that printed nothing", () => {
  it("keeps the command reachable in the activity row's body", () => {
    const { container } = render(<ToolCard tool={silentBash} running={false} activity />);
    expect(container.querySelector("details")).not.toBeNull();
    open(container);
    expect(container.querySelector(".activity-call-input")?.textContent).toContain("mkdir -p build/out");
  });

  // Outside the activity group there is no input body to open, so the row
  // itself has to carry the command it ran.
  it("keeps the command on the row drawn outside the activity group", () => {
    const { container } = render(<ToolCard tool={silentBash} running={false} />);
    expect(container.querySelector(".hl .arg")?.textContent).toContain("mkdir -p build/out");
  });
});
