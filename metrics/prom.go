package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel"
	promexporter "go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/sdk/metric"
)

var (
	promExporter  *promexporter.Exporter
	meterProvider *metric.MeterProvider
	registry      *prometheus.Registry
)

func InitPrometheus() (http.Handler, error) {
	registry = prometheus.NewRegistry()

	var err error
	promExporter, err = promexporter.New(
		promexporter.WithRegisterer(registry),
	)
	if err != nil {
		return nil, err
	}

	meterProvider = metric.NewMeterProvider(metric.WithReader(promExporter))
	otel.SetMeterProvider(meterProvider)

	return promhttp.HandlerFor(registry, promhttp.HandlerOpts{}), nil
}
