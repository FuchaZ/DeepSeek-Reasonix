package serve

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"

	"reasonix/internal/contract/config"
	"reasonix/internal/state/workspacelist"
)

type workspaceList = workspacelist.List

var errWorkspaceNotRemembered = errors.New("workspace is not remembered")
var errWorkspaceListFull = errors.New("the project list is at the limit you set (desktop.max_workspaces); remove one before adding another")

// workspaceListFull says whether the user's own limit leaves no room for another
// project. No limit is set unless their file sets one.
func workspaceListFull(n int) bool {
	limit := config.LoadForEdit(config.UserConfigPath()).WorkspaceLimit()
	return limit > 0 && n >= limit
}

func workspacesPath() string {
	if dir := config.MemoryUserDir(); dir != "" {
		return filepath.Join(dir, workspacelist.FileName)
	}
	return ""
}

// Workspaces is the sidebar's remembered project order. Projects the user
// removed stay out whatever wrote them back — the removal is the user's last
// word about the folder until they pick it again.
func Workspaces() []string {
	list, _ := readWorkspaceList(workspacesPath())
	paths := list.Paths
	if len(list.Removed) > 0 {
		paths = slices.DeleteFunc(paths, func(dir string) bool { return workspaceRemovedIdentity(list, dir) })
	}
	return paths
}

// LaunchWorkspaces puts the launch project first without changing sidebar order.
// A removed folder is no candidate: the launch picker falls through to one the
// user still holds, and the removal stands.
func LaunchWorkspaces() []string {
	list, _ := readWorkspaceList(workspacesPath())
	paths := list.Paths
	if len(list.Removed) > 0 {
		paths = slices.DeleteFunc(paths, func(dir string) bool { return workspaceRemovedIdentity(list, dir) })
	}
	if list.Launch != "" && !slices.Contains(paths, list.Launch) {
		list.Launch = ""
	}
	if list.Launch == "" {
		return paths
	}
	ordered := []string{list.Launch}
	for _, dir := range paths {
		if dir != list.Launch {
			ordered = append(ordered, dir)
		}
	}
	return ordered
}

func readWorkspaceList(path string) (workspaceList, error) { return workspacelist.Read(path) }

func updateWorkspaceList(ctx context.Context, repair bool, mutate func(*workspaceList) error) error {
	return workspacelist.Update(ctx, workspacesPath(), repair, mutate)
}

// isAutoWorkspace says whether dir is the folder the app opens when nobody chose
// one. It is where such a launch lands, not a project, so no list holds it.
func isAutoWorkspace(dir string) bool {
	auto := config.AutoWorkspaceDir()
	return auto != "" && projectIdentity(dir) == projectIdentity(auto)
}

// workspaceRemovedIdentity says whether dir is one the user took off the
// sidebar. The list stores canonical identities, so any spelling of the folder
// matches.
func workspaceRemovedIdentity(list workspaceList, dir string) bool {
	root := projectIdentity(dir)
	if root == "" {
		return false
	}
	return slices.Contains(list.Removed, root)
}

// workspaceRemoved says whether a removal for dir is on record. Sources that
// list a folder nobody picked — the folder a launch happened to start in, a
// folder a conversation was once held in — must read this before doing so: the
// user's removal outranks them until the folder is asked for again.
func workspaceRemoved(dir string) bool {
	list, _ := readWorkspaceList(workspacesPath())
	return workspaceRemovedIdentity(list, dir)
}

// ensureAutoWorkspace makes the app's own folder on demand and returns it, or ""
// when the state root will not take it. A new session with no project behind it
// opens there instead of being refused.
func ensureAutoWorkspace() string {
	auto := config.AutoWorkspaceDir()
	if auto == "" || os.MkdirAll(auto, 0o755) != nil {
		return ""
	}
	return auto
}

func rememberWorkspace(dir string) {
	if err := addRememberedWorkspace(context.Background(), dir); err != nil {
		slog.Warn("serve: remember workspace", "err", err)
	}
}

