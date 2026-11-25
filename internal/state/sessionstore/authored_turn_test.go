package sessionstore

import (
	"testing"

	"reasonix/internal/contract/provider"
)

// A steer that landed carries the displayed text in RawContent, which is how
// every persisted steer is written. Classification must read the wrapper on
// Content, not the display copy: otherwise the guidance opens a turn the
// person never typed.
func TestASteerWithADisplayCopyIsStillASteer(t *testing.T) {
	for _, tc := range []struct {
		name   string
		source SteerSource
	}{
		{"user", SteerByUser},
		{"host", SteerByHost},
		{"peer", SteerByPeer},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := provider.Message{
				Role:       provider.RoleUser,
				Content:    MidTurnSteerSource("guidance", tc.source),
				RawContent: "guidance display",
			}
			class := ClassifyTurn(m, 0)
			if !class.Steer || class.StartsTurn || class.AuthoredTurn != 0 {
				t.Fatalf("a %s steer classified as %+v, want Steer with no turn", tc.name, class)
			}
		})
	}
}
