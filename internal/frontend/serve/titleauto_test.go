package serve

import (
	"path/filepath"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/contract/event"
	"reasonix/internal/contract/provider"
	"reasonix/internal/session/control"
	"reasonix/internal/state/sessionstore"
)

func firstTurnPane(t *testing.T) (*Server, string) {
	t.Helper()
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	root := testenv.TempDir(t)
	ctrl := control.New(control.Options{WorkspaceRoot: root, SessionDir: SessionDirFor(root)})
	t.Cleanup(ctrl.Close)
	s := New(ctrl, NewBroadcaster(), config.ServeConfig{})
	path := filepath.Join(SessionDirFor(root), "20261114-130000.jsonl")
	sess := sessionstore.NewSession("system")
	sess.Add(provider.Message{Role: provider.RoleUser, Content: "fix the login loop"})
	sess.Add(provider.Message{Role: provider.RoleAssistant, Content: "found it"})
	if err := sess.SaveSnapshot(path); err != nil {
		t.Fatal(err)
	}
	ctrl.SetSessionPath(path)
	return s, path
}

// titleOn gives the pane the title model a person declared in settings, which
// is the only kind an automatic name may spend.
func titleOn(s *Server, prov provider.Provider) {
	s.titleModel = titleProviderState{prov: prov, declared: true}
}

// startTurn announces the first turn the way the kernel does: the message the
// person sent rides the event, so a name can be asked for before any answer.
func startTurn(s *Server, authored int, text string) {
	s.bc.Emit(event.Event{Kind: event.TurnStarted, AuthoredTurn: &authored, Text: text})
}

// settleNaming gives the naming goroutine time to reach its decision, for the
// tests that assert it made none.
func settleNaming() { time.Sleep(80 * time.Millisecond) }

func cachedTitle(s *Server, path string) (string, bool) {
	meta, ok, err := sessionstore.LoadBranchMeta(path)
	if err != nil || !ok || meta.Preview == "" {
		return "", false
	}
	return s.titles.get(filepath.Base(path), titleSource(meta.Preview), sessionstore.SessionContentModTime(path).UnixNano())
}

// A name is asked for while the turn is still running: the model sees the
// person's message, not the answer, and the wait is beside the work rather
// than after it.
func TestFirstTurnAsksForANameWhileTheTurnRuns(t *testing.T) {
	s, path := firstTurnPane(t)
	prov := &gatedTitleProvider{entered: make(chan struct{}), release: make(chan struct{})}
	titleOn(s, prov)

	startTurn(s, 1, "fix the login loop")
	<-prov.entered // the request left before any answer existed
	close(prov.release)

	got := waitTitle(t, s, filepath.Base(path), titleSource(mustPreview(t, path)), sessionstore.SessionContentModTime(path).UnixNano())
	if got != "fix the login loop" {
		t.Fatalf("title = %q, want the first message", got)
	}
	if prov.count() != 1 {
		t.Fatalf("requests = %d, want 1", prov.count())
	}
}

func mustPreview(t *testing.T, path string) string {
	t.Helper()
	meta, ok, err := sessionstore.LoadBranchMeta(path)
	if err != nil || !ok {
		t.Fatalf("sidecar unreadable: %v", err)
	}
	return meta.Preview
}

