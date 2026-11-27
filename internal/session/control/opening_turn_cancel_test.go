package control

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/event"
	"reasonix/internal/contract/provider"
	"reasonix/internal/contract/tool"
	"reasonix/internal/runtime/agent"
	"reasonix/internal/state/sessioninbox"
	"reasonix/internal/state/sessionstore"
)

// A dispatched session's opening turn is host-authored. Cancelling it must keep
// the task the session was opened to do: stripping it as scaffolding leaves the
// session with no subject, so it cannot be named and is not listed again.
func TestCancellingTheOpeningHostTurnKeepsItsTask(t *testing.T) {
	dir := testenv.TempDir(t)
	prov := newInboxSteerProvider()
	sess := sessionstore.NewSession("sys")
	exec := agent.New(prov, tool.NewRegistry(), sess, agent.Options{}, event.Discard)
	sink, done, _ := collectSink()
	c := New(Options{
		Runner: exec, Executor: exec, Sink: sink,
		SessionDir: dir, SessionPath: filepath.Join(dir, "s.jsonl"),
	})
	t.Cleanup(func() { prov.unblock(); c.Close(); c.autosaveWG.Wait() })

	rec, err := c.EnqueueInbox(InboxRequest{
		Intent: sessioninbox.IntentFollowup, Origin: sessioninbox.OriginHost,
		Source: "peer:s-sender", Display: "message from another session: sender",
		Raw:    "fix the login loop",
		Submit: "<peer-message from=\"sender\">\nfix the login loop\n</peer-message>",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.TrySubmitInboxItem(rec.ItemID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-prov.started:
	case e := <-done:
		t.Fatalf("the turn ended before it reached the provider: %+v", e)
	case <-time.After(testenv.Budget(t)):
		t.Fatal("the turn never started")
	}

	c.Cancel()
	prov.unblock()
	waitForDoneWithin(t, done, 60*time.Second)

	kept := false
	for _, m := range sess.Snapshot() {
		if m.Role != provider.RoleUser || !strings.Contains(m.Content+m.RawContent, "fix the login loop") {
			continue
		}
		kept = true
		if !m.HostAuthored {
			t.Fatalf("the kept task was attributed to the person: %+v", m)
		}
		if m.RawContent != "fix the login loop" {
			t.Fatalf("raw content = %q, want the sender's own text", m.RawContent)
		}
	}
	if !kept {
		t.Fatalf("cancelling erased the session's opening task: %+v", sess.Snapshot())
	}
}
