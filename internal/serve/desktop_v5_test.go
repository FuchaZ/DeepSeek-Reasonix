package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"reasonix/internal/config"
	"reasonix/internal/control"
	"reasonix/internal/provider"
	"reasonix/internal/session"
	"reasonix/internal/workspacestate"
)

// desktopV5Fixture is an isolated Desktop store plus the Serve process's own
// (empty) v4 store, wired the way a host with both a Desktop and Serve runs.
//
// Every path is under t.TempDir(): these tests must never touch a real
// %APPDATA%\reasonix store, whose Desktop writer is live.
type desktopV5Fixture struct {
	server      *Server
	desktop     *session.Service
	desktopRoot string
	registry    *workspacestate.Store
	registryAt  string
}

func newDesktopV5Fixture(t *testing.T) *desktopV5Fixture {
	t.Helper()
	desktopRoot := filepath.Join(t.TempDir(), "desktop-sessions-v5", "by-id")
	desktop, err := session.NewService(session.DesktopStoreHostID, session.NewFilesystemPersistence(desktopRoot))
	if err != nil {
		t.Fatal(err)
	}
	desktop.MetadataOnlyListings()
	t.Cleanup(func() { _ = desktop.Shutdown(context.Background()) })

	registryAt := filepath.Join(t.TempDir(), "workspace-state-v1.json")
	registry := workspacestate.NewStore(registryAt)
	if err := registry.EnsureWorkspace(t.Context(), workspacestate.Workspace{ID: workspacestate.GlobalWorkspaceID, Root: t.TempDir(), Title: "主对话", Visible: true}); err != nil {
		t.Fatal(err)
	}

	// Serve's own store stays separate: the v5 identities under test are not
	// members of it, which is exactly the gap this change closes.
	serveStore, err := session.NewService(session.DesktopStoreHostID, session.NewFilesystemPersistence(filepath.Join(t.TempDir(), "sessions-v4")))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = serveStore.Shutdown(context.Background()) })

	bc := NewBroadcaster()
	ctrl := control.New(control.Options{SessionService: serveStore, ExclusiveSession: true})
	t.Cleanup(ctrl.Close)
	srv := New(ctrl, bc, config.ServeConfig{})
	srv.SetDesktopSessionStore(desktop, registryAt)
	return &desktopV5Fixture{server: srv, desktop: desktop, desktopRoot: desktopRoot, registry: registry, registryAt: registryAt}
}

