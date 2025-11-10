package main

import (
	"context"

	_ "github.com/projectqai/hydra/logging"

	"github.com/projectqai/hydra/cmd"

	"github.com/projectqai/hydra/builtin"
	_ "github.com/projectqai/hydra/builtin/adsblol"
	_ "github.com/projectqai/hydra/builtin/ais"
	_ "github.com/projectqai/hydra/builtin/spacetrack"
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

		ctx := context.Background()

		serverAddr, err := engine.StartEngine(ctx)
		if err != nil {
			return err
		}

		builtin.StartAll(ctx, serverAddr)

		if all || enableView {
			browser.OpenURL("http://" + serverAddr)
		}

		select {}
	}
}

func main() {
	err := cmd.CMD.Execute()
	if err != nil {
		panic(err)
	}
}
