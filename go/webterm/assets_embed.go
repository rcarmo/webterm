package webterm

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed static static/* static/js/* static/icons/*
var embeddedStaticAssets embed.FS

func embeddedStaticFS() (http.FileSystem, bool) {
	sub, err := fs.Sub(embeddedStaticAssets, "static")
	if err != nil {
		return nil, false
	}
	return http.FS(sub), true
}
