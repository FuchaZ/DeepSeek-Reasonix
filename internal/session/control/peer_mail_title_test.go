package control

import (
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/state/sessionstore"
)

// The peer record's title is what list_peers prints and what a send resolves
// against. A branch id there makes every name the user says unresolvable: the
// send misses, and the model then hands the task to whatever else it can reach —
// a dispatch opens a different session than the one the person named.
func TestThePublishedPeerTitleIsTheSessionTitle(t *testing.T) {
	peersDir := filepath.Join(testenv.TempDir(t), "peers")
	a := newPeerSession(t, peersDir, "alpha")
	b := newPeerSession(t, peersDir, "beta")
	if err := sessionstore.RenameSession(b.SessionPath(), "评审会话"); err != nil {
		t.Fatal(err)
	}
	// The rename only reaches the spool through the session's own beat: a
	// session republishes its record on its ingest tick (2s in production).
	b.peerIngest()
	a.peerIngest()

	peers := a.Peers()
	if len(peers) != 1 {
		t.Fatalf("Peers() = %+v, want only beta", peers)
	}
	if peers[0].Title != "评审会话" {
		t.Fatalf("published title %q, want the session's own title", peers[0].Title)
	}

	// The name the user says resolves to the session it names — not to whatever
	// else is listening in the same project.
	rec, err := a.SendPeerMessage("评审会话", "请复核这一轮改动")
	if err != nil {
		t.Fatal(err)
	}
	if rec.To.Key != b.peers.key {
		t.Fatalf("sent to %s, want beta's key %s", rec.To.Key, b.peers.key)
	}
	b.peerIngest()
	held := b.HeldPeerMessages()
	if len(held) != 1 || held[0].ID != rec.ID {
		t.Fatalf("receiver holds %+v, want the message sent to its name", held)
	}
}

// A session the person never named still reads as its own word: the branch id
// stays the fallback, so an unnamed session is reachable by its key.
func TestAnUnnamedSessionPublishesItsBranchIDAsFallback(t *testing.T) {
	peersDir := filepath.Join(testenv.TempDir(t), "peers")
	a := newPeerSession(t, peersDir, "alpha")
	c := newPeerSession(t, peersDir, "gamma")

	peers := a.Peers()
	if len(peers) != 1 {
		t.Fatalf("Peers() = %+v, want only gamma", peers)
	}
	if want := sessionstore.BranchID(c.SessionPath()); peers[0].Title != want {
		t.Fatalf("published title %q, want the branch id %q", peers[0].Title, want)
	}
	if got, err := a.SendPeerMessage(peers[0].Title, "hi"); err != nil || got.To.Key != c.peers.key {
		t.Fatalf("send by branch id = %v, %v", got, err)
	}
}
