package cli

import (
	"fmt"

	"github.com/spf13/cobra"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	conn      *grpc.ClientConn
	serverURL string
)

func connect(cmd *cobra.Command, args []string) error {
	var err error
	conn, err = grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return fmt.Errorf("failed to connect to server: %w", err)
	}

	return nil
}
