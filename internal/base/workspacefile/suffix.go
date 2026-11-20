package workspacefile

import (
	"context"
	"io/fs"
	"path"
	"path/filepath"
	"strings"
)

// skipScanDir names the folders a suffix search never enters.
var skipScanDir = map[string]bool{
	".git": true, ".hg": true, ".svn": true, "node_modules": true, "vendor": true,
	".venv": true, "venv": true, "__pycache__": true,
}

// Suffix locates a path written by something whose working directory is not the
// workspace root: `cd crate && cargo build` reports `target/release/app.exe`,
// though the file sits under `crate/` from the workspace. Only an unambiguous
// answer is returned — two files ending the same way is a question for the
// person, not a coin toss.
func (s Service) Suffix(written string) (Ref, error) {
	tail := path.Clean(strings.ReplaceAll(strings.TrimSpace(written), `\`, "/"))
	if tail == "" || tail == "." || tail == ".." || path.IsAbs(tail) || strings.HasPrefix(tail, "../") {
		return Ref{}, ErrMissing
	}
	// The spelling is usually right, and a caller asks this for every path it
	// opens rather than only the ones that failed, so an exact answer costs one
	// stat and no walk.
	if ref, err := s.Resolve(filepath.FromSlash(tail)); err == nil {
		if _, infoErr := s.Info(context.Background(), ref); infoErr == nil {
			return ref, nil
		}
	}
	var found Ref
	for _, base := range append([]string{s.Primary}, s.Extra...) {
		matched := matchSuffix(base, tail)
		for _, rel := range matched {
			if found.Path != "" {
				return Ref{}, ErrAmbiguous
			}
			found = Ref{Path: rel}
			if filepath.Clean(base) != filepath.Clean(s.Primary) {
				found.Root = base
			}
		}
	}
	if found.Path == "" {
		return Ref{}, ErrMissing
	}
	return found, nil
}

// matchSuffix walks one root for up to two files whose path ends with the given
// tail on a separator boundary. Two is all the caller needs to refuse an
// ambiguous answer; a root it cannot open contributes nothing.
func matchSuffix(base, tail string) []string {
	var out []string
	_ = filepath.WalkDir(base, func(at string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if at != base && entry != nil && entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if at == base {
			return nil
		}
		if entry.IsDir() {
			if skipScanDir[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		rel, relErr := filepath.Rel(base, at)
		if relErr != nil || !filepath.IsLocal(rel) {
			return nil
		}
		if rel = filepath.ToSlash(rel); rel == tail || strings.HasSuffix(rel, "/"+tail) {
			out = append(out, rel)
			if len(out) > 1 {
				return filepath.SkipAll
			}
		}
		return nil
	})
	return out
}
