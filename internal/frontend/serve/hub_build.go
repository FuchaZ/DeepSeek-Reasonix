package serve

import (
	"context"
	"errors"
	"os"
	"strings"

	"reasonix/internal/assembly/boot"
	"reasonix/internal/contract/agentcomposition"
	"reasonix/internal/contract/event"
	"reasonix/internal/contract/provider"
	"reasonix/internal/state/sessionstore"
)

// paneBuild is everything one open needs in order to assemble its runtime:
// what the caller asked for, the composition the transcript was written under,
// and the posture read from the session's own record.
type paneBuild struct {
	req       OpenRequest
	inherited *agentcomposition.Binding
	binding   *agentcomposition.Binding
	posture   sessionBuildPostureResult
	root      string
	paneSink  event.Sink
	settings  *sessionstore.BranchMeta
}

// buildPane assembles the runtime a pane runs on, retrying on the default model
// when a branch names one this machine can no longer resolve. It reports
// whether that fallback happened, because the pane then owes the person a note.
func (h *Hub) buildPane(ctx context.Context, in paneBuild) (*boot.BuildResult, bool, error) {
	build := func(model string, fallback bool) (*boot.BuildResult, error) {
		opts := boot.Options{
			AgentComposition:         in.req.AgentComposition,
			Composition:              in.binding,
			ComputerDriver:           h.opts.ComputerDriver,
			Model:                    strings.TrimSpace(model),
			AgentPreset:              in.posture.preset,
			RoleText:                 in.posture.role,
			WorkspaceRoot:            in.root,
			SessionDir:               SessionDirFor(in.root),
			Sink:                     in.paneSink,
			NativeSurfaces:           h.opts.NativeSurfaces,
			Stderr:                   os.Stderr,
			DiagnosticSink:           h.skillNotices.once(in.paneSink),
			StatsSource:              h.surface(),
			FeedbackSurface:          feedbackSurface(h.surface()),
			AccountsURL:              accountsBaseURL(),
			BalanceStore:             h.wallets,
			OpenOnFallbackModel:      fallback,
			ProviderResolver:         h.opts.ProviderResolver,
			CleanupPendingReconciler: BackgroundCleanupReconciler,
			NewConversation:          strings.TrimSpace(in.req.SessionPath) == "",
		}
		if in.inherited != nil {
			return boot.BuildRuntime(ctx, opts)
		}
		return buildCompositionOrHistory(ctx, opts)
	}
	built, err := build(in.req.Model, in.settings == nil)
	if err != nil && in.settings != nil && errors.Is(err, provider.ErrUnknownModel) {
		fallback, retryErr := build("", true)
		return fallback, retryErr == nil, retryErr
	}
	return built, false, err
}
