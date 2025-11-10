package goclient

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"os"
	"strings"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	// dnsResolveInterval is how often we re-resolve the endpoint hostname
	dnsResolveInterval = 60 * time.Second
	// dnsTimeout is the timeout for DNS resolution
	dnsTimeout = 5 * time.Second
)

var dnsResolver = &net.Resolver{}

// WireGuardConfig holds the configuration for a WireGuard tunnel
type WireGuardConfig struct {
	PrivateKey    string     // client's WireGuard private key (base64)
	Address       netip.Addr // client's IP in the WireGuard network
	PeerPublicKey string     // server's WireGuard public key (base64)
	Endpoint      string     // WireGuard endpoint (host:port)
}

// ParseWireGuardConfig parses a standard WireGuard config file
func ParseWireGuardConfig(path string) (*WireGuardConfig, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open config file: %w", err)
	}
	defer file.Close()

	cfg := &WireGuardConfig{}
	scanner := bufio.NewScanner(file)
	section := ""

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Section headers
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(line[1 : len(line)-1])
			continue
		}

		// Key-value pairs
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(strings.ToLower(parts[0]))
		value := strings.TrimSpace(parts[1])

		switch section {
		case "interface":
			switch key {
			case "privatekey":
				cfg.PrivateKey = value
			case "address":
				// Parse address, strip CIDR if present
				addrStr := strings.Split(value, "/")[0]
				addr, err := netip.ParseAddr(addrStr)
				if err != nil {
					return nil, fmt.Errorf("invalid Address: %w", err)
				}
				cfg.Address = addr
			}
		case "peer":
			switch key {
			case "publickey":
				cfg.PeerPublicKey = value
			case "endpoint":
				cfg.Endpoint = value
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading config: %w", err)
	}

	// Validate required fields
	if cfg.PrivateKey == "" {
		return nil, fmt.Errorf("missing PrivateKey in [Interface]")
	}
	if !cfg.Address.IsValid() {
		return nil, fmt.Errorf("missing Address in [Interface]")
	}
	if cfg.PeerPublicKey == "" {
		return nil, fmt.Errorf("missing PublicKey in [Peer]")
	}
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("missing Endpoint in [Peer]")
	}

	return cfg, nil
}

func resolveEndpoint(endpoint string) (string, error) {
	host, port, err := net.SplitHostPort(endpoint)
	if err != nil {
		return "", fmt.Errorf("invalid endpoint format: %w", err)
	}

	if ip := net.ParseIP(host); ip != nil {
		return endpoint, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), dnsTimeout)
	defer cancel()

	addrs, err := dnsResolver.LookupHost(ctx, host)
	if err != nil {
		return "", fmt.Errorf("failed to resolve %s: %w", host, err)
	}

	if len(addrs) == 0 {
		return "", fmt.Errorf("no IP addresses found for %s", host)
	}

	// Prefer IPv4
	for _, addr := range addrs {
		if ip := net.ParseIP(addr); ip != nil && ip.To4() != nil {
			return net.JoinHostPort(addr, port), nil
		}
	}

	return net.JoinHostPort(addrs[0], port), nil
}

// WireGuardTunnel represents an active userspace WireGuard tunnel
type WireGuardTunnel struct {
	device *device.Device
	net    *netstack.Net

	// DNS resolution fields
	cfg             *WireGuardConfig
	originalHost    string
	originalPort    string
	currentEndpoint string
	mu              sync.Mutex
	stopDNS         chan struct{}
	dnsWg           sync.WaitGroup
	privateKeyHex   string
	peerKeyHex      string
}

// Close shuts down the WireGuard tunnel
func (t *WireGuardTunnel) Close() error {
	// Stop DNS resolution goroutine
	if t.stopDNS != nil {
		close(t.stopDNS)
		t.dnsWg.Wait()
	}
	t.device.Close()
	return nil
}

