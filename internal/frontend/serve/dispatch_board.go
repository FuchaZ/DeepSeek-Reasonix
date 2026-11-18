package serve

import (
	"net/http"
	"sort"
	"sync"
	"time"

	"reasonix/internal/session/control"
	"reasonix/internal/state/peermail"
)

// boardJoinMemo is the last tree join the board read, kept so panes polling it
// share one walk. absent remembers the peers that walk did not hold — a sender
// whose session is gone must not make every later read walk again. Guarded by
// its own mutex, which is never held while another lock of the hub's is taken.
type boardJoinMemo struct {
	mu     sync.Mutex
	at     time.Time
	join   map[string]dispatchTargetJoin
	absent map[string]bool
}

// invalidate drops the walk, so the next read sees the tree as it is now. Every
// tree change calls it: a rename, an archive and a removal all reach the board
// through that one notification, so none of them waits out the interval.
func (m *boardJoinMemo) invalidate() {
	m.mu.Lock()
	m.at, m.join, m.absent = time.Time{}, nil, nil
	m.mu.Unlock()
}

// knows says whether this walk already answered for every key asked about,
// either by naming the peer or by having missed it.
func (m *boardJoinMemo) knows(keys []string) bool {
	for _, key := range keys {
		if _, ok := m.join[key]; ok {
			continue
		}
		if m.absent[key] {
			continue
		}
		return false
	}
	return true
}

// DispatchBoardParty is one end of a dispatch: the session that handed a task
// out or the one that received it. Titles and projects come from the tree join
// and degrade to the branch id when a session has gone quiet.
type DispatchBoardParty struct {
	Key         string `json:"key,omitempty"`
	SessionPath string `json:"sessionPath,omitempty"`
	Title       string `json:"title,omitempty"`
	Project     string `json:"project,omitempty"`
}

// DispatchBoardRow is one task handed from one session to another, with the
// state the dispatcher can read (waiting / working / replied / declined). It
// carries no task text: the audit trail never stores message bodies.
type DispatchBoardRow struct {
	Dispatcher DispatchBoardParty `json:"dispatcher"`
	Assignee   DispatchBoardParty `json:"assignee"`
	Role       string             `json:"role,omitempty"`
	State      string             `json:"state"`
	Since      string             `json:"since,omitempty"`
	// CrossProject is true when the two ends live in different folders.
	CrossProject bool `json:"crossProject"`
}

// dispatchBoardHTTP answers the window's session-collaboration board: every
// dispatch this machine still has a record of, from both ends' point of view.
func (h *Hub) dispatchBoardHTTP(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, h.dispatchBoard())
}

// dispatchBoard answers the window's session-collaboration board: every
// dispatch this machine still has a record of, from both ends' point of view.
// The trail and the tree are read once per request: a session that never handed
// a task out has no row, so the senders the trail and the book name are the work.
func (h *Hub) dispatchBoard() []DispatchBoardRow {
	audit := h.peerAudit()
	book := h.dispatch.allThreads()
	senders := boardSenders(audit, book)
	if len(senders) == 0 {
		return nil
	}
	join := h.dispatchJoins(boardJoinKeys(senders, audit, book))

	// One row per (dispatcher, assignee) pair. The status reader already folds
	// held/approved/replied/declined for one dispatcher, so it is reused here
	// rather than re-derived from the trail.
	seen := map[string]bool{}
	var out []DispatchBoardRow
	for _, key := range senders {
		// Both ends must still exist and be live: an archived or deleted
		// session is a closed chapter, and must not keep asking for the
		// person's attention on the board.
		sender, ok := join[key]
		if !ok || sender.archived || sender.sessionPath == "" {
			continue
		}
		for _, th := range h.dispatchStatuses(sender.sessionPath, audit, join) {
			if th.SessionPath == "" {
				continue
			}
			assignee, ok := join[control.PeerKeyForPath(th.SessionPath)]
			if !ok || assignee.archived {
				continue
			}
			id := sender.sessionPath + "\x00" + th.SessionPath
			if seen[id] {
				continue
			}
			seen[id] = true
			assign := DispatchBoardParty{Key: control.PeerKeyForPath(th.SessionPath), SessionPath: th.SessionPath, Title: th.TargetTitle, Project: th.TargetProject}
			if assign.Title == "" {
				assign.Title = assignee.title()
			}
			if assign.Project == "" {
				assign.Project = assignee.project
			}
			out = append(out, DispatchBoardRow{
				Dispatcher:   DispatchBoardParty{Key: key, SessionPath: sender.sessionPath, Title: sender.title(), Project: sender.project},
				Assignee:     assign,
				Role:         th.Role,
				State:        string(th.State),
				Since:        th.Since.Format("2006-01-02T15:04:05Z07:00"),
				CrossProject: sender.project != "" && assign.Project != "" && !sameFolder(sender.project, assign.Project),
			})
		}
	}
	out = dedupeBoardReplies(out)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Since == out[j].Since {
			return out[i].Assignee.SessionPath < out[j].Assignee.SessionPath
		}
		return out[i].Since > out[j].Since
	})
	return out
}

