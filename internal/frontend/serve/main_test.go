package serve

import (
	"context"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/frontend/clisession"
	"reasonix/internal/platform/telemetry"
)

func TestMain(m *testing.M) {
	telemetry.Retired = false
	// The usage and history projections are process-wide and cached per home,
	// so no controller closes them; Windows will not unlink a file still open
	// under the disposable home.
	testenv.OnCleanup(func(context.Context) error {
		clisession.CloseUsageCatalogs()
		return nil
	})
	testenv.RunWithIsolatedUserState(m)
}
