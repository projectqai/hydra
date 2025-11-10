package main

import (
	_ "github.com/projectqai/hydra/logging"

	"github.com/projectqai/hydra/cmd"

	_ "github.com/projectqai/hydra/cli"
	"github.com/projectqai/hydra/engine"
	_ "github.com/projectqai/hydra/view"
	"github.com/spf13/cobra"

	"github.com/pkg/browser"
)

func init() {
	cmd.CMD.Flags().Bool("view", false, "open builtin webview")

	cmd.CMD.RunE = func(cmd *cobra.Command, args []string) error {
		all, _ := cmd.Flags().GetBool("all")
		enableView, _ := cmd.Flags().GetBool("view")

		errc := make(chan error)

		go func() {
			errc <- engine.CMD.RunE(cmd, args)
		}()

		if all || enableView {
			browser.OpenURL("http://localhost:50051")
		}

		err := <-errc
		return err
	}
}

func main() {
	err := cmd.CMD.Execute()
	if err != nil {
		panic(err)
	}
}
