package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
)

func TestUserChoseDirRejectsWhatALauncherInherits(t *testing.T) {
	base := testenv.TempDir(t)
	app := filepath.Join(base, "ReasonixStudio")
	exe := filepath.Join(app, "Reasonix Studio.exe")
	home := filepath.Join(base, "home")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, cwd, exe string
		want           bool
	}{
		{"install directory", app, exe, false},
		{"below the install directory", filepath.Join(app, "resources"), exe, false},
		{"filesystem root", filepath.VolumeName(base) + string(filepath.Separator), exe, false},
		{"a project elsewhere", filepath.Join(base, "project"), exe, true},
		{"a sibling sharing the name prefix", app + "-notes", exe, true},
		{"unpackaged run keeps the directory", app, "", true},
		{"the home directory", home, exe, false},
		{"the home directory in another case", strings.ToUpper(home), exe, false},
	}
	for _, c := range cases {
		if got := userChoseDir(c.cwd, c.exe, home); got != c.want {
			t.Errorf("%s: userChoseDir(%q) = %v, want %v", c.name, c.cwd, got, c.want)
		}
	}
}

func TestPickLaunchWorkspaceFallbackOrder(t *testing.T) {
	base := testenv.TempDir(t)
	app := filepath.Join(base, "ReasonixStudio")
	exe := filepath.Join(app, "Reasonix Studio.exe")
	home := filepath.Join(base, "home")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	mk := func(name string) string {
		d := filepath.Join(base, name)
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
		return d
	}
	a, b := mk("a"), mk("b")
	auto := filepath.Join(base, "auto")
	gone := filepath.Join(base, "gone")
	proj := mk("proj")

	cases := []struct {
		name       string
		cwd        string
		remembered []string
		want       string
	}{
		{"chosen directory wins over the list", proj, []string{a}, proj},
		{"list head", app, []string{a, b}, a},
		{"stale head skipped", app, []string{gone, b}, b},
		{"all stale falls to the auto workspace", app, []string{gone}, auto},
		{"empty list falls to the auto workspace", app, nil, auto},
		{"the home directory is not a chosen directory", home, []string{a}, a},
	}
	for _, c := range cases {
		if got := pickLaunchWorkspace(c.cwd, exe, home, c.remembered, auto); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
	// With nothing remembered either, a launch from the home directory still
	// opens the auto workspace rather than the user's own folder.
	if got := pickLaunchWorkspace(home, exe, home, nil, auto); got != auto {
		t.Errorf("a home-directory launch with an empty list opened %q, want the auto workspace %q", got, auto)
	}
}

func TestLaunchWorkspaceKeepsLaunchProjectAfterSidebarReorder(t *testing.T) {
	base := testenv.TempDir(t)
	home := filepath.Join(base, "state")
	app := filepath.Join(base, "app")
	a, b := filepath.Join(base, "a"), filepath.Join(base, "b")
	for _, dir := range []string{home, app, a, b} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("REASONIX_HOME", home)
	data, _ := json.Marshal(map[string]any{"paths": []string{b, a}, "launch": a})
	if err := os.WriteFile(filepath.Join(home, "serve-workspaces.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(app, "Reasonix Studio")
	// The launch's working directory is the install directory, as a desktop
	// launch's is; what the remembered list carries decides the pane.
	if got := launchWorkspaceFrom(app, exe, filepath.Join(base, "userhome")); got != a {
		t.Fatalf("launchWorkspace = %q, want the pre-reorder launch project %q", got, a)
	}
	if err := os.Remove(a); err != nil {
		t.Fatal(err)
	}
	if got := launchWorkspaceFrom(app, exe, filepath.Join(base, "userhome")); got != b {
		t.Fatalf("missing launch project = %q, want next remembered folder %q", got, b)
	}
}

func TestLaunchWithNothingChosenOrRememberedOpensTheAutoWorkspaceNotHome(t *testing.T) {
	base := testenv.TempDir(t)
	state := filepath.Join(base, "state")
	home := filepath.Join(base, "home")
	app := filepath.Join(base, "app")
	for _, dir := range []string{state, home, app} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("REASONIX_HOME", state)
	exe := filepath.Join(app, "Reasonix Studio")

	got := launchWorkspaceFrom(app, exe, home)
	if got == home {
		t.Fatalf("a first launch opened the home directory %q", got)
	}
	if want := config.AutoWorkspaceDir(); got != want {
		t.Fatalf("launchWorkspace = %q, want the auto workspace %q", got, want)
	}
	if st, err := os.Stat(got); err != nil || !st.IsDir() {
		t.Fatalf("the auto workspace was not created: %v", err)
	}
	if rel, err := filepath.Rel(state, got); err != nil || strings.HasPrefix(rel, "..") {
		t.Fatalf("the auto workspace %q is not under the state root %q", got, state)
	}
	// A launch the shell started in the user's own folder — the one that put an
	// uninvited row in the sidebar — opens the auto workspace too.
	if got := launchWorkspaceFrom(home, exe, home); got != config.AutoWorkspaceDir() {
		t.Fatalf("a launch from the home directory opened %q, want the auto workspace", got)
	}
}

// A shell or shortcut that starts the application in the user's own folder is
// the launch that put an uninvited row in the sidebar and kept bringing it
// back after removals. The home directory falls through to what the user
// holds, whatever the remembered list carries.
func TestLaunchFromTheHomeDirectoryOpensWhatTheUserHolds(t *testing.T) {
	base := testenv.TempDir(t)
	state := filepath.Join(base, "state")
	home := filepath.Join(base, "home")
	app := filepath.Join(base, "app")
	a := filepath.Join(base, "a")
	for _, dir := range []string{state, home, app, a} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("REASONIX_HOME", state)
	data, _ := json.Marshal(map[string]any{"paths": []string{a}, "launch": a})
	if err := os.WriteFile(filepath.Join(state, "serve-workspaces.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(app, "Reasonix Studio")

	if got := launchWorkspaceFrom(home, exe, home); got != a {
		t.Fatalf("a launch from the home directory opened %q, want the remembered project %q", got, a)
	}
	// And the home directory is not smuggled back in by a spelling the shell
	// wrote differently.
	if got := launchWorkspaceFrom(strings.ToLower(home), exe, home); got != a {
		t.Fatalf("a launch from a recast home directory opened %q, want the remembered project %q", got, a)
	}
}

func TestPickLaunchWorkspaceCreatesTheAutoWorkspaceLast(t *testing.T) {
	base := testenv.TempDir(t)
	app := filepath.Join(base, "app")
	exe := filepath.Join(app, "Reasonix Studio")
	home := filepath.Join(base, "home")
	auto := filepath.Join(base, "state", "workspaces", "auto")
	if got := pickLaunchWorkspace(app, exe, home, nil, auto); got != auto {
		t.Fatalf("got %q, want %q", got, auto)
	}
	if st, err := os.Stat(auto); err != nil || !st.IsDir() {
		t.Fatalf("not created: %v", err)
	}
	chosen := filepath.Join(base, "proj")
	if err := os.MkdirAll(chosen, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := pickLaunchWorkspace(chosen, exe, home, nil, auto); got != chosen {
		t.Fatalf("a chosen directory must win over the auto workspace: %q", got)
	}
}
