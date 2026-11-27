package serve

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/provider"
	"reasonix/internal/state/sessionstore"
)

// After a restart no pane holds a dispatched session; the sidebar must still
// list it from its transcript, under the task it was opened to do.
func TestTreeListsADispatchedSessionFromDisk(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	root := testenv.TempDir(t)
	h := NewHub(HubOptions{})
	if err := addRememberedWorkspace(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(SessionDirFor(root), "20260101-000000-dispatch.jsonl")
	s := sessionstore.NewSession("system instructions")
	s.Add(provider.Message{
		Role: provider.RoleUser, HostAuthored: true,
		Content:    "composed",
		RawContent: "fix the login loop",
	})
	s.Add(provider.Message{Role: provider.RoleAssistant, Content: "done"})
	if err := s.SaveSnapshot(path); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(operatorHandler(h))
	defer srv.Close()
	var row *treeSession
	for _, ws := range hubGet[[]treeWorkspace](t, srv, "/tree") {
		if filepath.Clean(ws.Root) != filepath.Clean(root) {
			continue
		}
		for i := range ws.Sessions {
			if filepath.Clean(ws.Sessions[i].Path) == filepath.Clean(path) {
				row = &ws.Sessions[i]
			}
		}
	}
	if row == nil {
		t.Fatalf("the dispatched session was not listed after restart")
	}
	if row.Title != "fix the login loop" {
		t.Fatalf("row title = %q, want the session's subject", row.Title)
	}
	if row.Turns != 0 {
		t.Fatalf("row turns = %d, want 0: the person opened no turn", row.Turns)
	}
}

// A dispatch names the session before its first transcript exists. While the
// pane is open the sidebar's temporary row has to carry that name, not fall
// back to "New session" for the whole life of the dispatched session.
func TestAnOpenDispatchedPaneShowsItsRoleTitleBeforeTheFirstSave(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	root := testenv.TempDir(t)
	h := NewHub(HubOptions{})
	rt := hubRuntime(t, h, root)
	path := sessionstore.NewSessionPath(SessionDirFor(root), "dispatch")
	rt.Server.Controller().SetSessionPath(path)
	if err := sessionstore.RenameSession(path, "reviewer"); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(operatorHandler(h))
	defer srv.Close()
	var row *treeSession
	for _, ws := range hubGet[[]treeWorkspace](t, srv, "/tree") {
		for i := range ws.Sessions {
			if ws.Sessions[i].RuntimeID == rt.ID {
				row = &ws.Sessions[i]
			}
		}
	}
	if row == nil {
		t.Fatalf("the open dispatch pane got no row")
	}
	if row.Title != "reviewer" {
		t.Fatalf("row title = %q, want the role the dispatch wrote", row.Title)
	}
}
