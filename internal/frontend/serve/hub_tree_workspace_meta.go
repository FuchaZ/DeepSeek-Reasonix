package serve

import (
	"encoding/json"
	"net/http"
	"strings"

	"reasonix/internal/state/workspacelist"
)

// setWorkspaceDisplayName records the name a project reads by in the sidebar:
// the folder on disk keeps its own, and its files stay where they are.
func (h *Hub) setWorkspaceDisplayName(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		badBody(w)
		return
	}
	dir, err := resolveWorkspaceDir(strings.TrimSpace(body.Path))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	err = updateWorkspaceList(r.Context(), false, func(l *workspacelist.List) error {
		l.SetName(storedWorkspacePath(l, dir), strings.TrimSpace(body.Name))
		return nil
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	h.treeChanged()
	writeJSON(w, map[string]any{"ok": true})
}

// setWorkspacePinned pins or unpins a project: a pinned one leads the list.
func (h *Hub) setWorkspacePinned(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path   string `json:"path"`
		Pinned bool   `json:"pinned"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		badBody(w)
		return
	}
	dir, err := resolveWorkspaceDir(strings.TrimSpace(body.Path))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	err = updateWorkspaceList(r.Context(), false, func(l *workspacelist.List) error {
		l.SetPinned(storedWorkspacePath(l, dir), body.Pinned)
		return nil
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	h.treeChanged()
	writeJSON(w, map[string]any{"ok": true})
}

// storedWorkspacePath names the path exactly as the list carries it, so a
// metadata write lands on the entry the sidebar reads.
func storedWorkspacePath(l *workspacelist.List, dir string) string {
	for _, stored := range l.Paths {
		if strings.EqualFold(strings.TrimSpace(stored), strings.TrimSpace(dir)) {
			return stored
		}
	}
	return dir
}
