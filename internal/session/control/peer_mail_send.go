package control

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"reasonix/internal/state/peermail"
	"reasonix/internal/state/sessionstore"
)

const (
	// peerBeatTTL is how long a session may stay silent and still be listed;
	// the ingest tick beats well inside it.
	peerBeatTTL = 15 * time.Second
	// A placeholder for the rate a person types messages at, until measured.
	peerSendBurst  = 10
	peerSendWindow = time.Minute
)

// Each is an identity a frontend can map; none is matched by its words.
var (
	ErrPeerNotFound    = errors.New("no session on this machine answers to that name")
	ErrPeerAmbiguous   = errors.New("more than one session answers to that name")
	ErrPeerSelf        = errors.New("a session cannot message itself")
	ErrPeerRefused     = errors.New("that session does not accept messages")
	ErrPeerRateLimited = errors.New("too many messages sent in a short time")
	ErrPeerTooLarge    = peermail.ErrTooLarge
	ErrPeerEmpty       = errors.New("a message needs some text")
)

// PeerView is another session on this machine that can be written to.
type PeerView struct {
	Key     string `json:"key"`
	Title   string `json:"title"`
	Project string `json:"project,omitempty"`
}

// PeerReceipt says a message was handed to the receiver's spool, not that it was
// read: the receiver's user still decides.
type PeerReceipt struct {
	ID string   `json:"id"`
	To PeerView `json:"to"`
}

// Peers lists the other sessions that are listening, newest beat first is not
// promised; the list is the set that beat within the last few seconds.
func (c *Controller) Peers() []PeerView {
	p := c.peers
	dir := p.dirOrNil()
	if dir == nil {
		return nil
	}
	p.mu.Lock()
	self := p.key
	p.mu.Unlock()
	var out []PeerView
	for _, l := range c.livePeers() {
		if l.SessionID != self {
			out = append(out, PeerView{Key: l.SessionID, Title: l.Title, Project: l.Project})
		}
	}
	return out
}

func (c *Controller) livePeers() []peermail.Live {
	dir := c.peers.dirOrNil()
	if dir == nil {
		return nil
	}
	now := time.Now()
	live, _ := dir.ListLive(func(l peermail.Live) bool { return now.Sub(l.BeatAt) <= peerBeatTTL })
	// A record is a file any process of this user may have written, so the names
	// are reduced here, where they are read, as the publisher reduces its own.
	for i := range live {
		live[i].Title, live[i].Project = peerAttribute(live[i].Title), peerAttribute(live[i].Project)
	}
	return live
}

// SendPeerMessage writes one message into another session's spool, as the user
// asked. The name is resolved here, at the sender, and the message records the
// session key it landed on: an exact key, else an exact title, else
// "project/title", compared without case. More than one answer is refused, never
// guessed. What the receiver does with it is the receiver's decision.
func (c *Controller) SendPeerMessage(to, text string) (PeerReceipt, error) {
	return c.sendPeerMessage(to, text, "")
}

// sendPeerMessage is SendPeerMessage with the message this one answers, if any.
func (c *Controller) sendPeerMessage(to, text, replyTo string) (PeerReceipt, error) {
	p := c.peers
	dir := p.dirOrNil()
	if dir == nil {
		return PeerReceipt{}, ErrPeersDisabled
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return PeerReceipt{}, ErrPeerEmpty
	}
	p.mu.Lock()
	self, path := p.key, c.SessionPath()
	p.mu.Unlock()
	if self == "" {
		return PeerReceipt{}, ErrPeersDisabled
	}
	target, err := resolvePeer(c.livePeers(), strings.TrimSpace(to))
	if err != nil {
		return PeerReceipt{}, err
	}
	if target.SessionID == self {
		return PeerReceipt{}, ErrPeerSelf
	}
	if target.Inbound != "hold" {
		return PeerReceipt{}, ErrPeerRefused
	}
	if !c.peerSendAllowed() {
		return PeerReceipt{}, ErrPeerRateLimited
	}
	var token [8]byte
	_, _ = rand.Read(token[:])
	msg := peermail.Message{
		ID: "m-" + hex.EncodeToString(token[:]), SentAt: time.Now().UTC(), Body: text, ReplyTo: replyTo,
		From: peermail.Party{SessionID: self, Title: peerAttribute(sessionstore.BranchID(path)), Project: peerAttribute(baseName(c.WorkspaceRoot()))},
		To:   peermail.Party{SessionID: target.SessionID, WriterID: target.WriterID, Title: target.Title, Project: target.Project},
	}
	c.signDispatch(&msg)
	if err := dir.Send(msg); err != nil {
		return PeerReceipt{}, err
	}
	_ = dir.Audit(peermail.AuditRecord{Receiver: target.SessionID, Sender: self, ID: msg.ID, Decision: peermail.DecisionSent, Bytes: len(msg.Body), SHA256: peermail.Digest(msg.Body)})
	return PeerReceipt{ID: msg.ID, To: PeerView{Key: target.SessionID, Title: target.Title, Project: target.Project}}, nil
}

