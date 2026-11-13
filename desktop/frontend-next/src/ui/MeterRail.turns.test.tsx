// @vitest-environment jsdom
import "./testkit";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MeterRail } from "./MeterRail";

afterEach(cleanup);

function rail(authoredTurns?: number) {
  return render(
    <MeterRail
      tps={0} trail={[]} running={false} speed={{ output: 0, modelSeconds: 0, average: 0, firstToken: 0 }}
      metrics={{ hit: 0, miss: 0 }} ctx={null} mcp={[]} compact={{ phase: "idle" } as never} cost={[]} wallet={{} as never}
      hideAmounts={false} tasks={[]} jobs={[]} onSettings={vi.fn()} onCancelJob={vi.fn(async () => {})}
      authoredTurns={authoredTurns}
    />,
  );
}

it("names the turns the person started, not the model's replies", () => {
  const { container } = rail(7);
  const chip = container.querySelector(".studio-meter-turns");
  expect(chip?.textContent).toMatch(/对话轮次/);
  expect(chip?.textContent).toMatch(/7/);
});

it("reads zero as a known count, not missing data", () => {
  const { container } = rail(0);
  expect(container.querySelector(".studio-meter-turns")?.textContent).toMatch(/0/);
});
