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

//go:embed dist/*
var dist embed.FS

var port string

func NewWebServer() (http.Handler, error) {
	distFS, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, fmt.Errorf("failed to get dist subdirectory: %w", err)
	}
	return http.FileServer(http.FS(distFS)), nil
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
