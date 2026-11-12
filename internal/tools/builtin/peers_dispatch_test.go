package builtin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"reasonix/internal/contract/tool"
)

type fakeDispatcher struct {
	fakePeers
	asked [2]string
	role  string
	err   error
}

func (f *fakeDispatcher) DispatchToProject(_ context.Context, project, text, role string) (tool.DispatchReceipt, error) {
	f.asked = [2]string{project, text}
	f.role = role
	if f.err != nil {
		return tool.DispatchReceipt{}, f.err
	}
	return tool.DispatchReceipt{Project: "/work/billing", Key: "s-9", ID: "m-7", Role: role}, nil
}

func dispatchTool(dir tool.PeerDirectory) tool.Tool {
	link := &tool.PeerLink{}
	if dir != nil {
		link.Bind(dir)
	}
	return DispatchTool(link)
}

func TestDispatchToolHandsTheTaskOverAndReportsWhereItWent(t *testing.T) {
	d := &fakeDispatcher{}
	tl := dispatchTool(d)
	if tl.ReadOnly() {
		t.Fatal("handing work to another project is an outward effect, not a read")
	}
	out, err := tl.Execute(context.Background(), json.RawMessage(`{"project":"billing","text":"rotate the key"}`))
	if err != nil || d.asked != [2]string{"billing", "rotate the key"} {
		t.Fatalf("out %q err %v asked %v", out, err, d.asked)
	}
	for _, want := range []string{"/work/billing", "m-7", "s-9", "not as an instruction"} {
		if !strings.Contains(out, want) {
			t.Errorf("result lacks %q: %s", want, out)
		}
	}
}

func TestDispatchToolRefusalsKeepTheirIdentity(t *testing.T) {
	ctx := context.Background()
	if _, err := dispatchTool(nil).Execute(ctx, json.RawMessage(`{"project":"b","text":"x"}`)); err == nil || !strings.HasPrefix(err.Error(), "peer.disabled") {
		t.Fatalf("unbound = %v, want peer.disabled", err)
	}
	if _, err := dispatchTool(&fakePeers{}).Execute(ctx, json.RawMessage(`{"project":"b","text":"x"}`)); err == nil || !strings.HasPrefix(err.Error(), "dispatch.unavailable") {
		t.Fatalf("a directory that cannot dispatch = %v, want dispatch.unavailable", err)
	}
	for _, args := range []string{`{"project":"","text":"x"}`, `{"project":"b","text":"  "}`} {
		if _, err := dispatchTool(&fakeDispatcher{}).Execute(ctx, json.RawMessage(args)); err == nil || !strings.HasPrefix(err.Error(), "peer.empty") {
			t.Fatalf("%s = %v, want peer.empty", args, err)
		}
	}
	boom := errors.New("dispatch.untrusted: that project is not one you have trusted")
	if _, err := dispatchTool(&fakeDispatcher{err: boom}).Execute(ctx, json.RawMessage(`{"project":"b","text":"x"}`)); !errors.Is(err, boom) {
		t.Fatalf("a refusal from the host was changed on the way: %v", err)
	}
}

// A role travels through to the host and comes back in the result, and a call
// that names none leaves it empty so the host keeps its one-per-project rule.
func TestDispatchToolPassesTheRoleThrough(t *testing.T) {
	ctx := context.Background()

	plain := &fakeDispatcher{}
	out, err := dispatchTool(plain).Execute(ctx, json.RawMessage(`{"project":"billing","text":"rotate the key"}`))
	if err != nil || plain.role != "" {
		t.Fatalf("no role: err %v, role %q; want an empty role", err, plain.role)
	}
	if strings.Contains(out, "role") {
		t.Errorf("a roleless result names a role: %s", out)
	}

	named := &fakeDispatcher{}
	out, err = dispatchTool(named).Execute(ctx, json.RawMessage(`{"project":"alpha","text":"build the layout","role":"frontend"}`))
	if err != nil || named.role != "frontend" {
		t.Fatalf("role: err %v, role %q; want frontend", err, named.role)
	}
	if !strings.Contains(out, `"frontend"`) {
		t.Errorf("result does not name the role: %s", out)
	}
}
