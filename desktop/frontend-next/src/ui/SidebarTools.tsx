import { t } from "../i18n";
import { Settings } from "lucide-react";
import { chord } from "./keys";
import { UpdateDot } from "./UpdateDot";

/** The foot of the column: the settings row, and nothing else. The icon rail's
 *  destinations used to be folded behind a chevron here; they now sit under the
 *  column's own two rows, with 更多 opening the panel that arranges them. */
export function SidebarTools({ onSettings }: { onSettings: (section?: string) => void }) {
  return (
    <div className="studio-tools">
      <div className="studio-tools-row">
        <button className="studio-settings" data-action="chrome.settings" onClick={() => onSettings()} aria-label={t("common.settings")} title={`${t("common.settings")} ${chord(",")}`}>
          <Settings size={16} /><span>{t("common.settings")}</span><UpdateDot />
        </button>
      </div>
    </div>
  );
}
