package control

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/event"
	"reasonix/internal/contract/tool"
	"reasonix/internal/runtime/agent"
	"reasonix/internal/state/peermail"
	"reasonix/internal/state/sessioninbox"
	"reasonix/internal/state/sessionstore"
)

// peerSteeringTurn is a controller with a turn already running and a spool it
// reads: the one state in which "when does the message arrive" has two
// answers.
func peerSteeringTurn(t *testing.T) (*Controller, *agent.Agent, *sessionstore.Session, *inboxSteerProvider, chan event.Event, func() []event.Event, *peermail.Dir) {
	t.Helper()
	setDispatchSwitch(t, true, false)
	dir := testenv.TempDir(t)
	peersDir := filepath.Join(dir, "peers")
	prov := newInboxSteerProvider()
	sess := sessionstore.NewSession("sys")
	exec := agent.New(prov, tool.NewRegistry(), sess, agent.Options{}, event.Discard)
	sink, done, events := collectSink()
	path := filepath.Join(dir, "sessions", "receiver.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	c := New(Options{
		Runner: exec, Executor: exec, Sink: sink,
		SessionDir: filepath.Dir(path), SessionPath: path,
		Peers: PeersOptions{Dir: peersDir},
	})
	t.Cleanup(func() { prov.unblock(); c.Close(); c.autosaveWG.Wait() })
	peers, err := peermail.Open(peersDir)
	if err != nil {
		t.Fatal(err)
	}
	c.peerIngest()
	c.Submit("initial turn")
	select {
	case <-prov.started:
	case e := <-done:
		t.Fatalf("the turn ended before it reached the provider: %+v", e)
	case <-time.After(testenv.Budget(t)):
		t.Fatal("the turn never started")
	}
	return c, exec, sess, prov, done, events, peers
}

// A message that arrives while the turn is running is the case where waiting
// hurts: the session that sent it is blocked on an answer, and the turn that
// could act on it is busy. It rides the steer path — the door the person's own
// mid-turn guidance comes through — instead of waiting in the follow-up queue
// for the turn to end.
func TestAMessageFromAnotherSessionReachesARunningTurnWithoutWaitingForItToEnd(t *testing.T) {
	c, _, sess, prov, done, _, peers := peerSteeringTurn(t)
	body := "the docs target is failing the build"
	if err := peers.Send(peermail.Message{
		ID: "m1", SentAt: time.Now().UTC(), Body: body,
		From: peermail.Party{SessionID: "s-0000000000000001", Title: "docs session", Project: "alpha"},
		To:   peermail.Party{SessionID: c.peers.key},
	}); err != nil {
		t.Fatal(err)
	}
	c.peerIngest()
	if held := c.HeldPeerMessages(); len(held) != 1 {
		t.Fatalf("held = %+v, want the one message", held)
	}
	if err := c.ResolvePeerMessage("m1", true); err != nil {
		t.Fatalf("approve: %v", err)
	}

	// The turn is still running. An item sitting queued here is the delay the
	// person reported; one accepted as a steer is the message reaching the model
	// at its next step.
	items := c.InboxSnapshot().Items
	if len(items) != 1 || items[0].State != sessioninbox.StateSteerAccepted {
		t.Fatalf("queue = %+v, want the message accepted as a mid-turn steer", items)
	}

	prov.unblock()
	waitForDoneWithin(t, done, 60*time.Second)
	delivered := 0
	for _, m := range sess.Snapshot() {
		if !strings.Contains(m.Content, body) {
			continue
		}
		delivered++
		if !m.HostAuthored {
			t.Fatalf("the peer steer was persisted as the person's own message: %+v", m)
		}
	}
	if delivered != 1 {
		t.Fatalf("the message reached the model %d times, want once", delivered)
	}
}

