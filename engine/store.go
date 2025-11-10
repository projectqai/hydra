package engine

import (
	"context"
	"sync"
	"time"

	pb "github.com/projectqai/proto/go"
)

type Event struct {
	Entity *pb.Entity
}

// remember to design this to sync over nats AND into kv
type Store struct {
	l sync.RWMutex

	min time.Time
	max time.Time

	// FIXME supposed to be stored in historic order, but its not. this needs a real datastructure
	events []Event
}

func NewStore() *Store {
	return &Store{}
}

func (s *Store) Push(ctx context.Context, e Event) error {
	s.l.Lock()
	defer s.l.Unlock()

	if e.Entity.Lifetime != nil && e.Entity.Lifetime.From.IsValid() {
		t := e.Entity.Lifetime.From.AsTime()
		if t.Before(s.min) {
			s.min = t
		}

		if s.min.IsZero() {
			s.min = t
		}
		if s.max.IsZero() {
			s.max = t
		}
	}

	if e.Entity.Lifetime != nil && e.Entity.Lifetime.Until.IsValid() {
		t := e.Entity.Lifetime.Until.AsTime()
		if s.max.IsZero() {
			s.max = t
		}
		if t.After(s.max) {
			s.max = t
		}
	}

	s.events = append(s.events, e)
	return nil
}

func (s *Store) GetTimeline() (time.Time, time.Time) {
	s.l.RLock()
	defer s.l.RUnlock()
	return s.min, s.max
}

func (s *Store) GetEventsInTimeRange(targetTime time.Time) []*pb.Entity {
	s.l.RLock()
	defer s.l.RUnlock()

	entityMap := make(map[string]*pb.Entity)

	for _, event := range s.events {
		entity := event.Entity
		if entity.Lifetime == nil {
			continue
		}

		fromTime := entity.Lifetime.From.AsTime()

		if fromTime.After(targetTime) {
			continue
		}

		if entity.Lifetime.Until != nil && entity.Lifetime.Until.IsValid() {
			untilTime := entity.Lifetime.Until.AsTime()
			if untilTime.Before(targetTime) {
				continue
			}
		}

		if existing, exists := entityMap[entity.Id]; !exists || fromTime.After(existing.Lifetime.From.AsTime()) {
			entityMap[entity.Id] = entity
		}
	}

	var result []*pb.Entity
	for _, entity := range entityMap {
		result = append(result, entity)
	}

	return result
}
