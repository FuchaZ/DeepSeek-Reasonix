package sessionstore

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// NewSessionPath returns the path to use for a fresh session, namespaced by
// the model so the filename hints at what the conversation was with. dir is
// typically config.SessionDir().
func NewSessionPath(dir, model string) string {
	safe := strings.NewReplacer("/", "-", "\\", "-", ":", "-", "<", "-", ">", "-", "\"", "-", "|", "-", "?", "-", "*", "-").Replace(model)
	if safe == "" {
		safe = "session"
	}
	return filepath.Join(dir, fmt.Sprintf("%s-%s.jsonl", time.Now().UTC().Format("20060102-150405.000000000"), safe))
}

// NewDatedSessionPath returns the path for a fresh session in a folder that
// nests its transcripts by date (…/2026/11/14) — the task area's conversations
// read back as a calendar. The dated folders are created on the first save.
func NewDatedSessionPath(dir, model string) string {
	return filepath.Join(dir, time.Now().Format("2006/01/02"), filepath.Base(NewSessionPath("", model)))
}
