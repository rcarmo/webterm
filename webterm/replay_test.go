package webterm

import "testing"

func TestReplayBufferTrimsOldData(t *testing.T) {
	buffer := NewReplayBuffer(5)
	buffer.Add([]byte("abc"))
	buffer.Add([]byte("de"))
	buffer.Add([]byte("f"))
	if got := string(buffer.Bytes()); got != "def" {
		t.Fatalf("expected trimmed replay buffer, got %q", got)
	}
}

func FuzzReplayBuffer(f *testing.F) {
	f.Add([]byte("hello"), []byte("world"), 100)
	f.Add([]byte{}, []byte("a"), 1)
	f.Add([]byte("abcdef"), []byte("ghijkl"), 5)
	f.Add(make([]byte, 300), []byte{0xff}, 256)

	f.Fuzz(func(t *testing.T, chunk1, chunk2 []byte, limit int) {
		if limit <= 0 {
			limit = 1
		}
		if limit > 1024*1024 {
			limit = 1024 * 1024
		}
		buf := NewReplayBuffer(limit)
		buf.Add(chunk1)
		buf.Add(chunk2)
		result := buf.Bytes()

		// Result size must not exceed limit
		if len(result) > limit {
			t.Errorf("replay buffer size %d exceeds limit %d", len(result), limit)
		}

		// If both chunks fit, all data should be present
		if len(chunk1)+len(chunk2) <= limit {
			combined := append(append([]byte{}, chunk1...), chunk2...)
			if string(result) != string(combined) {
				t.Errorf("expected full data when within limit")
			}
		}
	})
}

func FuzzReplayBufferRapid(f *testing.F) {
	f.Add([]byte("a"), 10)
	f.Add([]byte("abcdefghij"), 5)

	f.Fuzz(func(t *testing.T, chunk []byte, count int) {
		if count < 0 {
			count = 0
		}
		if count > 200 {
			count = 200
		}
		buf := NewReplayBuffer(256)
		for i := 0; i < count; i++ {
			buf.Add(chunk)
		}
		result := buf.Bytes()
		if len(result) > 256 {
			t.Errorf("replay buffer exceeded limit: %d", len(result))
		}
	})
}
