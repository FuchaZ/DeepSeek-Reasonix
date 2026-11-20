package openai

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"reasonix/internal/contract/provider"
)

func TestChatRequestsNameTheirSession(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("X-Magpie-Session")
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer srv.Close()

	p, err := New(provider.Config{Name: "relay", BaseURL: srv.URL + "/v1", Model: "m", APIKey: "k"})
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
