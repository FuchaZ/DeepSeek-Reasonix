import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import type { TreeWorkspace } from "../port/hub";
import { StudioIcon } from "./StudioIcon";
import { listenAction } from "./listen";
import { useCenteredCard } from "./useCenteredCard";
import { useBack } from "./back";

export interface BlankAdder {
  pickFolder: (preferred?: string) => Promise<string | null>;
  addNamed: (name: string, parent: string) => Promise<TreeWorkspace>;
}

/** 新建空白项目: an empty, named folder inside the folder the picker returned.
 *  The dialog is shared — the composer's pill and the sidebar's 项目 plus both
 *  land a new project with it — and `onDone` carries the workspace that was
 *  made, so each caller decides what to do with it afterwards. */
export function BlankProjectDialog({ adder, onDone, onClose, onError }: {
  adder: BlankAdder;
  onDone: (workspace: TreeWorkspace) => void | Promise<void>;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [name, setName] = useState(t("session.untitled_project"));
  const [parent, setParent] = useState("");
  const [noPicker, setNoPicker] = useState(false);
  const [working, setWorking] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  useCenteredCard(card);
  useBack(true, onClose);
  // The card is its own door: its field starts selected, Escape and an
  // outside click dismiss it, and its buttons are the only way through.
  useEffect(() => {
    card.current?.querySelector<HTMLInputElement>("input")?.select();
    const outside = (event: MouseEvent) => {
      if (!card.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    };
    const stopOutside = listenAction(window, "mousedown", { action: "workspace.create", listener: outside as EventListener });
    const stopKey = listenAction(window, "keydown", { action: "workspace.create", listener: key as EventListener }, true);
    return () => { stopOutside(); stopKey(); };
  }, [onClose]);
  const pickParent = () => {
    // A picker without a desktop host to answer it — null, or an error — falls
    // back to typing the folder: the path field replaces the picker row. The
    // start folder is the platform's own: a fresh conversation works inside the
    // app's own area, and a new project is nobody's subfolder of it.
    void adder.pickFolder("").then((dir) => {
      if (dir) setParent(dir);
      else setNoPicker(true);
    }).catch(() => setNoPicker(true));
  };
  const createBlank = () => {
    const named = name.trim();
    const at = noPicker ? parent.trim() : parent;
    if (!named || !at || working) return;
    setWorking(true);
    void adder.addNamed(named, at)
      .then(async (workspace) => {
        await onDone(workspace);
        onClose();
      })
      .catch(onError)
      .finally(() => setWorking(false));
  };
  return createPortal(<div ref={card} className="workspace-blank" role="dialog" aria-label={t("session.new_blank_project")}>
    <div className="workspace-blank-head">
      <span className="workspace-blank-mark"><StudioIcon name="folder" /></span>
      <button data-action="layer.dismiss" className="workspace-palette-close" aria-label={t("common.close")} onClick={onClose}><StudioIcon name="close" /></button>
    </div>
    <h2>{t("session.new_blank_project")}</h2>
    <label className="workspace-blank-field">
      <span>{t("session.project_name")}</span>
      <input value={name} data-action-change="workspace.create" onChange={(ev) => setName(ev.currentTarget.value)}
        onKeyDown={(ev) => { if (ev.key === "Enter") createBlank(); }} />
    </label>
    <div className="workspace-blank-field">
      <span>{t("session.source_folder")}</span>
      <div className="workspace-blank-pick" data-empty={parent || !noPicker ? undefined : ""}>
        {parent ? (
          <button type="button" data-action="workspace.add-existing" title={parent} onClick={pickParent}>
            <StudioIcon name="folder" /><span>{parent}</span>
          </button>
        ) : noPicker ? (
          <input type="text" placeholder={t("session.the_folder_picker_cannot_open")} data-action-change="workspace.add-existing"
            value={parent} onChange={(ev) => setParent(ev.currentTarget.value)} />
        ) : (
          <button type="button" data-action="workspace.add-existing" onClick={pickParent}>
            <StudioIcon name="folder" /><span>{t("session.choose_folder")}</span>
          </button>
        )}
        <small>{t("session.blank_project_lands_here")}</small>
      </div>
    </div>
    <p className="workspace-blank-hint">{t("session.name_a_folder_first")}</p>
    <div className="workspace-blank-go">
      <button type="button" data-action="layer.dismiss" disabled={working} onClick={onClose}>{t("common.cancel")}</button>
      <button type="button" className="pick" data-action="workspace.create" disabled={working || !name.trim() || !(parent.trim())}
        onClick={createBlank}>{t("session.create_the_project")}</button>
    </div>
  </div>, document.body);
}
