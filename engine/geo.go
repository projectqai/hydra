package engine

import (
	proto "github.com/projectqai/proto/go"
	"github.com/paulmach/orb/encoding/wkb"
)

func (s *worldServer) addObservedGeom(g *proto.Geometry) {
	gg, err := wkb.Unmarshal(g.Wkb)
	if err != nil {
		return
	}

	s.l.Lock()
	defer s.l.Unlock()
	s.observed[g] = gg
}

func (s *worldServer) removeObservedGeom(g *proto.Geometry) {
	s.l.Lock()
	defer s.l.Unlock()
	delete(s.observed, g)
}
