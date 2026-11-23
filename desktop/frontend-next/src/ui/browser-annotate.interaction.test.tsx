// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import "./testkit";
import { host, type BrowserControl, type BrowserPick, type BrowserPickLabels } from "../port/host";
import type { BrowserTab } from "../port/port";
import { AgentBrowserPanel } from "./BrowserPanel";
import type { AnnotateCapability, PageAnnotation } from "./annotations";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const file: BrowserTab = { id: "b1", target: "v1", title: "Demo", url: "file:///work/site/a.html", active: true };
const picked: BrowserPick = {
  cancelled: false,
  element: { selector: "#note", tagName: "p", text: "hello" },
};
const pinned: PageAnnotation = {
  id: "n1",
  pageUrl: "file:///work/site/a.html",
  selector: "#note",
  tagName: "p",
  text: "hello",
  note: "needs a rewrite",
  createdAt: 1,
};
const elsewhere: PageAnnotation = { ...pinned, id: "n2", pageUrl: "https://elsewhere/", note: "another page" };

let pick: Mock<(target: string, labels: BrowserPickLabels) => Promise<BrowserPick>>;

beforeEach(() => {
  const shell = host();
  vi.spyOn(shell, "drawsBrowserViews").mockReturnValue(true);
  vi.spyOn(shell, "picksBrowserElements").mockReturnValue(true);
  vi.spyOn(shell, "showBrowserView").mockImplementation(() => {});
  vi.spyOn(shell, "hideBrowserView").mockImplementation(() => {});
  vi.spyOn(shell, "annotateBrowserView").mockImplementation(() => Promise.resolve(1));
  pick = vi.fn(async () => picked);
  vi.spyOn(shell, "pickBrowserElement").mockImplementation(pick);
  vi.spyOn(shell, "cancelBrowserPick").mockImplementation(() => {});
  vi.spyOn(shell, "controlBrowserView").mockImplementation((() => {}) as unknown as (target: string, action: BrowserControl) => void);
});

function annotator(over: Partial<AnnotateCapability> = {}) {
  return {
    annotations: [] as PageAnnotation[],
    ensure: vi.fn(async () => {}) as AnnotateCapability["ensure"],
    save: vi.fn(async () => {}) as AnnotateCapability["save"],
    remove: vi.fn(async () => {}) as AnnotateCapability["remove"],
    submit: vi.fn(async () => {}) as AnnotateCapability["submit"],
    ...over,
  } satisfies AnnotateCapability;
}

const pickButton = () => screen.getByRole("button", { name: "点选页面元素" });

describe("pinning a note to a picked element", () => {
  it("saves the note against the element and the page, and says so", async () => {
    const annotate = annotator();
    render(<AgentBrowserPanel tabs={[file]} shown editPage={vi.fn()} annotate={annotate} />);
    fireEvent.click(pickButton());
    const form = await screen.findByRole("form", { name: "修改所选元素" });
    expect(form).toBeTruthy();
    fireEvent.change(screen.getByLabelText("批注"), { target: { value: "needs a rewrite" } });
    fireEvent.click(screen.getByRole("button", { name: "保存批注" }));
    await waitFor(() => expect(annotate.save).toHaveBeenCalledTimes(1));
    expect(annotate.save).toHaveBeenCalledWith(picked.element, "needs a rewrite", "file:///work/site/a.html");
    expect(await screen.findByText("批注已保存")).toBeTruthy();
  });

  it("saves nothing when the note is empty", async () => {
    const annotate = annotator();
    render(<AgentBrowserPanel tabs={[file]} shown editPage={vi.fn()} annotate={annotate} />);
    fireEvent.click(pickButton());
    await screen.findByRole("form", { name: "修改所选元素" });
    fireEvent.click(screen.getByRole("button", { name: "保存批注" }));
    expect(await screen.findByText("写一句批注再保存")).toBeTruthy();
    expect(annotate.save).not.toHaveBeenCalled();
  });

  it("lists this page's notes only, and takes one back on request", async () => {
    const annotate = annotator({ annotations: [pinned, elsewhere] });
    render(<AgentBrowserPanel tabs={[file]} shown editPage={vi.fn()} annotate={annotate} />);
    fireEvent.click(pickButton());
    await screen.findByRole("form", { name: "修改所选元素" });
    expect(screen.getByText("needs a rewrite")).toBeTruthy();
    expect(screen.queryByText("another page")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "删除批注" }));
    await waitFor(() => expect(annotate.remove).toHaveBeenCalledWith("n1"));
  });

  it("hands a note to the agent on request", async () => {
    const annotate = annotator({ annotations: [pinned] });
    render(<AgentBrowserPanel tabs={[file]} shown editPage={vi.fn()} annotate={annotate} />);
    fireEvent.click(pickButton());
    await screen.findByRole("form", { name: "修改所选元素" });
    fireEvent.click(screen.getByRole("button", { name: "发给对话" }));
    await waitFor(() => expect(annotate.submit).toHaveBeenCalledWith(pinned));
  });

  it("keeps the shell's marks in step with this page's notes", async () => {
    const annotate = annotator({ annotations: [pinned, elsewhere] });
    render(<AgentBrowserPanel tabs={[file]} shown editPage={vi.fn()} annotate={annotate} />);
    await waitFor(() =>
      expect(host().annotateBrowserView).toHaveBeenCalledWith("v1", [{ id: "n1", selector: "#note", note: "needs a rewrite" }]),
    );
  });

  it("draws no marks and offers no notes without the capability", async () => {
    render(<AgentBrowserPanel tabs={[file]} shown editPage={vi.fn()} />);
    fireEvent.click(pickButton());
    await screen.findByRole("form", { name: "修改所选元素" });
    expect(screen.queryByLabelText("批注")).toBeNull();
    await waitFor(() => expect(host().annotateBrowserView).not.toHaveBeenCalled());
  });

  it("drops the note form when another page is shown", async () => {
    const web: BrowserTab = { id: "b2", target: "v2", title: "Web", url: "https://example.com/", active: false };
    const annotate = annotator();
    render(<AgentBrowserPanel tabs={[file, web]} shown editPage={vi.fn()} annotate={annotate} />);
    fireEvent.click(pickButton());
    await screen.findByLabelText("批注");
    fireEvent.click(screen.getByRole("tab", { name: "Web" }));
    await waitFor(() => expect(screen.queryByLabelText("批注")).toBeNull());
  });
});