// peerSendAllowed spends one send from the window; a refused send spends none.
func (c *Controller) peerSendAllowed() bool {
	p := c.peers
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	kept := p.sent[:0]
	for _, at := range p.sent {
		if now.Sub(at) < peerSendWindow {
			kept = append(kept, at)
		}
	}
	p.sent = kept
	if len(p.sent) >= peerSendBurst {
		return false
	}
	p.sent = append(p.sent, now)
	return true
}

// resolvePeer picks the one live session a name refers to.
func resolvePeer(live []peermail.Live, name string) (peermail.Live, error) {
	if name == "" {
		return peermail.Live{}, ErrPeerNotFound
	}
	for _, l := range live {
		if l.SessionID == name {
			return l, nil
		}
	}
	var match []peermail.Live
	for _, l := range live {
		if strings.EqualFold(l.Title, name) || strings.EqualFold(fmt.Sprintf("%s/%s", l.Project, l.Title), name) {
			match = append(match, l)
		}
	}
	switch len(match) {
	case 0:
		return peermail.Live{}, ErrPeerNotFound
	case 1:
		return match[0], nil
	}
	return peermail.Live{}, ErrPeerAmbiguous
}

// PeerMessageState is what became of one message this session sent.
type PeerMessageState struct {
	State string // queued | accepted | declined | replied
	Reply string // the answer that named this message, empty until one does
}

// PeerMessageState reports what became of the message msgID: the receiver's
// side decision from the shared audit, and the answer that names the message —
// from the spool while the reply is still held, or from this session's inbox
// once it has been let in.
func (c *Controller) PeerMessageState(msgID string) (PeerMessageState, bool) {
	p := c.peers
	dir := p.dirOrNil()
	if dir == nil {
		return PeerMessageState{}, false
	}
	p.mu.Lock()
	self := p.key
	p.mu.Unlock()
	if self == "" {
		return PeerMessageState{}, false
	}
	state := "queued"
	var receiver string
	var sentAt time.Time
	for _, r := range dir.AuditSince(time.Now().Add(-peerThreadWindow)) {
		if r.ID != msgID || r.Sender != self {
			continue
		}
		receiver, sentAt = r.Receiver, r.At
		switch r.Decision {
		case peermail.DecisionApproved, peermail.DecisionReleased:
			state = "accepted"
		case peermail.DecisionDenied, peermail.DecisionRejected:
			state = "declined"
		}
	}
	if receiver == "" {
		return PeerMessageState{}, false
	}
	if reply, ok := c.peerReplyText(msgID, receiver, sentAt); ok {
		return PeerMessageState{State: "replied", Reply: reply}, true
	}
	return PeerMessageState{State: state}, true
}

// peerReplyText is the answer to one sent message: a spool message still held
// here that names it in ReplyTo, else the inbox item let in with the same
// pointer in its envelope. A reply that names nothing is not counted — a
// message from the same session may be about anything.
func (c *Controller) peerReplyText(msgID, receiver string, sentAt time.Time) (string, bool) {
	p := c.peers
	if dir := p.dirOrNil(); dir != nil {
		p.mu.Lock()
		self := p.key
		p.mu.Unlock()
		if pending, _ := dir.Pending(self); len(pending) > 0 {
			for _, m := range pending {
				if m.ReplyTo == msgID && m.From.SessionID == receiver {
					return m.Body, true
				}
			}
		}
	}
	c.inbox.mu.Lock()
	st := c.inbox.store
	c.inbox.mu.Unlock()
	if st == nil {
		return "", false
	}
	for _, item := range c.InboxSnapshot().Items {
		if item.Source != peerSourcePrefix+receiver || item.CreatedAt.Before(sentAt) {
			continue
		}
		if _, env, err := c.ReadInboxItem(item.ID); err == nil && env.Extra["reply_to"] == msgID {
			return item.Preview, true
		}
	}
	return "", false
}

func baseName(path string) string {
	path = strings.TrimRight(path, `\/`)
	if i := strings.LastIndexAny(path, `\/`); i >= 0 {
		return path[i+1:]
	}
	return path
}
