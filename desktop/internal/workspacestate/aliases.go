// Package workspacestate re-exports the canonical Workspace registry package
// from the root module.
//
// The registry's parse and write implementation now lives in
// reasonix/internal/workspacestate so the root module (Serve, CLI) can read the
// same authoritative workspace registry the desktop already maintains, instead
// of duplicating a partial reader. This file keeps the desktop's import path
// and API surface stable: every alias below denotes the identical type,
// constant, function, or error value, so existing desktop call sites need no
// changes. Because these are type aliases rather than defined types, methods on
// *Store and every constant's type carry over unchanged.
package workspacestate

import (
	ws "reasonix/internal/workspacestate"
)

// Types.
type (
	State              = ws.State
	Workspace          = ws.Workspace
	Organization       = ws.Organization
	OrganizationGroup  = ws.OrganizationGroup
	SessionState       = ws.SessionState
	Presentation       = ws.Presentation
	PendingCreate      = ws.PendingCreate
	SourceMapping      = ws.SourceMapping
	RecoveryEntry      = ws.RecoveryEntry
	TopicRemoval       = ws.TopicRemoval
	Operation          = ws.Operation
	PurgeState         = ws.PurgeState
	PurgeSourceCleanup = ws.PurgeSourceCleanup
	Store              = ws.Store
	ReadSnapshot       = ws.ReadSnapshot
	ReadVersions       = ws.ReadVersions
	WorkspaceIndex     = ws.WorkspaceIndex
)

// Constants.
const (
	SchemaVersion     = ws.SchemaVersion
	GlobalWorkspaceID = ws.GlobalWorkspaceID
	Active            = ws.Active
	Archived          = ws.Archived
	Deleted           = ws.Deleted

	PurgeAbsent         = ws.PurgeAbsent
	PurgePreparedStale  = ws.PurgePreparedStale
	PurgeTombstoned     = ws.PurgeTombstoned
	PurgeContentRemoved = ws.PurgeContentRemoved
	PurgeCommitted      = ws.PurgeCommitted
	PurgeInvalid        = ws.PurgeInvalid
)

// Functions.
var (
	NewStore                 = ws.NewStore
	SessionKey               = ws.SessionKey
	ClassifyPurge            = ws.ClassifyPurge
	FindWorkspace            = ws.FindWorkspace
	ResolveWorkspaceID       = ws.ResolveWorkspaceID
	ResolveCreationWorkspace = ws.ResolveCreationWorkspace
	NewWorkspaceIndex        = ws.NewWorkspaceIndex
	NewReadVersions          = ws.NewReadVersions
	TopicSessionRemovalToken = ws.TopicSessionRemovalToken
)

// Error values.
var (
	ErrUnsupportedVersion           = ws.ErrUnsupportedVersion
	ErrWorkspaceNotFound            = ws.ErrWorkspaceNotFound
	ErrSessionNotFound              = ws.ErrSessionNotFound
	ErrMutationConflict             = ws.ErrMutationConflict
	ErrCreationWorkspaceUnavailable = ws.ErrCreationWorkspaceUnavailable
	ErrCreationWorkspaceChanged     = ws.ErrCreationWorkspaceChanged
	ErrCreationSessionInactive      = ws.ErrCreationSessionInactive
)
