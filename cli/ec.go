package cli

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"

	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/cmd"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/encoding/wkb"
	"github.com/rodaine/table"
	"github.com/spf13/cobra"
	"google.golang.org/protobuf/encoding/protojson"
)

func init() {
	ECCMD := &cobra.Command{
		Use:               "ec",
		Aliases:           []string{"entities", "e"},
		Short:             "entity/components client",
		PersistentPreRunE: connect,
	}
	ECCMD.PersistentFlags().StringVar(&serverURL, "server", "localhost:50051", "gRPC server address")

	lsCmd := &cobra.Command{
		Use:     "ls",
		Aliases: []string{"list"},
		Short:   "list all entities",
		RunE:    runLS,
	}

	observeCmd := &cobra.Command{
		Use:     "o",
		Aliases: []string{"observe"},
		Short:   "observe entities within a geometry",
		RunE:    runObserve,
	}

	debugCmd := &cobra.Command{
		Use:     "debug",
		Aliases: []string{"d"},
		Short:   "subscribe to all change events and print as JSON",
		RunE:    runDebug,
	}

	ECCMD.AddCommand(lsCmd)
	ECCMD.AddCommand(observeCmd)
	ECCMD.AddCommand(debugCmd)

	cmd.CMD.AddCommand(ECCMD)
}

func runObserve(cmd *cobra.Command, args []string) error {
	var p orb.Polygon
	p = append(p, orb.Ring{
		orb.Point{
			13.26381753917674,
			52.562674720066035,
		},
		orb.Point{
			13.306191079765078,
			52.56604539661486,
		},
		orb.Point{
			13.328310401583929,
			52.55291095491699,
		},
		orb.Point{
			13.262209637543883,
			52.55267637557711,
		},
		orb.Point{
			13.26381753917674,
			52.562674720066035,
		},
	})
	wkb, err := wkb.Marshal(p, binary.LittleEndian)
	if err != nil {
		return err
	}

	conn, err := goclient.Connect(builtin.ServerURL)
	if err != nil {
		return err
	}
	defer conn.Close()
	world := pb.NewWorldServiceClient(conn)

	stream, err := goclient.WatchEntitiesWithRetry(cmd.Context(), world, &pb.ListEntitiesRequest{
		Geo: &pb.Geometry{
			Wkb: wkb,
		},
	})
	if err != nil {
		return fmt.Errorf("failed to list entities: %w", err)
	}

	for {
		m, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				return nil
			}
			panic(err)
		}
		printEntitiesTable([]*pb.Entity{m.Entity})
	}

	return nil
}

func runLS(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	resp, err := client.ListEntities(context.Background(), &pb.ListEntitiesRequest{})
	if err != nil {
		return fmt.Errorf("failed to list entities: %w", err)
	}

	printEntitiesTable(resp.Entities)
	return nil
}

func printEntitiesTable(entities []*pb.Entity) {
	if len(entities) == 0 {
		fmt.Println("No entities found")
		return
	}

	tbl := table.New("ID", "symbol", "Latitude", "Longitude")

	for _, entity := range entities {
		lat := "N/A"
		lon := "N/A"
		if entity.Geo != nil {
			lat = fmt.Sprintf("%.6f", entity.Geo.Latitude)
			lon = fmt.Sprintf("%.6f", entity.Geo.Longitude)
		}
		symbol := ""
		if entity.Symbol != nil {
			symbol = entity.Symbol.MilStd2525C
		}

		tbl.AddRow(entity.Id, symbol, lat, lon)
	}

	tbl.Print()
}

func runDebug(cmd *cobra.Command, args []string) error {
	conn, err := goclient.Connect(builtin.ServerURL)
	if err != nil {
		return err
	}
	defer conn.Close()
	world := pb.NewWorldServiceClient(conn)

	// Subscribe to all change events (no geometry filter)
	stream, err := goclient.WatchEntitiesWithRetry(cmd.Context(), world, &pb.ListEntitiesRequest{})
	if err != nil {
		return fmt.Errorf("failed to watch entities: %w", err)
	}

	// Configure JSON marshaler
	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
		Indent:          "  ",
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("stream error: %w", err)
		}

		// Marshal the entire EntityChangeEvent to JSON
		jsonBytes, err := marshaler.Marshal(event)
		if err != nil {
			return fmt.Errorf("failed to marshal event: %w", err)
		}

		fmt.Println(string(jsonBytes))
	}
}
