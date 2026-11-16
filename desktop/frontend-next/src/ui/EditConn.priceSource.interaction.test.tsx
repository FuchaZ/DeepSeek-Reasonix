// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { EditConn } from "./EditConn";
import { MockPort } from "../port/mock";
import type { ProviderEdit, ProviderEntry } from "../port/port";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const entry = (over: Partial<ProviderEntry> = {}): ProviderEntry => ({
  name: "gw", kind: "openai", baseUrl: "https://gw.example/v1", models: ["alpha", "beta"], default: "alpha", hasKey: true,
  keyEnv: "GW_KEY", inUse: false, preset: false, ...over,
} as ProviderEntry);

async function open(e: ProviderEntry) {
  const port = new MockPort();
  const edit = vi.spyOn(port, "editProvider").mockResolvedValue(undefined as never);
  const external = vi.spyOn(port, "openExternal").mockResolvedValue(undefined as never);
  render(<EditConn entry={e} port={port as never} busy="" setBusy={() => {}} onDone={() => {}} onRevert={() => {}} />);
  await screen.findByText("按模型设置价格");
  // The per-model tuning folds shut; opening it is part of reaching the rows.
  await userEvent.click(screen.getByRole("button", { name: /按模型设置价格/ }));
  return { edit, external };
}
const field = (name: string) => screen.getByRole<HTMLInputElement>("textbox", { name });
const save = () => screen.getByRole<HTMLButtonElement>("button", { name: /保存/ });
const priced = { input: 3, output: 15, cacheHit: 0.3, currency: "USD" };
const today = () => new Date().toISOString().slice(0, 10);

describe("where a price came from", () => {
  it("sends the source and the check date typed under a price", async () => {
    const { edit } = await open(entry({ modelPrices: { alpha: priced } }));
    fireEvent.change(field("alpha 的价格来源"), { target: { value: "https://gw.example/pricing" } });
    fireEvent.change(field("alpha 的核对日期"), { target: { value: "2026-10-01" } });
    await userEvent.click(save());
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect((edit.mock.calls[0]![0] as ProviderEdit).modelPrices).toEqual({ alpha: { ...priced, sourceUrl: "https://gw.example/pricing", checked: "2026-10-01" } });
  });

  it("shows the host of a stored source, opens it only when clicked, and never asks for it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { external } = await open(entry({ modelPrices: { alpha: { ...priced, sourceUrl: "https://gw.example/pricing?x=1", checked: "2026-10-01" } } }));
    expect(screen.getByText("gw.example")).toBeTruthy();
    expect(external).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "alpha 打开价格来源" }));
    expect(external).toHaveBeenCalledWith("https://gw.example/pricing?x=1");
  });

  it("keeps a stored source when the price is edited, and drops it with the price", async () => {
    const { edit } = await open(entry({ modelPrices: { alpha: { ...priced, sourceUrl: "https://gw.example/pricing", checked: "2026-10-01" } } }));
    fireEvent.change(field("alpha 的输入单价"), { target: { value: "" } });
    fireEvent.change(field("alpha 的输出单价"), { target: { value: "" } });
    await userEvent.click(save());
    await waitFor(() => expect(edit).toHaveBeenCalled());
    expect((edit.mock.calls[0]![0] as ProviderEdit).modelPrices).toEqual({ alpha: null });
  });

  it("refuses a source that is not an http(s) link, and a date after today in UTC, and says why", async () => {
    await open(entry({ modelPrices: { alpha: priced } }));
    fireEvent.change(field("alpha 的价格来源"), { target: { value: "javascript:alert(1)" } });
    expect(screen.getByText("来源必须是 http 或 https 链接，不能带用户名密码。")).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.change(field("alpha 的价格来源"), { target: { value: "https://gw.example/p" } });
    expect(save().disabled).toBe(false);
    for (const hidden of ["https://api-docs.deep\u200bseek.com/pricing", "https://api-docs.deep\u00adseek.com/pricing", "https://gw.example/\u202elmth.gnicirp"]) {
      fireEvent.change(field("alpha 的价格来源"), { target: { value: hidden } });
      expect(screen.getByText("来源必须是 http 或 https 链接，不能带用户名密码。")).toBeTruthy();
      expect(save().disabled).toBe(true);
    }
    fireEvent.change(field("alpha 的价格来源"), { target: { value: "https://gw.example/p" } });
    fireEvent.change(field("alpha 的核对日期"), { target: { value: "2999-01-01" } });
    expect(screen.getByText("核对日期不能晚于今天（按 UTC）。")).toBeTruthy();
    expect(save().disabled).toBe(true);
    expect(field("alpha 的核对日期").getAttribute("placeholder")).toBe("YYYY-MM-DD");
    fireEvent.change(field("alpha 的核对日期"), { target: { value: today() } });
    expect(save().disabled).toBe(false);
  });
});
