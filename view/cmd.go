package view

import (
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/projectqai/hydra/builtin"
	"github.com/spf13/cobra"
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

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	}), nil
}

var CMD = &cobra.Command{
	Use:   "view",
	Short: "serve the embedded web UI",
	RunE: func(cmd *cobra.Command, args []string) error {
		fileServer, err := NewWebServer()
		if err != nil {
			return err
		}

		http.Handle("/", fileServer)

		addr := ":" + port
		slog.Info("Open webui on http://localhost" + addr)
		return http.ListenAndServe(addr, nil)
	},
}

func init() {
	CMD.Flags().StringVarP(&port, "port", "p", "8080", "port to serve on")
	builtin.CMD.AddCommand(CMD)
}
