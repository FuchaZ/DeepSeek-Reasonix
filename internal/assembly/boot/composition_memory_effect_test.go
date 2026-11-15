package boot

import (
	"context"
	"strings"
	"testing"

	"reasonix/internal/contract/agentcomposition"
	"reasonix/internal/contract/provider"
	"reasonix/internal/state/agentpreset"
	"reasonix/internal/state/memory"
)

// presetDecidingMemory saves a preset whose persona decides what saved memory
// reaches the model. enabled nil writes no field at all, which is what a preset
// saved before the switch existed looks like.
func presetDecidingMemory(t *testing.T, home, root, id string, enabled *bool) {
	t.Helper()
	d := agentcomposition.Builtins()[0]
	d.ID = id
	d.Persona.IncludeMemory = enabled
	if _, err := agentpreset.New(home, root).Save(d, ""); err != nil {
		t.Fatalf("save preset %s: %v", id, err)
	}
}

// runPreset builds one session under a preset and returns the executor request
// it produced. It slices the recording provider so the caller can run several
// builds against one recorder and tell their requests apart.
func runPreset(t *testing.T, rec *effectRecordingProvider, home, root, preset string) provider.Request {
	t.Helper()
	before := len(rec.requests())
	res, err := BuildRuntime(context.Background(), Options{
		Home: home, WorkspaceRoot: root, AgentComposition: preset, resolvedShell: pinnedEffectShell(),
	})
	if err != nil {
		t.Fatalf("BuildRuntime(%s): %v", preset, err)
	}
	defer res.Controller.Close()
	res.Controller.EnsureSessionPath()
	if err := res.Controller.RunTurn(context.Background(), "Where do releases go?"); err != nil {
		t.Fatalf("RunTurn(%s): %v", preset, err)
	}
	reqs := agentRequests(rec.requests()[before:])
	if len(reqs) == 0 {
		t.Fatalf("no agent request reached the provider boundary for %s", preset)
	}
	return reqs[len(reqs)-1]
}

// TestEffectPresetWithholdingMemoryReachesTheProviderBoundary is the whole
// switch at its final boundary: a preset that withholds memory must send no
// saved fact on either surface the model reads — the cached prefix and the
// turn — while one that keeps memory, and one saved before the field existed,
// still sends it. Standing instructions survive every arm.
func TestEffectPresetWithholdingMemoryReachesTheProviderBoundary(t *testing.T) {
	const kind = "boot-effect-preset-memory"
	rec := &effectRecordingProvider{}
	provider.Register(kind, func(provider.Config) (provider.Provider, error) { return rec, nil })
	home, root := compositionTestWorkspace(t, kind)
	writeFile(t, root, "REASONIX.md", "# Rules\n\nAlways run go vet before committing.\n")

	// The fact has to be saved by a session that then ends: one written
	// mid-session is what this build's own prefix already folded in.
	seed, err := BuildRuntime(context.Background(), Options{Home: home, WorkspaceRoot: root, resolvedShell: pinnedEffectShell()})
	if err != nil {
		t.Fatalf("seed build: %v", err)
	}
	if _, err := seed.Controller.SaveMemory(memory.Memory{
		Name: "deploy-target", Description: "where releases go",
		Type: memory.TypeProject, Body: "Releases go to staging first.",
	}); err != nil {
		seed.Controller.Close()
		t.Fatalf("seed memory: %v", err)
	}
	seed.Controller.Close()

	on, off := true, false
	presetDecidingMemory(t, home, root, "user:keeps-memory", &on)
	presetDecidingMemory(t, home, root, "user:no-memory", &off)
	presetDecidingMemory(t, home, root, "user:legacy-memory", nil)

	const fact = "Releases go to staging first."
	for _, arm := range []struct {
		preset string
		want   bool
	}{
		{"user:keeps-memory", true},
		{"user:legacy-memory", true},
		{"user:no-memory", false},
	} {
		t.Run(arm.preset, func(t *testing.T) {
			req := runPreset(t, rec, home, root, arm.preset)
			sys, turn := systemOf(req), userTurnOf(t, req)
			gotFact := strings.Contains(sys, fact) || strings.Contains(turn, fact)
			if gotFact != arm.want {
				t.Fatalf("saved fact on the wire = %v, want %v\nsystem:\n%s\nturn:\n%s", gotFact, arm.want, sys, turn)
			}
			if arm.want {
				return
			}
			if strings.Contains(sys, "# Memory") || strings.Contains(sys, "Background memory") {
				t.Fatalf("the memory block reached the cached prefix:\n%s", sys)
			}
			if strings.Contains(turn, "remember") {
				t.Fatalf("the memory protocol reached the turn:\n%s", turn)
			}
			// The rules are the project's own text, not a saved fact, and a
			// preset saying "no memory" is not saying "no project".
			if !strings.Contains(turn, "Always run go vet before committing.") {
				t.Fatalf("standing instructions did not survive:\n%s", turn)
			}
		})
	}
}

