package policy

import (
	"context"
	"net"

	pb "github.com/projectqai/proto/go"
)

type Ability struct {
	engine   *Engine
	sourceIP string
	builtin  bool
}

// Creates an Ability bound to a remote identity, like source ip for now
func For(engine *Engine, remoteAddr string) *Ability {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	return &Ability{
		engine:   engine,
		sourceIP: host,
		builtin:  remoteAddr == "bufconn",
	}
}

func (a *Ability) CanRead(ctx context.Context, entity *pb.Entity) bool {
	return true
}

func (a *Ability) AuthorizeWrite(ctx context.Context, entity *pb.Entity) error {
	return nil
}

func (a *Ability) AuthorizeTimeline(ctx context.Context) error {
	return nil
}

func (a *Ability) can(ctx context.Context, action string, entity *pb.Entity) bool {
	return true
}
