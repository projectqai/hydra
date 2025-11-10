package version

import (
	"fmt"

	"github.com/projectqai/hydra/cmd"
	"github.com/spf13/cobra"
)

var CMD = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println(Version)
	},
}

func init() {
	cmd.CMD.AddCommand(CMD)
}
