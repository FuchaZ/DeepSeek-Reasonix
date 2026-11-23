package control

import (
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/state/peermail"
)

// A sent message's state is what the shared audit and this session's own spool
// say about it: the receiver's decision, and an answer that names the message.
// A message from the same session that names nothing answers nothing.

func peerStateFixture(t *testing.T) (*Controller, *peermail.Dir) {
	t.Helper()
	d, err := peermail.Open(testenv.TempDir(t))
	if err != nil {
		t.Fatal(err)
	}
	c := &Controller{peers: &peerMail{key: "s-self"}}
	c.peers.dir.Store(d)
	return c, d
}

func TestPeerMessageStateIsUnknownUntilTheMessageIsOnRecord(t *testing.T) {
	c, _ := peerStateFixture(t)
	if _, ok := c.PeerMessageState("m-nothing"); ok {
		t.Fatal("an unsent message id reported a state")
	}
}

func TestPeerMessageStateFollowsTheSharedAudit(t *testing.T) {
	c, d := peerStateFixture(t)
	_ = d.Audit(peermail.AuditRecord{Receiver: "s-other", Sender: "s-self", ID: "m-1", Decision: peermail.DecisionSent})
	if st, ok := c.PeerMessageState("m-1"); !ok || st.State != "queued" {
		t.Fatalf("sent = %+v, %v, want queued", st, ok)
	}
	_ = d.Audit(peermail.AuditRecord{Receiver: "s-other", Sender: "s-self", ID: "m-1", Decision: peermail.DecisionApproved})
	if st, _ := c.PeerMessageState("m-1"); st.State != "accepted" {
		t.Fatalf("approved = %+v, want accepted", st)
	}
	_ = d.Audit(peermail.AuditRecord{Receiver: "s-other", Sender: "s-self", ID: "m-1", Decision: peermail.DecisionDenied})
	if st, _ := c.PeerMessageState("m-1"); st.State != "declined" {
		t.Fatalf("denied = %+v, want declined", st)
	}
}

func TestPeerMessageStateReadsAReplyThatNamesTheMessage(t *testing.T) {
	c, d := peerStateFixture(t)
	_ = d.Audit(peermail.AuditRecord{Receiver: "s-other", Sender: "s-self", ID: "m-1", Decision: peermail.DecisionSent})
	err := d.Send(peermail.Message{
		ID: "m-2", SentAt: time.Now().UTC(), Body: "the answer", ReplyTo: "m-1",
		From: peermail.Party{SessionID: "s-other"}, To: peermail.Party{SessionID: "s-self"},
	})
	if err != nil {
		t.Fatal(err)
	}
	st, ok := c.PeerMessageState("m-1")
	if !ok || st.State != "replied" || st.Reply != "the answer" {
		t.Fatalf("replied = %+v, %v, want the answer", st, ok)
	}
}

func TestPeerMessageStateIgnoresAReplyThatNamesNothing(t *testing.T) {
	c, d := peerStateFixture(t)
	_ = d.Audit(peermail.AuditRecord{Receiver: "s-other", Sender: "s-self", ID: "m-1", Decision: peermail.DecisionApproved})
	if err := d.Send(peermail.Message{
		ID: "m-2", SentAt: time.Now().UTC(), Body: "unrelated chatter",
		From: peermail.Party{SessionID: "s-other"}, To: peermail.Party{SessionID: "s-self"},
	}); err != nil {
		t.Fatal(err)
	}
	st, ok := c.PeerMessageState("m-1")
	if !ok || st.State != "accepted" || st.Reply != "" {
		t.Fatalf("unrelated chatter was taken for an answer: %+v, %v", st, ok)
	}
}
