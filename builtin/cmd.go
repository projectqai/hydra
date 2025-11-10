package builtin

import (
	"context"
	"log/slog"
	"net"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

var ServerURL string = "localhost:50051"

const bufSize = 1024 * 1024

var (
	builtinListener *bufconn.Listener
	builtinOnce     sync.Once
)

func GetBuiltinListener() *bufconn.Listener {
	builtinOnce.Do(func() {
		builtinListener = bufconn.Listen(bufSize)
	})
	return builtinListener
}

func BuiltinDialer() grpc.DialOption {
	return grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
		return GetBuiltinListener().DialContext(ctx)
	})
}

func BuiltinClientConn() (*grpc.ClientConn, error) {
	return grpc.NewClient(
		"passthrough:///bufconn",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		BuiltinDialer(),
	)
}

type Builtin struct {
	Name string
	Run  func(ctx context.Context, logger *slog.Logger, serverURL string) error
}

var (
	mu       sync.RWMutex
	builtins []Builtin
)

func Register(name string, run func(ctx context.Context, logger *slog.Logger, serverURL string) error) {
	builtins = append(builtins, Builtin{
		Name: name,
		Run:  run,
	})
}

func StartAll(ctx context.Context, serverURL string) {
	for _, b := range builtins {
		builtin := b // capture loop variable
		go func() {
			// Create a logger with module prefix for this builtin
			logger := slog.Default().With("module", builtin.Name)

			for {
				select {
				case <-ctx.Done():
					logger.Info("Stopping (context cancelled)")
					return
				default:
				}

				err := builtin.Run(ctx, logger, serverURL)

				if ctx.Err() != nil {
					// Context cancelled, don't restart
					return
				}

				logger.Error("Crashed, restarting in 1 second", "error", err)

				select {
				case <-ctx.Done():
					return
				case <-time.After(1 * time.Second):
					// Continue to restart
				}
			}
		}()
	}
}
