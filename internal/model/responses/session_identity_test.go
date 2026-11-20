package responses

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"reasonix/internal/contract/provider"
)

func TestStreamNamesItsSession(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("X-Magpie-Session")
		writeEvents(w, `{"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`)
	}))
	defer srv.Close()

	p := New(Config{Name: "relay", BaseURL: srv.URL + "/v1", Model: "m", APIKey: "k"})
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
