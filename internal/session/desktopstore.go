package session

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"reasonix/internal/config"
	"reasonix/internal/workspacestate"
)

// DesktopStoreHostID is the host identity the Desktop application opens its own
// store with. A Serve process reading the same store uses it too, so a
// SessionRef{HostID, SessionID} resolved on one side means the same session on
// the other and neither side has to translate identities.
const DesktopStoreHostID = "local"

// OpenDesktopStore opens the Desktop v5 session store (config.DesktopSessionStoreDir)
// for reading alongside the Serve process's own sessions-v4 store, together
// with the workspace registry index that groups and filters those sessions.
//
// The returned service is observation-only: MetadataOnlyListings keeps listing
// from replaying session content or publishing catalog metadata, and every read
// goes through the store's cold path, which never takes the writer lease and
// never modifies a session's own files. Query projections under the store root's
// .query-cache are the same disposable caches the Desktop rebuilds itself.
//
// It returns an error when the store path is unavailable on this host. Callers
// that must degrade to legacy-only behavior treat any error as "no desktop
// store here".
func OpenDesktopStore() (*Service, string, error) {
	root := strings.TrimSpace(config.DesktopSessionStoreDir())
	if root == "" {
		return nil, "", fmt.Errorf("session: desktop session store path is unavailable")
	}
	service, err := NewService(DesktopStoreHostID, NewFilesystemPersistence(root))
	if err != nil {
		return nil, "", err
	}
	service.MetadataOnlyListings()
	return service, strings.TrimSpace(config.DesktopWorkspaceStatePath()), nil
}

// LoadDesktopWorkspaceIndexAt reads the workspace registry at path. It is the
// path-based entry point for hosts and tests that hold no registry store.
func LoadDesktopWorkspaceIndexAt(ctx context.Context, path string) *DesktopWorkspaceIndex {
	if strings.TrimSpace(path) == "" {
		return emptyDesktopWorkspaceIndex()
	}
	return LoadDesktopWorkspaceIndex(ctx, workspacestate.NewStore(path))
}

func emptyDesktopWorkspaceIndex() *DesktopWorkspaceIndex {
	return &DesktopWorkspaceIndex{bySession: map[string]DesktopWorkspace{}, hidden: map[string]struct{}{}}
}

// DesktopWorkspace is one workspace's display identity.
type DesktopWorkspace struct {
	ID    string
	Title string
}

// DesktopWorkspaceIndex is a read-only projection of the Desktop workspace
// registry (desktop/workspace-state-v1.json): which workspace owns a session,
// and which sessions the Desktop itself keeps out of its sidebar.
//
// It is the authority for listing, not for storage: a session is still opened
// by SessionID alone. Workspace membership is presentation state.
type DesktopWorkspaceIndex struct {
	bySession map[string]DesktopWorkspace
	hidden    map[string]struct{}
}

// LoadDesktopWorkspaceIndex reads the registry through store. A nil store, a
// missing file, or an unreadable/future-version registry yields an empty index
// rather than an error: the session store can exist without one, and listing
// must not fail because display metadata is unavailable.
func LoadDesktopWorkspaceIndex(ctx context.Context, store *workspacestate.Store) *DesktopWorkspaceIndex {
	index := &DesktopWorkspaceIndex{bySession: map[string]DesktopWorkspace{}, hidden: map[string]struct{}{}}
	if store == nil {
		return index
	}
	state, err := store.Load(ctx)
	if err != nil {
		return index
	}
	for _, id := range orderedWorkspaceIDs(state) {
		workspace, ok := state.Workspaces[id]
		if !ok || !workspace.Visible {
			continue
		}
		title := strings.TrimSpace(workspace.Title)
		if title == "" {
			title = strings.TrimSpace(id)
		}
		for _, raw := range workspace.SessionIDs {
			sessionID := strings.TrimSpace(raw)
			if sessionID == "" {
				continue
			}
			if _, exists := index.bySession[sessionID]; exists {
				continue // first workspace wins, matching the registry's ownership rule
			}
			index.bySession[sessionID] = DesktopWorkspace{ID: strings.TrimSpace(id), Title: title}
		}
	}
	// A lifecycle other than active (archived, deleted) is hidden, as the
	// desktop sidebar hides it. An absent entry means active: the registry
	// records transitions, not the initial state.
	for sessionID, status := range state.SessionStates {
		lifecycle := strings.TrimSpace(status.Lifecycle)
		if lifecycle != "" && lifecycle != workspacestate.Active {
			index.hidden[strings.TrimSpace(sessionID)] = struct{}{}
		}
	}
	// A pending create is a reservation, not yet a conversation: the desktop
	// does not expose a tab for it, so it must not appear in a listing either.
	for sessionID := range state.PendingCreates {
		index.hidden[strings.TrimSpace(sessionID)] = struct{}{}
	}
	return index
}

// Workspace reports the workspace that owns sessionID.
func (i *DesktopWorkspaceIndex) Workspace(sessionID string) (DesktopWorkspace, bool) {
	if i == nil {
		return DesktopWorkspace{}, false
	}
	workspace, ok := i.bySession[strings.TrimSpace(sessionID)]
	return workspace, ok
}

// Hidden reports whether the desktop keeps sessionID out of its own sidebar.
func (i *DesktopWorkspaceIndex) Hidden(sessionID string) bool {
	if i == nil {
		return false
	}
	_, hidden := i.hidden[strings.TrimSpace(sessionID)]
	return hidden
}

// Registered reports whether sessionID is a member of a visible workspace.
func (i *DesktopWorkspaceIndex) Registered(sessionID string) bool {
	_, ok := i.Workspace(sessionID)
	return ok
}

// orderedWorkspaceIDs returns the registry's workspace order, falling back to a
// sorted key order when the durable order is absent.
func orderedWorkspaceIDs(state workspacestate.State) []string {
	if len(state.WorkspaceIDs) > 0 {
		return state.WorkspaceIDs
	}
	ids := make([]string, 0, len(state.Workspaces))
	for id := range state.Workspaces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
