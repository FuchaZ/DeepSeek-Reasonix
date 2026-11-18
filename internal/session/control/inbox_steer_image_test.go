package control

import (
	"os"
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

// A picture attached to mid-turn guidance rides the running turn. It used to be
// refused kernel-side and silently converted to a follow-up turn, so the
// composer's steer could not carry one.
func TestSteeringWithAnImageLandsItOnTheRunningTurn(t *testing.T) {
	dir := testenv.TempDir(t)
	workspace := filepath.Join(dir, "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	writeVisionTestConfig(t, workspace)
	imagePath := filepath.Join(workspace, "shot.png")
	if err := os.WriteFile(imagePath, mustBase64(t, tinyPNG), 0o644); err != nil {
		t.Fatal(err)
	}
	prov := newInboxSteerProvider()
	sess := sessionstore.NewSession("sys")
	exec := agent.New(prov, tool.NewRegistry(), sess, agent.Options{}, event.Discard)
	sink, done, _ := collectSink()
	c := New(Options{
		Runner:        exec,
		Executor:      exec,
		Sink:          sink,
		SessionDir:    dir,
		SessionPath:   filepath.Join(dir, "s.jsonl"),
		WorkspaceRoot: workspace,
		ModelRef:      "custom/vision-pro",
	})
	defer c.autosaveWG.Wait()
	t.Cleanup(prov.unblock)
	c.Submit("initial turn")
	select {
	case <-prov.started:
	case <-time.After(testenv.Budget(t)):
		t.Fatal("the turn never started")
	}
	rec, err := c.EnqueueInbox(InboxRequest{Intent: sessioninbox.IntentSteer, Submit: "look at this @shot.png", Source: "test"})
	if err != nil {
		t.Fatal(err)
	}
	_, env, err := c.ReadInboxItem(rec.ItemID)
	if err != nil || len(env.FrozenImages) != 1 {
		t.Fatalf("frozen image envelope = %+v err=%v", env, err)
	}
	frozen := env.FrozenImages[0]
	got, err := c.TrySteerInboxItem(rec.ItemID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Disposition != sessioninbox.DispositionSteerAccepted {
		t.Fatalf("an image steer converted to %q; it belongs on the running turn", got.Disposition)
	}
	prov.unblock()
	waitForDone(t, done)
	for _, req := range prov.requests {
		for _, m := range req.Messages {
			if m.Role == provider.RoleUser && len(m.Images) == 1 && m.Images[0] == frozen && strings.Contains(m.Content, "look at this") {
				return
			}
		}
	}
	t.Fatalf("no steered user message carried the enqueue-time image: %+v", prov.requests)
}
