package serve

import (
	"context"
	"strings"
	"time"

	"reasonix/internal/provider"
	"reasonix/internal/session"
)

// SetDesktopSessionStore attaches a read-only view of the Desktop's v5 session
// store (desktop-sessions-v5/by-id) to this server, together with the path of
// the workspace registry that groups those sessions and hides the ones the
// Desktop keeps out of its own sidebar.
//
// The service must be opened observation-only (session.OpenDesktopStore does
// this). Serve never writes through it: it lists v5 sessions and answers cold
// history reads, so a Desktop process that owns the same store is never
// disturbed. A nil service leaves Serve with its legacy-only behavior, which is
// what a host without a Desktop store gets.
//
// registryPath is read on each listing, not cached, because the Desktop
// rewrites it as its membership changes. An empty path lists every session
// ungrouped and visible.
//
// Call this before the listener starts serving: the fields it sets are read by
// request handlers without further synchronization.
func (s *Server) SetDesktopSessionStore(service *session.Service, registryPath string) {
	s.desktopV5 = service
	s.desktopWorkspaceState = strings.TrimSpace(registryPath)
}

// closeDesktopStore releases the read-only Desktop store. Its cold-query
// projection workers are joined here so a Serve shutdown leaves no goroutine
// holding a handle into the Desktop's store directory.
func (s *Server) closeDesktopStore() {
	if s.desktopV5 == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = s.desktopV5.Shutdown(ctx)
	s.desktopV5 = nil
	s.desktopWorkspaceState = ""
}

// desktopV5Rows lists the Desktop's v5 sessions as Serve session rows.
//
// These rows carry no legacy transcript path: a v5 session's identity is its
// SessionID, and workspace membership is presentation state, not a locator.
// They are announced as taken over because Serve holds no write authority over
// the Desktop store, so a client offers a read-only view rather than a resume
// that cannot succeed.
func (s *Server) desktopV5Rows(ctx context.Context) []sessionListEntry {
	if s.desktopV5 == nil {
		return nil
	}
	query := s.desktopV5.Query()
	if query == nil {
		return nil
	}
	hostID := s.desktopV5.HostID()
	// The registry is the Desktop's own authority for membership and
	// visibility, and it is rewritten while the Desktop runs, so it is read
	// here rather than snapshotted at startup.
	workspaces := session.LoadDesktopWorkspaceIndexAt(ctx, s.desktopWorkspaceState)
	// One List call caps at 100 rows in session-id order, so a long-lived store
	// would otherwise hide an arbitrary subset. The row bound keeps a broken
	// cursor from looping forever, matching the canonical catalog walk.
	const pageLimit = 100
	const maxRows = 500
	rows := make([]sessionListEntry, 0)
	cursor := ""
	for pages := 1; ; pages++ {
		page, err := query.List(ctx, cursor, pageLimit)
		if err != nil {
			break
		}
		for _, info := range page.Sessions {
			sessionID := strings.TrimSpace(info.SessionID)
			if sessionID == "" {
				continue
			}
			// The registry is the authority for what the Desktop shows. A
			// session it hides (archived, deleted, or a pending create that
			// never became a conversation) stays out of this listing too.
			if workspaces.Hidden(sessionID) {
				continue
			}
			row := sessionListEntry{
				HostID:        hostID,
				SessionID:     sessionID,
				Name:          sessionID,
				Path:          "",
				Title:         strings.TrimSpace(info.Title),
				Turns:         info.Turns,
				Preview:       strings.TrimSpace(info.Preview),
				MtimeMilli:    info.UpdatedAt.UnixMilli(),
				MetadataReady: info.MetadataStatus == session.MetadataReady,
				TakenOver:     true,
			}
			if workspace, ok := workspaces.Workspace(sessionID); ok {
				row.WorkspaceID = workspace.ID
				row.WorkspaceTitle = workspace.Title
			}
			// A cold row carries no legacy preview fallback, so a chatted
			// session would list as untitled until its catalog metadata is
			// rebuilt. Borrow the preview the way the canonical rows do.
			if row.Title == "" && row.Preview != "" {
				row.Title = truncatedPreview(row.Preview)
			}
			rows = append(rows, row)
		}
		if page.NextCursor == "" || page.NextCursor == cursor || pages*pageLimit >= maxRows || len(rows) >= maxRows {
			break
		}
		cursor = page.NextCursor
	}
	return rows
}

// desktopV5Query resolves a v5 session identity to the read-only Desktop
// store's query surface. It reports false when this server has no Desktop store
// or the identity is not one of its sessions, so callers fall through to their
// own store's error path.
func (s *Server) desktopV5Query(ctx context.Context, sessionID string) (*session.Query, session.SessionRef, bool) {
	sessionID = strings.TrimSpace(sessionID)
	if s.desktopV5 == nil || sessionID == "" {
		return nil, session.SessionRef{}, false
	}
	query := s.desktopV5.Query()
	if query == nil {
		return nil, session.SessionRef{}, false
	}
	ref := session.SessionRef{HostID: s.desktopV5.HostID(), SessionID: sessionID}
	if _, err := query.Stat(ctx, ref); err != nil {
		return nil, session.SessionRef{}, false
	}
	return query, ref, true
}

// desktopV5History reads a v5 session's committed messages through the
// read-only Desktop store. The Desktop writer may live in another process; the
// durable event log is the shared source of truth and this read takes no writer
// lease, exactly like Serve's other cold identity reads.
func (s *Server) desktopV5History(sessionID string) ([]provider.Message, bool) {
	sessionID = strings.TrimSpace(sessionID)
	if s.desktopV5 == nil || sessionID == "" {
		return nil, false
	}
	query := s.desktopV5.Query()
	if query == nil {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ref := session.SessionRef{HostID: s.desktopV5.HostID(), SessionID: sessionID}
	msgs, err := query.History(ctx, ref)
	if err != nil {
		return nil, false
	}
	return msgs, true
}
