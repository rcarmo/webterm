package webterm

import "testing"

func FuzzToIntFromQuery(f *testing.F) {
	f.Add("42", 7)
	f.Add("-5", 10)
	f.Add("  123  ", 0)
	f.Add("not-a-number", 99)
	f.Add("", 11)

	f.Fuzz(func(t *testing.T, value string, fallback int) {
		got := toIntFromQuery(value, fallback)
		// Must not panic and should preserve fallback semantics for non-numeric values.
		if value == "" && got != fallback {
			t.Fatalf("empty value should use fallback: got=%d fallback=%d", got, fallback)
		}
	})
}

func FuzzHTMLHelpers(f *testing.F) {
	f.Add(`plain text`)
	f.Add(`<script>alert("x")</script>`)
	f.Add(`a&b<c>d"e`)
	f.Add(``)

	f.Fuzz(func(t *testing.T, value string) {
		escaped := htmlEscape(value)
		attrEscaped := htmlAttrEscape(value)
		if len(escaped) == 0 && len(value) > 0 {
			t.Fatalf("htmlEscape unexpectedly empty for %q", value)
		}
		if len(attrEscaped) == 0 && len(value) > 0 {
			t.Fatalf("htmlAttrEscape unexpectedly empty for %q", value)
		}
	})
}