// boardSenders names the sessions a dispatch can start from: the ones the trail
// records handing a task out, plus the ones this hub opened a pane for and has
// not written to the trail yet.
func boardSenders(audit []peermail.AuditRecord, book map[string][]DispatchThread) []string {
	seen := map[string]bool{}
	var out []string
	add := func(key string) {
		if key == "" || seen[key] {
			return
		}
		seen[key] = true
		out = append(out, key)
	}
	for _, r := range audit {
		if r.Decision == peermail.DecisionSent {
			add(r.Sender)
		}
	}
	for path := range book {
		add(control.PeerKeyForPath(path))
	}
	return out
}

// boardJoinKeys names every peer a board read will look up: each sender, the
// targets its threads name, and the panes the book remembers.
func boardJoinKeys(senders []string, audit []peermail.AuditRecord, book map[string][]DispatchThread) []string {
	out := append([]string(nil), senders...)
	for _, key := range senders {
		for _, th := range control.PeerThreadsFrom(key, audit) {
			out = append(out, th.Key)
		}
	}
	for _, threads := range book {
		for _, t := range threads {
			if t.Key != "" {
				out = append(out, t.Key)
			}
			if t.SessionPath != "" {
				out = append(out, control.PeerKeyForPath(t.SessionPath))
			}
		}
	}
	return out
}

// boardJoinTTL is how long one walk of the tree answers the board. Every pane
// polls it, and the join it reads changes on the order of a rename, so a walk
// is shared rather than repeated per pane.
const boardJoinTTL = 15 * time.Second

// dispatchJoins answers the tree join the board reads, from the last walk while
// it is recent and names every peer this read looks up. A dispatch to a session
// nobody has seen yet misses, so a fresh task never waits out the interval.
func (h *Hub) dispatchJoins(needed []string) map[string]dispatchTargetJoin {
	h.boardJoin.mu.Lock()
	defer h.boardJoin.mu.Unlock()
	if h.boardJoin.join != nil && time.Since(h.boardJoin.at) < boardJoinTTL && h.boardJoin.knows(needed) {
		return h.boardJoin.join
	}
	join := h.dispatchTargetJoins()
	absent := map[string]bool{}
	for _, key := range needed {
		if _, ok := join[key]; !ok {
			absent[key] = true
		}
	}
	h.boardJoin.at, h.boardJoin.join, h.boardJoin.absent = time.Now(), join, absent
	return join
}

// dedupeBoardReplies drops the role-less row that is a dispatch's reply: when
// the reverse direction carries a role, that row is the dispatch itself and
// carries the state lamp, so the reply must not appear as a second task.
func dedupeBoardReplies(rows []DispatchBoardRow) []DispatchBoardRow {
	kept := make([]DispatchBoardRow, 0, len(rows))
	for _, row := range rows {
		if row.Role == "" {
			reply := false
			for _, other := range rows {
				if other.Role != "" && other.Dispatcher.SessionPath == row.Assignee.SessionPath && other.Assignee.SessionPath == row.Dispatcher.SessionPath {
					reply = true
					break
				}
			}
			if reply {
				continue
			}
		}
		kept = append(kept, row)
	}
	return kept
}
