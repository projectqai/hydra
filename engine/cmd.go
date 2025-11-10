package engine

import (
	"github.com/projectqai/hydra/cmd"
	"github.com/spf13/cobra"
)

var CMD = &cobra.Command{
	Use:   "node",
	RunE:  RunEngine,
	Short: "run a hydra node",
}

func init() {
	cmd.CMD.AddCommand(CMD)
}
