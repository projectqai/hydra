package logging

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/lmittmann/tint"
)

type modulePrefixHandler struct {
	handler slog.Handler
	module  string
}

func (h *modulePrefixHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.handler.Enabled(ctx, level)
}

func (h *modulePrefixHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	module := h.module
	var otherAttrs []slog.Attr

	for _, attr := range attrs {
		if attr.Key == "module" {
			module = attr.Value.String()
		} else {
			otherAttrs = append(otherAttrs, attr)
		}
	}

	return &modulePrefixHandler{
		handler: h.handler.WithAttrs(otherAttrs),
		module:  module,
	}
}

func (h *modulePrefixHandler) WithGroup(name string) slog.Handler {
	return &modulePrefixHandler{
		handler: h.handler.WithGroup(name),
		module:  h.module,
	}
}

func (h *modulePrefixHandler) Handle(ctx context.Context, r slog.Record) error {
	if h.module != "" {
		newRecord := slog.NewRecord(r.Time, r.Level, "["+h.module+"] "+r.Message, r.PC)
		r.Attrs(func(a slog.Attr) bool {
			newRecord.AddAttrs(a)
			return true
		})
		return h.handler.Handle(ctx, newRecord)
	}

	return h.handler.Handle(ctx, r)
}

func init() {
	// Setup slog with colored output and module prefix
	// must be imported by main before any other package's init() because they import this package
	handler := &modulePrefixHandler{
		handler: tint.NewHandler(os.Stderr, &tint.Options{
			Level:      slog.LevelInfo,
			TimeFormat: time.Kitchen,
		}),
	}
	slog.SetDefault(slog.New(handler))
}
