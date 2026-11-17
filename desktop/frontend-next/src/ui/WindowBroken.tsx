import { t } from "../i18n";
import { StudioIcon } from "./StudioIcon";

/** What the window shows instead of itself when rendering throws.
 *
 *  A render-time throw unmounts the tree, and a shell with no address bar has
 *  nothing left to press — the whole app reads as blank until it is killed. Any
 *  failure here is a bug worth reporting, but the window it leaves behind has
 *  to be a way out rather than a dead end. */
export function WindowBroken() {
  return (
    <div className="app" data-run="idle">
      <div className="window-broken" role="alertdialog" aria-modal="true" aria-labelledby="window-broken-h">
        <span className="gone-icon" aria-hidden="true"><StudioIcon name="warning" /></span>
        <h1 id="window-broken-h">{t("app.this_window_could_not_draw")}</h1>
        <p className="gone-t">{t("app.something_it_needed_was_missing")}</p>
        <div className="gone-acts">
          <button className="btn" data-primary="" data-action="chrome.reload" onClick={() => location.reload()}>
            <StudioIcon name="refresh" />{t("common.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}
