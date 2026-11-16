// In-app feedback: a report the maintainers triage, the receipt that follows
// it, and the thread of replies under it. Field names are the kernel's json
// tags; a refusal is told apart by its code, never by its sentence.

export type FeedbackCategory = "bug" | "idea" | "question" | "other";

export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = ["bug", "idea", "question", "other"];

// What a person may see. A report waiting for triage reads as received; one
// the maintainers declined reads as closed, with no reason.
export type FeedbackStatus =
  | "received" | "needs_info" | "answered" | "recorded" | "in_progress" | "fixed" | "wontfix" | "duplicate" | "closed" | "withdrawn";

export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = [
  "received", "needs_info", "answered", "recorded", "in_progress", "fixed", "wontfix", "duplicate", "closed", "withdrawn",
];

export const isUnderReview = (item: Pick<FeedbackItem, "status" | "underReview" | "statusUnavailable">): boolean =>
  item.status === "received" && item.underReview === true && !item.statusUnavailable;

// Only these take a reply from the reporter; the service has the last word. A
// reply to a fixed report says the fix did not hold and reopens it. A received
// report takes one once it is released: one still under review reads as received
// too, and is not asked for anything.
export const FEEDBACK_REPLYABLE: readonly FeedbackStatus[] = ["needs_info", "answered", "recorded", "in_progress", "fixed"];

export const canReplyTo = (item: Pick<FeedbackItem, "status" | "underReview" | "statusUnavailable">): boolean =>
  !item.statusUnavailable && (FEEDBACK_REPLYABLE.includes(item.status) || (item.status === "received" && !isUnderReview(item)));

// A report can be taken back until it has an outcome; the service has the last word.
export const FEEDBACK_WITHDRAWABLE: readonly FeedbackStatus[] = ["received", "needs_info", "answered", "recorded", "in_progress"];

export const canWithdraw = (item: Pick<FeedbackItem, "status" | "statusUnavailable">): boolean =>
  !item.statusUnavailable && FEEDBACK_WITHDRAWABLE.includes(item.status);

// One process's memory as a report carries it: a type from a fixed list and two
// sizes in kilobytes. Nothing in it names a path, a process id or a user.
export type FeedbackProcessType = "browser" | "renderer" | "gpu" | "utility" | "kernel";

export interface FeedbackProcessMemory {
  process: FeedbackProcessType;
  workingSetKB: number;
  privateKB: number;
}

export interface FeedbackEnvInfo {
  version: string;
  commit: string;
  surface: string;
  os: string;
  osVersion: string;
  arch: string;
  locale: string;
  channel: string;
  providerKind: string;
  // The kernel's own row; the window's shell adds the rest when a report is sent.
  memory?: FeedbackProcessMemory[];
}

// uploadBytes bounds one raw file the page may hand over; the kernel shrinks
// and re-encodes it, and imageBytes is what is finally sent.
export interface FeedbackLimits {
  bodyBytes: number;
  nameChars: number;
  contactChars: number;
  images: number;
  imageBytes: number;
  uploadBytes: number;
  replyBytes: number;
}

export interface FeedbackEnv {
  env: FeedbackEnvInfo;
  displayName: string;
  limits: FeedbackLimits;
}

export interface FeedbackImage {
  name: string;
  dataBase64: string;
}

export interface FeedbackRequest {
  idempotencyKey: string;
  category: FeedbackCategory;
  body: string;
  displayName: string;
  contact?: string;
  // The UI language tag, so the issue can be triaged in the reporter's language.
  locale?: string;
  images: FeedbackImage[];
  // The shell's process rows; the kernel keeps the fixed types and adds its own.
  memory?: FeedbackProcessMemory[];
  // Answer to a feedback.challenge_required refusal.
  turnstileToken?: string;
}

export interface FeedbackReplyReceipt {
  replyId: number;
  createdAt: string;
}

export interface FeedbackReceipt {
  receipt: string;
  status: FeedbackStatus;
  createdAt: string;
  redacted: boolean;
  // A maintainer is reading the report before it is listed; status stays received.
  underReview: boolean;
}

export type FeedbackAuthor = "maintainer" | "user";

// Plain text only: never linked, formatted or interpreted.
export interface FeedbackReply {
  id: number;
  author: FeedbackAuthor;
  body: string;
  createdAt: string;
}

