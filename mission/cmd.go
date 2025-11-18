package mission

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/projectqai/hydra/cmd"
	"github.com/projectqai/hydra/engine"
	"github.com/spf13/cobra"
)

var CMD = &cobra.Command{
	Use:   "mission [mission-file]",
	Short: "run a hydra node with a mission configuration",
	Args:  cobra.ExactArgs(1),
	RunE:  runMission,
}

func init() {
	cmd.CMD.AddCommand(CMD)
}

func runMission(cmd *cobra.Command, args []string) error {
	missionPath := args[0]

	slog.Info("loading mission", "path", missionPath)
	m, err := LoadMission(missionPath)
	if err != nil {
		return fmt.Errorf("failed to load mission: %w", err)
	}

	// Validate connectors before starting anything
	if err := m.Validate(); err != nil {
		return fmt.Errorf("mission validation failed: %w", err)
	}

	// Start mission connectors in background
	ctx := context.Background()
	go func() {
		if err := m.Run(ctx); err != nil {
			slog.Error("mission failed", "error", err)
		}
	}()

	// Run the engine
	return engine.RunEngine(cmd, args)
}
