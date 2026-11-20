package provider

import (
	"net/http"
	"strings"
)

// sessionHeader names a call's conversation to a gateway that groups usage by
// session (magpie's protocol). The gateway strips it before the request goes
// upstream, so a vendor never sees it.
const sessionHeader = "X-Magpie-Session"

// ApplySessionIdentity names the conversation a call belongs to. An empty
// sessionID names none and sends nothing; a configured custom header wins.
func ApplySessionIdentity(req *http.Request, sessionID string) {
	if req == nil {
		return
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || req.Header.Get(sessionHeader) != "" {
		return
	}
	req.Header.Set(sessionHeader, sessionID)
}
