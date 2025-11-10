package main

import (
	"github.com/projectqai/hydra/engine"
	_ "github.com/projectqai/hydra/view"
	"github.com/spf13/cobra"
	webview "github.com/webview/webview_go"
)

func main() {
	go engine.RunEngine(&cobra.Command{}, []string{})

	w := webview.New(false)
	defer w.Destroy()
	w.SetTitle("Basic Example")
	w.SetSize(480, 320, webview.HintNone)
	w.Navigate("http://localhost:50051")
	w.Run()
}
