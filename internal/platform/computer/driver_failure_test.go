package computer

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDriverRefusalReasonIsQuotedAndBounded(t *testing.T) {
	err := checkDriverResult(DriverResult{IsError: true, Content: []DriverContent{{Type: "text", Text: "source\n\x00" + strings.Repeat("x", 10000)}}})
	if CodeOf(err) != CodeDriverRefused {
		t.Fatal(err)
	}
	if strings.ContainsAny(err.Error(), "\n\x00") || len(err.Error()) > 2300 {
		t.Fatalf("unsafe diagnostic of %d bytes", len(err.Error()))
	}
}

func TestDriverRefusalReasonIsCutOnACharacterBoundary(t *testing.T) {
	// 3,000 three-byte characters: the grapheme budget cuts mid-string, and the
	// cut lands between characters, never inside one.
	reason := strings.Repeat("测", 3000)
	err := checkDriverResult(DriverResult{IsError: true, Content: []DriverContent{{Type: "text", Text: reason}}})
	if CodeOf(err) != CodeDriverRefused {
		t.Fatal(err)
	}
	if msg := err.Error(); strings.ContainsRune(msg, utf8.RuneError) || !strings.Contains(msg, strings.Repeat("测", 2047)+"…") {
		t.Fatalf("refusal reason was not cut cleanly: %q", msg)
	}
}
