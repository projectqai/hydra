package cli

import (
	"fmt"

	"github.com/projectqai/hydra/goclient"
	"github.com/spf13/cobra"
)

var (
	conn         *goclient.Connection
	serverURL    string
	wgConfigPath string
)

func AddConnectionFlags(cmd *cobra.Command) {
	cmd.PersistentFlags().StringVar(&serverURL, "server", "localhost:50051", "gRPC server address")
	cmd.PersistentFlags().StringVar(&wgConfigPath, "wireguard", "", "path to WireGuard config to each the server")
}

func connect(cmd *cobra.Command, args []string) error {
	var err error

	if wgConfigPath != "" {
		conn, err = goclient.ConnectWithWireGuard(serverURL, wgConfigPath)
	} else {
		conn, err = goclient.Connect(serverURL)
	}

	if err != nil {
		return fmt.Errorf("failed to connect to server: %w", err)
	}
	return nil
}

func disconnect() {
	if conn != nil {
		conn.Close()
		conn = nil
	}
}
