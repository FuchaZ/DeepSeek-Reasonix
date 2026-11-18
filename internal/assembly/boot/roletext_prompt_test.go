package boot

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"reasonix/internal/base/testenv"
)

// A dispatch role enters the system prompt as an identity prefix, the same way
// a persona does. An ordinary session built without one carries no role text at
// all, so its prefix stays what a build without this field produced.
func TestRoleTextFoldsIntoSystemPromptOnlyForRoleSessions(t *testing.T) {
	t.Setenv("REASONIX_HOME", testenv.TempDir(t))
	dir := testenv.TempDir(t)
	writeFile(t, dir, "reasonix.toml", `
default_model = "test-model"

[agent]
system_prompt = "BASE SYSTEM PROMPT"

[[providers]]
name = "test-model"
kind = "openai"
base_url = "https://example.invalid"
model = "x"
api_key_env = "REASONIX_TEST_KEY_UNSET"
`)
	approveWorkspace(t, dir)

	plain, err := Build(context.Background(), Options{WorkspaceRoot: dir, SessionDir: filepath.Join(dir, "sessions")})
	if err != nil {
		t.Fatalf("Build plain: %v", err)
	}
	plainSys := systemMessage(plain.History())
	if strings.Contains(plainSys, "Dispatch role:") {
		plain.Close()
		t.Fatalf("ordinary session carries a dispatch role:\n%s", plainSys)
	}
	plain.Close()

	role, err := Build(context.Background(), Options{WorkspaceRoot: dir, SessionDir: filepath.Join(dir, "sessions"), RoleText: "reviewer"})
	if err != nil {
		t.Fatalf("Build role: %v", err)
	}
	defer role.Close()
	roleSys := systemMessage(role.History())
	if !strings.Contains(roleSys, "Dispatch role: reviewer") {
		t.Fatalf("role session's system prompt missing its role:\n%s", roleSys)
	}
	if !strings.HasPrefix(roleSys, "Dispatch role: reviewer") {
		t.Fatalf("role is not an identity prefix:\n%s", roleSys)
	}
}
