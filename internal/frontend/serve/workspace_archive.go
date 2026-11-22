package serve

import (
	"path/filepath"

	"reasonix/internal/state/sessionstore"
	"reasonix/internal/state/store"
)

// archiveWorkspaceSessions archives every conversation a folder holds, so a
// removed project leaves nothing behind in the everyday list. Nothing on disk
// is deleted: the rows are still in 归档, and the project row stays as a ghost
// of itself until its conversations are gone or the folder is asked for
// again. A session that could not be archived is reported rather than skipped.
func (h *Hub) archiveWorkspaceSessions(dir string) error {
	sessionDir := SessionDirFor(dir)
	if sessionDir == "" {
		return nil
	}
	infos, err := sessionstore.ListSessions(sessionDir)
	if err != nil {
		return err
	}
	open := h.openSessions()
	excluded := make([]string, 0, len(open))
	for openPath := range open {
		excluded = append(excluded, openPath)
	}
	for _, info := range infos {
		if info.Archived || store.IsSubagentTranscriptName(filepath.Base(info.Path)) {
			continue
		}
		if err := sessionstore.SetSessionLineageArchived(info.Path, true, excluded...); err != nil {
			return err
		}
	}
	return nil
}

// workspaceHasListableSessions says whether the folder still holds a
// conversation the sidebar would list: subagent transcripts are bookkeeping,
// not rows. This is what keeps a ghost row standing — and what retires it once
// the archive has been emptied.
func workspaceHasListableSessions(dir string) bool {
	sessionDir := SessionDirFor(dir)
	if sessionDir == "" {
		return false
	}
	infos, err := sessionstore.ListSessions(sessionDir)
	if err != nil {
		return false
	}
	for _, info := range infos {
		if !store.IsSubagentTranscriptName(filepath.Base(info.Path)) {
			return true
		}
	}
	return false
}
