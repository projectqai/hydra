package engine

import (
	"context"
	pb "github.com/projectqai/proto/go"
	"connectrpc.com/connect"
)

func (s *WorldServer) RunTask(ctx context.Context, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	return connect.NewResponse(&pb.RunTaskResponse{
		ExecutionId: "",
		Status: pb.TaskStatus_TaskStatusInvalid,
	}), nil
}

