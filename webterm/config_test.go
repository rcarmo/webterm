package webterm

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadLandingYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "landing.yaml")
	content := `
- name: Shell
  command: /bin/sh
  slug: shell
- name: Missing Command
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadLandingYAML(path)
	if err != nil {
		t.Fatalf("LoadLandingYAML() error = %v", err)
	}
	if len(apps) != 1 {
		t.Fatalf("expected 1 app, got %d", len(apps))
	}
	if apps[0].Slug != "shell" || apps[0].Command != "/bin/sh" {
		t.Fatalf("unexpected app: %+v", apps[0])
	}
}

func TestLoadLandingYAMLWebtermThemeKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "landing.yaml")
	content := `
- name: Pro
  command: /bin/sh
  webterm-theme: monokai-pro
- name: Classic
  command: /bin/sh
  theme: dracula
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	apps, err := LoadLandingYAML(path)
	if err != nil {
		t.Fatalf("LoadLandingYAML() error = %v", err)
	}
	if len(apps) != 2 {
		t.Fatalf("expected 2 apps, got %d", len(apps))
	}
	if apps[0].Theme != "monokai-pro" {
		t.Fatalf("expected monokai-pro from webterm-theme key, got %q", apps[0].Theme)
	}
	if apps[1].Theme != "dracula" {
		t.Fatalf("expected dracula from theme key, got %q", apps[1].Theme)
	}
}

func TestLoadComposeManifestReadsLabels(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "compose.yaml")
	content := `
services:
  web:
    labels:
      webterm-command: auto
      webterm-theme: monokai
  db:
    labels:
      - webterm-command=docker exec -it db psql
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	apps, project, err := LoadComposeManifest(path)
	if err != nil {
		t.Fatalf("LoadComposeManifest() error = %v", err)
	}
	if project != filepath.Base(dir) {
		t.Fatalf("unexpected project name: %q", project)
	}
	if len(apps) != 2 {
		t.Fatalf("expected 2 apps, got %d", len(apps))
	}
	if apps[0].Theme != "monokai" && apps[1].Theme != "monokai" {
		t.Fatalf("expected theme to be parsed")
	}
}

func FuzzExtractLabel(f *testing.F) {
	f.Add("webterm-command=auto", "webterm-command")
	f.Add("webterm-theme=monokai", "webterm-theme")
	f.Add("no-equals-sign", "no-equals-sign")
	f.Add("key=", "key")
	f.Add("=value", "")
	f.Add("key=val=ue", "key")
	f.Add("", "")

	f.Fuzz(func(t *testing.T, labelEntry, key string) {
		// Test list-style labels
		listLabels := []any{labelEntry}
		result := extractLabel(listLabels, key)
		_ = result // Must not panic

		// Test map-style labels — note asString() applies os.ExpandEnv
		mapLabels := map[string]any{key: labelEntry}
		result2 := extractLabel(mapLabels, key)
		// Result should be the env-expanded version of the entry
		_ = result2 // Must not panic

		// Test nil labels
		result3 := extractLabel(nil, key)
		if result3 != "" {
			t.Errorf("extractLabel(nil, %q) = %q, want empty", key, result3)
		}

		// Test unsupported type
		result4 := extractLabel(42, key)
		if result4 != "" {
			t.Errorf("extractLabel(42, %q) = %q, want empty", key, result4)
		}
	})
}
