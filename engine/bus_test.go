// this is llm slop, dont bother reading it

package engine

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func ptr[T any](v T) *T { return &v }

// testWorld creates a WorldServer with the given entities for testing
func testWorld(entities map[string]*pb.Entity) *WorldServer {
	w := &WorldServer{
		bus:   NewBus(),
		head:  make(map[string]*pb.Entity),
		store: NewStore(),
	}
	for id, e := range entities {
		w.head[id] = e
	}
	return w
}

func TestConsumer_DirtyAndPop(t *testing.T) {
	c := NewConsumer(nil, nil, nil, nil)

	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e2", pb.Priority_PriorityImmediate, pb.EntityChange_EntityChangeUpdated)

	// Should pop High first
	id, change, priority, ok := c.popNext()
	if !ok || id != "e2" || priority != pb.Priority_PriorityImmediate {
		t.Errorf("expected e2/High, got %s/%v", id, priority)
	}
	if change != pb.EntityChange_EntityChangeUpdated {
		t.Errorf("expected Updated, got %v", change)
	}

	// Then Low
	id, _, priority, ok = c.popNext()
	if !ok || id != "e1" || priority != pb.Priority_PriorityRoutine {
		t.Errorf("expected e1/Low, got %s/%v", id, priority)
	}

	// Empty
	_, _, _, ok = c.popNext()
	if ok {
		t.Error("expected empty")
	}
}

