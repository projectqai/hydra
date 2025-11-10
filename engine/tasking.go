package engine

import (
	"connectrpc.com/connect"
	"context"
	pb "github.com/projectqai/proto/go"
)

func (s *WorldServer) RunTask(ctx context.Context, req *connect.Request[pb.RunTaskRequest]) (*connect.Response[pb.RunTaskResponse], error) {
	return connect.NewResponse(&pb.RunTaskResponse{
		ExecutionId: "",
		Status:      pb.TaskStatus_TaskStatusInvalid,
	}), nil
}
