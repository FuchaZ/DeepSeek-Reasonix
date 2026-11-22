import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { StudioIcon } from "./StudioIcon";
import { reason } from "../i18n/kernel";
import type { AgentPort, ApprovalMode, SessionStatus } from "../port/port";
import { useDismiss } from "./dismiss";
import { beside, placeInViewport, useFollow, zoom } from "./place";
import { APPROVALS, approvalName } from "./approvals";

// Permission is one boundary, not a catch-all for every way a turn can run.
// Work strategy and model effort live in their own controls beside this one.
interface Props {
  port: AgentPort;
  status: SessionStatus | null;
  onChanged: () => void;
  onBoundary?: () => void;
}

export function Policy({ port, status, onChanged, onBoundary }: Props) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState("");
  const [refused, setRefused] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(open, wrap, () => setOpen(false), menu);
  const put = useCallback(() => {
    const anchor = btn.current?.getBoundingClientRect();
    const el = menu.current;
    if (!anchor || !el || el.hidden) return;
    const s = zoom();
    const box = { width: el.offsetWidth * s, height: el.offsetHeight * s };
    const y = beside({ top: anchor.top, bottom: anchor.bottom }, box.height, innerHeight, "above", 9);
    const at = placeInViewport({ x: anchor.left, y }, box, { width: innerWidth, height: innerHeight }, s);
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
  }, []);
  useFollow(open, put);

  if (!status) return null;

  const apv = status.toolApprovalMode ?? "ask";
  const label = approvalName(apv);
  const apply = (value: ApprovalMode) => {
    if (asking) return;
    setAsking(value);
    setRefused("");
    port.setApprovalMode(value)
      .then(onChanged)
      .catch((e: unknown) => setRefused(reason(e)))
      .finally(() => setAsking(""));
  };

  return (
    <div
      className="picker policy"
      ref={wrap}
      data-quiet={apv === "ask" ? "" : undefined}
    >
      <button
        ref={btn}
        className="mode plain"
        data-action="chrome.policy"
        data-risk={apv === "yolo" ? "" : undefined}
        aria-expanded={open}
        aria-label={`${t("safety.execution_permissions")}：${label}`}
        title={`${t("safety.execution_permissions")}：${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ic" aria-hidden="true">
          {apv === "yolo"
            ? <i className="polwarn"><StudioIcon name="warning" /></i>
            : <StudioIcon name="shield" />}
        </span>
        <span className={apv === "yolo" ? "lb polrisk" : "lb"} data-display={label}>{label}</span>
        <StudioIcon name="down" className="studio-control-chevron" />
      </button>
      {status && createPortal(
        <div
          ref={menu}
          className="menu portmenu pm-up polmenu composer-menu"
          role="group"
          aria-label={t("safety.execution_permissions")}
          hidden={!open}
        >
          <div className="studio-policy-head"><b>{t("safety.execution_permissions")}</b><small>{t("common.current_task")}</small></div>
          <div className="studio-policy-primary">
            {APPROVALS.map(([value, name, note]) => (
              <div key={value}>
                {value === "yolo" && <div className="studio-policy-risk">{t("common.high_risk")}</div>}
                <button
                  className={`studio-permission-option${value === "yolo" ? " studio-permission-yolo" : ""}`}
                  data-action="tool-approval.mode"
                  data-value={value}
                  data-on={apv === value ? "" : undefined}
                  data-pending={asking === value ? "" : undefined}
                  aria-pressed={apv === value}
                  disabled={!!asking}
                  onClick={() => apply(value)}
                >
                  <span><b>{t(name)}</b><small>{t(note)}</small></span>
                  {apv === value && <StudioIcon name="check" className="studio-permission-check" />}
                </button>
              </div>
              ))}
          </div>
          {refused && <div className="note bad studio-policy-error" role="alert">{refused}</div>}
          <div className="studio-policy-note">{t("safety.approvals_decide_when_to_ask")}</div>
          <button className="studio-policy-boundary" data-action="settings.section" data-value="tools:sandbox" onClick={onBoundary} disabled={!onBoundary}>
            <span><b>{t("safety.sandbox_and_runtime_boundary")}</b><small>{t("safety.view_current_isolation_and_network")}</small></span>
            <span aria-hidden="true"><StudioIcon name="chevron" /></span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