func TestConsumer_PriorityOrder(t *testing.T) {
	c := NewConsumer(nil, nil, nil, nil)

	c.markDirty("low", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("high", pb.Priority_PriorityImmediate, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("burst", pb.Priority_PriorityFlash, pb.EntityChange_EntityChangeUpdated)

	// Should come out Burst, High, Low
	expected := []string{"burst", "high", "low"}
	for _, exp := range expected {
		id, _, _, ok := c.popNext()
		if !ok || id != exp {
			t.Errorf("expected %s, got %s", exp, id)
		}
	}
}

func TestConsumer_MinPriorityFilter(t *testing.T) {
	limiter := &pb.WatchLimiter{
		MinPriority: ptr(pb.Priority_PriorityImmediate),
	}
	c := NewConsumer(nil, nil, limiter, nil)

	c.markDirty("low", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("high", pb.Priority_PriorityImmediate, pb.EntityChange_EntityChangeUpdated)

	// Low should be filtered out
	id, _, _, ok := c.popNext()
	if !ok || id != "high" {
		t.Errorf("expected high, got %s", id)
	}

	_, _, _, ok = c.popNext()
	if ok {
		t.Error("expected empty, low should have been filtered")
	}
}

func TestConsumer_Coalescing(t *testing.T) {
	c := NewConsumer(nil, nil, nil, nil)

	// Multiple updates to same entity
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	// Should only pop once
	_, _, _, ok := c.popNext()
	if !ok {
		t.Error("expected one entry")
	}

	_, _, _, ok = c.popNext()
	if ok {
		t.Error("expected empty after coalescing")
	}
}

func TestConsumer_PriorityChange(t *testing.T) {
	c := NewConsumer(nil, nil, nil, nil)

	// Entity starts low, then becomes high priority
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e1", pb.Priority_PriorityImmediate, pb.EntityChange_EntityChangeUpdated)

	// Should only be in high, not low
	id, _, priority, ok := c.popNext()
	if !ok || id != "e1" || priority != pb.Priority_PriorityImmediate {
		t.Errorf("expected e1/High, got %s/%v", id, priority)
	}

	_, _, _, ok = c.popNext()
	if ok {
		t.Error("expected empty, entity should have moved from low to high")
	}
}

func TestConsumer_Signal(t *testing.T) {
	c := NewConsumer(nil, nil, nil, nil)

	// Signal channel should be non-blocking
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	select {
	case <-c.signal:
		// Good
	default:
		t.Error("signal should have fired")
	}

	// Second markDirty shouldn't block even if signal not consumed
	c.markDirty("e2", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
}

func TestBus_Dirty(t *testing.T) {
	bus := NewBus()

	c1 := NewConsumer(nil, nil, nil, nil)
	c2 := NewConsumer(nil, nil, nil, nil)

	bus.Register(c1)
	bus.Register(c2)

	entity := &pb.Entity{Id: "e1", Priority: ptr(pb.Priority_PriorityImmediate)}
	bus.Dirty("e1", entity, pb.EntityChange_EntityChangeUpdated)

	// Both consumers should have the entity dirty
	id1, _, _, ok1 := c1.popNext()
	id2, _, _, ok2 := c2.popNext()

	if !ok1 || id1 != "e1" {
		t.Error("c1 should have e1")
	}
	if !ok2 || id2 != "e1" {
		t.Error("c2 should have e1")
	}
}

func TestBus_Unregister(t *testing.T) {
	bus := NewBus()

	c := NewConsumer(nil, nil, nil, nil)
	bus.Register(c)

	if len(bus.consumers) != 1 {
		t.Error("expected 1 consumer")
	}

	bus.Unregister(c)

	if len(bus.consumers) != 0 {
		t.Error("expected 0 consumers")
	}
}

func TestSenderLoop_Basic(t *testing.T) {
	entities := map[string]*pb.Entity{
		"e1": {Id: "e1"},
		"e2": {Id: "e2"},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, nil, nil)

	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e2", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	go c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	time.Sleep(50 * time.Millisecond)

	if len(sent) != 2 {
		t.Errorf("expected 2 sent, got %d", len(sent))
	}
}

func TestSenderLoop_Expiry(t *testing.T) {
	// Entity that's already expired
	expired := &pb.Entity{
		Id: "e1",
		Lifetime: &pb.Lifetime{
			Until: timestamppb.New(time.Now().Add(-time.Hour)),
		},
	}

	world := testWorld(map[string]*pb.Entity{"e1": expired})
	c := NewConsumer(world, nil, nil, nil)

	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	go c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	time.Sleep(50 * time.Millisecond)

	if len(sent) != 1 {
		t.Fatalf("expected 1 sent, got %d", len(sent))
	}
	if sent[0].T != pb.EntityChange_EntityChangeExpired {
		t.Errorf("expected Expired, got %v", sent[0].T)
	}
}

func TestSenderLoop_EntityGone(t *testing.T) {
	world := testWorld(map[string]*pb.Entity{}) // empty - entity is gone
	c := NewConsumer(world, nil, nil, nil)

	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	go c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	time.Sleep(50 * time.Millisecond)

	if len(sent) != 1 {
		t.Fatalf("expected 1 sent, got %d", len(sent))
	}
	if sent[0].T != pb.EntityChange_EntityChangeExpired {
		t.Errorf("expected Expired for gone entity, got %v", sent[0].T)
	}
}

func TestSenderLoop_BurstBypassesRateLimit(t *testing.T) {
	limiter := &pb.WatchLimiter{
		MaxMessagesPerSecond: ptr(uint64(1)), // 1 msg/sec = very slow
	}

	entities := map[string]*pb.Entity{
		"burst": {Id: "burst", Priority: ptr(pb.Priority_PriorityFlash)},
		"low":   {Id: "low", Priority: ptr(pb.Priority_PriorityRoutine)},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, limiter, nil)

	c.markDirty("burst", pb.Priority_PriorityFlash, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("low", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	go c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	time.Sleep(50 * time.Millisecond)

	// Burst should be sent immediately, Low should be waiting on rate limit
	if len(sent) != 1 {
		t.Errorf("expected 1 sent (burst only), got %d", len(sent))
	}
	if sent[0].Entity.Id != "burst" {
		t.Errorf("expected burst, got %s", sent[0].Entity.Id)
	}
}

func TestSenderLoop_Filter(t *testing.T) {
	filter := &pb.EntityFilter{Id: proto.String("e1")}

	entities := map[string]*pb.Entity{
		"e1": {Id: "e1"},
		"e2": {Id: "e2"},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, nil, filter)

	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e2", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	go c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	time.Sleep(50 * time.Millisecond)

	if len(sent) != 1 {
		t.Fatalf("expected 1 sent (filtered), got %d", len(sent))
	}
	if sent[0].Entity.Id != "e1" {
		t.Errorf("expected e1, got %s", sent[0].Entity.Id)
	}
}

func TestSenderLoop_SlowConsumerCoalesces(t *testing.T) {
	// Consumer limited to 10 msg/sec
	limiter := &pb.WatchLimiter{
		MaxMessagesPerSecond: ptr(uint64(10)),
	}

	entities := map[string]*pb.Entity{
		"e1": {Id: "e1"},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, limiter, nil)

	// Producer sends 100 updates to same entity rapidly
	for i := 0; i < 100; i++ {
		c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	// Should only send a few times due to coalescing, not 100
	if len(sent) > 5 {
		t.Errorf("expected coalescing to reduce sends, got %d", len(sent))
	}
	if len(sent) < 1 {
		t.Error("expected at least 1 send")
	}
}

func TestSenderLoop_SlowConsumerMultipleEntities(t *testing.T) {
	// Consumer limited to 5 msg/sec = 200ms between sends
	limiter := &pb.WatchLimiter{
		MaxMessagesPerSecond: ptr(uint64(5)),
	}

	entities := map[string]*pb.Entity{
		"e1": {Id: "e1"},
		"e2": {Id: "e2"},
		"e3": {Id: "e3"},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, limiter, nil)

	// Mark all dirty
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e2", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e3", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	// At 5 msg/sec over 500ms, should get about 2-3 messages
	if len(sent) > 4 {
		t.Errorf("rate limit not working, got %d sends in 500ms at 5/sec", len(sent))
	}
	if len(sent) < 1 {
		t.Error("expected at least 1 send")
	}
}

func TestBus_DirtyNeverBlocks(t *testing.T) {
	bus := NewBus()

	// Create consumer with very slow rate limit
	limiter := &pb.WatchLimiter{
		MaxMessagesPerSecond: ptr(uint64(1)),
	}
	c := NewConsumer(nil, nil, limiter, nil)
	bus.Register(c)

	entity := &pb.Entity{Id: "e1", Priority: ptr(pb.Priority_PriorityRoutine)}

	// Rapidly mark dirty many times - should never block
	start := time.Now()
	for i := 0; i < 10000; i++ {
		bus.Dirty("e1", entity, pb.EntityChange_EntityChangeUpdated)
	}
	elapsed := time.Since(start)

	// 10000 Dirty calls should complete in under 100ms (no blocking)
	if elapsed > 100*time.Millisecond {
		t.Errorf("Dirty blocked, took %v for 10000 calls", elapsed)
	}
}

func TestBus_ProducerFasterThanConsumer(t *testing.T) {
	// Slow consumer: 10 msg/sec
	limiter := &pb.WatchLimiter{
		MaxMessagesPerSecond: ptr(uint64(10)),
	}

	entities := map[string]*pb.Entity{}
	world := testWorld(entities)
	c := NewConsumer(world, nil, limiter, nil)

	bus := NewBus()
	bus.Register(c)

	// Start consumer
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	var mu sync.Mutex

	go c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		mu.Lock()
		sent = append(sent, ev)
		mu.Unlock()
		return nil
	})

	// Producer rapidly creates 100 entities
	for i := 0; i < 100; i++ {
		id := fmt.Sprintf("e%d", i)
		entity := &pb.Entity{Id: id, Priority: ptr(pb.Priority_PriorityRoutine)}
		world.l.Lock()
		world.head[id] = entity
		world.l.Unlock()
		bus.Dirty(id, entity, pb.EntityChange_EntityChangeUpdated)
	}

	<-ctx.Done()

	mu.Lock()
	numSent := len(sent)
	mu.Unlock()

	// At 10 msg/sec over 300ms, consumer should have sent about 2-4 messages
	t.Logf("sent %d of 100 entities in 300ms at 10/sec limit", numSent)
	if numSent > 10 {
		t.Errorf("rate limit not working, sent %d in 300ms at 10/sec", numSent)
	}
}

func TestConsumer_BurstPriorityUnderLoad(t *testing.T) {
	// Slow consumer
	limiter := &pb.WatchLimiter{
		MaxMessagesPerSecond: ptr(uint64(5)),
	}

	entities := map[string]*pb.Entity{
		"burst": {Id: "burst", Priority: ptr(pb.Priority_PriorityFlash)},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, limiter, nil)

	// Add many low priority items
	for i := 0; i < 100; i++ {
		id := fmt.Sprintf("low%d", i)
		world.l.Lock()
		world.head[id] = &pb.Entity{Id: id, Priority: ptr(pb.Priority_PriorityRoutine)}
		world.l.Unlock()
		c.markDirty(id, pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	}

	// Add burst priority
	c.markDirty("burst", pb.Priority_PriorityFlash, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	go c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	time.Sleep(50 * time.Millisecond)

	// Burst should be first
	if len(sent) < 1 {
		t.Fatal("expected at least 1 send")
	}
	if sent[0].Entity.Id != "burst" {
		t.Errorf("expected burst to be first, got %s", sent[0].Entity.Id)
	}
}

func TestBus_DirtyNilEntity(t *testing.T) {
	bus := NewBus()
	c := NewConsumer(nil, nil, nil, nil)
	bus.Register(c)

	// Dirty with nil entity should use default priority
	bus.Dirty("e1", nil, pb.EntityChange_EntityChangeExpired)

	id, change, priority, ok := c.popNext()
	if !ok {
		t.Fatal("expected dirty entry")
	}
	if id != "e1" {
		t.Errorf("expected e1, got %s", id)
	}
	if priority != pb.Priority_PriorityRoutine {
		t.Errorf("expected PriorityLow for nil entity, got %v", priority)
	}
	if change != pb.EntityChange_EntityChangeExpired {
		t.Errorf("expected Expired, got %v", change)
	}
}

func TestConsumer_PriorityReserved0(t *testing.T) {
	c := NewConsumer(nil, nil, nil, nil)

	// PriorityReserved0 is 0, should be treated as valid (though unusual)
	c.markDirty("e1", pb.Priority_PriorityUnspecified, pb.EntityChange_EntityChangeUpdated)

	// MinPriority defaults to PriorityLow (1), so Reserved0 (0) should be filtered
	_, _, _, ok := c.popNext()
	if ok {
		t.Error("PriorityReserved0 should be filtered out by default minPriority")
	}
}

func TestConsumer_MinPriorityAllowsReserved0(t *testing.T) {
	limiter := &pb.WatchLimiter{
		MinPriority: ptr(pb.Priority_PriorityUnspecified),
	}
	c := NewConsumer(nil, nil, limiter, nil)

	c.markDirty("e1", pb.Priority_PriorityUnspecified, pb.EntityChange_EntityChangeUpdated)

	id, _, _, ok := c.popNext()
	if !ok || id != "e1" {
		t.Error("PriorityReserved0 should be allowed when minPriority is Reserved0")
	}
}

func TestSenderLoop_ContextAlreadyCancelled(t *testing.T) {
	world := testWorld(map[string]*pb.Entity{"e1": {Id: "e1"}})
	c := NewConsumer(world, nil, nil, nil)
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	var sent []*pb.EntityChangeEvent
	err := c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
	if len(sent) != 0 {
		t.Errorf("expected no sends with cancelled context, got %d", len(sent))
	}
}

func TestSenderLoop_ContextCancelledDuringRateLimit(t *testing.T) {
	limiter := &pb.WatchLimiter{
		MaxMessagesPerSecond: ptr(uint64(1)), // Very slow
	}

	entities := map[string]*pb.Entity{
		"e1": {Id: "e1"},
		"e2": {Id: "e2"},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, limiter, nil)

	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e2", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithCancel(context.Background())

	var sent []*pb.EntityChangeEvent
	done := make(chan error)
	go func() {
		done <- c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
			sent = append(sent, ev)
			return nil
		})
	}()

	// Wait for first send, then cancel
	time.Sleep(50 * time.Millisecond)
	cancel()

	err := <-done
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestBus_ConcurrentDirty(t *testing.T) {
	bus := NewBus()
	c := NewConsumer(nil, nil, nil, nil)
	bus.Register(c)

	// Concurrent Dirty from multiple goroutines
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := "e" + string(rune('a'+i%26))
			entity := &pb.Entity{Id: id, Priority: ptr(pb.Priority_PriorityRoutine)}
			for j := 0; j < 100; j++ {
				bus.Dirty(id, entity, pb.EntityChange_EntityChangeUpdated)
			}
		}(i)
	}
	wg.Wait()

	// Should not have panicked, and should have some dirty entries
	count := 0
	for {
		_, _, _, ok := c.popNext()
		if !ok {
			break
		}
		count++
	}

	// 26 unique entity IDs (a-z)
	if count > 26 {
		t.Errorf("expected at most 26 unique entities, got %d", count)
	}
	if count == 0 {
		t.Error("expected some dirty entities")
	}
}

func TestSenderLoop_AllEntitiesFiltered(t *testing.T) {
	filter := &pb.EntityFilter{Id: proto.String("nonexistent")}

	entities := map[string]*pb.Entity{
		"e1": {Id: "e1"},
		"e2": {Id: "e2"},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, nil, filter)

	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
	c.markDirty("e2", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		sent = append(sent, ev)
		return nil
	})

	// All filtered, nothing sent
	if len(sent) != 0 {
		t.Errorf("expected 0 sends (all filtered), got %d", len(sent))
	}
}

func TestSenderLoop_EntityReMarkedDuringLoop(t *testing.T) {
	entities := map[string]*pb.Entity{
		"e1": {Id: "e1", Label: ptr("v0")},
	}
	world := testWorld(entities)
	c := NewConsumer(world, nil, nil, nil)

	version := 0
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	var sent []*pb.EntityChangeEvent
	var mu sync.Mutex

	done := make(chan struct{})
	go func() {
		c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
			mu.Lock()
			sent = append(sent, ev)
			mu.Unlock()

			// Re-mark dirty after first send
			if version == 0 {
				version++
				world.l.Lock()
				world.head["e1"] = &pb.Entity{Id: "e1", Label: ptr("v1")}
				world.l.Unlock()
				c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)
			}
			return nil
		})
		close(done)
	}()

	// Wait for sender loop to finish
	<-done

	mu.Lock()
	numSent := len(sent)
	mu.Unlock()

	// Should have sent at least twice (initial + re-marked)
	if numSent < 2 {
		t.Errorf("expected at least 2 sends, got %d", numSent)
	}
}

