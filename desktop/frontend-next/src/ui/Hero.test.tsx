// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { Hero } from "./Hero";

afterEach(cleanup);

// The hero never asks which project the conversation belongs to — that is the
// composer pill's question, asked wherever the composer is.
describe("the empty conversation's hero", () => {
  it("offers three ways to start and hands the chosen sentence to the composer", async () => {
    const onSuggest = vi.fn();
    render(<Hero onSuggest={onSuggest} />);
    const chips = screen.getAllByRole("button");
    expect(chips.map((b) => b.textContent)).toEqual(["解释这个项目的结构", "找出最近的回归", "给改动写测试"]);
    await userEvent.click(chips[1]!);
    expect(onSuggest).toHaveBeenCalledWith("找出最近的回归");
  });

  it("never asks for a project", () => {
    render(<Hero />);
    expect(screen.queryByText("先打开一个项目")).toBeNull();
    expect(screen.queryByRole("button", { name: "打开项目…" })).toBeNull();
  });
});
