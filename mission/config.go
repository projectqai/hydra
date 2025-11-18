package mission

import (
	"context"
)

type MissionConnectConfig struct {
	Type   string         `json:"type"`
	Config map[string]any `json:"config"`
}

type Mission struct {
	Connectors map[string]MissionConnectConfig `json:"connectors"`
}

type Connector interface {
	Run(ctx context.Context) error
}

type ConnectorFactory func(id string, config map[string]any) Connector

var BUILTINS = map[string]ConnectorFactory{}

func RegisterConnector(id string, f ConnectorFactory) {
	BUILTINS[id] = f
}
