package control

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/state/peermail"
)

// A hop count belongs to the chain, not to the caller: a reply carries one hop
// more than the message it answers, whether the model names that message or the
// host answers on the opener's behalf. The chain stops at the limit.

func (f *peerFixture) sendSignedHops(t *testing.T, id, body string, seq uint64, hops int) {
	t.Helper()
	m := peermail.Message{
		ID: id, SentAt: time.Now().UTC(), Body: body, Seq: seq, Hops: hops,
		From: peermail.Party{SessionID: f.sender, Title: "sender", Project: "alpha"},
		To:   peermail.Party{SessionID: f.key},
	}
	m.Proof = peermail.Proof(pairSecret, m)
	if err := f.peers.Send(m); err != nil {
		t.Fatal(err)
	}
}

// waitForHeldPeer ingests until the receiver holds id. The spool is read rather
// than remembered, so a message written a moment ago can miss one pass;
// ingestion is idempotent, so asking again is free.
func waitForHeldPeer(t *testing.T, f *peerFixture, id string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		f.c.peerIngest()
		for _, h := range f.c.HeldPeerMessages() {
			if h.ID == id {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("the receiver never held %q", id)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestAMessageAtTheHopLimitIsNotSentAgain(t *testing.T) {
	// Hold rather than release: a held hop is readable at once, while a released
	// one lives in the envelope the release writes first. Pinning the answer
	// after the fixture set REASONIX_HOME keeps the config out of this test.
	f := newPeerFixture(t)
	setPeerIncoming(t, config.IncomingAsk)
	f.pairedWith(t, true)
	f.sendSignedHops(t, "m-far", "keep going", 1, peermail.MaxHops)
	waitForHeldPeer(t, f, "m-far")
	if _, err := f.c.sendPeerMessage(f.sender, "again", "m-far"); !errors.Is(err, ErrPeerHopLimit) {
		t.Fatalf("a message one hop past the limit = %v, want ErrPeerHopLimit", err)
	}
	if got := f.senderInbox(); len(got) != 0 {
		t.Fatalf("a message went out past the limit: %+v", got)
	}
}

// A round trip through both sessions raises the count by one each way, and the
// chain is still inside the limit after three of them.
func TestARoundTripRaisesTheHopCountByOne(t *testing.T) {
	peersDir := filepath.Join(testenv.TempDir(t), "peers")
	a := newPeerSession(t, peersDir, "alpha")
	b := newPeerSession(t, peersDir, "beta")
	a.peerIngest()
	b.peerIngest()

	round := func(from, to *Controller, body, replyTo string, wantHops int) string {
		t.Helper()
		rec, err := from.sendPeerMessage(to.peers.key, body, replyTo)
		if err != nil {
			t.Fatalf("send %q: %v", body, err)
		}
		to.peerIngest()
		pending, _ := from.peers.dir.Load().Pending(to.peers.key)
		var arrived peermail.Message
		found := false
		for _, m := range pending {
			if m.ID == rec.ID {
				arrived, found = m, true
			}
		}
		if !found {
			t.Fatalf("the message just sent is not at the receiver: %+v", pending)
		}
		if got := arrived.Hops; got != wantHops {
			t.Fatalf("%q arrived at hop %d, want %d", body, got, wantHops)
		}
		return rec.ID
	}
	first := round(a, b, "first", "", 0)
	second := round(b, a, "second", first, 1)
	third := round(a, b, "third", second, 2)
	round(b, a, "fourth", third, 3)
}
