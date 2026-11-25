package serve

import (
	"testing"

	"reasonix/internal/contract/provider"
)

// A reopened picture call has to reach the client with the same pictures the
// live sink drew; without them the card can only say a picture was seen.
func TestHistoryCarriesThePicturesAToolShowed(t *testing.T) {
	want := []string{"data:image/png;base64,AA", "data:image/png;base64,BB"}
	msgs := []provider.Message{
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{ID: "c1", Name: "view_image"}}},
		{Role: provider.RoleTool, ToolCallID: "c1", Name: "view_image", Content: "[image]", Images: want},
	}
	var tool historyMessage
	for _, hm := range historyMessages(msgs) {
		if hm.Role == "tool" {
			tool = hm
		}
	}
	if len(tool.ToolImages) != len(want) {
		t.Fatalf("tool images = %v, want %v", tool.ToolImages, want)
	}
	for i := range want {
		if tool.ToolImages[i] != want[i] {
			t.Fatalf("tool image %d = %q, want %q", i, tool.ToolImages[i], want[i])
		}
	}
}