// The model has to tell three speakers apart, because the answer to each is
// different: the person may redirect the task, the host is reporting a fact,
// and another session is data the person may not have read. A peer message
// must not borrow the host's voice — that is the one label that says the user
// said nothing.
func TestAMessageFromAnotherSessionDoesNotClaimTheHostWroteIt(t *testing.T) {
	c, _, sess, prov, done, _, peers := peerSteeringTurn(t)
	body := "please regenerate the fixtures"
	if err := peers.Send(peermail.Message{
		ID: "m2", SentAt: time.Now().UTC(), Body: body,
		From: peermail.Party{SessionID: "s-0000000000000002", Title: "fixtures", Project: "beta"},
		To:   peermail.Party{SessionID: c.peers.key},
	}); err != nil {
		t.Fatal(err)
	}
	c.peerIngest()
	if err := c.ResolvePeerMessage("m2", true); err != nil {
		t.Fatalf("approve: %v", err)
	}
	prov.unblock()
	waitForDoneWithin(t, done, 60*time.Second)

	var peer string
	for _, m := range sess.Snapshot() {
		if strings.Contains(m.Content, body) {
			peer = m.Content
		}
	}
	if peer == "" {
		t.Fatal("the message never reached the model")
	}
	if strings.Contains(peer, sessionstore.HostNoticePrefix) {
		t.Fatalf("a message from another session is labelled as the host's own:\n%s", peer)
	}
	if strings.Contains(peer, sessionstore.MidTurnSteerPrefix) {
		t.Fatalf("a message from another session is labelled as the user's words:\n%s", peer)
	}
	if !strings.Contains(peer, "another Reasonix session") {
		t.Fatalf("the message does not say where it came from:\n%s", peer)
	}
}

// The decision has to leave a mark the person can read. A steer the model
// consumed becomes their own transcript's guidance, so without a notice an
// approved message arrives invisibly.
func TestAnApprovedPeerMessageLeavesAVisibleNotice(t *testing.T) {
	c, _, _, prov, done, events, peers := peerSteeringTurn(t)
	if err := peers.Send(peermail.Message{
		ID: "m1", SentAt: time.Now().UTC(), Body: "the docs target is failing",
		From: peermail.Party{SessionID: "s-0000000000000001", Title: "docs session", Project: "alpha"},
		To:   peermail.Party{SessionID: c.peers.key},
	}); err != nil {
		t.Fatal(err)
	}
	c.peerIngest()
	if err := c.ResolvePeerMessage("m1", true); err != nil {
		t.Fatalf("approve: %v", err)
	}
	var notices []event.Event
	for _, e := range events() {
		if e.Kind == event.Notice && strings.Contains(e.Text, "message from another session") {
			notices = append(notices, e)
		}
	}
	if len(notices) != 1 {
		t.Fatalf("peer notices = %+v, want exactly one", notices)
	}
	if !strings.Contains(notices[0].Text, "docs session") {
		t.Fatalf("notice text = %q, want the sender named", notices[0].Text)
	}
	prov.unblock()
	waitForDoneWithin(t, done, 60*time.Second)
}

// A denial never reaches the turn, so it must not leave the notice an approval
// would: the person already made the decision the notice reports.
func TestADeniedPeerMessageLeavesNoNotice(t *testing.T) {
	c, _, _, prov, done, events, peers := peerSteeringTurn(t)
	if err := peers.Send(peermail.Message{
		ID: "m2", SentAt: time.Now().UTC(), Body: "regenerate the fixtures",
		From: peermail.Party{SessionID: "s-0000000000000002", Title: "docs session", Project: "beta"},
		To:   peermail.Party{SessionID: c.peers.key},
	}); err != nil {
		t.Fatal(err)
	}
	c.peerIngest()
	if err := c.ResolvePeerMessage("m2", false); err != nil {
		t.Fatalf("deny: %v", err)
	}
	for _, e := range events() {
		if e.Kind == event.Notice && strings.Contains(e.Text, "message from another session") {
			t.Fatalf("a denied message left a notice: %+v", e)
		}
	}
	prov.unblock()
	waitForDoneWithin(t, done, 60*time.Second)
}

// A turn that finished between the approval and the injection keeps the
// message: it becomes the follow-up it would have been, rather than being
// dropped because the door it tried was already closed.
func TestAMessageApprovedAfterTheTurnEndsStillArrives(t *testing.T) {
	c, _, sess, prov, done, _, peers := peerSteeringTurn(t)
	body := "hold the release until the migration lands"
	if err := peers.Send(peermail.Message{
		ID: "m3", SentAt: time.Now().UTC(), Body: body,
		From: peermail.Party{SessionID: "s-0000000000000003", Title: "release", Project: "gamma"},
		To:   peermail.Party{SessionID: c.peers.key},
	}); err != nil {
		t.Fatal(err)
	}
	c.peerIngest()
	prov.unblock()
	waitForDoneWithin(t, done, 60*time.Second)
	if err := c.ResolvePeerMessage("m3", true); err != nil {
		t.Fatalf("approve after the turn: %v", err)
	}
	waitForDoneWithin(t, done, 60*time.Second)
	delivered := 0
	for _, m := range sess.Snapshot() {
		delivered += strings.Count(m.Content, body)
	}
	if delivered != 1 {
		t.Fatalf("the message reached the model %d times, want once", delivered)
	}
}
