package serve

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"reasonix/internal/contract/config"
	"reasonix/internal/contract/tool"
	"reasonix/internal/session/control"
	"reasonix/internal/state/sessionstore"
	"reasonix/internal/state/store"
)

var (
	errRenameUnknown  = errors.New("no session answers to that name; name one of your own sessions or a session you dispatched to")
	errRenameNotYours = errors.New("that session was not dispatched to by this one, so it cannot be renamed from here")
	errRenameBadPath  = errors.New("the session path could not be resolved")
	errRenameOutside  = errors.New("path outside a known workspace")
)

// renameSessionFor names the caller's own session (empty to) or one it handed
// a task to, after checking the target still lives in a workspace this hub
// owns. A name change writes the explicit title and refreshes the tree so the
// sidebar and the collaboration board pick it up at once.
func (h *Hub) renameSessionFor(from *Runtime, to, title string) (tool.RenamedSession, error) {
	ctrl, ok := from.Server.Controller().(*control.Controller)
	if !ok {
		return tool.RenamedSession{}, control.ErrRenameUnavailable
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return tool.RenamedSession{}, errors.New("a session name cannot be empty")
	}
	target, targetKind, err := h.resolveRenameTarget(from, ctrl, strings.TrimSpace(to))
	if err != nil {
		return tool.RenamedSession{}, err
	}
	path, err := h.resolveOwnedSessionPath(target)
	if err != nil {
		return tool.RenamedSession{}, err
	}
	if err := h.titleCacheFor(filepath.Dir(path)).putExplicit(filepath.Base(path), title); err != nil {
		return tool.RenamedSession{}, err
	}
	h.treeChanged()
	return tool.RenamedSession{Path: path, Title: title, Target: targetKind}, nil
}

// resolveRenameTarget turns what the model wrote into a session path and says
// whether it named itself ("self") or a dispatched member. Only these two are
// allowed: a key the caller did not dispatch to is refused, never guessed.
func (h *Hub) resolveRenameTarget(from *Runtime, ctrl *control.Controller, to string) (path, kind string, err error) {
	self := ctrl.SessionPath()
	selfKey := control.PeerKeyForPath(self)
	if to == "" || to == "self" || to == self || to == selfKey || strings.EqualFold(to, "自己") {
		if self == "" {
			return "", "", control.ErrRenameUnavailable
		}
		return self, "self", nil
	}

	// Only sessions this caller dispatched to are in scope. The dispatch record
	// (session paths plus the sender's own memory of roles) is the authority; a
	// title match is an affordance on top of it, never a substitute.
	allowed := map[string]string{}
	for _, th := range h.dispatch.threadsFrom(self) {
		if th.SessionPath != "" {
			allowed[th.SessionPath] = th.Key
		}
	}
	for _, id := range h.dispatch.targets(from.ID) {
		if rt := h.runtimeByID(id); rt != nil {
			if c, ok := rt.Server.Controller().(*control.Controller); ok && c.SessionPath() != "" {
				allowed[c.SessionPath()] = control.PeerKeyForPath(c.SessionPath())
			}
		}
	}
	for candidatePath, key := range allowed {
		if to == candidatePath || (key != "" && to == key) {
			return candidatePath, "member", nil
		}
	}
	// A title is how a person names a row, and how list_peers prints one for a
	// session with no explicit title. It resolves only to a session already in
	// scope, so a title never reaches outside what was dispatched.
	for candidatePath := range allowed {
		if title := h.titleForSession(candidatePath); title != "" && to == title {
			return candidatePath, "member", nil
		}
	}
	// A name that resolves to a real session but was not dispatched to is a
	// distinct refusal from a name that resolves to nothing at all.
	for _, root := range h.sessionRoots() {
		dir, err := filepath.Abs(SessionDirFor(root.dir))
		if err != nil {
			continue
		}
		for _, si := range h.treeRowsFor(dir) {
			if to == si.path || to == si.title || to == filepath.Base(si.path) || to == control.PeerKeyForPath(si.path) {
				return "", "", errRenameNotYours
			}
		}
	}
	return "", "", errRenameUnknown
}

// treeRow is the little a rename needs to know about a listed session.
type treeRow struct{ path, title string }

// treeRowsFor lists the titled sessions of one session directory, so a name the
// caller did not dispatch to can still be told apart from a name nobody has.
func (h *Hub) treeRowsFor(dir string) []treeRow {
	titles := h.titleCacheFor(dir).snapshot()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	out := make([]treeRow, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !store.IsSessionTranscriptName(e.Name()) {
			continue
		}
		path := filepath.Join(dir, e.Name())
		title := ""
		if t, ok := titles[e.Name()]; ok {
			title = strings.TrimSpace(t.Title)
		}
		if title == "" {
			title = strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
		}
		out = append(out, treeRow{path: path, title: title})
	}
	return out
}

// titleForSession reads one transcript's cached title, which is what the
// sidebar shows and therefore what a person will type.
func (h *Hub) titleForSession(path string) string {
	dir := filepath.Dir(path)
	name := filepath.Base(path)
	if entry, ok := h.titleCacheFor(dir).snapshot()[name]; ok {
		if title := strings.TrimSpace(entry.Title); title != "" {
			return title
		}
	}
	meta, ok, err := sessionstore.LoadBranchMeta(path)
	if err != nil || !ok {
		return ""
	}
	return strings.TrimSpace(meta.CustomTitle)
}

// projectOfRow names the project a listed session belongs to.
func projectOfRow(row sessionstore.SessionInfo, fallback string) string {
	if root := strings.TrimSpace(row.WorkspaceRoot); root != "" {
		return root
	}
	return fallback
}

// peersDir names the durable spool root, resolved from this process's state
// root so it honours REASONIX_HOME the same way the controllers do.
func (h *Hub) peersDir() string {
	cfg, err := config.Load()
	if err != nil {
		return ""
	}
	return cfg.Roots().PeersDir()
}

// resolveOwnedSessionPath validates a raw session path the same way the HTTP
// title routes do: a direct transcript file in a workspace this hub owns, with
// no symlink escape. It is the shared safety gate for both the routes and the
// rename tool.
func (h *Hub) resolveOwnedSessionPath(raw string) (string, error) {
	requested, err := filepath.Abs(strings.TrimSpace(raw))
	if err != nil {
		return "", errRenameBadPath
	}
	name := filepath.Base(requested)
	if !filepath.IsLocal(name) || !store.IsSessionTranscriptName(name) {
		return "", errRenameBadPath
	}
	for _, root := range h.sessionRoots() {
		dir, err := filepath.Abs(SessionDirFor(root.dir))
		if err != nil || !strings.HasPrefix(requested, dir+string(os.PathSeparator)) || filepath.Dir(requested) != dir {
			continue
		}
		path := filepath.Join(dir, name)
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			return "", err
		}
		physicalDir, err := filepath.EvalSymlinks(dir)
		if err != nil {
			return "", err
		}
		if !strings.HasPrefix(resolved, physicalDir+string(os.PathSeparator)) || filepath.Dir(resolved) != physicalDir {
			return "", errRenameOutside
		}
		return path, nil
	}
	return "", errRenameOutside
}
