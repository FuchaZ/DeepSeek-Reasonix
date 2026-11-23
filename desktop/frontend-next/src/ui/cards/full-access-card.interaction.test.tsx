// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalCard } from "./ApprovalCard";
import { t } from "../../i18n";

// "Confirm full access" settles this card too, so one click moves the run on:
// the person who clicked it meant this call, whatever posture covered it. Only
// a card with no approval id to answer stays, and says why.

const bashCard = {
  t: "approval" as const,
  id: "i1",
  a: {
    id: "a1",
    tool: "bash",
    subject: "cd x && powershell -Command y",
    reason: "this command runs another command through nesting",
    reasonCode: "dynamic_bash",
    allowsSession: true,
    allowsPersist: false,
  },
};

afterEach(cleanup);

const draw = (onFullAccess: (id: string) => Promise<boolean>) =>
  render(<ApprovalCard item={bashCard as never} onApprove={async () => {}} onFullAccess={onFullAccess} onPlan={async () => {}} />);

describe("switching to full access from a card", () => {
  it("closes the confirm box once the card itself was let through", async () => {
    const { container } = draw(async () => true);
    await userEvent.click(screen.getAllByRole("button", { name: t("chat.switch_to_full_access") })[0]);
    await userEvent.click(screen.getByRole("button", { name: t("chat.confirm_full_access") }));
    await waitFor(() => expect(container.querySelector(".apv-yolo-confirm")).toBeNull());
    expect(screen.queryByText(t("chat.full_access_is_on_this_one_still_needs"))).toBeNull();
  });

  it("says so if the card could not be answered either", async () => {
    const { container } = draw(async () => false);
    await userEvent.click(screen.getAllByRole("button", { name: t("chat.switch_to_full_access") })[0]);
    await userEvent.click(screen.getByRole("button", { name: t("chat.confirm_full_access") }));
    await waitFor(() => expect(container.querySelector(".apv-yolo-confirm")).toBeNull());
    expect(screen.getByText(t("chat.full_access_is_on_this_one_still_needs"))).toBeTruthy();
  });

  it("keeps the box open when the switch failed, so the failure is visible there", async () => {
    const { container } = draw(async () => {
      throw new Error("busy");
    });
    await userEvent.click(screen.getAllByRole("button", { name: t("chat.switch_to_full_access") })[0]);
    await userEvent.click(screen.getByRole("button", { name: t("chat.confirm_full_access") }));
    await waitFor(() => expect(container.querySelector(".apv-yolo-confirm")).toBeTruthy());
  });
});