func addRememberedWorkspace(ctx context.Context, dir string) error {
	if dir == "" || isAutoWorkspace(dir) {
		return nil
	}
	return updateWorkspaceList(ctx, true, func(list *workspaceList) error {
		// Asking for the folder again is the one thing that lifts a removal:
		// the sidebar carries it from here on, whatever once dismissed it.
		list.Restore(projectIdentity(dir))
		if slices.Contains(list.Paths, dir) {
			return nil
		}
		if workspaceListFull(len(rememberedProjects(list.Paths))) && !hasWorkspaceProject(list.Paths, dir) {
			return refusal(http.StatusConflict, "workspace.limit_reached", errWorkspaceListFull, nil)
		}
		identity := projectIdentity(dir)
		at := slices.IndexFunc(list.Paths, func(path string) bool { return projectIdentity(path) == identity })
		if at < 0 {
			list.Paths = append([]string{dir}, list.Paths...)
		} else {
			list.Paths = slices.Insert(list.Paths, at+1, dir)
		}
		list.Launch = dir
		return nil
	})
}

// keepUsedWorkspace lists a folder a conversation now lives in, behind the ones
// already there so neither the order nor the launch project moves. A pane
// adopted at launch is no folder anyone picked, and its conversations are
// reachable only through a row for it — unless the user removed that folder,
// which stands over this the way it stands over the launch itself.
func keepUsedWorkspace(dir string) {
	if dir == "" || isAutoWorkspace(dir) || workspaceRemoved(dir) {
		return
	}
	err := updateWorkspaceList(context.Background(), true, func(list *workspaceList) error {
		if slices.Contains(list.Paths, dir) || (workspaceListFull(len(rememberedProjects(list.Paths))) && !hasWorkspaceProject(list.Paths, dir)) {
			return nil
		}
		list.Paths = append(list.Paths, dir)
		return nil
	})
	if err != nil {
		slog.Warn("serve: list the folder a conversation lives in", "err", err)
	}
}

// forgetWorkspace takes a folder off the sidebar and records the removal, so no
// source that lists folders nobody picked — the folder a launch started in, a
// folder a conversation was held in, a merged older list — puts the row back on
// the next start. Nothing on disk is touched: the removal is only the sidebar
// forgetting the folder, and asking for it again lifts it.
func forgetWorkspace(dir string) {
	if dir == "" {
		return
	}
	err := updateWorkspaceList(context.Background(), true, func(list *workspaceList) error {
		root := projectIdentity(dir)
		// The auto workspace is not a project; its row is not a removal the
		// list should remember.
		if root != "" && !isAutoWorkspace(dir) {
			list.Remove(root)
		}
		list.Paths = slices.DeleteFunc(list.Paths, func(path string) bool { return projectIdentity(path) == root })
		if projectIdentity(list.Launch) == root {
			list.Launch = ""
			if len(list.Paths) > 0 {
				list.Launch = list.Paths[0]
			}
		}
		return nil
	})
	if err != nil {
		slog.Warn("serve: forget workspace", "err", err)
	}
}

func moveWorkspace(ctx context.Context, dir string, direction int) error {
	return updateWorkspaceList(ctx, false, func(list *workspaceList) error {
		roots := workspaceProjectOrder(list.Paths)
		at := slices.Index(roots, projectIdentity(dir))
		if at < 0 {
			return errWorkspaceNotRemembered
		}
		to := at + direction
		if to >= 0 && to < len(roots) {
			roots[at], roots[to] = roots[to], roots[at]
			list.Paths = orderWorkspaceMembers(list.Paths, roots)
		}
		return nil
	})
}

// placeWorkspace drops dir where a drag left it: before the remembered project
// named by before, or at the end when before is empty. The launch project stays.
func placeWorkspace(ctx context.Context, dir, before string) error {
	return updateWorkspaceList(ctx, false, func(list *workspaceList) error {
		roots := workspaceProjectOrder(list.Paths)
		dir = projectIdentity(dir)
		if before != "" {
			before = projectIdentity(before)
		}
		if !slices.Contains(roots, dir) {
			return errWorkspaceNotRemembered
		}
		if before != "" && !slices.Contains(roots, before) {
			return errWorkspaceNotRemembered
		}
		if dir == before {
			return nil
		}
		rest := slices.DeleteFunc(roots, func(path string) bool { return path == dir })
		at := len(rest)
		if before != "" {
			at = slices.Index(rest, before)
		}
		list.Paths = orderWorkspaceMembers(list.Paths, slices.Insert(rest, at, dir))
		return nil
	})
}
