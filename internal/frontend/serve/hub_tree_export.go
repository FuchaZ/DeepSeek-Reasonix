package serve

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"reasonix/internal/state/sessionstore"
	"reasonix/internal/state/store"
)

// exportSession returns the transcript only after applying the same workspace
// boundary as rename and removal. The shell owns where the copy is saved; the
// kernel owns which path is safe to read.
func (h *Hub) exportSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		badBody(w)
		return
	}
	path, err := filepath.Abs(strings.TrimSpace(body.Path))
	name := filepath.Base(path)
	if err != nil || !filepath.IsLocal(name) || !store.IsSessionTranscriptName(name) {
		refuse(w, http.StatusBadRequest, codeSessionBadPath, "the session path could not be resolved", nil)
		return
	}
	// The file's own directory is the opened root: task conversations live in
	// dated directories under the sessions tree, which the boundary check
	// proved owned. The validated local base name cannot leave it.
	dir := filepath.Dir(path)
	if !h.ownsSessionDir(dir) {
		refuse(w, http.StatusForbidden, "session.outside_workspace", "path outside a known workspace", nil)
		return
	}
	path = filepath.Join(dir, name)
	root, err := os.OpenRoot(dir)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	defer root.Close()
	info, err := root.Lstat(name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if !info.Mode().IsRegular() {
		refuse(w, http.StatusForbidden, "session.outside_workspace", "session export requires a regular transcript", nil)
		return
	}
	loaded, err := sessionstore.LoadSession(path)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	content, err := root.ReadFile(name)
	if loaded.Composition() != nil {
		content, err = sessionstore.ExportNativeArchive(path)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	}{Name: strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)), Content: string(content)})
}
