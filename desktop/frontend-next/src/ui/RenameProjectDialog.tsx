import { useRef } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { StudioIcon } from "./StudioIcon";
import { useCenteredCard } from "./useCenteredCard";

/** 重命名项目: the display name of one remembered project. It is a card of its
 *  own rather than an inline field because the sidebar clips its contents, and
 *  a name is typed while the tree behind it still reads. */
export function RenameProjectDialog({ root, name, onName, onClose, onSave }: {
  root: string;
  name: string;
  onName: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  useCenteredCard(card);
  const trimmed = name.trim();
  return createPortal(
    <div ref={card} className="workspace-blank" role="dialog" aria-label={t("session.rename_project")}>
      <div className="workspace-blank-head">
        <span className="workspace-blank-mark"><StudioIcon name="edit" /></span>
        <button className="workspace-palette-close" aria-label={t("common.close")} data-action="workspace.rename-close" onClick={onClose}><StudioIcon name="close" /></button>
      </div>
      <h2>{t("session.rename_project")}</h2>
      <p className="picknote">{root}</p>
      <label className="workspace-blank-field">
        <span>{t("session.project_display_name")}</span>
        <input autoFocus data-action-blur="workspace.rename" data-action-change="workspace.rename" data-action-keydown="workspace.rename"
          value={name} onChange={(ev) => onName(ev.currentTarget.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter" && trimmed) onSave(); }} />
      </label>
      <div className="workspace-blank-go">
        <button data-action="layer.dismiss" onClick={onClose}>{t("common.cancel")}</button>
        <button className="pick" data-action="workspace.rename" disabled={!trimmed} onClick={onSave}>{t("common.save")}</button>
      </div>
    </div>, document.body);
}
