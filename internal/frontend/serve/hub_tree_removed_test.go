package serve

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"testing"

	"reasonix/internal/base/testenv"
)

func postRemoveWorkspace(t *testing.T, srv *httptest.Server, path string) *http.Response {
	t.Helper()
	body, err := json.Marshal(map[string]string{"path": path})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.Post(srv.URL+"/tree/workspaces/remove", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func treeRoots(t *testing.T, srv *httptest.Server) []treeWorkspace {
	t.Helper()
	return hubGet[[]treeWorkspace](t, srv, "/tree")
}

// treeRootsArchived reads the tree the way the sidebar's 已归档 scope does:
// that is where a removed project's ghost row stands.
func treeRootsArchived(t *testing.T, srv *httptest.Server) []treeWorkspace {
	t.Helper()
	return hubGet[[]treeWorkspace](t, srv, "/tree?scope=archived")
}

func treeRowFor(rows []treeWorkspace, dir string) *treeWorkspace {
	for i := range rows {
		if sameFolder(rows[i].Root, dir) {
			return &rows[i]
		}
	}
	return nil
}

func readListRemoved(t *testing.T) []string {
	t.Helper()
	list, err := readWorkspaceList(workspacesPath())
	if err != nil {
		t.Fatal(err)
	}
	return list.Removed
}

// A removed project's archive stays reachable for as long as it exists: the
// ghost row lists the archived conversations, unarchiving one works there the
// same as anywhere, and deleting the last conversation retires the record —
// the ghost row and the tombstone go together, so nothing invisible is kept.
func TestARemovedProjectKeepsItsArchiveUntilItEmpties(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	dir := testenv.TempDir(t)
	sessionPath := filepath.Join(SessionDirFor(dir), "kept.jsonl")
	writeSessionAt(t, sessionPath)
	if err := addRememberedWorkspace(t.Context(), dir); err != nil {
		t.Fatal(err)
	}

	hub := NewHub(HubOptions{})
	defer hub.Shutdown()
	srv := httptest.NewServer(operatorHandler(hub))
	defer srv.Close()

	resp := postRemoveWorkspace(t, srv, dir)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("remove = %d, want 204", resp.StatusCode)
	}
	ghost := treeRowFor(treeRootsArchived(t, srv), dir)
	if ghost == nil || !ghost.Removed {
		t.Fatalf("the removed project left no ghost row in the 已归档 scope: %+v", treeRootsArchived(t, srv))
	}
	if treeRowFor(treeRoots(t, srv), dir) != nil {
		t.Fatalf("an archive-only ghost row leaked into the everyday list: %+v", treeRoots(t, srv))
	}
	if ghost.Archived != 1 || len(ghost.Sessions) != 1 || !ghost.Sessions[0].Archived {
		t.Fatalf("the ghost row does not show the archived conversation: %+v", ghost)
	}

	// Unarchive is a tree mutation like any other; a removed project's session
	// dir is still owned, so the row answers the same actions it always did.
	post := func(route string, body any) int {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		answer, err := http.Post(srv.URL+route, "application/json", bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		defer answer.Body.Close()
		return answer.StatusCode
	}
	if code := post("/tree/sessions/archive", map[string]any{"path": sessionPath, "archived": false}); code != http.StatusNoContent {
		t.Fatalf("unarchive on a ghost row = %d, want 204", code)
	}
	// An unarchived conversation is live work again: the row returns to the
	// everyday list with it.
	ghost = treeRowFor(treeRoots(t, srv), dir)
	if ghost == nil || ghost.Archived != 0 || len(ghost.Sessions) != 1 || ghost.Sessions[0].Archived {
		t.Fatalf("the unarchived conversation is not a live row of the ghost: %+v", ghost)
	}

	// The last conversation goes; the record retires with it.
	if code := post("/tree/sessions/remove", map[string]any{"path": sessionPath}); code != http.StatusNoContent {
		t.Fatalf("remove = %d, want 204", code)
	}
	if rows := treeRoots(t, srv); treeRowFor(rows, dir) != nil {
		t.Fatalf("an emptied ghost row outlived its archive: %+v", rows)
	}
	if removed := readListRemoved(t); slices.Contains(removed, projectIdentity(dir)) {
		t.Errorf("an emptied removal stayed on record: %+v", removed)
	}
}

// Subagent transcripts are bookkeeping, not conversations: a removed folder
// whose session dir holds only them has an empty archive, so it leaves no
// ghost row and its record retires at once.
func TestAnArchiveOfOnlySubagentTranscriptsIsNotAGhost(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	dir := testenv.TempDir(t)
	writeSessionAt(t, filepath.Join(SessionDirFor(dir), "subagent-run.jsonl"))
	if err := addRememberedWorkspace(t.Context(), dir); err != nil {
		t.Fatal(err)
	}

	hub := NewHub(HubOptions{})
	defer hub.Shutdown()
	srv := httptest.NewServer(operatorHandler(hub))
	defer srv.Close()

	resp := postRemoveWorkspace(t, srv, dir)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("remove = %d, want 204", resp.StatusCode)
	}
	for name, rows := range map[string][]treeWorkspace{"everyday": treeRoots(t, srv), "archived": treeRootsArchived(t, srv)} {
		if treeRowFor(rows, dir) != nil {
			t.Fatalf("bookkeeping alone kept a row for the removed folder in %s: %+v", name, rows)
		}
	}
	if removed := readListRemoved(t); slices.Contains(removed, projectIdentity(dir)) {
		t.Errorf("a removal with nothing left to show stayed on record: %+v", removed)
	}
}

// A tombstone written before removals carried the folder path — every record
// this build's predecessor left behind — still names a ghost row: the
// identity is the folder's canonical path, and it answers on disk as one.
// The conversation is filed under that spelling, since the legacy record is
// all the ghost has; a folder spelled differently falls back to silence.
func TestALegacyTombstoneWithoutAPathStillShowsItsArchive(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	dir := testenv.TempDir(t)
	writeSessionAt(t, filepath.Join(SessionDirFor(projectIdentity(dir)), "held.jsonl"))
	list, err := readWorkspaceList(workspacesPath())
	if err != nil {
		t.Fatal(err)
	}
	// Write the removal the old build made: the identity, and nothing else.
	list.Removed = []string{projectIdentity(dir)}
	list.RemovedPaths = nil
	if err := updateWorkspaceList(t.Context(), false, func(l *workspaceList) error {
		*l = list
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	hub := NewHub(HubOptions{})
	defer hub.Shutdown()
	srv := httptest.NewServer(operatorHandler(hub))
	defer srv.Close()

	ghost := treeRowFor(treeRootsArchived(t, srv), dir)
	if ghost == nil || !ghost.Removed {
		t.Fatalf("a legacy tombstone left no ghost row in the 已归档 scope: %+v", treeRootsArchived(t, srv))
	}
}

// Search reaches what the everyday list hides: an archived conversation of a
// removed project answers a matching query, under its ghost row, from the
// scope the sidebar searches with.
func TestSearchSurfacesARemovedProjectsArchive(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	dir := testenv.TempDir(t)
	path := filepath.Join(SessionDirFor(dir), "kept.jsonl")
	writeSessionAt(t, path)
	if err := addRememberedWorkspace(t.Context(), dir); err != nil {
		t.Fatal(err)
	}
	hub := NewHub(HubOptions{})
	defer hub.Shutdown()
	srv := httptest.NewServer(operatorHandler(hub))
	defer srv.Close()
	resp := postRemoveWorkspace(t, srv, dir)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("remove = %d, want 204", resp.StatusCode)
	}

	rows := hubGet[[]treeWorkspace](t, srv, "/tree?q=hello")
	ghost := treeRowFor(rows, dir)
	if ghost == nil || !ghost.Removed || len(ghost.Sessions) != 1 {
		t.Fatalf("a search over a removed project's archive found nothing: %+v", rows)
	}
}
