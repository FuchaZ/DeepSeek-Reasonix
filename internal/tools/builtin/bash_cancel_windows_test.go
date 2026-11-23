//go:build windows

package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"reasonix/internal/base/testenv"
	"reasonix/internal/safety/sandbox"
)

// startDetachedNoConsole starts arguments detached with no console and no
// inherited handles, leaving the pid in $p.Id. Start-Process allocates a console
// (a visible Windows Terminal tab) and CreateNoWindow inherits this shell's
// stdout, which holds WaitDelay open; CreateProcessW avoids both. 104 is
// sizeof(STARTUPINFOW).
func startDetachedNoConsole(arguments string) string {
	return `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Detached {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct SI {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hProcess, hThread; public int pid, tid; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="CreateProcessW")]
  public static extern bool CreateProcess([MarshalAs(UnmanagedType.LPWStr)] string app,
    [MarshalAs(UnmanagedType.LPWStr)] string cmd, IntPtr pa, IntPtr ta,
    bool inherit, uint flags, IntPtr env, [MarshalAs(UnmanagedType.LPWStr)] string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
}
'@
$si = New-Object Detached+SI
$si.cb = 104
$pi = New-Object Detached+PI
$ok = [Detached]::CreateProcess([NullString]::Value, 'powershell.exe ` + arguments + `',
  [IntPtr]::Zero, [IntPtr]::Zero, $false, 0x08000000, [IntPtr]::Zero, [NullString]::Value, [ref]$si, [ref]$pi)
if (-not $ok) { throw "start the child: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
[void][Detached]::CloseHandle($pi.hProcess); [void][Detached]::CloseHandle($pi.hThread)
$p = [pscustomobject]@{ Id = $pi.pid }
`
}

const hiddenSleeperArgs = `-NoProfile -NonInteractive -Command "Start-Sleep -Seconds %d"`

func TestBashCancelKillsWindowsChildProcessTree(t *testing.T) {
	powershell, err := exec.LookPath("powershell")
	if err != nil {
		t.Skip("powershell not found")
	}
	tmp := testenv.TempDir(t)
	pidFile := filepath.Join(tmp, "child.pid")
	quotedPIDFile := strings.ReplaceAll(pidFile, "'", "''")
	command := fmt.Sprintf(
		startDetachedNoConsole(fmt.Sprintf(hiddenSleeperArgs, 120))+
			"Set-Content -LiteralPath '%s' -Value $p.Id; "+
			"Start-Sleep -Seconds 120",
		quotedPIDFile,
	)
	args, _ := json.Marshal(map[string]any{"command": command})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		_, runErr := (bash{
			shell: sandbox.Shell{Kind: sandbox.ShellPowerShell, Path: powershell},
		}).Execute(ctx, args)
		done <- runErr
	}()

	childPID := waitForWindowsPIDFile(t, pidFile)
	cancel()
	select {
	case err = <-done:
	case <-time.After(40 * time.Second):
		killWindowsPID(childPID)
		t.Fatal("cancel did not interrupt bash within 40s")
	}
	if err == nil {
		t.Fatal("expected cancel to return an error")
	}
	for range 50 {
		if !windowsProcessAlive(childPID) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	killWindowsPID(childPID)
	t.Fatalf("child process %d survived bash cancel", childPID)
}

func TestBashWindowsReapsChildAfterForegroundShellExit(t *testing.T) {
	powershell, err := exec.LookPath("powershell")
	if err != nil {
		t.Skip("powershell not found")
	}
	tmp := testenv.TempDir(t)
	pidFile := filepath.Join(tmp, "child.pid")
	quotedPIDFile := strings.ReplaceAll(pidFile, "'", "''")
	command := fmt.Sprintf(
		startDetachedNoConsole(fmt.Sprintf(hiddenSleeperArgs, 120))+
			"Set-Content -LiteralPath '%s' -Value $p.Id",
		quotedPIDFile,
	)
	args, _ := json.Marshal(map[string]any{"command": command})

	out, err := (bash{
		shell: sandbox.Shell{Kind: sandbox.ShellPowerShell, Path: powershell},
	}).Execute(context.Background(), args)
	childPID := waitForWindowsPIDFile(t, pidFile)
	if err != nil {
		killWindowsPID(childPID)
		t.Fatalf("foreground command failed: %v (out=%q)", err, out)
	}
	for range 50 {
		if !windowsProcessAlive(childPID) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	killWindowsPID(childPID)
	t.Fatalf("child process %d survived foreground bash cleanup", childPID)
}

func TestBashCancelKillsGitBashHereDocPython(t *testing.T) {
	sh := sandbox.ResolveShell("bash", "", nil)
	if sh.Kind != sandbox.ShellBash || sh.Path == "" {
		t.Skip("Git Bash not found")
	}
	python := gitBashPython(t, sh.Path)
	tmp := testenv.TempDir(t)
	pidFile := filepath.Join(tmp, "python.pid")
	pythonPIDFile := filepath.ToSlash(pidFile)
	command := fmt.Sprintf("%s - <<'PYEOF'\nimport os, time\nwith open(%q, 'w') as f:\n    f.write(str(os.getpid()))\n    f.flush()\ntime.sleep(120)\nPYEOF\n", shellQuote(python), pythonPIDFile)
	args, _ := json.Marshal(map[string]any{"command": command})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		_, runErr := (bash{shell: sh}).Execute(ctx, args)
		done <- runErr
	}()

	childPID := waitForWindowsPIDFile(t, pidFile)
	time.Sleep(300 * time.Millisecond) // let the tracker observe the Git Bash child tree.
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected cancel to return an error")
		}
	case <-time.After(20 * time.Second):
		killWindowsPID(childPID)
		t.Fatal("cancel did not interrupt Git Bash here-doc python within 20s")
	}
	for range 50 {
		if !windowsProcessAlive(childPID) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	killWindowsPID(childPID)
	t.Fatalf("Git Bash here-doc python process %d survived bash cancel", childPID)
}

func waitForWindowsPIDFile(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil {
			pid, parseErr := strconv.Atoi(strings.TrimSpace(string(data)))
			if parseErr == nil && pid > 0 {
				return pid
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for child pid file %s", path)
	return 0
}

func gitBashPython(t *testing.T, bashPath string) string {
	t.Helper()
	for _, name := range []string{"python3", "python"} {
		path, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		python := gitBashPath(t, bashPath, path)
		out, err := exec.Command(bashPath, "-lc", fmt.Sprintf("%s - <<'PYEOF'\nprint('ok')\nPYEOF\n", shellQuote(python))).CombinedOutput()
		if err == nil {
			return python
		}
		t.Logf("python candidate %s is not usable from Git Bash: %v: %s", python, err, strings.TrimSpace(string(out)))
	}
	t.Skip("python not found or not usable from Git Bash")
	return ""
}

func gitBashPath(t *testing.T, bashPath, path string) string {
	t.Helper()
	out, err := exec.Command(bashPath, "-lc", fmt.Sprintf("cygpath -u %s", shellQuote(path))).Output()
	if err == nil {
		converted := strings.TrimSpace(string(out))
		if converted != "" {
			return strings.Split(converted, "\n")[0]
		}
	}
	return filepath.ToSlash(path)
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func windowsProcessAlive(pid int) bool {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", fmt.Sprintf("if (Get-Process -Id %d -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }", pid))
	return cmd.Run() == nil
}

func killWindowsPID(pid int) {
	_ = exec.Command("taskkill", "/F", "/PID", strconv.Itoa(pid)).Run()
}
