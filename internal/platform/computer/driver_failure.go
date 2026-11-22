package computer

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"reasonix/internal/base/textutil"
)

type driverStatus struct {
	Effect   string          `json:"effect"`
	Code     string          `json:"code"`
	Hint     string          `json:"hint"`
	Reason   string          `json:"reason"`
	NextCall *DriverNextCall `json:"next_call"`
}

func checkDriverResult(result DriverResult) error {
	var status driverStatus
	if len(result.Structured) > 0 {
		if err := json.Unmarshal(result.Structured, &status); err != nil {
			return fail(CodeFailed, "invalid CUA structured result")
		}
	}
	if !result.IsError && status.Effect != "refused" {
		return nil
	}
	// The hint is what to try next and never stands in for the refusal's own
	// cause, which reads from the reason fields or the prose result.
	hint, call := status.Hint, status.NextCall
	code, reason := status.Code, status.Reason
	if i := slices.IndexFunc(result.Content, func(c DriverContent) bool { return c.Type == "text" && c.Text != "" }); i >= 0 {
		reason = result.Content[i].Text
	}
	detail := "CUA refused the operation"
	if code != "" {
		detail += " (" + ShownBundle(code) + ")"
	}
	if reason != "" {
		bounded, _ := textutil.BoundLiteral(reason, textutil.PreviewLimit{Graphemes: 2048, Lines: 1})
		detail += ": " + fmt.Sprintf("%q", strings.TrimSpace(bounded))
	}
	detail += nextGuidance(hint, call)
	return &Failure{Code: CodeDriverRefused, Detail: detail}
}
