package serve

import (
	"errors"
	"net/http"

	"reasonix/internal/base/workspacefile"
)

func previewRef(r *http.Request) workspacefile.Ref {
	return workspacefile.Ref{Path: r.URL.Query().Get("path"), Root: r.URL.Query().Get("root")}
}

func (s *Server) workspacePreviewRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /workspace/preview/info", s.workspacePreviewInfo)
	mux.HandleFunc("GET /workspace/preview/content", s.workspacePreviewContent)
	mux.HandleFunc("GET /workspace/resolve", s.workspaceResolve)
}

// workspaceResolve answers where a path a conversation named really lives. Only
// an unambiguous answer is given: a tail two files share is not a file this can
// choose, and the caller keeps showing the path it was given.
func (s *Server) workspaceResolve(w http.ResponseWriter, r *http.Request) {
	ref, err := s.ctl().WorkspaceResolvePath(r.URL.Query().Get("path"))
	if err != nil {
		if errors.Is(err, workspacefile.ErrAmbiguous) {
			refuse(w, http.StatusConflict, "workspace.path_ambiguous", err.Error(), nil)
			return
		}
		if errors.Is(err, workspacefile.ErrMissing) {
			refuse(w, http.StatusNotFound, "workspace.file_missing", err.Error(), nil)
			return
		}
		refuse(w, http.StatusInternalServerError, "workspace.file_failed", err.Error(), nil)
		return
	}
	writeJSON(w, ref)
}

func refusePreview(w http.ResponseWriter, err error) {
	code, status := "workspace.preview_failed", http.StatusInternalServerError
	for _, candidate := range []struct {
		err    error
		code   string
		status int
	}{
		{workspacefile.ErrMissing, "workspace.file_missing", http.StatusNotFound},
		{workspacefile.ErrDenied, "workspace.preview_denied", http.StatusForbidden},
		{workspacefile.ErrNotFile, "workspace.preview_not_file", http.StatusBadRequest},
		{workspacefile.ErrTooLarge, "workspace.preview_too_large", http.StatusRequestEntityTooLarge},
		{workspacefile.ErrNotText, "workspace.preview_not_text", http.StatusUnsupportedMediaType},
		{workspacefile.ErrUnsupported, "workspace.preview_unsupported", http.StatusUnsupportedMediaType},
		{workspacefile.ErrChanged, "workspace.preview_changed", http.StatusConflict},
	} {
		if errors.Is(err, candidate.err) {
			code, status = candidate.code, candidate.status
			break
		}
	}
	refuse(w, status, code, err.Error(), nil)
}

func (s *Server) workspacePreviewInfo(w http.ResponseWriter, r *http.Request) {
	info, err := s.ctl().WorkspacePreviewInfo(r.Context(), previewRef(r))
	if err != nil {
		refusePreview(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, info)
}

func (s *Server) workspacePreviewContent(w http.ResponseWriter, r *http.Request) {
	data, info, err := s.ctl().WorkspacePreviewContent(r.Context(), previewRef(r))
	if err != nil {
		refusePreview(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Preview-Version", info.Version)
	_, _ = w.Write(data)
}
