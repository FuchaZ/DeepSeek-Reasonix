package anthropic

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"reasonix/internal/contract/provider"
)

func TestStreamNamesItsSession(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("X-Magpie-Session")
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, `event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":2,"output_tokens":0}}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}

event: message_stop
data: {"type":"message_stop"}

`)
	}))
	defer srv.Close()

	p, err := New(provider.Config{Name: "gateway", BaseURL: srv.URL, Model: "claude-sonnet-4-6", APIKey: "sk-test"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ch, err := p.Stream(context.Background(), provider.Request{
		Messages:  []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
		SessionID: "sess-1",
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	for chunk := range ch {
		if chunk.Type == provider.ChunkError {
			t.Fatalf("stream error: %v", chunk.Err)
		}
	}
	if got != "sess-1" {
		t.Fatalf("X-Magpie-Session = %q, want sess-1", got)
	}
}
