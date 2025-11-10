package main

import (
	"context"
	"fmt"
	"os"

	_ "github.com/projectqai/hydra/logging"

	"github.com/projectqai/hydra/cmd"

	"github.com/projectqai/hydra/builtin"
	_ "github.com/projectqai/hydra/builtin/adsblol"
	_ "github.com/projectqai/hydra/builtin/ais"
	_ "github.com/projectqai/hydra/builtin/asterix"
	_ "github.com/projectqai/hydra/builtin/federation"
	_ "github.com/projectqai/hydra/builtin/spacetrack"
	_ "github.com/projectqai/hydra/builtin/tak"
	_ "github.com/projectqai/hydra/cli"
	"github.com/projectqai/hydra/engine"
	_ "github.com/projectqai/hydra/view"
	"github.com/spf13/cobra"

	"github.com/pkg/browser"
)

func init() {
	cmd.CMD.Flags().Bool("view", false, "open builtin webview")
	cmd.CMD.Flags().StringP("world", "w", "", "world state file to load on startup and periodically flush to")
	cmd.CMD.Flags().String("policy", "", "path to OPA policy file (.rego) for access control")

	cmd.CMD.RunE = func(cmd *cobra.Command, args []string) error {
		all, _ := cmd.Flags().GetBool("all")
		enableView, _ := cmd.Flags().GetBool("view")
		worldFile, _ := cmd.Flags().GetString("world")
		policyFile, _ := cmd.Flags().GetString("policy")

		ctx := context.Background()

		serverAddr, err := engine.StartEngine(ctx, engine.EngineConfig{
			WorldFile:  worldFile,
			PolicyFile: policyFile,
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
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
