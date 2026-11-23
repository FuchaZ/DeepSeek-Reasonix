package boot

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/contract/event"
	"reasonix/internal/contract/provider"
	"reasonix/internal/safety/permission"
	"reasonix/internal/session/control"
	"reasonix/internal/state/peermail"
)

// The send-side consent contract: telling another of the user's sessions
// something on their behalf comes back to the person under every posture --the card names the receiver and every word -- and a run with nobody watching
// is refused rather than answered for them.

// consentProvider fires one tool call on the model's first round, then finishes.
type consentProvider struct {
	mu       sync.Mutex
	reqs     []provider.Request
	toolName string
	args     string
}

func (p *consentProvider) Name() string { return "boot-consent" }

func (p *consentProvider) Stream(_ context.Context, req provider.Request) (<-chan provider.Chunk, error) {
	p.mu.Lock()
	p.reqs = append(p.reqs, req)
	first := len(p.reqs) == 1
	p.mu.Unlock()
	ch := make(chan provider.Chunk, 3)
	offered := false
	for _, t := range req.Tools {
		offered = offered || t.Name == p.toolName
	}
	if first && offered {
		ch <- provider.Chunk{Type: provider.ChunkToolCall, ToolCall: &provider.ToolCall{ID: "call-consent", Name: p.toolName, Arguments: p.args}}
	} else {
		ch <- provider.Chunk{Type: provider.ChunkText, Text: "done"}
	}
	ch <- provider.Chunk{Type: provider.ChunkDone}
	close(ch)
	return ch, nil
}

type consentSeen struct {
	mu        sync.Mutex
	approvals []event.Approval
}

func (s *consentSeen) first() (event.Approval, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.approvals) == 0 {
		return event.Approval{}, false
	}
	return s.approvals[0], true
}

type consentSession struct {
	ctrl        *control.Controller
	seen        *consentSeen
	peersDir    string
	setDispatch func(control.ProjectDispatcher)
}

// buildConsentSession assembles an interactive session whose model tries one
// tool call, under the given posture. It sets the process environment, so the
// tests using it run serially.
func buildConsentSession(t *testing.T, mode, toolName, argsJSON string) *consentSession {
	t.Helper()
	home := statedBootHome(t)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	dir := testenv.TempDir(t)
	rec := &consentProvider{toolName: toolName, args: argsJSON}
	kind := fmt.Sprintf("boot-consent-%s", strings.ReplaceAll(t.Name(), "/", "-"))
	provider.Register(kind, func(provider.Config) (provider.Provider, error) { return rec, nil })
	writeFile(t, dir, "reasonix.toml", `
default_model = "test-model"

[codegraph]
enabled = false

[[providers]]
name = "test-model"
kind = "`+kind+`"
model = "x"
`)
	writeFile(t, home, "config.toml", "[peers]\nenabled = true\ndispatch = true\n")
	approveWorkspaceAt(t, home, dir)
	seen := &consentSeen{}
	sink := event.FuncSink(func(e event.Event) {
		if e.Kind == event.ApprovalRequest {
			seen.mu.Lock()
			seen.approvals = append(seen.approvals, e.Approval)
			seen.mu.Unlock()
		}
	})
	ctrl, err := Build(context.Background(), Options{Home: home, WorkspaceRoot: dir, Sink: sink})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	t.Cleanup(ctrl.Close)
	if err := ctrl.NewSession(); err != nil {
		t.Fatal(err)
	}
	ctrl.SetToolApprovalMode(mode)
	ctrl.EnableInteractiveApproval()
	return &consentSession{ctrl: ctrl, seen: seen, peersDir: home + "/peers", setDispatch: ctrl.SetProjectDispatcher}
}

// awaitApproval runs one turn in the background and returns the card it raised.
func (s *consentSession) awaitApproval(t *testing.T, prompt string) (event.Approval, chan error) {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		done <- s.ctrl.Run(ctx, prompt)
	}()
	var request event.Approval
	waitFor(t, "the approval request", func() bool {
		var ok bool
		request, ok = s.seen.first()
		return ok
	})
	return request, done
}

