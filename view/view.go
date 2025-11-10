package view

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
)

//go:embed all:frontend/apps/foss/build
var dist embed.FS

var port string

func NewWebServer() (http.Handler, error) {
	distFS, err := fs.Sub(dist, "frontend/apps/foss/build")
	if err != nil {
		return nil, fmt.Errorf("failed to get dist subdirectory: %w", err)
	}
	fsys := http.FS(distFS)
	fileServer := http.FileServer(fsys)

	mux := http.NewServeMux()

	mux.HandleFunc("/node", nodeHandler)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}

		f, err := fsys.Open(path)
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// File not found - serve index.html for SPA routing
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})

	return mux, nil
}
