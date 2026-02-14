package webterm

import "testing"

func TestTwoWayMapBasic(t *testing.T) {
	m := NewTwoWayMap[string, int]()
	if err := m.Set("a", 1); err != nil {
		t.Fatalf("Set error: %v", err)
	}
	v, ok := m.Get("a")
	if !ok || v != 1 {
		t.Fatalf("Get(a) = %d, %v", v, ok)
	}
	k, ok := m.GetKey(1)
	if !ok || k != "a" {
		t.Fatalf("GetKey(1) = %q, %v", k, ok)
	}
	m.DeleteKey("a")
	_, ok = m.Get("a")
	if ok {
		t.Fatalf("expected key to be deleted")
	}
}

func FuzzTwoWayMap(f *testing.F) {
	f.Add("key1", "val1", "key2", "val2", true)
	f.Add("a", "b", "a", "c", false)
	f.Add("x", "y", "z", "y", true)
	f.Add("", "", "", "", false)

	f.Fuzz(func(t *testing.T, k1, v1, k2, v2 string, deleteFirst bool) {
		m := NewTwoWayMap[string, string]()

		// Set first pair
		_ = m.Set(k1, v1)

		// Verify invariant: Get and GetKey are consistent
		if val, ok := m.Get(k1); ok {
			if key, ok2 := m.GetKey(val); !ok2 || key != k1 {
				t.Errorf("bidirectional invariant broken for (%q, %q)", k1, v1)
			}
		}

		if deleteFirst {
			m.DeleteKey(k1)
			if _, ok := m.Get(k1); ok {
				t.Errorf("key %q still present after delete", k1)
			}
			if _, ok := m.GetKey(v1); ok {
				t.Errorf("value %q still present after delete of key %q", v1, k1)
			}
		}

		// Set second pair
		_ = m.Set(k2, v2)

		// Keys list should be consistent with forward map
		keys := m.Keys()
		for _, key := range keys {
			if _, ok := m.Get(key); !ok {
				t.Errorf("Keys() returned %q but Get(%q) failed", key, key)
			}
		}
	})
}
