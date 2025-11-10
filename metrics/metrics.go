package metrics

import (
	"context"
	"runtime"
	"sync/atomic"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
)

var (
	entityCount atomic.Int64
	meter       metric.Meter

	// Application metrics
	entityCountGauge metric.Int64ObservableGauge

	// Go runtime metrics
	goroutinesGauge     metric.Int64ObservableGauge
	memAllocGauge       metric.Int64ObservableGauge
	memTotalAllocGauge  metric.Int64ObservableGauge
	memSysGauge         metric.Int64ObservableGauge
	memHeapAllocGauge   metric.Int64ObservableGauge
	memHeapSysGauge     metric.Int64ObservableGauge
	memHeapObjectsGauge metric.Int64ObservableGauge
	gcNumGauge          metric.Int64ObservableGauge
	gcPauseTotalGauge   metric.Int64ObservableGauge
	numCPUGauge         metric.Int64ObservableGauge
)

func Init() error {
	meter = otel.Meter("hydra.metrics")

	// Application metrics
	var err error
	entityCountGauge, err = meter.Int64ObservableGauge(
		"hydra.entities.count",
		metric.WithDescription("Number of currently held entities"),
		metric.WithUnit("{entities}"),
	)
	if err != nil {
		return err
	}

	// Go runtime metrics
	goroutinesGauge, err = meter.Int64ObservableGauge(
		"go.goroutines",
		metric.WithDescription("Number of goroutines"),
		metric.WithUnit("{goroutines}"),
	)
	if err != nil {
		return err
	}

	memAllocGauge, err = meter.Int64ObservableGauge(
		"go.memory.allocated",
		metric.WithDescription("Bytes of allocated heap objects"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return err
	}

	memTotalAllocGauge, err = meter.Int64ObservableGauge(
		"go.memory.total_allocated",
		metric.WithDescription("Cumulative bytes allocated for heap objects"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return err
	}

	memSysGauge, err = meter.Int64ObservableGauge(
		"go.memory.sys",
		metric.WithDescription("Total bytes of memory obtained from the OS"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return err
	}

	memHeapAllocGauge, err = meter.Int64ObservableGauge(
		"go.memory.heap.allocated",
		metric.WithDescription("Bytes of allocated heap objects"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return err
	}

	memHeapSysGauge, err = meter.Int64ObservableGauge(
		"go.memory.heap.sys",
		metric.WithDescription("Bytes of heap memory obtained from the OS"),
		metric.WithUnit("By"),
	)
	if err != nil {
		return err
	}

	memHeapObjectsGauge, err = meter.Int64ObservableGauge(
		"go.memory.heap.objects",
		metric.WithDescription("Number of allocated heap objects"),
		metric.WithUnit("{objects}"),
	)
	if err != nil {
		return err
	}

	gcNumGauge, err = meter.Int64ObservableGauge(
		"go.gc.count",
		metric.WithDescription("Number of completed GC cycles"),
		metric.WithUnit("{cycles}"),
	)
	if err != nil {
		return err
	}

	gcPauseTotalGauge, err = meter.Int64ObservableGauge(
		"go.gc.pause_total_ns",
		metric.WithDescription("Cumulative nanoseconds in GC stop-the-world pauses"),
		metric.WithUnit("ns"),
	)
	if err != nil {
		return err
	}

	numCPUGauge, err = meter.Int64ObservableGauge(
		"go.cpu.count",
		metric.WithDescription("Number of logical CPUs"),
		metric.WithUnit("{cpus}"),
	)
	if err != nil {
		return err
	}

	// Register callback for all metrics
	_, err = meter.RegisterCallback(
		func(ctx context.Context, o metric.Observer) error {
			// Application metrics
			count := GetEntityCount()
			o.ObserveInt64(entityCountGauge, int64(count))

			// Runtime metrics
			var m runtime.MemStats
			runtime.ReadMemStats(&m)

			o.ObserveInt64(goroutinesGauge, int64(runtime.NumGoroutine()))
			o.ObserveInt64(memAllocGauge, int64(m.Alloc))
			o.ObserveInt64(memTotalAllocGauge, int64(m.TotalAlloc))
			o.ObserveInt64(memSysGauge, int64(m.Sys))
			o.ObserveInt64(memHeapAllocGauge, int64(m.HeapAlloc))
			o.ObserveInt64(memHeapSysGauge, int64(m.HeapSys))
			o.ObserveInt64(memHeapObjectsGauge, int64(m.HeapObjects))
			o.ObserveInt64(gcNumGauge, int64(m.NumGC))
			o.ObserveInt64(gcPauseTotalGauge, int64(m.PauseTotalNs))
			o.ObserveInt64(numCPUGauge, int64(runtime.NumCPU()))

			return nil
		},
		entityCountGauge,
		goroutinesGauge,
		memAllocGauge,
		memTotalAllocGauge,
		memSysGauge,
		memHeapAllocGauge,
		memHeapSysGauge,
		memHeapObjectsGauge,
		gcNumGauge,
		gcPauseTotalGauge,
		numCPUGauge,
	)

	return err
}

func SetEntityCount(count int) {
	entityCount.Store(int64(count))
}

func GetEntityCount() int {
	return int(entityCount.Load())
}
