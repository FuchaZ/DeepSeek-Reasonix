package provider

import (
	"net/http"
	"testing"
)

func TestApplySessionIdentityNamesTheConversation(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "https://relay.example.com/v1/chat/completions", nil)
	ApplySessionIdentity(req, "sess-1")
	if got := req.Header.Get("X-Magpie-Session"); got != "sess-1" {
		t.Fatalf("X-Magpie-Session = %q, want sess-1", got)
	}
}

func TestApplySessionIdentitySendsNothingWithoutASession(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "https://relay.example.com/v1/chat/completions", nil)
	ApplySessionIdentity(req, "  ")
	if got := req.Header.Get("X-Magpie-Session"); got != "" {
		t.Fatalf("X-Magpie-Session = %q, want none", got)
	}
}

func TestApplySessionIdentityKeepsAConfiguredHeader(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "https://relay.example.com/v1/chat/completions", nil)
	req.Header.Set("X-Magpie-Session", "mine")
	ApplySessionIdentity(req, "theirs")
	if got := req.Header.Get("X-Magpie-Session"); got != "mine" {
		t.Fatalf("X-Magpie-Session = %q, want the configured value kept", got)
	}
}
