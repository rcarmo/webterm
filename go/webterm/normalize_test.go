package webterm

import (
	"bytes"
	"testing"
)

func TestFilterDASequencesCompleteAndPartial(t *testing.T) {
	data := []byte("a\x1b[?1;10;0cb")
	filtered, buffer := FilterDASequences(data, nil)
	if string(buffer) != "" {
		t.Fatalf("expected empty buffer, got %q", string(buffer))
	}
	if string(filtered) != "ab" {
		t.Fatalf("unexpected filtered output: %q", string(filtered))
	}

	part1, partBuffer := FilterDASequences([]byte("x\x1b[?1;10"), nil)
	if string(part1) != "x" {
		t.Fatalf("unexpected part1 output: %q", string(part1))
	}
	if string(partBuffer) == "" {
		t.Fatalf("expected buffered partial sequence")
	}
	part2, partBuffer2 := FilterDASequences([]byte(";0cy"), partBuffer)
	if string(partBuffer2) != "" {
		t.Fatalf("expected empty buffer after completion")
	}
	if string(part2) != "y" {
		t.Fatalf("unexpected part2 output: %q", string(part2))
	}
}

func FuzzFilterDASequences(f *testing.F) {
	f.Add([]byte("a\x1b[?1;10;0cb"), []byte{})
	f.Add([]byte("plain text"), []byte{})
	f.Add([]byte{0x1b, '[', '?'}, []byte{})
	f.Add([]byte(";0cy"), []byte("\x1b[?1;10"))
	f.Add([]byte("\x1b[>0c\x1b[=1c"), []byte{})
	f.Add([]byte{}, []byte{0x1b})
	f.Add([]byte("no escape"), []byte{})

	f.Fuzz(func(t *testing.T, data []byte, buffer []byte) {
		out, remaining := FilterDASequences(data, buffer)
		_ = out
		// Remaining should be empty or a partial escape sequence starting with ESC
		if len(remaining) > 0 && remaining[0] != 0x1b {
			t.Errorf("remaining buffer doesn't start with ESC: %q", remaining)
		}
		// Complete DA sequences should not appear in output
		if bytes.Contains(out, []byte("\x1b[?1;10;0c")) {
			t.Errorf("DA sequence leaked through filter")
		}
	})
}
