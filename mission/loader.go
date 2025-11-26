package mission

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

func LoadMission(path string) (*Mission, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading mission file: %w", err)
	}

	mission := &Mission{}
	ext := strings.ToLower(filepath.Ext(path))

	switch ext {
	case ".json":
		if err := json.Unmarshal(data, mission); err != nil {
			return nil, fmt.Errorf("parsing JSON mission file: %w", err)
		}
	case ".yaml", ".yml":
		if err := yaml.Unmarshal(data, mission); err != nil {
			return nil, fmt.Errorf("parsing YAML mission file: %w", err)
		}
	default:
		return nil, fmt.Errorf("unsupported file extension %s (must be .json, .yaml, or .yml)", ext)
	}

	return mission, nil
}

func (m *Mission) Validate() error {
	if len(m.Connectors) == 0 {
		return fmt.Errorf("no connectors defined in mission")
	}

	for id, connConfig := range m.Connectors {
		_, exists := BUILTINS[connConfig.Type]
		if !exists {
			return fmt.Errorf("unknown connector type %s for connector %s", connConfig.Type, id)
		}
	}

	return nil
}

func (m *Mission) Run(ctx context.Context) error {
	if len(m.Connectors) == 0 {
		slog.Warn("no connectors to run")
		return nil
	}

	// Instantiate and start all connectors
	for id, connConfig := range m.Connectors {
		factory, exists := BUILTINS[connConfig.Type]
		if !exists {
			return fmt.Errorf("unknown connector type %s for connector %s", connConfig.Type, id)
		}

		connector := factory(id, connConfig.Config)
		slog.Info("loaded connector", "id", id, "type", connConfig.Type)

		go runConnectorWithRestart(ctx, id, connector)
	}

	// Block until context is cancelled
	<-ctx.Done()
	return ctx.Err()
}

func runConnectorWithRestart(ctx context.Context, id string, connector Connector) {
	log := slog.Default().With("module", id)

	backoff := time.Second
	maxBackoff := time.Minute

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		log.Info("starting connector")
		err := connector.Run(ctx)

		if err != nil {
			if ctx.Err() != nil {
				// Context was cancelled, don't restart
				return
			}
			log.Error("connector exited with error, restarting", "error", err, "backoff", backoff)
		} else {
			log.Warn("connector exited unexpectedly, restarting", "backoff", backoff)
		}

		// Wait before restarting
		select {
		case <-time.After(backoff):
			// Exponential backoff
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		case <-ctx.Done():
			return
		}
	}
}