func TestBus_UnregisterDuringSenderLoop(t *testing.T) {
	entities := map[string]*pb.Entity{
		"e1": {Id: "e1"},
	}
	world := testWorld(entities)

	bus := NewBus()
	c := NewConsumer(world, nil, nil, nil)
	bus.Register(c)

	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	done := make(chan error)
	go func() {
		done <- c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error { return nil })
	}()

	// Unregister while loop is running
	time.Sleep(10 * time.Millisecond)
	bus.Unregister(c)

	// Should complete without panic
	<-done
}

func TestConsumer_RateLimiterZero(t *testing.T) {
	// MaxMessagesPerSecond = 0 should mean unlimited
	limiter := &pb.WatchLimiter{
		MaxMessagesPerSecond: ptr(uint64(0)),
	}
	c := NewConsumer(nil, nil, limiter, nil)

	if c.rateLimiter != nil {
		t.Error("rateLimiter should be nil when max=0")
	}
}

func TestSenderLoop_SendError(t *testing.T) {
	world := testWorld(map[string]*pb.Entity{"e1": {Id: "e1"}})
	c := NewConsumer(world, nil, nil, nil)
	c.markDirty("e1", pb.Priority_PriorityRoutine, pb.EntityChange_EntityChangeUpdated)

	ctx := context.Background()

	testErr := fmt.Errorf("send failed")
	err := c.SenderLoop(ctx, func(ev *pb.EntityChangeEvent) error {
		return testErr
	})

	if err != testErr {
		t.Errorf("expected send error to propagate, got %v", err)
	}
}

func TestIsExpired(t *testing.T) {
	tests := []struct {
		name     string
		entity   *pb.Entity
		expected bool
	}{
		{
			name:     "no lifetime",
			entity:   &pb.Entity{Id: "e1"},
			expected: false,
		},
		{
			name:     "no until",
			entity:   &pb.Entity{Id: "e1", Lifetime: &pb.Lifetime{}},
			expected: false,
		},
		{
			name: "future until",
			entity: &pb.Entity{
				Id:       "e1",
				Lifetime: &pb.Lifetime{Until: timestamppb.New(time.Now().Add(time.Hour))},
			},
			expected: false,
		},
		{
			name: "past until",
			entity: &pb.Entity{
				Id:       "e1",
				Lifetime: &pb.Lifetime{Until: timestamppb.New(time.Now().Add(-time.Hour))},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isExpired(tt.entity); got != tt.expected {
				t.Errorf("isExpired() = %v, want %v", got, tt.expected)
			}
		})
	}
}
