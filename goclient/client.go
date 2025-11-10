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

// Connection wraps a gRPC connection with optional WireGuard tunnel
type Connection struct {
	*grpc.ClientConn
	Tunnel *WireGuardTunnel // nil for non-WireGuard connections
}

// Close closes the connection and tunnel if present
func (c *Connection) Close() error {
	if c.ClientConn != nil {
		c.ClientConn.Close()
	}
	if c.Tunnel != nil {
		c.Tunnel.Close()
	}
	return nil
}

// Connect establishes a gRPC connection to the server
func Connect(serverURL string) (*Connection, error) {
	conn, err := grpc.NewClient(
		serverURL,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, err
	}
	return &Connection{ClientConn: conn}, nil
}

// ConnectWithWireGuard establishes a gRPC connection through a WireGuard tunnel
func ConnectWithWireGuard(serverAddr string, wgConfigPath string) (*Connection, error) {
	cfg, err := ParseWireGuardConfig(wgConfigPath)
	if err != nil {
		return nil, err
	}

	conn, tunnel, err := ConnectViaWireGuard(serverAddr, cfg)
	if err != nil {
		return nil, err
	}

	return &Connection{ClientConn: conn, Tunnel: tunnel}, nil
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
		retryInterval := 1 * time.Second
		maxRetryInterval := 30 * time.Second
		attemptCount := 0

		for {
			attemptCount++

			select {
			case <-time.After(retryInterval):
			case <-r.ctx.Done():
				slog.Debug("context cancelled during wait")
				return nil, r.ctx.Err()
			}

			stream, err := r.client.WatchEntities(r.ctx, r.request)
			if err != nil {
				slog.Warn("reconnecting to world", "error", err, "attempt", attemptCount, "elapsed", time.Since(retryStartTime))
				retryInterval = min(retryInterval*2, maxRetryInterval)
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
