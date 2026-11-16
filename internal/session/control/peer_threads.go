package control

import (
	"slices"
	"time"

	"reasonix/internal/state/peermail"
)

// PeerThreadState is where a conversation with one other session stands, read
// off the audit trail both sides write, never off any message's words.
type PeerThreadState string

const (
	// PeerWaiting: my last message is still in the other session's inbox.
	PeerWaiting PeerThreadState = "waiting"
	// PeerWorking: the other session's user took my last message and has not answered.
	PeerWorking PeerThreadState = "working"
	// PeerReplied: the other session wrote to me after my last message.
	PeerReplied PeerThreadState = "replied"
	// PeerDeclined: the other session's user refused my last message.
	PeerDeclined PeerThreadState = "declined"
)

// peerThreadWindow bounds how far back the trail is read.
const peerThreadWindow = 30 * 24 * time.Hour

// PeerThread is one session this one has sent to, and where that stands.
type PeerThread struct {
	Key string `json:"key"`
	// Role is the name the sender dispatched this session under, as the serving
	// pane's dispatch book remembers it; empty for a thread no dispatch opened.
	Role        string          `json:"role,omitempty"`
	Title       string          `json:"title,omitempty"`
	Project     string          `json:"project,omitempty"`
	SessionPath string          `json:"sessionPath,omitempty"`
	State       PeerThreadState `json:"state"`
	Since       time.Time       `json:"since"`
	MessageID   string          `json:"messageId"`
}

// PeerThreads lists the sessions this one has sent a message to, newest first.
// A session that was never written to is not listed.
func (c *Controller) PeerThreads() []PeerThread {
	p := c.peers
	dir := p.dirOrNil()
	if dir == nil {
		return nil
	}
	p.mu.Lock()
	self := p.key
	p.mu.Unlock()
	if self == "" {
		return nil
	}
	threads := peerThreadsFrom(self, dir.AuditSince(time.Now().Add(-peerThreadWindow)))
	live := map[string]peermailLive{}
	for _, l := range c.livePeers() {
		live[l.SessionID] = peermailLive{title: l.Title, project: l.Project, path: l.SessionPath}
	}
	for i := range threads {
		if l, ok := live[threads[i].Key]; ok {
			threads[i].Title, threads[i].Project, threads[i].SessionPath = l.title, l.project, l.path
		}
	}
	return threads
}

type peermailLive struct{ title, project, path string }

// peerThreadsFrom folds the trail into one thread per session self has written
// to. The state is that of self's latest message: undecided means waiting; taken
// means working; refused means declined; and anything the other session sent to
// self afterwards makes it replied.
func peerThreadsFrom(self string, trail []peermail.AuditRecord) []PeerThread {
	type last struct {
		id string
		at time.Time
	}
	sent := map[string]last{}
	for _, r := range trail {
		if r.Decision == peermail.DecisionSent && r.Sender == self && !r.At.Before(sent[r.Receiver].at) {
			sent[r.Receiver] = last{r.ID, r.At}
		}
	}
	var out []PeerThread
	for peer, l := range sent {
		t := PeerThread{Key: peer, State: PeerWaiting, Since: l.at, MessageID: l.id}
		for _, r := range trail {
			switch {
			case r.Receiver == peer && r.Sender == self && r.ID == l.id:
				switch r.Decision {
				case peermail.DecisionApproved, peermail.DecisionReleased:
					t.State, t.Since = PeerWorking, r.At
				case peermail.DecisionDenied:
					t.State, t.Since = PeerDeclined, r.At
				}
			case r.Receiver == self && r.Sender == peer && r.At.After(l.at) && r.Decision == peermail.DecisionHeld:
				t.State, t.Since = PeerReplied, r.At
			}
		}
		out = append(out, t)
	}
	slices.SortFunc(out, func(a, b PeerThread) int { return b.Since.Compare(a.Since) })
	return out
}
