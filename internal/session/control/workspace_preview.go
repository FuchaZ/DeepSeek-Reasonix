package control

import (
	"context"

	"reasonix/internal/base/workspacefile"
)

func (c *Controller) previewFiles() (workspacefile.Service, error) {
	extra, err := c.ReadableExtraRoots()
	return workspacefile.Service{Primary: c.WorkspaceRoot(), Extra: extra}, err
}

func (c *Controller) WorkspacePreviewInfo(ctx context.Context, ref workspacefile.Ref) (workspacefile.Info, error) {
	files, err := c.previewFiles()
	if err != nil {
		return workspacefile.Info{}, err
	}
	return files.Info(ctx, ref)
}

func (c *Controller) WorkspacePreviewContent(ctx context.Context, ref workspacefile.Ref) ([]byte, workspacefile.Info, error) {
	files, err := c.previewFiles()
	if err != nil {
		return nil, workspacefile.Info{}, err
	}
	return files.Content(ctx, ref)
}

// WorkspaceResolvePath answers where a path spelled from somewhere else in the
// workspace really lives. A conversation's links are read against the workspace
// root, though the model writes them against whatever directory its shell ran
// in — `cd crate && cargo build` reports `target/release/app.exe`. A read that
// found nothing asks this before it reports the file gone.
func (c *Controller) WorkspaceResolvePath(written string) (workspacefile.Ref, error) {
	files, err := c.previewFiles()
	if err != nil {
		return workspacefile.Ref{}, err
	}
	return files.Suffix(written)
}