// seedChat creates a v5 session with one completed turn and a title, then
// attaches it to the global workspace. The runtime is left live so catalog
// metadata (title, turns) is readable without a rebuild.
func (f *desktopV5Fixture) seedChat(t *testing.T, sessionID, title string) {
	t.Helper()
	runtime, err := f.desktop.Create(t.Context(), session.CreateOptions{SessionID: sessionID})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(map[string]any{"message": provider.Message{ID: "m-" + sessionID, Role: provider.RoleUser, Content: "hello from the desktop"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.Session().Append(t.Context(), session.Batch{OperationID: "op-" + sessionID, TurnID: "turn-" + sessionID, Events: []session.Event{
		{Kind: "turn/start"},
		{Kind: "message/complete", Payload: payload},
		{Kind: "turn/end", Payload: json.RawMessage(`{"status":"completed"}`)},
	}}); err != nil {
		t.Fatal(err)
	}
	if err := f.desktop.SetTitle(t.Context(), runtime.Ref(), title); err != nil {
		t.Fatal(err)
	}
	if err := f.registry.AttachSession(t.Context(), "", workspacestate.GlobalWorkspaceID, sessionID, ""); err != nil {
		t.Fatal(err)
	}
}

func getSessions(t *testing.T, ts *httptest.Server) []sessionListEntry {
	t.Helper()
	resp, err := http.Get(ts.URL + "/sessions")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/sessions status = %d", resp.StatusCode)
	}
	var rows []sessionListEntry
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		t.Fatal(err)
	}
	return rows
}

func rowFor(rows []sessionListEntry, sessionID string) (sessionListEntry, bool) {
	for _, row := range rows {
		if row.SessionID == sessionID {
			return row, true
		}
	}
	return sessionListEntry{}, false
}

// TestSessionsListIncludesDesktopV5Sessions is the change's core behavior: a
// Desktop v5 session, invisible to this process's own store, is listed with its
// identity, workspace grouping, and title, and is announced as taken over
// because Serve holds no write authority over it.
func TestSessionsListIncludesDesktopV5Sessions(t *testing.T) {
	f := newDesktopV5Fixture(t)
	f.seedChat(t, "v5-visible", "桌面上的会话")

	ts := httptest.NewServer(f.server.Handler())
	defer ts.Close()

	row, ok := rowFor(getSessions(t, ts), "v5-visible")
	if !ok {
		t.Fatal("desktop v5 session is missing from /sessions")
	}
	if row.Path != "" {
		t.Errorf("v5 row path = %q, want empty (identity is the SessionID)", row.Path)
	}
	if row.HostID != session.DesktopStoreHostID {
		t.Errorf("v5 row hostId = %q, want %q", row.HostID, session.DesktopStoreHostID)
	}
	if row.Title != "桌面上的会话" {
		t.Errorf("v5 row title = %q, want the desktop title", row.Title)
	}
	if row.Turns != 1 {
		t.Errorf("v5 row turns = %d, want 1", row.Turns)
	}
	if row.WorkspaceID != workspacestate.GlobalWorkspaceID || row.WorkspaceTitle != "主对话" {
		t.Errorf("v5 row workspace = (%q, %q), want the registry's global workspace", row.WorkspaceID, row.WorkspaceTitle)
	}
	if !row.TakenOver {
		t.Error("v5 row must be taken over: serve holds no write authority over the desktop store")
	}
}

// TestSessionsListHidesDesktopHiddenSessions covers the registry's authority
// over what the Desktop shows: an archived session and an unfinished create
// reservation stay out of the listing.
func TestSessionsListHidesDesktopHiddenSessions(t *testing.T) {
	f := newDesktopV5Fixture(t)
	f.seedChat(t, "v5-archived", "已归档")
	if err := f.registry.SetLifecycle(t.Context(), []string{"v5-archived"}, workspacestate.Archived); err != nil {
		t.Fatal(err)
	}
	f.seedChat(t, "v5-pending", "未完成的创建")
	if err := f.registry.BeginCreate(t.Context(), workspacestate.PendingCreate{OperationID: "op-pending", WorkspaceID: workspacestate.GlobalWorkspaceID, SessionID: "v5-pending"}); err != nil {
		t.Fatal(err)
	}

	ts := httptest.NewServer(f.server.Handler())
	defer ts.Close()
	rows := getSessions(t, ts)

	if _, ok := rowFor(rows, "v5-archived"); ok {
		t.Error("archived v5 session must not be listed")
	}
	if _, ok := rowFor(rows, "v5-pending"); ok {
		t.Error("a pending create must not be listed")
	}
}

// TestSessionsListReadsLiveRegistry proves the registry is read per listing
// rather than snapshotted: a session archived after the server was built drops
// out on the next call, which is what a running Desktop's edits require.
func TestSessionsListReadsLiveRegistry(t *testing.T) {
	f := newDesktopV5Fixture(t)
	f.seedChat(t, "v5-live", "还在")
	ts := httptest.NewServer(f.server.Handler())
	defer ts.Close()

	if _, ok := rowFor(getSessions(t, ts), "v5-live"); !ok {
		t.Fatal("seeded v5 session should be listed")
	}
	if err := f.registry.SetLifecycle(t.Context(), []string{"v5-live"}, workspacestate.Archived); err != nil {
		t.Fatal(err)
	}
	if _, ok := rowFor(getSessions(t, ts), "v5-live"); ok {
		t.Error("archiving after startup must take effect without rebuilding the server")
	}
}

// TestDesktopV5ReadsDoNotModifySessionFiles pins the observation-only contract:
// listing and cold-reading a Desktop session must not touch the session's own
// files or take its writer lease. Query projections under the store root are
// disposable caches and are deliberately not compared.
func TestDesktopV5ReadsDoNotModifySessionFiles(t *testing.T) {
	f := newDesktopV5Fixture(t)
	f.seedChat(t, "v5-frozen", "只读")

	// Close the writer so no runtime keeps rewriting the session while we
	// fingerprint it, and so a lease taken by the read path would be visible.
	if err := f.desktop.Close(t.Context(), session.SessionRef{HostID: session.DesktopStoreHostID, SessionID: "v5-frozen"}); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(f.desktopRoot, "v5-frozen")
	before := fingerprintSessionDir(t, dir)

	ts := httptest.NewServer(f.server.Handler())
	defer ts.Close()
	if _, ok := rowFor(getSessions(t, ts), "v5-frozen"); !ok {
		t.Fatal("seeded v5 session should be listed")
	}
	resp, err := http.Get(ts.URL + "/history?session=" + remoteSessionIDQueryPrefix + "v5-frozen")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/history status = %d, want 200", resp.StatusCode)
	}

	after := fingerprintSessionDir(t, dir)
	if after != before {
		t.Errorf("desktop v5 read modified the session directory\nbefore: %s\nafter:  %s", before, after)
	}
	// The seed's Create left a writer lease file behind (Close releases the
	// lease but the file is not removed). The read path must neither add one nor
	// rewrite it, so its presence is compared through the fingerprint above
	// rather than asserted absent.
	if strings.Contains(before, "writer.lock") != strings.Contains(after, "writer.lock") {
		t.Error("a read must not add or remove the writer lease file")
	}
}

