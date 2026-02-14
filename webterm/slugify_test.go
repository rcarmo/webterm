package webterm

import (
	"regexp"
	"testing"
)

var validSlugPattern = regexp.MustCompile(`^[a-z0-9_-]*$`)

func TestSlugifyBasic(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"Hello World", "hello-world"},
		{"My App 2.0!", "my-app-20"},
		{"---padded---", "padded"},
		{"", ""},
	}
	for _, tc := range cases {
		got := Slugify(tc.in)
		if got != tc.want {
			t.Errorf("Slugify(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func FuzzSlugify(f *testing.F) {
	f.Add("Hello World")
	f.Add("My App 2.0!")
	f.Add("---padded---")
	f.Add("")
	f.Add("café résumé")
	f.Add("日本語テスト")
	f.Add("a" + string([]byte{0x00, 0x01}) + "b")
	f.Add(string(make([]byte, 1024)))

	f.Fuzz(func(t *testing.T, input string) {
		result := Slugify(input)
		// Result must only contain lowercase alphanumeric and hyphens
		if !validSlugPattern.MatchString(result) {
			t.Errorf("Slugify(%q) = %q contains invalid characters", input, result)
		}
		// Result must not start or end with hyphen/underscore
		if len(result) > 0 {
			if result[0] == '-' || result[0] == '_' {
				t.Errorf("Slugify(%q) = %q starts with separator", input, result)
			}
			if result[len(result)-1] == '-' || result[len(result)-1] == '_' {
				t.Errorf("Slugify(%q) = %q ends with separator", input, result)
			}
		}
	})
}
