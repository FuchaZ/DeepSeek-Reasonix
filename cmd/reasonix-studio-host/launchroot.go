package main

import (
	"os"
	"path/filepath"
	"strings"

	"reasonix/internal/assembly/boot"
	"reasonix/internal/contract/config"
	"reasonix/internal/frontend/serve"
)

// launchWorkspace is the folder the first pane opens: a chosen directory, then
// a remembered project, then the app's own auto workspace. The working
// directory counts only when someone chose it — not the install directory, the
// filesystem root, or the home directory, which a launcher hands over without
// anyone choosing a project; taking one is what kept an uninvited sidebar row.
func launchWorkspace(appExe string) string {
	home, _ := os.UserHomeDir()
	return launchWorkspaceFrom(boot.ResolveWorkspaceRoot(""), appExe, home)
}

// launchWorkspaceFrom is launchWorkspace with the pieces a launch inherits
// resolved. Tests pin both, because what they resolve to is a fact about the
// machine a test cannot arrange.
func launchWorkspaceFrom(cwd, appExe, home string) string {
	return pickLaunchWorkspace(cwd, appExe, home, serve.LaunchWorkspaces(), config.AutoWorkspaceDir())
}

// pickLaunchWorkspace resolves the first pane's folder from the pieces the
// launch hands it: a chosen directory, the first remembered project that still
// exists, the auto workspace, and only when even that will not take does the
// working directory stand in.
func pickLaunchWorkspace(cwd, appExe, home string, remembered []string, auto string) string {
	if userChoseDir(cwd, appExe, home) {
		return cwd
	}
	for _, dir := range remembered {
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			return dir
		}
	}
	if auto != "" && os.MkdirAll(auto, 0o755) == nil {
		return auto
	}
	return cwd
}

// userChoseDir says whether the working directory was chosen: not the install
// directory or the filesystem root a launcher inherits, and not the home
// directory, which a shortcut's start-in field, a shell opened there, or the
// OS default all resolve to without a project being picked.
func userChoseDir(cwd, appExe, home string) bool {
	if cwd == "" || filepath.Dir(cwd) == cwd {
		return false
	}
	if sameRealDir(cwd, home) {
		return false
	}
	rel, err := filepath.Rel(filepath.Dir(appExe), cwd)
	if err != nil {
		return true
	}
	inside := rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
	return !inside
}

// sameRealDir says whether two spellings name one directory. Launchers
// disagree about case and separators on every platform, so the spellings are
// resolved and case-folded first. A false match costs one launch root falling
// back to the remembered projects; a miss puts the home directory in the
// sidebar. An empty spelling names nothing.
func sameRealDir(a, b string) bool {
	if strings.TrimSpace(a) == "" || strings.TrimSpace(b) == "" {
		return false
	}
	a, err := filepath.Abs(a)
	if err != nil {
		return false
	}
	b, err = filepath.Abs(b)
	if err != nil {
		return false
	}
	if real, err := filepath.EvalSymlinks(a); err == nil {
		a = real
	}
	if real, err := filepath.EvalSymlinks(b); err == nil {
		b = real
	}
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}
