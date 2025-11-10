package engine

import (
	"sync"

	pb "github.com/projectqai/proto/go"
)

type Bus struct {
	mu        sync.RWMutex
	consumers map[*Consumer]struct{}
}

func NewBus() *Bus {
	return &Bus{
		consumers: make(map[*Consumer]struct{}),
	}
}

func (b *Bus) Register(c *Consumer) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.consumers[c] = struct{}{}
}

func (b *Bus) Unregister(c *Consumer) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.consumers, c)
}

func (b *Bus) Dirty(entityID string, entity *pb.Entity, change pb.EntityChange) {
	priority := pb.Priority_PriorityRoutine
	if entity != nil && entity.Priority != nil {
		priority = *entity.Priority
	}

	b.mu.RLock()
	defer b.mu.RUnlock()

	for c := range b.consumers {
		c.markDirty(entityID, priority, change)
	}
}
