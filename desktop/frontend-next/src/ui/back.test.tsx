// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { takeBack, useBack } from "./back";
import { useDismiss, useEscape } from "./dismiss";

afterEach(cleanup);

function Layer({ log, name }: { log: string[]; name: string }) {
  const [open, setOpen] = useState(true);
  useBack(open, () => {
    log.push(name);
    setOpen(false);
  });
  return null;
}

it("closes the innermost layer first and answers false when none is open", () => {
  const log: string[] = [];
  render(<><Layer name="outer" log={log} /><Layer name="inner" log={log} /></>);
  act(() => { expect(takeBack()).toBe(true); });
  expect(log).toEqual(["inner"]);
  act(() => { expect(takeBack()).toBe(true); });
  expect(log).toEqual(["inner", "outer"]);
  expect(takeBack()).toBe(false);
});

function EscLayer({ close }: { close: () => void }) {
  useEscape(true, close);
  return null;
}

function DismissLayer({ close }: { close: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDismiss(true, box, close);
  return <div ref={box} />;
}

it("makes Escape layers and dismiss layers answer system back", () => {
  const esc = vi.fn();
  const dismiss = vi.fn();
  const first = render(<EscLayer close={esc} />);
  act(() => { expect(takeBack()).toBe(true); });
  expect(esc).toHaveBeenCalledTimes(1);
  first.unmount();

  const second = render(<DismissLayer close={dismiss} />);
  act(() => { expect(takeBack()).toBe(true); });
  expect(dismiss).toHaveBeenCalledTimes(1);
  second.unmount();
  expect(takeBack()).toBe(false);
});