// updateEndpoint re-resolves the hostname and updates WireGuard if the IP changed
func (t *WireGuardTunnel) updateEndpoint() error {
	resolved, err := resolveEndpoint(net.JoinHostPort(t.originalHost, t.originalPort))
	if err != nil {
		return err
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if resolved == t.currentEndpoint {
		return nil
	}

	slog.Info("endpoint IP changed, updating WireGuard",
		"old", t.currentEndpoint,
		"new", resolved)

	config := fmt.Sprintf("public_key=%s\nendpoint=%s\n",
		t.peerKeyHex,
		resolved,
	)

	if err := t.device.IpcSet(config); err != nil {
		return fmt.Errorf("failed to update endpoint: %w", err)
	}

	t.currentEndpoint = resolved
	return nil
}

// startDNSResolver starts a background goroutine that periodically re-resolves the endpoint
func (t *WireGuardTunnel) startDNSResolver() {
	t.stopDNS = make(chan struct{})
	t.dnsWg.Add(1)

	go func() {
		defer t.dnsWg.Done()
		ticker := time.NewTicker(dnsResolveInterval)
		defer ticker.Stop()

		for {
			select {
			case <-t.stopDNS:
				return
			case <-ticker.C:
				if err := t.updateEndpoint(); err != nil {
					slog.Warn("failed to update endpoint", "error", err)
				}
			}
		}
	}()
}

// Dial creates a TCP connection through the WireGuard tunnel
func (t *WireGuardTunnel) Dial(ctx context.Context, address string) (net.Conn, error) {
	return t.net.DialContext(ctx, "tcp", address)
}

// decodeKey decodes a WireGuard key from base64 or hex format
func decodeKey(key string) ([]byte, error) {
	// Try base64 first (standard WireGuard format)
	if decoded, err := base64.StdEncoding.DecodeString(key); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	// Try hex
	if decoded, err := hex.DecodeString(key); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	return nil, fmt.Errorf("invalid key format: must be 32 bytes base64 or hex encoded")
}

// NewWireGuardTunnel creates a new userspace WireGuard tunnel
func NewWireGuardTunnel(cfg *WireGuardConfig) (*WireGuardTunnel, error) {
	privateKey, err := decodeKey(cfg.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}

	peerPublicKey, err := decodeKey(cfg.PeerPublicKey)
	if err != nil {
		return nil, fmt.Errorf("invalid peer public key: %w", err)
	}

	// Parse the endpoint to extract host and port
	host, port, err := net.SplitHostPort(cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid endpoint format: %w", err)
	}

	// Resolve hostname to IP before passing to WireGuard
	resolvedEndpoint, err := resolveEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve endpoint: %w", err)
	}

	// Create the netstack TUN device
	localAddrs := []netip.Addr{cfg.Address}
	tun, tnet, err := netstack.CreateNetTUN(localAddrs, nil, device.DefaultMTU)
	if err != nil {
		return nil, fmt.Errorf("failed to create netstack TUN: %w", err)
	}

	// Create the WireGuard device
	dev := device.NewDevice(tun, conn.NewDefaultBind(), device.NewLogger(device.LogLevelSilent, ""))

	privateKeyHex := hex.EncodeToString(privateKey)
	peerKeyHex := hex.EncodeToString(peerPublicKey)

	// Configure: allow all traffic through tunnel
	config := fmt.Sprintf(`private_key=%s
public_key=%s
endpoint=%s
allowed_ip=0.0.0.0/0
allowed_ip=::/0
persistent_keepalive_interval=25
`,
		privateKeyHex,
		peerKeyHex,
		resolvedEndpoint,
	)

	if err := dev.IpcSet(config); err != nil {
		dev.Close()
		return nil, fmt.Errorf("failed to configure WireGuard device: %w", err)
	}

	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, fmt.Errorf("failed to bring up WireGuard device: %w", err)
	}

	tunnel := &WireGuardTunnel{
		device:          dev,
		net:             tnet,
		cfg:             cfg,
		originalHost:    host,
		originalPort:    port,
		currentEndpoint: resolvedEndpoint,
		privateKeyHex:   privateKeyHex,
		peerKeyHex:      peerKeyHex,
	}

	// Start DNS resolution goroutine if endpoint is a hostname (not an IP)
	if net.ParseIP(host) == nil {
		tunnel.startDNSResolver()
	}

	return tunnel, nil
}

// ConnectViaWireGuard creates a gRPC connection through a WireGuard tunnel
func ConnectViaWireGuard(serverAddr string, wgCfg *WireGuardConfig) (*grpc.ClientConn, *WireGuardTunnel, error) {
	tunnel, err := NewWireGuardTunnel(wgCfg)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create WireGuard tunnel: %w", err)
	}

	conn, err := grpc.NewClient(
		serverAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(tunnel.Dial),
	)
	if err != nil {
		tunnel.Close()
		return nil, nil, err
	}

	return conn, tunnel, nil
}
