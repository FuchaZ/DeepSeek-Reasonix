//go:build windows

package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/event"
	"reasonix/internal/safety/sandbox"
	"reasonix/internal/tools/jobs"
)

// A background job that left a child holding its output must still end when it
// is killed: the job leaves the running list within the shell's wait delay, not
// after the child's own lifetime, and the child does not outlive the kill.
func TestKilledBackgroundJobWithAChildLeavesTheRunningList(t *testing.T) {
	powershell, err := exec.LookPath("powershell")
	if err != nil {
		t.Skip("powershell not found")
	}
	tmp := testenv.TempDir(t)
	pidFile := filepath.Join(tmp, "child.pid")
	quoted := strings.ReplaceAll(pidFile, "'", "''")
	command := fmt.Sprintf(
		startDetachedNoConsole(fmt.Sprintf(hiddenSleeperArgs, 300))+
			"Set-Content -LiteralPath '%s' -Value $p.Id; Start-Sleep -Seconds 300", quoted)
	m := jobs.NewManager(event.Discard)
	defer m.Close()
	ctx := jobs.WithManager(context.Background(), m)
	args, _ := json.Marshal(map[string]any{"command": command, "run_in_background": true})
	if _, err := (bash{shell: sandbox.Shell{Kind: sandbox.ShellPowerShell, Path: powershell}}).Execute(ctx, args); err != nil {
		t.Fatalf("start: %v", err)
	}
	childPID := waitForWindowsPIDFile(t, pidFile)
	defer killWindowsPID(childPID)
	id := m.Running()[0].ID
	if _, err := (killShell{}).Execute(ctx, []byte(`{"job_id":"`+id+`"}`)); err != nil {
		t.Fatalf("kill_shell: %v", err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for len(m.Running()) > 0 {
		if time.Now().After(deadline) {
			t.Fatalf("the killed job is still listed as running after 30s: %+v", m.Running())
		}
		time.Sleep(200 * time.Millisecond)
	}
	for range 50 {
		if !windowsProcessAlive(childPID) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("child process %d survived the kill", childPID)
}