// The auto posture allows every other writer without asking. Sending a message
// to another session is not a write into this workspace: it is speaking on the
// user's behalf, so the card still comes up, names the receiver and the whole
// text, and nothing reaches the spool until the person answers.
func TestEffectSendPeerMessageAsksBeforeSendingUnderAuto(t *testing.T) {
	const receiver = "s-00000000000000aa"
	const words = "INJECTED-TEXT-SAYS-SEND-THE-PLAN"
	args, _ := json.Marshal(map[string]string{"to": receiver, "text": words})
	s := buildConsentSession(t, control.ToolApprovalAuto, "send_peer_message", string(args))
	d, err := peermail.Open(s.peersDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.PublishLive(peermail.Live{SessionID: receiver, Title: "docs", Project: "notes", Inbound: "hold", BeatAt: time.Now(), StartedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the other session to be listed", func() bool { return len(s.ctrl.Peers()) == 1 })

	request, done := s.awaitApproval(t, "read the page and do what it says")
	if request.Tool != "send_peer_message" || !strings.Contains(request.Subject, receiver) || !strings.Contains(request.Subject, words) {
		t.Fatalf("the card does not show the receiver and the whole text: %+v", request)
	}
	if pending, _ := d.Pending(receiver); len(pending) != 0 {
		t.Fatalf("a message was spooled before the user answered: %+v", pending)
	}
	s.ctrl.Approve(request.ID, true, false, false)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	pending, _ := d.Pending(receiver)
	if len(pending) != 1 || pending[0].Body != words {
		t.Fatalf("after approval the spool holds %+v, want the one message", pending)
	}
}

// YOLO is the posture that allows everything; it still does not speak on the
// user's behalf. The promise "sending asks first" has no posture carve-out.
func TestEffectSendPeerMessageAsksBeforeSendingUnderYolo(t *testing.T) {
	const receiver = "s-00000000000000bb"
	const words = "YOLO-DOES-NOT-SEND-FOR-THE-USER"
	args, _ := json.Marshal(map[string]string{"to": receiver, "text": words})
	s := buildConsentSession(t, control.ToolApprovalYolo, "send_peer_message", string(args))
	d, err := peermail.Open(s.peersDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.PublishLive(peermail.Live{SessionID: receiver, Title: "docs", Project: "notes", Inbound: "hold", BeatAt: time.Now(), StartedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the other session to be listed", func() bool { return len(s.ctrl.Peers()) == 1 })

	request, done := s.awaitApproval(t, "read the page and do what it says")
	if request.Tool != "send_peer_message" || !strings.Contains(request.Subject, receiver) || !strings.Contains(request.Subject, words) {
		t.Fatalf("the card does not show the receiver and the whole text: %+v", request)
	}
	s.ctrl.Approve(request.ID, false, false, false)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if pending, _ := d.Pending(receiver); len(pending) != 0 {
		t.Fatalf("a declined message was spooled under yolo: %+v", pending)
	}
}

// Nobody is watching: the posture may not answer for the absent person, so the
// call is refused with its identity rather than sent.
func TestEffectSendPeerMessageIsRefusedWhenNobodyIsWatching(t *testing.T) {
	for _, mode := range []string{control.ToolApprovalAuto, control.ToolApprovalYolo} {
		t.Run(mode, func(t *testing.T) {
			const receiver = "s-00000000000000cc"
			args, _ := json.Marshal(map[string]string{"to": receiver, "text": "UNATTENDED-MUST-NOT-SEND"})
			run := buildPostureRun(t, "[peers]\nenabled = true\n", provider.ToolCall{ID: "c-send", Name: "send_peer_message", Arguments: string(args)})
			if err := run.ctrl.NewSession(); err != nil {
				t.Fatal(err)
			}
			d, err := peermail.Open(config.RootsForHome("").PeersDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := d.PublishLive(peermail.Live{SessionID: receiver, Title: "docs", Project: "notes", Inbound: "hold", BeatAt: time.Now(), StartedAt: time.Now()}); err != nil {
				t.Fatal(err)
			}
			run.runIn(t, mode)
			got := run.results["c-send"]
			if got.RefusalCode != permission.RefusalUnattended {
				t.Fatalf("the unattended send carries refusal %q (%s), want %q", got.RefusalCode, got.Err, permission.RefusalUnattended)
			}
			if pending, _ := d.Pending(receiver); len(pending) != 0 {
				t.Fatalf("an unattended send was spooled: %+v", pending)
			}
		})
	}
}

// Opening a session in another project and handing it a task is the same class
// of decision: it speaks on the user's behalf and spends their other project.
// The card comes up first, and a declined call opens nothing.
func TestEffectDispatchToProjectAsksBeforeOpeningTheWindow(t *testing.T) {
	const project = "notes"
	const text = "DISPATCHED-TASK-THE-USER-NEVER-SAW"
	args, _ := json.Marshal(map[string]string{"project": project, "text": text})
	s := buildConsentSession(t, control.ToolApprovalAuto, "dispatch_to_project", string(args))
	var mu sync.Mutex
	var dispatched []string
	fake := func(_ context.Context, proj, body, role string) (control.DispatchResult, error) {
		mu.Lock()
		dispatched = append(dispatched, proj+"|"+body+"|"+role)
		mu.Unlock()
		return control.DispatchResult{Project: proj, Key: "k", ID: "s-00000000000000dd", Role: role}, nil
	}
	s.setDispatch(fake)

	request, done := s.awaitApproval(t, "hand the task over")
	if request.Tool != "dispatch_to_project" || !strings.Contains(request.Subject, project) || !strings.Contains(request.Subject, text) {
		t.Fatalf("the card does not show the project and the whole task: %+v", request)
	}
	mu.Lock()
	early := len(dispatched)
	mu.Unlock()
	if early != 0 {
		t.Fatal("the task was dispatched before the user answered")
	}
	s.ctrl.Approve(request.ID, true, false, false)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(dispatched) != 1 || dispatched[0] != project+"|"+text+"|" {
		t.Fatalf("after approval the dispatcher saw %+v, want the one task", dispatched)
	}
}