// fingerprintSessionDir summarizes a session directory's own files (excluding
// the disposable .query-cache projections) by name, size, and modification time.
func fingerprintSessionDir(t *testing.T, dir string) string {
	t.Helper()
	var entries []string
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".query-cache" {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		entries = append(entries, fmt.Sprintf("%s:%d:%d", d.Name(), info.Size(), info.ModTime().UnixNano()))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(entries)
	return strings.Join(entries, "|")
}

// TestHistoryReadsDesktopV5SessionCold proves the read path: a v5 identity that
// this process's own store does not hold is still readable through Serve, from
// the durable event log, without a controller binding.
func TestHistoryReadsDesktopV5SessionCold(t *testing.T) {
	f := newDesktopV5Fixture(t)
	f.seedChat(t, "v5-cold", "冷读")

	ts := httptest.NewServer(f.server.Handler())
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/history?session=" + remoteSessionIDQueryPrefix + "v5-cold")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/history status = %d, want 200", resp.StatusCode)
	}
	var msgs []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&msgs); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, msg := range msgs {
		if content, _ := msg["content"].(string); strings.Contains(content, "hello from the desktop") {
			found = true
		}
	}
	if !found {
		t.Fatalf("cold history did not return the desktop session's message: %#v", msgs)
	}
}

// TestSessionsWithoutDesktopStoreStayLegacyOnly guards the optional wiring: a
// host with no Desktop store keeps its previous listing behavior and does not
// fail when a v5 identity is requested.
func TestSessionsWithoutDesktopStoreStayLegacyOnly(t *testing.T) {
	bc := NewBroadcaster()
	ctrl := control.New(control.Options{Sink: bc, SessionDir: t.TempDir()})
	t.Cleanup(ctrl.Close)
	ts := httptest.NewServer(New(ctrl, bc, config.ServeConfig{}).Handler())
	defer ts.Close()

	if rows := getSessions(t, ts); len(rows) != 0 {
		t.Fatalf("rows without a desktop store = %#v, want none", rows)
	}
	resp, err := http.Get(ts.URL + "/history?session=" + remoteSessionIDQueryPrefix + "missing")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("/history without a desktop store status = %d, want 409", resp.StatusCode)
	}
}
