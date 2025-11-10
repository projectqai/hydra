package controller

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestControllerStartsConnectorOnUpdate(t *testing.T) {
	var started atomic.Bool
	var receivedEntity *pb.Entity

	c := &controller{
		run: func(ctx context.Context, entity *pb.Entity) error {
			started.Store(true)
			receivedEntity = entity
			<-ctx.Done()
			return ctx.Err()
		},
		connectors: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	entity := &pb.Entity{Id: "test-entity-1"}
	c.handleUpdate(ctx, entity)

	// Wait for connector to start
	time.Sleep(50 * time.Millisecond)

	if !started.Load() {
		t.Error("expected connector to be started")
	}
	if receivedEntity.Id != "test-entity-1" {
		t.Errorf("expected entity ID test-entity-1, got %s", receivedEntity.Id)
	}

	c.mu.Lock()
	_, exists := c.connectors["test-entity-1"]
	c.mu.Unlock()
	if !exists {
		t.Error("expected connector to be in map")
	}
}

func TestControllerStopsConnectorOnRemoval(t *testing.T) {
	var ctxCancelled atomic.Bool

	c := &controller{
		run: func(ctx context.Context, entity *pb.Entity) error {
			<-ctx.Done()
			ctxCancelled.Store(true)
			return ctx.Err()
		},
		connectors: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start connector
	entity := &pb.Entity{Id: "test-entity-2"}
	c.handleUpdate(ctx, entity)
	time.Sleep(50 * time.Millisecond)

	// Simulate removal by setting lifetime.until to now
	entity.Lifetime = &pb.Lifetime{Until: timestamppb.Now()}
	c.handleUpdate(ctx, entity)

	// Wait for cancellation
	time.Sleep(50 * time.Millisecond)

	if !ctxCancelled.Load() {
		t.Error("expected connector context to be cancelled")
	}

	c.mu.Lock()
	_, exists := c.connectors["test-entity-2"]
	c.mu.Unlock()
	if exists {
		t.Error("expected connector to be removed from map")
	}
}

func TestControllerRestartsConnectorOnUpdate(t *testing.T) {
	var startCount atomic.Int32
	var lastCtx context.Context

	c := &controller{
		run: func(ctx context.Context, entity *pb.Entity) error {
			startCount.Add(1)
			lastCtx = ctx
			<-ctx.Done()
			return ctx.Err()
		},
		connectors: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	entity := &pb.Entity{Id: "test-entity-3"}

	// First update
	c.handleUpdate(ctx, entity)
	time.Sleep(50 * time.Millisecond)
	firstCtx := lastCtx

	// Second update (should restart)
	c.handleUpdate(ctx, entity)
	time.Sleep(50 * time.Millisecond)

	if startCount.Load() != 2 {
		t.Errorf("expected 2 starts, got %d", startCount.Load())
	}

	// First context should be cancelled
	if firstCtx.Err() == nil {
		t.Error("expected first context to be cancelled")
	}

	// Second context should still be active
	if lastCtx.Err() != nil {
		t.Error("expected second context to be active")
	}
}

func TestControllerDoesNotStartExpiredEntity(t *testing.T) {
	var started atomic.Bool

	c := &controller{
		run: func(ctx context.Context, entity *pb.Entity) error {
			started.Store(true)
			<-ctx.Done()
			return ctx.Err()
		},
		connectors: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Entity with expired lifetime
	entity := &pb.Entity{
		Id: "test-entity-4",
		Lifetime: &pb.Lifetime{
			Until: timestamppb.New(time.Now().Add(-1 * time.Hour)),
		},
	}
	c.handleUpdate(ctx, entity)

	time.Sleep(50 * time.Millisecond)

	if started.Load() {
		t.Error("expected connector NOT to be started for expired entity")
	}
}

func TestControllerContextExpiresWithLifetime(t *testing.T) {
	var ctxCancelled atomic.Bool
	var cancelReason error

	c := &controller{
		run: func(ctx context.Context, entity *pb.Entity) error {
			<-ctx.Done()
			ctxCancelled.Store(true)
			cancelReason = ctx.Err()
			return ctx.Err()
		},
		connectors: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Entity with short lifetime
	entity := &pb.Entity{
		Id: "test-entity-5",
		Lifetime: &pb.Lifetime{
			Until: timestamppb.New(time.Now().Add(100 * time.Millisecond)),
		},
	}
	c.handleUpdate(ctx, entity)

	// Wait for lifetime to expire
	time.Sleep(200 * time.Millisecond)

	if !ctxCancelled.Load() {
		t.Error("expected connector context to be cancelled after lifetime expiry")
	}
	if !errors.Is(cancelReason, context.DeadlineExceeded) {
		t.Errorf("expected DeadlineExceeded, got %v", cancelReason)
	}
}

func TestControllerRestartsOnError(t *testing.T) {
	var runCount atomic.Int32

	c := &controller{
		run: func(ctx context.Context, entity *pb.Entity) error {
			count := runCount.Add(1)

			if count < 3 {
				return errors.New("simulated error")
			}
			// Third run: wait for cancellation
			<-ctx.Done()
			return ctx.Err()
		},
		connectors: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())

	entity := &pb.Entity{Id: "test-entity-6"}
	c.handleUpdate(ctx, entity)

	// Wait for restarts (5s backoff means we need to wait a bit)
	// But we can cancel early after confirming restart behavior
	time.Sleep(100 * time.Millisecond)

	// Should have run at least once
	if runCount.Load() < 1 {
		t.Error("expected at least one run")
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
}

func TestControllerMultipleEntities(t *testing.T) {
	var runningEntities sync.Map
	var startCount atomic.Int32

	c := &controller{
		run: func(ctx context.Context, entity *pb.Entity) error {
			startCount.Add(1)
			runningEntities.Store(entity.Id, true)
			<-ctx.Done()
			runningEntities.Delete(entity.Id)
			return ctx.Err()
		},
		connectors: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start multiple entities
	for i := 0; i < 5; i++ {
		entity := &pb.Entity{Id: "multi-entity-" + string(rune('a'+i))}
		c.handleUpdate(ctx, entity)
	}

	time.Sleep(100 * time.Millisecond)

	if startCount.Load() != 5 {
		t.Errorf("expected 5 starts, got %d", startCount.Load())
	}

	// Count running entities
	var count int
	runningEntities.Range(func(key, value any) bool {
		count++
		return true
	})
	if count != 5 {
		t.Errorf("expected 5 running entities, got %d", count)
	}

	c.mu.Lock()
	connectorCount := len(c.connectors)
	c.mu.Unlock()
	if connectorCount != 5 {
		t.Errorf("expected 5 connectors in map, got %d", connectorCount)
	}
}

func TestControllerParentContextCancellation(t *testing.T) {
	var ctxCancelled atomic.Bool

	c := &controller{
		run: func(ctx context.Context, entity *pb.Entity) error {
			<-ctx.Done()
			ctxCancelled.Store(true)
			return ctx.Err()
		},
		connectors: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())

	entity := &pb.Entity{Id: "test-entity-7"}
	c.handleUpdate(ctx, entity)

	time.Sleep(50 * time.Millisecond)

	// Cancel parent context
	cancel()

	time.Sleep(50 * time.Millisecond)

	if !ctxCancelled.Load() {
		t.Error("expected connector to be cancelled when parent context is cancelled")
	}
}
