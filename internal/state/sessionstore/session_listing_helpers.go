package sessionstore

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SessionInfo summarises a saved session for the --resume picker: where it is on
// disk, when it was created/last active, the first user message as a preview, and
// a rough turn count.
type SessionInfo struct {
	MetadataState  string
	Path           string
	CreatedAt      time.Time
	LastActivityAt time.Time
	ModTime        time.Time // compatibility alias for LastActivityAt
	Preview        string
	Turns          int
	CountsKnown    bool
	Scope          string
	WorkspaceRoot  string
	TopicID        string
	TopicTitle     string
	CustomTitle    string
	Archived       bool
	Pinned         bool
	ManualRank     float64
	Unread         bool
	ViewedAt       time.Time
	Recovered      bool
	RecoveryReason string
	RecoveryDigest string
	ParentID       string
	RecoveryRootID string
}

// SessionOrderInfo is the lightweight sidecar/mtime ordering record shared by
// session pickers and prompt-history navigation. It intentionally avoids reading
// JSONL content; callers that need previews can layer that on afterwards.
type SessionOrderInfo struct {
	Path           string
	CreatedAt      time.Time
	LastActivityAt time.Time
	ModTime        time.Time // compatibility alias for LastActivityAt
	Scope          string
	WorkspaceRoot  string
	TopicID        string
	TopicTitle     string
	CustomTitle    string
	Archived       bool
	Pinned         bool
	ManualRank     float64
	Unread         bool
	ViewedAt       time.Time
	Recovered      bool
	RecoveryReason string
	RecoveryDigest string
	ParentID       string
	RecoveryRootID string
	// Turns and Preview are the cached listing fields from the sidecar; SchemaVersion
	// >= BranchMetaCountsVersion means they were recorded from content and can
	// be trusted (even Turns == 0). ListSessions uses them to skip the whole-file decode.
	Turns         int
	Preview       string
	SchemaVersion int
	// Revision and ContentDigest bind a listing backfill to the transcript
	// generation it decoded. They are sidecar-only compare-and-apply guards and
	// are not exposed through SessionInfo.
	Revision      int64
	ContentDigest string
}

func sessionInfoFromOrder(session SessionOrderInfo, preview string, turns int, countsKnown bool) SessionInfo {
	return SessionInfo{
		Path:           session.Path,
		CreatedAt:      session.CreatedAt,
		LastActivityAt: session.LastActivityAt,
		ModTime:        session.ModTime,
		Preview:        preview,
		Turns:          turns,
		CountsKnown:    countsKnown,
		Scope:          session.Scope,
		WorkspaceRoot:  session.WorkspaceRoot,
		TopicID:        session.TopicID,
		TopicTitle:     session.TopicTitle,
		CustomTitle:    session.CustomTitle,
		Archived:       session.Archived,
		Pinned:         session.Pinned,
		ManualRank:     session.ManualRank,
		Unread:         session.Unread,
		ViewedAt:       session.ViewedAt,
		Recovered:      session.Recovered,
		RecoveryReason: session.RecoveryReason,
		RecoveryDigest: session.RecoveryDigest,
		ParentID:       session.ParentID,
		RecoveryRootID: session.RecoveryRootID,
	}
}

func sessionArtifactsHaveContent(path string) bool {
	if info, err := os.Stat(path); err == nil && !info.IsDir() && info.Size() > 0 {
		return true
	}
	return sessionEventLogSize(path) > 0
}

func sessionListingCountsNeedRefresh(schemaVersion, turns int) bool {
	if schemaVersion < branchMetaCountsInitialVersion {
		return true
	}
	return turns == 0 && schemaVersion < BranchMetaCountsVersion
}

func updateSessionListingCountsIfCurrent(session SessionOrderInfo, preview string, turns int) (string, int, error) {
	unlock, err := LockSessionMetaPath(session.Path)
	if err != nil {
		return preview, turns, err
	}
	defer unlock()

	current, err := ensureBranchMetaUnlocked(session.Path)
	if err != nil {
		return preview, turns, err
	}
	if current.SchemaVersion != session.SchemaVersion ||
		current.Turns != session.Turns ||
		current.Preview != session.Preview ||
		current.Revision != session.Revision ||
		current.ContentDigest != session.ContentDigest {
		return current.Preview, current.Turns, nil
	}
	if !sessionListingCountsNeedRefresh(current.SchemaVersion, current.Turns) {
		return current.Preview, current.Turns, nil
	}

	current.Preview = preview
	current.Turns = turns
	current.SchemaVersion = BranchMetaCountsVersion
	if err := saveBranchMeta(session.Path, current, false); err != nil {
		return preview, turns, err
	}
	return preview, turns, nil
}

func previewSessionWithError(path string) (string, int, error) {
	msgs, _, _, err := loadSessionMessages(path)
	if err != nil {
		return "", 0, err
	}
	preview, turns := SessionPreviewFromMessages(msgs)
	return preview, turns, nil
}

// nativeSessionInfo decides what one native session's listing row says, or
// false when the session has nothing to show. A superseded counts-authoritative
// zero is re-derived once: it may hold a host-opened subject that version could
// not name. Artifacts that never recorded counts stay unknown, as before.
func nativeSessionInfo(session SessionOrderInfo) (SessionInfo, bool) {
	preview, turns := session.Preview, session.Turns
	if sessionListingCountsNeedRefresh(session.SchemaVersion, turns) {
		if !sessionArtifactsHaveContent(session.Path) {
			return SessionInfo{}, false
		}
		if session.SchemaVersion >= branchMetaCountsAuthoritativeVersion {
			refreshedPreview, refreshedTurns, ok := refreshListingCounts(session)
			if ok {
				if refreshedTurns == 0 && strings.TrimSpace(refreshedPreview) == "" {
					return SessionInfo{}, false
				}
				return sessionInfoFromOrder(session, refreshedPreview, refreshedTurns, true), true
			}
		}
		if strings.TrimSpace(preview) == "" {
			preview = "History is being indexed — " + filepath.Base(session.Path)
		}
		return sessionInfoFromOrder(session, preview, turns, false), true
	}
	if turns == 0 && strings.TrimSpace(preview) == "" {
		// Nothing was ever said: no person's turn, no host-opened subject.
		// An empty conversation stays out of the history panel and pickers.
		return SessionInfo{}, false
	}
	return sessionInfoFromOrder(session, preview, turns, true), true
}

// refreshListingCounts derives a stale sidecar's listing fields from the
// transcript and records them when the sidecar has not moved underneath it. ok
// is false when the transcript could not be read whole; the caller then keeps
// the row visible as still being indexed rather than hiding the user's data.
func refreshListingCounts(session SessionOrderInfo) (preview string, turns int, ok bool) {
	preview, turns, err := previewSessionWithError(session.Path)
	if err != nil {
		return session.Preview, session.Turns, false
	}
	if keptPreview, keptTurns, err := updateSessionListingCountsIfCurrent(session, preview, turns); err == nil {
		return keptPreview, keptTurns, true
	}
	return preview, turns, true
}
