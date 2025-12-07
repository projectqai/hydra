package engine

import (
	"context"
	"log/slog"
	"time"

	pb "github.com/projectqai/proto/go"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *WorldServer) GetTimeline(ctx context.Context, req *connect.Request[pb.GetTimelineRequest], stream *connect.ServerStream[pb.GetTimelineResponse]) error {
	this := &observer{trace: "timeline"}
	s.bus.observe(this)
	defer s.bus.unobserve(this)

	min, max := s.store.GetTimeline()
	frozen := s.frozen.Load()
	frozenAt := s.frozenAt

	stream.Send(&pb.GetTimelineResponse{
		Min:    timestamppb.New(min),
		Max:    timestamppb.New(max),
		Frozen: frozen,
		At:     timestamppb.New(frozenAt),
	})

	ticker := time.NewTicker(900 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
		case ev, ok := <-this.C:
			if !ok {
				return nil
			}
			if !ev.timeline {
				continue
			}
		case <-ctx.Done():
			return nil
		}

		min2, max2 := s.store.GetTimeline()
		frozen2 := s.frozen.Load()
		frozenAt2 := s.frozenAt
		if min2 != min || max2 != max || frozen != frozen2 || !frozenAt.Equal(frozenAt2) {
			min = min2
			max = max2
			frozenAt = frozenAt2
			frozen = frozen2

			stream.Send(&pb.GetTimelineResponse{
				Min:    timestamppb.New(min),
				Max:    timestamppb.New(max),
				Frozen: s.frozen.Load(),
				At:     timestamppb.New(frozenAt),
			})
		}
	}
}

func (s *WorldServer) MoveTimeline(ctx context.Context, req *connect.Request[pb.MoveTimelineRequest]) (*connect.Response[pb.MoveTimelineResponse], error) {
	min, max := s.store.GetTimeline()
	slog.Info("TIMEWARP", "freeze", req.Msg.Freeze, "at", req.Msg.At.AsTime(), "min", min, "max", max)

	s.frozen.Store(req.Msg.Freeze)
	s.frozenAt = req.Msg.At.AsTime()

	s.gc()

	// Collect events that match the timeline criteria
	entities := s.store.GetEventsInTimeRange(req.Msg.At.AsTime())

	s.l.Lock()
	s.head = make(map[string]*pb.Entity)
	for _, ev := range entities {
		s.head[ev.Id] = ev
	}
	s.l.Unlock()

	for _, e := range entities {
		s.bus.publish(busevent{
			timeline: true,
			entity: &pb.EntityChangeEvent{
				T:      pb.EntityChange_Updated,
				Entity: e,
			},
			trace: "timeline move with events",
		})
	}

	return connect.NewResponse(&pb.MoveTimelineResponse{}), nil
}
