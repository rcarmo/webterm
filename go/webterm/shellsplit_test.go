package webterm

import "testing"

func TestShlexSplit(t *testing.T) {
	parts, err := shlexSplitImpl("echo 'hello world'")
	if err != nil {
		t.Fatalf("shlexSplit error = %v", err)
	}
	if len(parts) != 2 || parts[0] != "echo" || parts[1] != "hello world" {
		t.Fatalf("unexpected split result: %v", parts)
	}
}

func FuzzShlexSplit(f *testing.F) {
	f.Add("echo hello")
	f.Add("echo 'hello world'")
	f.Add(`echo "hello world"`)
	f.Add("")
	f.Add("a b c d e f g h i j")
	f.Add(`echo "it's a test"`)
	f.Add("echo \\n")
	f.Add("'unclosed")
	f.Add(`"unclosed`)
	f.Add("a\x00b")

	f.Fuzz(func(t *testing.T, command string) {
		// Must not panic; errors are acceptable for malformed input
		parts, err := shlexSplitImpl(command)
		if err != nil {
			return
		}
		// If no error, parts should be non-nil
		if parts == nil {
			t.Errorf("shlexSplit(%q) returned nil parts without error", command)
		}
	})
}
