package engine

import (
	"context"
	"sync"
	"time"

	"github.com/projectqai/hydra/policy"
	pb "github.com/projectqai/proto/go"
)

type Consumer struct {
	world   *WorldServer
	ability *policy.Ability
	limiter *pb.WatchLimiter
	filter  *pb.EntityFilter

	mu    sync.Mutex
	dirty [4]map[string]pb.EntityChange // [priority]map[entityID]EntityChange

	signal      chan struct{}
	rateLimiter *time.Ticker
}

func NewConsumer(world *WorldServer, ability *policy.Ability, limiter *pb.WatchLimiter, filter *pb.EntityFilter) *Consumer {
	c := &Consumer{
		world:   world,
		ability: ability,
		limiter: limiter,
		filter:  filter,
		signal:  make(chan struct{}, 1),
	}

	for i := range c.dirty {
		c.dirty[i] = make(map[string]pb.EntityChange)
	}

	if limiter != nil && limiter.MaxMessagesPerSecond != nil && *limiter.MaxMessagesPerSecond > 0 {
		interval := time.Second / time.Duration(*limiter.MaxMessagesPerSecond)
		c.rateLimiter = time.NewTicker(interval)
	}

	return c
}

func (c *Consumer) minPriority() pb.Priority {
	if c.limiter != nil && c.limiter.MinPriority != nil {
		return *c.limiter.MinPriority
	}
	return pb.Priority_PriorityRoutine
}

func (c *Consumer) markDirty(entityID string, priority pb.Priority, change pb.EntityChange) {
	if priority < c.minPriority() {
		return
	}

	c.mu.Lock()

	// just in case priority has changed, reseat it
	for p := range c.dirty {
		delete(c.dirty[p], entityID)
	}
	c.dirty[priority][entityID] = change

	c.mu.Unlock()

	select {
	case c.signal <- struct{}{}:
	default:
	}
}

func (c *Consumer) popNext() (entityID string, change pb.EntityChange, priority pb.Priority, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	minPri := c.minPriority()

	// Drain in priority order: Flash(3) -> Immediate(2) -> Routine(1) -> Unspecified(0)
	for p := pb.Priority_PriorityFlash; p >= pb.Priority_PriorityUnspecified; p-- {
		if p < minPri {
			continue
		}
		for id, ch := range c.dirty[p] {
			delete(c.dirty[p], id)
			return id, ch, p, true
		}
	}
	return "", 0, 0, false
}

func (c *Consumer) SenderLoop(ctx context.Context, send func(*pb.EntityChangeEvent) error) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		entityID, change, priority, ok := c.popNext()
		if !ok {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-c.signal:
				continue
			}
		}

		entity := c.world.GetHead(entityID)

		// Check read policy
		if entity != nil && c.ability != nil && !c.ability.CanRead(ctx, entity) {
			continue
		}

		if priority == pb.Priority_PriorityFlash {
			if entity != nil || change == pb.EntityChange_EntityChangeExpired {
				if err := send(&pb.EntityChangeEvent{Entity: entity, T: change}); err != nil {
					return err
				}
			}
			continue
		}

		if entity == nil || isExpired(entity) {
			change = pb.EntityChange_EntityChangeExpired
		}

		if entity != nil && c.filter != nil && !c.world.matchesEntityFilter(entity, c.filter) {
			continue
		}

		if c.rateLimiter != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-c.rateLimiter.C:
			}
		}

		if err := send(&pb.EntityChangeEvent{Entity: entity, T: change}); err != nil {
			return err
		}
	}
}

func isExpired(entity *pb.Entity) bool {
	if entity.Lifetime == nil || entity.Lifetime.Until == nil {
		return false
	}
	if !entity.Lifetime.Until.IsValid() {
		return false
	}
	return time.Now().After(entity.Lifetime.Until.AsTime())
}
