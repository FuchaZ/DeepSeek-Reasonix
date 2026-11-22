package computer

import "slices"

// DriverAction retains CUA's delivery facts without upgrading them to target proof.
type DriverAction struct {
	Effect   string           `json:"effect"`
	Route    string           `json:"route"`
	Path     string           `json:"path,omitempty"`
	Summary  string           `json:"summary"`
	Evidence []DriverEvidence `json:"evidence"`
	Delivery *struct {
		Mode  string `json:"mode"`
		Count *int   `json:"delivered_count"`
	} `json:"delivery"`
	Hint     string          `json:"hint,omitempty"`
	NextCall *DriverNextCall `json:"next_call,omitempty"`
}

// DriverEvidence is one fact the driver read behind an effect class.
type DriverEvidence struct {
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

func (a DriverAction) nativeContract(name string) DriverAction {
	if name == "set_value" && a.Route == "" && a.Path == "ax" {
		a.Route = "accessibility"
	}
	return a
}

func (a DriverAction) project() Effect {
	e := Effect{Class: EffectUnverifiable, Driver: &a, Hint: a.Hint, NextCall: a.NextCall}
	if a.Effect == "confirmed" && slices.ContainsFunc(a.Evidence, func(ev DriverEvidence) bool { return ev.Kind == "value_readback" }) {
		e.Class = EffectConfirmed
		e.Evidence = []Evidence{EvidenceValueReadback}
	}
	return e
}
