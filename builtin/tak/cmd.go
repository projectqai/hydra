package view

import (
	"bufio"
	"context"
	"log"
	"net"
	"strings"
	"sync/atomic"

	"github.com/projectqai/hydra/builtin"
	"github.com/projectqai/hydra/goclient"
	pb "github.com/projectqai/proto/go"
	"github.com/spf13/cobra"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	serverMode  bool
	listenAddr  string
	verbose     bool
	clientCount atomic.Int32
)

func handleClient(conn net.Conn, serverURL string) {
	clientID := clientCount.Add(1)
	log.Printf("[Client %d] Connected from %s", clientID, conn.RemoteAddr())

	defer conn.Close()
	defer func() {
		clientCount.Add(-1)
		log.Printf("[Client %d] Disconnected", clientID)
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	grpcConn, err := grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Printf("[Client %d] gRPC connection failed: %v", clientID, err)
		return
	}
	defer grpcConn.Close()

	client := pb.NewWorldServiceClient(grpcConn)

	// Start goroutine to read incoming data from TAK client
	go func() {
		defer cancel() // Signal main goroutine to exit when reader fails
		reader := bufio.NewReader(conn)
		buffer := make([]byte, 8192)
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			n, err := reader.Read(buffer)
			if err != nil {
				log.Printf("[Client %d] Read error (client disconnected): %v", clientID, err)
				return
			}
			if n > 0 {
				log.Printf("[Client %d] <<<< RECEIVED %d bytes from TAK client", clientID, n)
				log.Printf("[Client %d] RAW HEX: %X", clientID, buffer[:n])
				log.Printf("[Client %d] RAW STRING: %s", clientID, string(buffer[:n]))

				data := string(buffer[:n])

				// Respond to pings (type="t-x-c-t")
				if strings.Contains(data, `type="t-x-c-t"`) {
					log.Printf("[Client %d] Detected ping, sending pong response", clientID)
					// Echo the ping back as a pong
					if _, err := conn.Write(buffer[:n]); err != nil {
						log.Printf("[Client %d] Pong write error: %v", clientID, err)
						return
					}
				}

				// Parse and push position reports (type="a-f-G-U-C" and similar)
				if strings.Contains(data, `type="a-`) && !strings.Contains(data, `type="t-`) {
					log.Printf("[Client %d] Detected position report, parsing and pushing to Hydra", clientID)
					entity, err := CoTToEntity(buffer[:n])
					if err != nil {
						log.Printf("[Client %d] Error parsing CoT: %v", clientID, err)
					} else {
						log.Printf("[Client %d] Parsed entity: ID=%s, Callsign=%s, Lat=%.6f, Lon=%.6f",
							clientID, entity.Id, *entity.Label, entity.Geo.Latitude, entity.Geo.Longitude)

						// Push entity to Hydra
						_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{entity}})
						if err != nil {
							log.Printf("[Client %d] Error pushing to Hydra: %v", clientID, err)
						} else {
							log.Printf("[Client %d] Successfully pushed %s to Hydra", clientID, entity.Id)
						}
					}
				}
			}
		}
	}()
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{})
	if err != nil {
		log.Printf("[Client %d] WatchEntities failed: %v", clientID, err)
		return
	}

	writer := bufio.NewWriter(conn)
	sentCount := 0

	for {
		event, err := stream.Recv()
		if err != nil {
			log.Printf("[Client %d] Stream error: %v", clientID, err)
			return
		}

		if event.Entity == nil {
			continue
		}

		cotXML, err := EntityToCoT(event.Entity)
		if err != nil {
			log.Printf("[Client %d] Error converting entity %s: %v", clientID, event.Entity.Id, err)
			continue
		}

		if cotXML == nil {
			continue
		}

		if verbose {
			log.Printf("[Client %d] CoT for %s:\n%s", clientID, event.Entity.Id, string(cotXML))
		}

		log.Printf("[Client %d] >>>> SENDING %d bytes to TAK client", clientID, len(cotXML))
		if _, err := writer.Write(cotXML); err != nil {
			log.Printf("[Client %d] Write error: %v", clientID, err)
			return
		}

		if err := writer.Flush(); err != nil {
			log.Printf("[Client %d] Flush error: %v", clientID, err)
			return
		}

		sentCount++
		if !verbose {
			log.Printf("[Client %d] Sent %s (total: %d)", clientID, event.Entity.Id, sentCount)
		}
	}
}

func runUDPBroadcast(serverURL string) error {
	const multicastAddress = "239.2.3.1:6969"

	multicastAddr, err := net.ResolveUDPAddr("udp", multicastAddress)
	if err != nil {
		return err
	}

	localAddr, err := net.ResolveUDPAddr("udp", "0.0.0.0:0")
	if err != nil {
		return err
	}

	udpConn, err := net.DialUDP("udp", localAddr, multicastAddr)
	if err != nil {
		return err
	}
	defer udpConn.Close()

	log.Printf("UDP multicast: %s -> %s", udpConn.LocalAddr(), multicastAddress)

	grpcConn, err := grpc.NewClient(serverURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer grpcConn.Close()

	ctx := context.Background()
	client := pb.NewWorldServiceClient(grpcConn)
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, &pb.ListEntitiesRequest{})
	if err != nil {
		return err
	}

	sentCount := 0
	for {
		event, err := stream.Recv()
		if err != nil {
			return err
		}

		if event.Entity == nil {
			continue
		}

		// Log received entity
		log.Printf("RECEIVED entity: %+v", event.Entity)

		cotXML, err := EntityToCoT(event.Entity)
		if err != nil {
			log.Printf("Error converting entity %s: %v", event.Entity.Id, err)
			continue
		}

		if cotXML == nil {
			continue
		}

		if verbose {
			log.Printf("CoT for %s:\n%s", event.Entity.Id, string(cotXML))
		}

		if _, err := udpConn.Write(cotXML); err != nil {
			log.Printf("UDP write error: %v", err)
			continue
		}

		sentCount++
		if !verbose {
			log.Printf("Broadcast %s (total: %d)", event.Entity.Id, sentCount)
		}
	}
}

var CMD = &cobra.Command{
	Use:   "tak",
	Short: "TAK CoT server",
	Long:  "Streams Hydra entities as CoT (Cursor on Target) XML to TAK clients",
	RunE: func(cmd *cobra.Command, args []string) error {
		log.Printf("Hydra server: %s", builtin.ServerURL)

		if serverMode {
			listener, err := net.Listen("tcp", listenAddr)
			if err != nil {
				return err
			}
			defer listener.Close()

			log.Printf("TAK server on %s", listenAddr)

			for {
				conn, err := listener.Accept()
				if err != nil {
					log.Printf("Accept error: %v", err)
					continue
				}
				go handleClient(conn, builtin.ServerURL)
			}
		}

		log.Println("UDP multicast broadcast mode")
		return runUDPBroadcast(builtin.ServerURL)
	},
}

func init() {
	CMD.Flags().BoolVar(&serverMode, "server", false, "Run as TCP server instead of UDP broadcast")
	CMD.Flags().StringVar(&listenAddr, "listen", ":8088", "TCP address to listen on (only with --server)")
	CMD.Flags().BoolVarP(&verbose, "verbose", "v", false, "Enable verbose logging (shows full CoT XML)")
	builtin.CMD.AddCommand(CMD)
}
