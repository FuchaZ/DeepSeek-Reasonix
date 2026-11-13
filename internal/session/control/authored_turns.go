package control

import "reasonix/internal/runtime/agent"

// AuthoredTurns counts the turns the person opened in this session. A mid-turn
// steer and a fold digest are user-role lines that opened none, so counting
// role=user would report a longer conversation than anybody had. Re-derived
// from the transcript, never kept beside it: a stored count can disagree with
// the messages it numbers after a reload.
func (c *Controller) AuthoredTurns() int {
	return agent.PriorAuthoredTurn(c.History())
}
