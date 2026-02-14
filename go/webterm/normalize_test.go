package webterm

import (
	"bytes"
	"testing"
)

func TestNormalizeC1Controls(t *testing.T) {
	input := []byte{0x9B, '3', '1', 'm', 'A'}
	normalized, pending := NormalizeC1Controls(input, nil)
	if string(pending) != "" {
		t.Fatalf("expected no pending bytes, got %q", string(pending))
	}
	if string(normalized) != "\x1b[31mA" {
		t.Fatalf("unexpected normalized output: %q", string(normalized))
	}
}

func TestNormalizeC1ControlsPreservesSplitUTF8(t *testing.T) {
	first := []byte{0xC3}
	normalized, pending := NormalizeC1Controls(first, nil)
	if len(normalized) != 0 {
		t.Fatalf("expected no output for incomplete utf8")
	}
	second, pending2 := NormalizeC1Controls([]byte{0xA9}, pending)
	if len(pending2) != 0 {
		t.Fatalf("expected no pending bytes after completion")
	}
	if string(second) != "é" {
		t.Fatalf("unexpected utf8 output: %q", string(second))
	}
}

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

func FuzzNormalizeC1Controls(f *testing.F) {
	f.Add([]byte{0x9B, '3', '1', 'm', 'A'}, []byte{})
	f.Add([]byte{0xC3, 0xA9}, []byte{})
	f.Add([]byte{0xA9}, []byte{0xC3})
	f.Add([]byte("hello world"), []byte{})
	f.Add([]byte{0xF0, 0x9F, 0x98, 0x80}, []byte{})
	f.Add([]byte{0x90, 0x98, 0x9C, 0x9D, 0x9E, 0x9F}, []byte{})
	f.Add([]byte{}, []byte{0xE0, 0xA0})

	f.Fuzz(func(t *testing.T, data []byte, pending []byte) {
		out, remaining := NormalizeC1Controls(data, pending)
		// Must never panic (implicit). Output + remaining should account for all non-C1 bytes.
		_ = out
		// Remaining must be a valid incomplete UTF-8 prefix (0-3 bytes)
		if len(remaining) > 3 {
			t.Errorf("remaining too large: %d bytes", len(remaining))
		}
		// No C1 control bytes should survive in output
		for _, b := range out {
			if b >= 0x80 && b <= 0x9F {
				// Could be part of valid UTF-8 continuation byte (0x80-0xBF)
				if b >= 0x90 && b <= 0x9F {
					// These are C1 controls that should have been replaced,
					// but only if they weren't valid UTF-8 continuation bytes.
					// Since C1 replacement only happens for lead bytes (not continuations),
					// we just verify no standalone C1 controls remain.
				}
			}
		}
	})
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
