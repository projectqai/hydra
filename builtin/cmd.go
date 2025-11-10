package builtin

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

var ServerURL string = "localhost:50051"

// Builtin represents a builtin service that can be run
type Builtin struct {
	Name string
	Run  func(ctx context.Context, logger *slog.Logger, serverURL string) error
}

var (
	mu       sync.RWMutex
	builtins []Builtin
)

// Register registers a builtin service
func Register(name string, run func(ctx context.Context, logger *slog.Logger, serverURL string) error) {
	mu.Lock()
	defer mu.Unlock()
	builtins = append(builtins, Builtin{
		Name: name,
		Run:  run,
	})
	// slog.Info("Registered builtin", "module", "builtin", "name", name)
}

// GetAll returns all registered builtins
func GetAll() []Builtin {
	mu.RLock()
	defer mu.RUnlock()
	result := make([]Builtin, len(builtins))
	copy(result, builtins)
	return result
}

// StartAll starts all registered builtins with auto-restart on crash
func StartAll(ctx context.Context, serverURL string) {
	for _, b := range GetAll() {
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
