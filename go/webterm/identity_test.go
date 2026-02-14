package webterm

import (
	"strings"
	"testing"
)

func TestGenerateIDLength(t *testing.T) {
	for _, size := range []int{1, 5, 12, 50} {
		id := GenerateID(size)
		if len(id) != size {
			t.Errorf("GenerateID(%d) length = %d", size, len(id))
		}
	}
}

func TestGenerateIDDefaultSize(t *testing.T) {
	id := GenerateID(0)
	if len(id) != identitySize {
		t.Errorf("GenerateID(0) length = %d, want %d", len(id), identitySize)
	}
}

func TestGenerateIDAlphabet(t *testing.T) {
	id := GenerateID(1000)
	for _, ch := range id {
		if !strings.ContainsRune(identityAlphabet, ch) {
			t.Errorf("GenerateID produced char %q not in alphabet", string(ch))
		}
	}
}

func FuzzGenerateID(f *testing.F) {
	f.Add(0)
	f.Add(1)
	f.Add(12)
	f.Add(100)
	f.Add(-5)
	f.Add(500)

	f.Fuzz(func(t *testing.T, size int) {
		// Cap size to avoid excessive allocation
		if size > 10000 {
			size = 10000
		}
		id := GenerateID(size)
		expectedLen := size
		if size <= 0 {
			expectedLen = identitySize
		}
		if len(id) != expectedLen {
			t.Errorf("GenerateID(%d) length = %d, want %d", size, len(id), expectedLen)
		}
		for _, ch := range id {
			if !strings.ContainsRune(identityAlphabet, ch) {
				t.Errorf("GenerateID(%d) produced char %q not in alphabet %q", size, string(ch), identityAlphabet)
			}
		}
	})
}
