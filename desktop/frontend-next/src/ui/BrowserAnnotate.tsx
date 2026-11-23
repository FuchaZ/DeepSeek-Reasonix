import { useState } from "react";
import { t } from "../i18n";
import { reason } from "../i18n/kernel";
import type { PickedElement } from "../port/host";
import type { PageAnnotation } from "./annotations";

interface Props {
  element: PickedElement;
  /** The notes already pinned to the page being shown. */
  annotations: PageAnnotation[];
  /** Pins a note to the picked element and answers the updated list. */
  onSave: (note: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSubmit: (ann: PageAnnotation) => Promise<void>;
}

export function BrowserAnnotate({ element, annotations, onSave, onRemove, onSubmit }: Props) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  const save = async () => {
    const text = note.trim();
    if (!text) {
      setSaid(t("workbench.annotate_nothing"));
      return;
    }
    setBusy(true);
    setSaid("");
    try {
      await onSave(text);
      setNote("");
      setSaid(t("workbench.annotate_saved"));
    } catch (e) {
      setSaid(reason(e));
    } finally {
      setBusy(false);
    }
  };

  const run = (work: Promise<unknown>) => {
    setBusy(true);
    setSaid("");
    void work.then(
      () => setBusy(false),
      (e) => {
        setBusy(false);
        setSaid(reason(e));
      },
    );
  };

  return (
    <section className="belement" aria-label={t("workbench.annotate_title")}>
      <header className="belement-head">
        <code title={element.selector}>{element.selector}</code>
      </header>
      <label className="belement-field">
        <span>{t("workbench.annotate_note")}</span>
        <input value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} spellCheck={false} />
      </label>
      <div className="belement-foot">
        <button type="button" data-action="browser.annotate-save" disabled={busy} onClick={() => void save()}>{t("workbench.annotate_save")}</button>
        {said && <p role="status" className="studio-browser-note">{said}</p>}
      </div>
      {annotations.length > 0 && (
        <ul className="belement-notes">
          {annotations.map((ann) => (
            <li key={ann.id}>
              <code title={ann.selector}>{ann.selector}</code>
              <span>{ann.note}</span>
              <button type="button" data-action="browser.annotate-send" data-target={ann.id} disabled={busy} onClick={() => run(onSubmit(ann))}>{t("workbench.annotate_send")}</button>
              <button type="button" data-action="browser.annotate-remove" data-target={ann.id} disabled={busy} onClick={() => run(onRemove(ann.id))}>{t("workbench.annotate_remove")}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
