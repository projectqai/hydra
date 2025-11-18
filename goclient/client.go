package goclient

import (
	"context"
	"io"
	"log/slog"
	"time"

	proto "github.com/projectqai/proto/go"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

var retryPolicy = `{
	"methodConfig": [{
		"name": [
			{"service": "world.WorldService", "method": "ListEntities"},
			{"service": "world.WorldService", "method": "Push"}
		],
		"waitForReady": true,
		"retryPolicy": {
			"MaxAttempts": 10,
			"InitialBackoff": ".1s",
			"MaxBackoff": "1s",
			"BackoffMultiplier": 2.0,
			"RetryableStatusCodes": ["UNAVAILABLE", "RESOURCE_EXHAUSTED", "ABORTED"]
		}
	}]
}`

func Connect(serverURL string) (*grpc.ClientConn, error) {
	conn, err := grpc.NewClient(
		serverURL,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		// grpc.WithDefaultServiceConfig(retryPolicy), // it's just not great
	)
	if err != nil {
		return nil, err
	}

	return conn, nil
}

func isRetryableStreamError(err error) bool {
	if err == nil || err == io.EOF {
		return false
	}

	st, ok := status.FromError(err)
	if !ok {
		return false
	}

	switch st.Code() {
	case codes.Unavailable, codes.ResourceExhausted, codes.Aborted, codes.Internal, codes.Unknown:
		return true
	default:
		return false
	}
}

type resilientWatchEntitiesStream struct {
	ctx     context.Context
	client  proto.WorldServiceClient
	request *proto.ListEntitiesRequest
	stream  proto.WorldService_WatchEntitiesClient
}

func WatchEntitiesWithRetry(ctx context.Context, client proto.WorldServiceClient, req *proto.ListEntitiesRequest) (proto.WorldService_WatchEntitiesClient, error) {
	stream, err := client.WatchEntities(ctx, req)
	if err != nil {
		return nil, err
	}

	return &resilientWatchEntitiesStream{
		ctx:     ctx,
		client:  client,
		request: req,
		stream:  stream,
	}, nil
}

func (r *resilientWatchEntitiesStream) Recv() (*proto.EntityChangeEvent, error) {
	for {
		slog.Debug("attempting to receive message from stream")
		msg, err := r.stream.Recv()
		if err == nil {
			slog.Debug("received message successfully")
			return msg, nil
		}

		slog.Debug("stream recv error", "error", err, "error_type", status.Code(err))

		if err == io.EOF {
			slog.Debug("received EOF, not retrying")
			return nil, err
		}

		if !isRetryableStreamError(err) {
			slog.Debug("error not retryable", "code", status.Code(err))
			return nil, err
		}

		if r.ctx.Err() != nil {
			slog.Debug("context cancelled", "error", r.ctx.Err())
			return nil, r.ctx.Err()
		}

		retryStartTime := time.Now()
		maxRetryDuration := 1 * time.Minute
		retryInterval := 1 * time.Second
		attemptCount := 0

		for {
			attemptCount++
			elapsed := time.Since(retryStartTime)

			if elapsed > maxRetryDuration {
				slog.Warn("connection to world failed", "error", err, "attempt", attemptCount)
				return nil, status.Errorf(codes.Unavailable, "failed to reconnect after %v", elapsed)
			}

			select {
			case <-time.After(retryInterval):
			case <-r.ctx.Done():
				slog.Debug("context cancelled during wait")
				return nil, r.ctx.Err()
			}

			stream, err := r.client.WatchEntities(r.ctx, r.request)
			if err != nil {
				slog.Warn("connection to world failed", "error", err, "attempt", attemptCount)
				continue
			}

			r.stream = stream
			slog.Info("stream reconnected", "attempts", attemptCount, "elapsed", time.Since(retryStartTime))
			break
		}
	}
}

func (r *resilientWatchEntitiesStream) Header() (metadata.MD, error) {
	return r.stream.Header()
}

func (r *resilientWatchEntitiesStream) Trailer() metadata.MD {
	return r.stream.Trailer()
}

func (r *resilientWatchEntitiesStream) CloseSend() error {
	return r.stream.CloseSend()
}

func (r *resilientWatchEntitiesStream) Context() context.Context {
	return r.ctx
}

func (r *resilientWatchEntitiesStream) SendMsg(m interface{}) error {
	return r.stream.SendMsg(m)
}

func (r *resilientWatchEntitiesStream) RecvMsg(m interface{}) error {
	return r.stream.RecvMsg(m)
}
