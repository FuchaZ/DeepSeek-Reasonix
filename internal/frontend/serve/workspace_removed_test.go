package serve

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"reasonix/internal/base/testenv"
)

// A removal is the user's last word about a folder: the sidebar stops listing
// it, nothing that lists folders nobody picked puts it back, and asking for it
// again is the one thing that lifts it.
func TestRemovingAProjectKeepsItOffTheListUntilItIsAskedFor(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	root := testenv.TempDir(t)
	if err := addRememberedWorkspace(context.Background(), root); err != nil {
		t.Fatalf("add: %v", err)
	}
	if !slices.Contains(Workspaces(), root) {
		t.Fatalf("a remembered project is not listed: %v", Workspaces())
	}

	forgetWorkspace(root)
	if slices.Contains(Workspaces(), root) {
		t.Fatalf("a removed project is still listed: %v", Workspaces())
	}
	if slices.Contains(LaunchWorkspaces(), root) {
		t.Fatalf("a removed project is still a launch candidate: %v", LaunchWorkspaces())
	}

	// The sources that list folders nobody picked read the removal first: a
	// conversation held in the folder must not bring the row back.
	keepUsedWorkspace(root)
	if slices.Contains(Workspaces(), root) {
		t.Fatalf("a conversation put a removed project back: %v", Workspaces())
	}

	if err := addRememberedWorkspace(context.Background(), root); err != nil {
		t.Fatalf("add back: %v", err)
	}
	if !slices.Contains(Workspaces(), root) {
		t.Fatalf("asking for the folder again did not lift the removal: %v", Workspaces())
	}
}

// A project that still exists stays where it is; the tombstone bounds what a
// removal writes and nothing else.
func TestARemovalTouchesNoFileOnDisk(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	root := testenv.TempDir(t)
	file := filepath.Join(root, "keep.txt")
	if err := os.WriteFile(file, []byte("here"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := addRememberedWorkspace(context.Background(), root); err != nil {
		t.Fatalf("add: %v", err)
	}
	forgetWorkspace(root)
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("the removal touched the folder: %v", err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("the folder is gone: %v", err)
	}
}
