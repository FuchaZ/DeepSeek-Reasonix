package tool

import (
	"context"
	"sync"
)

// PeerView is another session on this machine that can be written to.
type PeerView struct {
	Key     string
	Title   string
	Project string
	// Busy says the session is in the middle of a turn.
	Busy bool
	// Purpose is the role a dispatch opened that session to do.
	Purpose string
}

// PeerReceipt says a message was handed to the receiver's spool, not read.
type PeerReceipt struct {
	ID string
	To PeerView
}

// PeerMessageState is what became of one message the session sent: the
// receiver's side decision, and the answer that came back once one did.
type PeerMessageState struct {
	State string // queued | accepted | declined | replied
	Reply string // the answer that named this message, empty until one does
}

// PeerDirectory is what the peer tools ask of the session that owns them.
type PeerDirectory interface {
	Peers() []PeerView
	SendPeerMessage(to, text, replyTo string) (PeerReceipt, error)
	PeerMessageState(id string) (PeerMessageState, bool)
}

// DispatchReceipt says a task was written into a session of another project.
// Role is the name the caller gave the job, empty when it named none.
type DispatchReceipt struct {
	Project string
	Key     string
	ID      string
	Role    string
}

// ProjectDispatcher is what the dispatch tool asks of the session that owns it:
// hand a task to a session in one of the user's projects, its own included — the
// dispatch card is the gate. A non-empty role keeps several sessions apart.
type ProjectDispatcher interface {
	DispatchToProject(ctx context.Context, project, text, role string) (DispatchReceipt, error)
}

// OpenedProject is what became of one folder the model asked to have opened.
// Code is the refusal identity when it was not; an empty Code with Added false
// means the folder was already in the list.
type OpenedProject struct {
	Path  string
	Added bool
	Code  string
}

// ProjectOpener is what the open_projects tool asks of the session that owns
// it: add folders to the user's project list as trusted, after the user has
// answered a card that names every one of them.
type ProjectOpener interface {
	OpenProjects(ctx context.Context, paths []string) ([]OpenedProject, error)
}

// PeerLink joins the peer tools, built with the registry, to the controller
// that exists only afterwards. Until the controller binds it the tools answer
// that no session is listening.
type PeerLink struct {
	mu  sync.RWMutex
	dir PeerDirectory
}

func (l *PeerLink) Bind(d PeerDirectory) {
	l.mu.Lock()
	l.dir = d
	l.mu.Unlock()
}

func (l *PeerLink) Directory() (PeerDirectory, bool) {
	if l == nil {
		return nil, false
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.dir, l.dir != nil
}