// The sidebar must read the name the first turn wrote. Both sides hash the
// listing preview, so a fill keyed on anything else lands where nothing looks.
func TestFirstTurnNamingLandsWhereTheTreeReadsIt(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	root := testenv.TempDir(t)
	h := NewHub(HubOptions{})
	rt := hubRuntime(t, h, root)
	path := filepath.Join(SessionDirFor(root), "20261114-140000.jsonl")
	sess := sessionstore.NewSession("system")
	sess.Add(provider.Message{Role: provider.RoleUser, Content: "fix the login loop"})
	if err := sess.SaveSnapshot(path); err != nil {
		t.Fatal(err)
	}
	rt.Server.Controller().SetSessionPath(path)
	titleOn(rt.Server, &recordingTitleProvider{})

	startTurn(rt.Server, 1, "fix the login loop")

	deadline := time.Now().Add(2 * time.Second)
	for {
		rows := h.workspacePage(rt.Root, "", nil, treeWindow{}, 0).Sessions
		if len(rows) == 1 && rows[0].Title == "fix the login loop" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the tree never picked up the generated name: %+v", rows)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// A later turn must not rename a conversation the person already recognises.
func TestLaterTurnLeavesTheNameAlone(t *testing.T) {
	s, path := firstTurnPane(t)
	prov := &recordingTitleProvider{}
	titleOn(s, prov)

	startTurn(s, 2, "and now something else")
	settleNaming()

	if prov.count() != 0 {
		t.Fatalf("requests = %d, want none for a second turn", prov.count())
	}
	if _, ok := cachedTitle(s, path); ok {
		t.Fatal("a later turn named the session")
	}
}

// A turn that opens no authored message — a steer, a fold digest, a synthetic
// continuation — is not the conversation's first turn, whatever it writes.
func TestTurnWithoutAnAuthoredNumberDoesNotNameTheSession(t *testing.T) {
	s, path := firstTurnPane(t)
	prov := &recordingTitleProvider{}
	titleOn(s, prov)

	s.bc.Emit(event.Event{Kind: event.TurnStarted, Text: "host injected"})
	settleNaming()

	if prov.count() != 0 {
		t.Fatalf("requests = %d, want none for an unnamed turn", prov.count())
	}
	if _, ok := cachedTitle(s, path); ok {
		t.Fatal("an unnamed turn named the session")
	}
}

// A name the person typed outranks anything generated for them.
func TestFirstTurnNamingKeepsATypedTitle(t *testing.T) {
	s, _ := firstTurnPane(t)
	prov := &recordingTitleProvider{}
	titleOn(s, prov)
	path := s.ctl().SessionPath()
	if err := sessionstore.UpdateBranchMeta(path, false, func(m *sessionstore.BranchMeta) error {
		m.CustomTitle = "the login loop"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	startTurn(s, 1, "fix the login loop")
	settleNaming()

	if prov.count() != 0 {
		t.Fatalf("requests = %d, want none when the person named it", prov.count())
	}
}

// Naming is decoration: a pane with no title provider keeps showing the preview.
func TestFirstTurnNamingWithoutATitleModel(t *testing.T) {
	s, path := firstTurnPane(t)
	s.titleModel = titleProviderState{}

	startTurn(s, 1, "fix the login loop")
	settleNaming()

	if _, ok := cachedTitle(s, path); ok {
		t.Fatal("a pane with no title model stored a title")
	}
}

// An undeclared title_model falls back to the chat model so a manual rename
// still works. Naming every session on its own must not spend that model: the
// settings page shows "do not use" for exactly this state.
func TestFirstTurnNamingStaysOffWithoutADeclaredTitleModel(t *testing.T) {
	s, path := firstTurnPane(t)
	prov := &recordingTitleProvider{}
	s.titleModel = titleProviderState{prov: prov}

	startTurn(s, 1, "fix the login loop")
	settleNaming()

	if prov.count() != 0 {
		t.Fatalf("requests = %d, want none while no title model is declared", prov.count())
	}
	if _, ok := cachedTitle(s, path); ok {
		t.Fatal("an undeclared title model named the session")
	}
}

// A stored title is already the answer; asking the model again only spends.
func TestFirstTurnNamingKeepsAnExistingTitle(t *testing.T) {
	s, path := firstTurnPane(t)
	prov := &recordingTitleProvider{}
	titleOn(s, prov)
	meta, _, err := sessionstore.LoadBranchMeta(path)
	if err != nil {
		t.Fatal(err)
	}
	s.titles.put(filepath.Base(path), "already named", titleSource(meta.Preview), sessionstore.SessionContentModTime(path).UnixNano())

	startTurn(s, 1, "fix the login loop")
	settleNaming()

	if prov.count() != 0 {
		t.Fatalf("requests = %d, want none for a session already named", prov.count())
	}
}
