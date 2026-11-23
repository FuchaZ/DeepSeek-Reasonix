package serve

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"reasonix/internal/base/workspacefile"
)

const maxWorkspaceFile = 2 << 20

type workspaceFile struct {
	Path            string `json:"path"`
	Content         string `json:"content"`
	Revision        string `json:"revision"`
	ObservedVersion string `json:"observedVersion,omitempty"`
	// Root is the granted folder the file was read from; empty for the workspace
	// itself. A file read from a granted folder is ReadOnly: only the workspace
	// may be written through this route.
	Root     string `json:"root,omitempty"`
	ReadOnly bool   `json:"readOnly,omitempty"`
}

func fileRevision(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func workspacePath(raw string) (string, error) {
	path := filepath.Clean(filepath.FromSlash(strings.TrimSpace(raw)))
	if path == "." || !filepath.IsLocal(path) {
		return "", errors.New("path is not a workspace file")
	}
	return path, nil
}

// refuseOpen answers a failed open by its cause: only a file that is not there
// is "missing". A permission, a lock or a path the root refuses is a different
// thing to do next, and saying "not found" sends the person looking for a file
// that exists.
func refuseOpen(w http.ResponseWriter, err error) {
	if errors.Is(err, fs.ErrNotExist) {
		refuse(w, http.StatusNotFound, "workspace.file_missing", err.Error(), nil)
		return
	}
	if errors.Is(err, workspacefile.ErrDenied) || errors.Is(err, fs.ErrPermission) {
		refuse(w, http.StatusForbidden, "workspace.preview_denied", err.Error(), nil)
		return
	}
	refuse(w, http.StatusInternalServerError, "workspace.file_failed", err.Error(), nil)
}

func (s *Server) workspaceFiles(w http.ResponseWriter, r *http.Request) {
	root := s.ctl().WorkspaceRoot()
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	requested := strings.TrimSpace(r.URL.Query().Get("path"))
	dots := r.URL.Query().Get("hidden") == "1"
	if requested != "" {
		var err error
		requested, err = workspacePath(requested)
		if err != nil {
			refuse(w, http.StatusBadRequest, "workspace.path_outside_tree", err.Error(), nil)
			return
		}
		requested = filepath.ToSlash(requested)
	}
	var listing workspaceListing
	var err error
	if query != "" {
		listing, err = searchFiles(root, query, dots)
	} else {
		listing, err = listFolder(root, requested, dots)
	}
	switch {
	case errors.Is(err, errListingOutsideTree):
		refuse(w, http.StatusBadRequest, "workspace.path_outside_tree", err.Error(), nil)
		return
	case errors.Is(err, fs.ErrNotExist):
		refuse(w, http.StatusNotFound, "workspace.file_missing", err.Error(), nil)
		return
	case err != nil:
		refuse(w, http.StatusInternalServerError, "workspace.files_failed", err.Error(), nil)
		return
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(listing)
}

func (s *Server) workspaceFileRead(w http.ResponseWriter, r *http.Request) {
	path, err := workspacePath(r.URL.Query().Get("path"))
	if err != nil {
		refuse(w, http.StatusBadRequest, "workspace.path_outside_tree", err.Error(), nil)
		return
	}
	named := r.URL.Query().Get("root")
	base, ok := s.readRoot(w, named)
	if !ok {
		return
	}
	data, info, err := (workspacefile.Service{Primary: base}).Text(r.Context(), workspacefile.Ref{Path: filepath.ToSlash(path)})
	if err != nil {
		if errors.Is(err, workspacefile.ErrTooLarge) || errors.Is(err, workspacefile.ErrNotFile) || errors.Is(err, workspacefile.ErrNotText) {
			refuse(w, http.StatusBadRequest, "workspace.file_unreadable", err.Error(), nil)
		} else {
			refuseOpen(w, err)
		}
		return
	}
	w.Header().Set("content-type", "application/json")
	out := workspaceFile{Path: filepath.ToSlash(path), Content: string(data), Revision: fileRevision(data), ObservedVersion: info.Version}
	if base != s.ctl().WorkspaceRoot() {
		out.Root, out.ReadOnly = base, true
	}
	_ = json.NewEncoder(w).Encode(out)
}

func (s *Server) workspaceFileWrite(w http.ResponseWriter, r *http.Request) {
	var in workspaceFile
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxWorkspaceFile+4096)).Decode(&in); err != nil {
		refuse(w, http.StatusBadRequest, "workspace.file_invalid", err.Error(), nil)
		return
	}
	path, err := workspacePath(in.Path)
	if err != nil {
		refuse(w, http.StatusBadRequest, "workspace.path_outside_tree", err.Error(), nil)
		return
	}
	root, err := os.OpenRoot(s.ctl().WorkspaceRoot())
	if err != nil {
		refuse(w, http.StatusInternalServerError, "workspace.file_failed", err.Error(), nil)
		return
	}
	defer root.Close()
	current, err := root.ReadFile(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) || in.Revision != "" {
			refuseOpen(w, err)
			return
		}
	} else if in.Revision == "" {
		refuse(w, http.StatusConflict, "workspace.file_exists", "the file is already there", nil)
		return
	} else if fileRevision(current) != in.Revision {
		refuse(w, http.StatusConflict, "workspace.file_changed", "the file changed after it was opened", nil)
		return
	}
	// An empty revision is the caller saying the file is not there yet: it is
	// created beside its parents, and only if nothing took the name first.
	flags := os.O_WRONLY | os.O_TRUNC
	if err != nil {
		if err := root.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			refuse(w, http.StatusInternalServerError, "workspace.file_failed", err.Error(), nil)
			return
		}
		flags = os.O_WRONLY | os.O_CREATE | os.O_EXCL
	}
	file, err := root.OpenFile(path, flags, 0o644)
	if err != nil && errors.Is(err, fs.ErrExist) {
		refuse(w, http.StatusConflict, "workspace.file_exists", "the file is already there", nil)
		return
	}
	if err == nil {
		_, err = file.WriteString(in.Content)
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
	}
	if err != nil {
		refuse(w, http.StatusInternalServerError, "workspace.file_failed", err.Error(), nil)
		return
	}
	data := []byte(in.Content)
	info, _ := (workspacefile.Service{Primary: s.ctl().WorkspaceRoot()}).Info(r.Context(), workspacefile.Ref{Path: filepath.ToSlash(path)})
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(workspaceFile{Path: filepath.ToSlash(path), Content: in.Content, Revision: fileRevision(data), ObservedVersion: info.Version})
}
