package control

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/contract/config"
	"reasonix/internal/ext/skill"
)

func completionController(t *testing.T) *Controller {
	t.Helper()
	home := testenv.TempDir(t)
	t.Setenv("REASONIX_HOME", home)
	for i := range 3 {
		dir := filepath.Join(home, ".reasonix", "skills", fmt.Sprintf("sk-%d", i))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		body := fmt.Sprintf("---\nname: sk-%d\ndescription: skill %d\n---\nBODY", i, i)
		if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	opts := skill.Options{HomeDir: home, DisableBuiltins: true}
	root := testenv.TempDir(t)
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := New(Options{SkillStore: skill.New(opts), AllSkillStore: skill.New(opts), WorkspaceRoot: root})
	t.Cleanup(c.Close)
	return c
}

// The lazy data must answer every line exactly as the full data does: it only
// leaves out what the line's branch of Complete never reads.
func TestCompletionDataForAnswersLikeTheFullData(t *testing.T) {
	c := completionController(t)
	for _, line := range []string{"/", "/sk", "/sk-1", "/skills ", "/skills sk-", "/model ", "/memory ", "/compact", "hello", "hello @", "/review @READ", "@READ"} {
		cursor := len(line)
		want := Complete(line, cursor, func() CompletionData { d := c.CompletionData(""); d.Scoped = true; return d }())
		got := Complete(line, cursor, func() CompletionData { d := c.CompletionDataFor("", line, cursor); d.Scoped = true; return d }())
		if !reflect.DeepEqual(want, got) {
			t.Errorf("line %q: lazy data answered %+v, full data %+v", line, got, want)
		}
	}
}

func TestNamingACommandReadsNoPackageOrConfig(t *testing.T) {
	c := completionController(t)
	var parses atomic.Int64
	prev := config.SetInstalledPackages(func(string) []config.InstalledPackage { parses.Add(1); return nil })
	defer func() { config.SetInstalledPackages(prev) }()

	for _, line := range []string{"/", "/sk", "/sk-1"} {
		parses.Store(0)
		_ = c.CompletionDataFor("", line, len(line))
		if got := parses.Load(); got != 0 {
			t.Errorf("completing %q parsed the installed packages %d times, want 0", line, got)
		}
	}
	parses.Store(0)
	_ = c.CompletionDataFor("", "/model ", len("/model "))
	if got := parses.Load(); got == 0 || got > 3 {
		t.Errorf("completing a command's arguments parsed the installed packages %d times, want between 1 and 3 (user config, workspace config, skill switches)", got)
	}
}