export interface FeedbackItem {
  // A report another device of the same account filed; read marks stay on this computer.
  otherInstall?: boolean;
  receipt: string;
  category: FeedbackCategory;
  titleSnippet: string;
  status: FeedbackStatus;
  issueNumber?: number;
  issueUrl?: string;
  // "vX.Y.Z", or the literal "next" while the fix is merged and not yet shipped.
  resolvedVersion?: string;
  duplicateOf?: number;
  // The report was filed under an install identity this machine no longer holds.
  statusUnavailable?: boolean;
  // The maintainers are waiting for the reporter's answer.
  needsInput: boolean;
  // A received report a maintainer is reading; a service that omits it reads as false.
  underReview: boolean;
  // Oldest first.
  replies: FeedbackReply[];
  // Maintainer replies newer than the last one the kernel was told was seen.
  unreadReplies: number;
  createdAt: string;
  updatedAt: string;
}

// What the service admits from this install right now. It follows live trust,
// so it can sit below what the level alone would allow.
export interface FeedbackEffectiveLimits {
  reportsPerHour: number;
  reportsPerDay: number;
  repliesPerHour: number;
}

// Why the install is admitted at the limits it is. Only active and
// legacy_active raise them; a value the page does not know raises nothing.
export type FeedbackTrustState = "active" | "legacy_active" | "lapsed" | "revoked" | "none";

// The install's earned standing, derived by the service from shipped outcomes
// and never sent by the page. The thresholds ride with it, so the page holds no
// table. The next* fields and remaining are all null at the top level.
export interface FeedbackProfile {
  level: number;
  adoptedCount: number;
  currentThreshold: number;
  nextLevel: number | null;
  nextThreshold: number | null;
  remaining: number | null;
  trustState: FeedbackTrustState;
  trustExpiresAt: string | null;
  observedAt: string;
  effectiveLimits: FeedbackEffectiveLimits;
}

// offline: the service was unreachable, so items are the receipts remembered
// on this machine and their statuses may be stale; profile is then the last one
// the service confirmed.
// unread counts the reports wanting attention; hasNew is unread > 0.
// profile is null when the service stated none the kernel could trust.
export interface FeedbackMine {
  items: FeedbackItem[];
  offline: boolean;
  unread: number;
  hasNew: boolean;
  profile?: FeedbackProfile | null;
  // A level the service now states that this machine has not told the person about.
  promotion?: FeedbackPromotion | null;
}

export interface FeedbackPromotion {
  from: number;
  to: number;
}

// One install an account holds, as the service lists it: the short id, when it
// was linked, and whether it is this machine. The install's token never comes
// with it.
export interface FeedbackLinkedInstall {
  id: string;
  linkedAt: string;
  current: boolean;
}

// The window a refusal came from, as the service names it. A refusal carries
// these in its params; an identifier not listed here is still a window.
export const FEEDBACK_LIMIT = {
  ipHourly: "ip_hourly",
  installHourly: "install_hourly",
  installDaily: "install_daily",
  replyHourly: "reply_hourly",
  replyItem: "reply_item",
  globalDaily: "global_daily",
  globalBurst: "global_burst",
} as const;

// One person on the contribution board: the name they chose, how many of their
// suggestions shipped, where, and (in a release view only) their place.
export interface FeedbackBoardEntry {
  displayName: string;
  credits: number;
  rank: number | null;
  releases: FeedbackBoardRelease[];
}

export interface FeedbackBoardRelease {
  version: string;
  count: number;
}

// The public board. available is false where the service does not serve one, which
// hides the section rather than failing it.
export interface FeedbackBoard {
  available: boolean;
  view: "all" | "release";
  release: string | null;
  entries: FeedbackBoardEntry[];
}

// What the signed-in person has chosen about being on the board.
export interface FeedbackBoardMe {
  listed: boolean;
  displayName: string | null;
  // A maintainer removed this account; it cannot list itself again until restored.
  delisted: boolean;
}

export const FEEDBACK_REPO_ISSUES = "https://github.com/FuchaZ/DeepSeek-Reasonix/issues/";

export const FEEDBACK_NEXT_VERSION = "next";

export const FEEDBACK_CODE = {
  invalid: "feedback.invalid",
  tooLarge: "feedback.too_large",
  rateLimited: "feedback.rate_limited",
  busy: "feedback.busy",
  imageMetadata: "feedback.image_metadata",
  disabled: "feedback.disabled",
  duplicate: "feedback.duplicate",
  badToken: "feedback.bad_token",
  replyLimit: "feedback.reply_limit",
  notReplyable: "feedback.not_replyable",
  notWithdrawable: "feedback.not_withdrawable",
  notFound: "feedback.not_found",
  challengeRequired: "feedback.challenge_required",
  accountRequired: "feedback.account_required",
  linkConflict: "feedback.link_conflict",
  linkLimit: "feedback.link_limit",
  noInstall: "feedback.no_install",
  offline: "feedback.offline",
  unavailable: "feedback.unavailable",
  internal: "feedback.internal",
  badBody: "request.bad_body",
} as const;
