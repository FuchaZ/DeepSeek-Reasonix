package serve

import (
	"cmp"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"slices"
	"strings"

	"reasonix/internal/state/sessionstore"
)

const (
	rankStep = 1024
	// rankGap is the room a midpoint needs before the list is renumbered.
	rankGap = 1e-3
)

// compareSessions is the order a project's conversations are listed in: the ones
// never placed by hand first, newest activity first, so a new conversation
// lands on top as it always has; then the placed ones, by the rank the person
// gave them.
func compareSessions(a, b sessionstore.SessionInfo) int {
	switch {
	case a.ManualRank == 0 && b.ManualRank != 0:
		return -1
	case a.ManualRank != 0 && b.ManualRank == 0:
		return 1
	case a.ManualRank != 0:
		if c := cmp.Compare(a.ManualRank, b.ManualRank); c != 0 {
			return c
		}
	default:
		if c := b.LastActivityAt.Compare(a.LastActivityAt); c != 0 {
			return c
		}
	}
	return cmp.Compare(a.Path, b.Path)
}

func sortSessions(list []sessionstore.SessionInfo) { slices.SortFunc(list, compareSessions) }

// rankUpdatesForStep moves path one place up (-1) or down (1) among the
// conversations in the same archived state, and answers the ranks that change.
// While every neighbour is placed and there is room, only the moved one changes;
// otherwise the whole group is numbered in its new order. ok is false when
// there is nothing to move.
func rankUpdatesForStep(order []sessionstore.SessionInfo, path string, direction int) (map[string]float64, bool) {
	at := slices.IndexFunc(order, func(s sessionstore.SessionInfo) bool { return s.Path == path })
	if at < 0 || (direction != -1 && direction != 1) {
		return nil, false
	}
	group := make([]sessionstore.SessionInfo, 0, len(order))
	for _, s := range order {
		if s.Archived == order[at].Archived {
			group = append(group, s)
		}
	}
	from := slices.IndexFunc(group, func(s sessionstore.SessionInfo) bool { return s.Path == path })
	to := from + direction
	if to < 0 || to >= len(group) {
		return nil, false
	}
	moved := group[from]
	group = slices.Delete(group, from, from+1)
	group = slices.Insert(group, to, moved)
	if updates, ok := midpointRank(group, to); ok {
		return updates, true
	}
	updates := make(map[string]float64, len(group))
	for i, s := range group {
		if rank := float64(i+1) * rankStep; rank != s.ManualRank {
			updates[s.Path] = rank
		}
	}
	return updates, true
}

// midpointRank ranks group[at] between its neighbours when all of the group is
// placed and the gap is wide enough.
func midpointRank(group []sessionstore.SessionInfo, at int) (map[string]float64, bool) {
	for _, s := range group {
		if s.ManualRank == 0 {
			return nil, false
		}
	}
	var rank float64
	switch {
	case at == 0:
		rank = group[1].ManualRank / 2
	case at == len(group)-1:
		rank = group[at-1].ManualRank + rankStep
	default:
		lo, hi := group[at-1].ManualRank, group[at+1].ManualRank
		if hi-lo < rankGap*2 {
			return nil, false
		}
		rank = (lo + hi) / 2
	}
	if rank < rankGap {
		return nil, false
	}
	return map[string]float64{group[at].Path: rank}, true
}

// moveSession places one conversation a step up or down in its project's list.
// The list is the sidebar's own — the same rows and order /tree answers — so a
// step the window shows is one a reload keeps. A conversation a pane is
// driving has no transcript on disk yet and sits pinned above the placed ones;
// moving it answers without error and without a rank to write.
func (h *Hub) moveSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path      string `json:"path"`
		Direction int    `json:"direction"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		badBody(w)
		return
	}
	if body.Direction != -1 && body.Direction != 1 {
		badValue(w, "direction", "-1", "1")
		return
	}
	abs, err := filepath.Abs(strings.TrimSpace(body.Path))
	if err != nil {
		refuse(w, http.StatusBadRequest, codeSessionBadPath, "the session path could not be resolved", nil)
		return
	}
	root := h.sessionTreeRoot(abs)
	if root == "" {
		refuse(w, http.StatusForbidden, "session.outside_workspace", "path outside a known workspace", nil)
		return
	}
	canonical := sessionstore.CanonicalSessionPath(abs)
	listed, unlisted := h.treeSessionRows(root)
	path := ""
	for _, si := range listed {
		if sessionstore.CanonicalSessionPath(si.Path) == canonical {
			path = si.Path
			break
		}
	}
	if path == "" {
		for _, si := range unlisted {
			if sessionstore.CanonicalSessionPath(si.Path) == canonical {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		refuse(w, http.StatusForbidden, "session.outside_workspace", "path outside a known workspace", nil)
		return
	}
	updates, ok := rankUpdatesForStep(listed, path, body.Direction)
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var failed error
	for p, rank := range updates {
		failed = errors.Join(failed, sessionstore.SetSessionRank(p, rank))
	}
	if failed != nil {
		writeErr(w, http.StatusInternalServerError, failed)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