// userTurnOf returns the newest user message of one request — where the turn's
// projected blocks ride.
func userTurnOf(t *testing.T, req provider.Request) string {
	t.Helper()
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if req.Messages[i].Role == provider.RoleUser {
			return req.Messages[i].Content
		}
	}
	t.Fatal("the request carried no user message")
	return ""
}

// TestEffectPresetWithholdingMemoryRegistersNoMemoryTool is the second surface:
// a model told it has no saved memory must not be handed a tool that reads it,
// and the capability registry is where a tool the model can still reach lives —
// use_capability dispatches from there, not from the provider-visible list.
func TestEffectPresetWithholdingMemoryRegistersNoMemoryTool(t *testing.T) {
	const kind = "boot-effect-preset-memory-tools"
	provider.Register(kind, func(provider.Config) (provider.Provider, error) { return &effectRecordingProvider{}, nil })
	home, root := compositionTestWorkspace(t, kind)
	off, on := false, true
	presetDecidingMemory(t, home, root, "user:no-memory-tools", &off)
	presetDecidingMemory(t, home, root, "user:keeps-memory-tools", &on)

	for _, arm := range []struct {
		preset string
		want   []string
	}{
		{"user:no-memory-tools", nil},
		{"user:keeps-memory-tools", []string{"memory", "remember", "forget"}},
	} {
		t.Run(arm.preset, func(t *testing.T) {
			res, err := BuildRuntime(context.Background(), Options{
				Home: home, WorkspaceRoot: root, AgentComposition: arm.preset, resolvedShell: pinnedEffectShell(),
			})
			if err != nil {
				t.Fatalf("BuildRuntime: %v", err)
			}
			defer res.Controller.Close()
			registered := map[string]bool{}
			for _, e := range res.Controller.AllToolContractEntries() {
				registered[e.Name] = true
			}
			for _, name := range []string{"memory", "remember", "forget"} {
				want := false
				for _, w := range arm.want {
					want = want || w == name
				}
				if registered[name] != want {
					t.Fatalf("%s registered = %v, want %v", name, registered[name], want)
				}
			}
		})
	}
}

// TestEffectPresetWithholdingMemoryReportsWhyRecallIsSilent pins the identity a
// reader acts on: "this preset withholds memory" and "the store is empty" lead
// to opposite next steps, so the diagnostic may not answer with the wrong one.
func TestEffectPresetWithholdingMemoryReportsWhyRecallIsSilent(t *testing.T) {
	const kind = "boot-effect-preset-memory-recall"
	provider.Register(kind, func(provider.Config) (provider.Provider, error) { return &effectRecordingProvider{}, nil })
	home, root := compositionTestWorkspace(t, kind)
	off := false
	presetDecidingMemory(t, home, root, "user:no-memory-recall", &off)

	seed, err := BuildRuntime(context.Background(), Options{Home: home, WorkspaceRoot: root, resolvedShell: pinnedEffectShell()})
	if err != nil {
		t.Fatalf("seed build: %v", err)
	}
	if _, err := seed.Controller.SaveMemory(memory.Memory{
		Name: "widget-calibration", Description: "how widgets are calibrated",
		Keywords: "widget calibration", Type: memory.TypeProject, Body: "Calibrate widgets with the jig.",
	}); err != nil {
		seed.Controller.Close()
		t.Fatalf("seed memory: %v", err)
	}
	seed.Controller.Close()

	res, err := BuildRuntime(context.Background(), Options{
		Home: home, WorkspaceRoot: root, AgentComposition: "user:no-memory-recall", resolvedShell: pinnedEffectShell(),
	})
	if err != nil {
		t.Fatalf("BuildRuntime: %v", err)
	}
	defer res.Controller.Close()
	res.Controller.EnsureSessionPath()
	if err := res.Controller.RunTurn(context.Background(), "how do I calibrate a widget"); err != nil {
		t.Fatalf("RunTurn: %v", err)
	}
	if got := res.Controller.LastMemoryRecall().SuppressionCode; got != memory.SuppressMemoryOff {
		t.Fatalf("recall suppression = %q, want %q", got, memory.SuppressMemoryOff)
	}
}
