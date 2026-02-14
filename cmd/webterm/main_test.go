package main

import (
	"os"
	"testing"
)

func TestMainVersionFlag(t *testing.T) {
	orig := os.Args
	defer func() { os.Args = orig }()
	os.Args = []string{"webterm", "-v"}
	main()
}
