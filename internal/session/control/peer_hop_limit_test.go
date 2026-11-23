package control

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
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

// waitForInboundHop ingests until the hop of a message this session received is
// readable. A paired message is let in rather than held, and its hop then lives
// in the inbox envelope: the release and the envelope's first snapshot are two
// steps, so a reply sent right after ingestion can read as a fresh chain.
func waitForInboundHop(t *testing.T, f *peerFixture, id string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		f.c.peerIngest()
		if _, ok := f.c.peerMessageHops(id); ok {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the hop of %q never became readable", id)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestAMessageAtTheHopLimitIsNotSentAgain(t *testing.T) {
	f := newPeerFixture(t)
	f.pairedWith(t, true)
	f.sendSignedHops(t, "m-far", "keep going", 1, peermail.MaxHops)
	// Let in rather than held, so the hop lives in the inbox envelope: release
	// and the envelope's first snapshot are two steps, and a reply between them
	// read as a fresh chain. Ingestion is idempotent, so asking again is free.
	waitForInboundHop(t, f, "m-far")
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
