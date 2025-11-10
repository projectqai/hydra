// this is just a stub for an actual event bus later

package engine

import (
	"log/slog"
	"sync"
	"time"

	pb "github.com/projectqai/proto/go"
)

// TODO refactor this into Store.Event once the observer is an entity
type busevent struct {
	trace    string
	entity   *pb.EntityChangeEvent
	observer bool
	timeline bool
}

type Bus struct {
	l         sync.RWMutex
	observers map[*observer]struct{}
}

func NewBus() *Bus {
	return &Bus{
		observers: make(map[*observer]struct{}),
	}
}

func (b *Bus) observe(o *observer) {
	b.l.Lock()
	defer b.l.Unlock()

	o.C = make(chan busevent, 10)
	b.observers[o] = struct{}{}
}

func (b *Bus) unobserve(o *observer) {
	b.l.Lock()
	defer b.l.Unlock()

	close(o.C)
	delete(b.observers, o)
}

func (b *Bus) publish(e busevent) {
	b.l.RLock()
	defer b.l.RUnlock()

	for o := range b.observers {
		select {
		case o.C <- e:
		case <-time.After(10 * time.Millisecond):
			slog.Warn("bus fanout dropped", "trace", o.trace)
		}
	}
}
