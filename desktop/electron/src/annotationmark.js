"use strict";

// The page half of the annotation layer, kept as a function so it can be
// stringified into the page. The marks are drawn in the page because a native
// view sits above anything this window's own page draws.
//
// Nothing here may reach out of the function: the page runs it alone, with no
// module and no binding of this process to refer to.

function pageMarks(marks) {
  const KEY = "__reasonixPageMarks";
  const NOTE_CLIP = 120;
  const previous = window[KEY];
  if (previous) previous.clear();
  const placed = [];

  const clear = () => {
    for (const at of placed) at.remove();
    placed.length = 0;
    window.removeEventListener("resize", draw);
    if (window[KEY] && window[KEY].clear === clear) delete window[KEY];
  };

  const clip = (text) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > NOTE_CLIP ? clean.slice(0, NOTE_CLIP) + "…" : clean;
  };

  // Absolute at document coordinates, so scrolling carries the marks with the
  // elements and only a reflow needs a redraw.
  const draw = () => {
    for (const at of placed) at.remove();
    placed.length = 0;
    for (const mark of marks || []) {
      if (!mark || typeof mark.selector !== "string") continue;
      let el = null;
      try {
        el = document.querySelector(mark.selector);
      } catch {
        continue;
      }
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) continue;
      const box = document.createElement("div");
      box.dataset.reasonixMark = "box";
      box.setAttribute("aria-hidden", "true");
      box.style.cssText =
        "position:absolute;z-index:2147483645;pointer-events:none;border:2px solid #f59e0b;" +
        "border-radius:3px;background:rgba(245,158,11,.14);box-sizing:border-box";
      box.style.left = rect.left + window.scrollX + "px";
      box.style.top = rect.top + window.scrollY + "px";
      box.style.width = Math.max(0, rect.width) + "px";
      box.style.height = Math.max(0, rect.height) + "px";
      const note = clip(mark.note);
      if (note) {
        const chip = document.createElement("div");
        chip.dataset.reasonixMark = "note";
        chip.setAttribute("aria-hidden", "true");
        chip.textContent = note;
        chip.style.cssText =
          "position:absolute;z-index:2147483645;pointer-events:none;max-width:280px;overflow:hidden;" +
          "text-overflow:ellipsis;white-space:nowrap;background:#1f2328;color:#e6edf3;border-radius:6px;" +
          "padding:3px 8px;font:11px/1.5 ui-sans-serif,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.24)";
        chip.style.left = rect.left + window.scrollX + "px";
        chip.style.top = Math.max(0, rect.top + window.scrollY - 22) + "px";
        placed.push(chip);
        document.documentElement.append(chip);
      }
      placed.push(box);
      document.documentElement.append(box);
    }
  };

  draw();
  window.addEventListener("resize", draw);
  window[KEY] = { clear };
  return placed.length;
}

// MARK draws one page's marks in the page, replacing whatever layer was there.
const MARK = (marks) => `(${pageMarks.toString()})(${JSON.stringify(marks || [])})`;

module.exports = { MARK };
