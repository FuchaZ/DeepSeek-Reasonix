package workspacefile_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"reasonix/internal/base/testenv"
	"reasonix/internal/base/workspacefile"
)

func write(t *testing.T, root, rel string) {
	t.Helper()
	at := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(at, []byte(rel), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSuffixFindsAFileSpelledFromAnotherWorkingDirectory(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "crate/target/release/app.exe")
	ref, err := (workspacefile.Service{Primary: root}).Suffix("target/release/app.exe")
	if err != nil {
		t.Fatalf("Suffix: %v", err)
	}
	if ref.Path != "crate/target/release/app.exe" || ref.Root != "" {
		t.Fatalf("Suffix = %+v, want the crate's path inside the workspace", ref)
	}
}

func TestSuffixTakesBackslashesAsTheModelWritesThem(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "crate/target/release/app.exe")
	ref, err := (workspacefile.Service{Primary: root}).Suffix(`target\release\app.exe`)
	if err != nil || ref.Path != "crate/target/release/app.exe" {
		t.Fatalf("Suffix(`target\\release\\app.exe`) = %+v, %v", ref, err)
	}
}

func TestSuffixFindsAFileUnderTheWorkspaceRootItself(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "app.exe")
	ref, err := (workspacefile.Service{Primary: root}).Suffix("app.exe")
	if err != nil || ref.Path != "app.exe" {
		t.Fatalf("Suffix = %+v, %v", ref, err)
	}
}

func TestSuffixRefusesAnAmbiguousTail(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "a/target/release/app.exe")
	write(t, root, "b/target/release/app.exe")
	_, err := (workspacefile.Service{Primary: root}).Suffix("target/release/app.exe")
	if !errors.Is(err, workspacefile.ErrAmbiguous) {
		t.Fatalf("Suffix = %v, want ErrAmbiguous", err)
	}
}

func TestSuffixKeepsAPathThatIsNotATail(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "x/release/app.exe")
	if _, err := (workspacefile.Service{Primary: root}).Suffix("target/release/app.exe"); !errors.Is(err, workspacefile.ErrMissing) {
		t.Fatalf("a path that only shares the file name = %v, want ErrMissing", err)
	}
}

func TestSuffixNamesTheRootAFileWasFoundIn(t *testing.T) {
	primary, extra := testenv.TempDir(t), testenv.TempDir(t)
	write(t, extra, "shots/out.png")
	ref, err := (workspacefile.Service{Primary: primary, Extra: []string{extra}}).Suffix("shots/out.png")
	if err != nil {
		t.Fatalf("Suffix: %v", err)
	}
	if ref.Path != "shots/out.png" || filepath.Clean(ref.Root) != filepath.Clean(extra) {
		t.Fatalf("Suffix = %+v, want the granted folder named", ref)
	}
}

func TestSuffixLeavesDependencyTreesOutOfTheWalk(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "node_modules/pkg/target/release/app.exe")
	write(t, root, "crate/target/release/app.exe")
	ref, err := (workspacefile.Service{Primary: root}).Suffix("target/release/app.exe")
	if err != nil || ref.Path != "crate/target/release/app.exe" {
		t.Fatalf("Suffix = %+v, %v; want the crate's own file, not the dependency's", ref, err)
	}
}

func TestSuffixRefusesToClimbOrEscape(t *testing.T) {
	root := testenv.TempDir(t)
	write(t, root, "app.exe")
	for _, written := range []string{"../app.exe", "/etc/passwd", "..", ""} {
		if _, err := (workspacefile.Service{Primary: root}).Suffix(written); !errors.Is(err, workspacefile.ErrMissing) {
			t.Errorf("Suffix(%q) = %v, want ErrMissing", written, err)
		}
	}
}
