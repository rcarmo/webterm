package webterm

import (
	"bytes"
	"regexp"
)

var (
	daResponsePattern = regexp.MustCompile(`\x1b\[[?>=][\d;]*c`)
	daPartialPattern  = regexp.MustCompile(`\x1b(?:\[(?:[?>=][\d;]*)?)?$`)
)

func FilterDASequences(data []byte, escapeBuffer []byte) ([]byte, []byte) {
	merged := append(append([]byte{}, escapeBuffer...), data...)
	if len(merged) == 0 {
		return nil, nil
	}
	filtered := daResponsePattern.ReplaceAll(merged, nil)
	if len(filtered) == 0 {
		return nil, nil
	}
	match := daPartialPattern.FindIndex(filtered)
	if match == nil {
		return filtered, nil
	}
	if match[0] == len(filtered)-1 || bytes.HasPrefix(filtered[match[0]:], []byte("\x1b[")) || bytes.Equal(filtered[match[0]:], []byte("\x1b")) {
		return filtered[:match[0]], filtered[match[0]:]
	}
	return filtered, nil
}
