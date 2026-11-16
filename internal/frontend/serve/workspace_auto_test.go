package serve

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/session/control"
)

// The auto workspace is where an unchosen launch opens, not a project anyone
// picked: if the list remembered it, it would become the answer to every later
// launch and sit in the sidebar as a project.
func TestTheAutoWorkspaceIsNeverRemembered(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	auto := config.AutoWorkspaceDir()
	if err := os.MkdirAll(auto, 0o755); err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(testenv.TempDir(t), "project")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := addRememberedWorkspace(context.Background(), auto); err != nil {
		t.Fatal(err)
	}
	keepUsedWorkspace(auto)
	if got := LaunchWorkspaces(); len(got) != 0 {
		t.Fatalf("the auto workspace was remembered: %v", got)
	}

	if err := addRememberedWorkspace(context.Background(), project); err != nil {
		t.Fatal(err)
	}
	if got := LaunchWorkspaces(); len(got) != 1 || got[0] != project {
		t.Fatalf("a chosen project must still be remembered: %v", got)
	}
}

// What is said in an auto-workspace conversation is kept in the user state
// root, with the conversations of every other folder: nothing about it lives in
// a directory that can be deleted out from under it.
func TestAutoWorkspaceConversationsAreKeptUnderTheStateRoot(t *testing.T) {
	state := testenv.TempDir(t)
	t.Setenv("REASONIX_HOME", state)
	dir := SessionDirFor(config.AutoWorkspaceDir())
	if rel, err := filepath.Rel(state, dir); err != nil || len(rel) == 0 || rel[0] == '.' {
		t.Fatalf("session dir %q is not under the state root %q", dir, state)
	}
}

// The pill's 不使用项目 answer names no path: the pane joins the app's own
// folder, created on demand, and that folder never enters the remembered list.
func TestWorkspaceSwitchToAutoUsesTheAppOwnFolder(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	old := control.New(control.Options{})
	replacement := control.New(control.Options{})
	var gotDir string

	s := New(old, NewBroadcaster(), config.ServeConfig{})
	s.AllowWorkspaceSwitch()
	s.buildWorkspaceController = func(_ context.Context, dir, _ string) (*control.Controller, error) {
		gotDir = dir
		return replacement, nil
	}
	srv := httptest.NewServer(operatorHandler(s))
	defer srv.Close()
	defer replacement.Close()

	resp, err := http.Post(srv.URL+"/workspace", "application/json", strings.NewReader(`{"auto":true}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /workspace {auto:true} = %d, want 200", resp.StatusCode)
	}
	want := config.AutoWorkspaceDir()
	if gotDir != want {
		t.Fatalf("built at %q, want the auto workspace %q", gotDir, want)
	}
	if info, err := os.Stat(want); err != nil || !info.IsDir() {
		t.Fatalf("auto workspace was not created: %v", err)
	}
	for _, dir := range LaunchWorkspaces() {
		if isAutoWorkspace(dir) {
			t.Fatalf("auto workspace entered the remembered list: %v", LaunchWorkspaces())
		}
	}
}
