package builtin

import (
	"github.com/projectqai/hydra/cmd"
	"github.com/spf13/cobra"
)

var (
	key       string
	ServerURL string
)

var CMD = &cobra.Command{
	Use:     "builtins",
	Aliases: []string{"b"},
}

func init() {
	CMD.PersistentFlags().StringVarP(&ServerURL, "server", "s", "localhost:50051", "world server url")
	cmd.CMD.AddCommand(CMD)
}
