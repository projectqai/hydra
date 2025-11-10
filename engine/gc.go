package engine

import (
	"time"

	proto "github.com/projectqai/proto/go"
)

func (s *WorldServer) gc() {
	now := time.Now()
	if s.frozen.Load() {
		now = s.frozenAt
	}

	s.l.Lock()
	for k, v := range s.head {
		if v.Lifetime != nil {
			if v.Lifetime.Until.IsValid() && now.After(v.Lifetime.Until.AsTime()) {
				delete(s.head, k)
				s.bus.Dirty(k, v, proto.EntityChange_EntityChangeExpired)
			}
		}
	}
	s.l.Unlock()
}
