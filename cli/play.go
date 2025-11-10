package cli

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/at-wat/ebml-go"
	"github.com/at-wat/ebml-go/webm"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/projectqai/hydra/cmd"
	pb "github.com/projectqai/proto/go"
	"github.com/spf13/cobra"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	controllerID   = "ext-mkv-player"
	controllerName = "External Matroska Player"
)

func init() {
	playCmd := &cobra.Command{
		Use:   "play <timeline.mkv>",
		Short: "Play timeline file with realtime player",
		Long:  "Play a Matroska timeline file with interactive controls and push to hydra",
		Args:  cobra.ExactArgs(1),
		RunE:  runPlayCommand,
	}

	AddConnectionFlags(playCmd)

	cmd.CMD.AddCommand(playCmd)
}

func runPlayCommand(cmd *cobra.Command, args []string) error {
	// Connect to gRPC server
	if err := connect(cmd, args); err != nil {
		return err
	}
	defer conn.Close()

	return runPlay(cmd, args)
}

// Frame represents a single frame at a specific timestamp
type Frame struct {
	Timestamp time.Duration // Relative timestamp from start
	Entities  []*pb.Entity
	BlockIdx  int
}

// Player manages realtime playback of matroska timeline files
type Player struct {
	mu sync.RWMutex

	// File data
	clusters  []webm.Cluster
	blocks    []Frame // Pre-indexed blocks for fast seeking
	duration  time.Duration
	startTime time.Time

	// Playback state
	currentTime   time.Duration
	playbackRate  float64
	playing       bool
	lastPlayedIdx int // Index of last played frame

	// Frame emission
	frameChan chan Frame
	stopChan  chan struct{}
	doneChan  chan struct{}

	// gRPC client (optional)
	worldClient *WorldClient
}

// WorldClient wraps the gRPC client for pushing entities
type WorldClient struct {
	client pb.WorldServiceClient
}

// NewWorldClient creates a new world client
func NewWorldClient(client pb.WorldServiceClient) *WorldClient {
	return &WorldClient{
		client: client,
	}
}

// ListEntities lists entities with a filter
func (wc *WorldClient) ListEntities(filter *pb.EntityFilter) ([]*pb.Entity, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req := &pb.ListEntitiesRequest{
		Filter: filter,
	}

	resp, err := wc.client.ListEntities(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("list entities failed: %w", err)
	}

	return resp.Entities, nil
}

// ListEntitiesByController lists entities by controller ID
func (wc *WorldClient) ListEntitiesByController(controllerId string) ([]*pb.Entity, error) {
	allEntities, err := wc.ListEntities(&pb.EntityFilter{})
	if err != nil {
		return nil, err
	}

	// Filter client-side for the specified controller ID
	var filtered []*pb.Entity
	for _, entity := range allEntities {
		if entity.Controller != nil && entity.Controller.Id == controllerId {
			filtered = append(filtered, entity)
		}
	}

	return filtered, nil
}

// ClearOwnEntities clears all entities owned by this controller
func (wc *WorldClient) ClearOwnEntities() error {
	// List entities with our controller ID
	entities, err := wc.ListEntitiesByController(controllerID)
	if err != nil {
		return fmt.Errorf("failed to list entities: %w", err)
	}

	if len(entities) == 0 {
		return nil
	}

	// Create deletion requests (set lifetime.until = now)
	now := timestamppb.Now()
	deletions := make([]*pb.Entity, len(entities))
	for i, entity := range entities {
		deletions[i] = &pb.Entity{
			Id: entity.Id,
			Lifetime: &pb.Lifetime{
				Until: now,
			},
		}
	}

	// Push deletions
	return wc.Push(deletions)
}

// Push pushes entities to the server
func (wc *WorldClient) Push(entities []*pb.Entity) error {
	for _, entity := range entities {
		if entity.Controller == nil {
			entity.Controller = &pb.ControllerRef{
				Id:   controllerID,
				Name: controllerName,
			}
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req := &pb.EntityChangeRequest{
		Changes: entities,
	}

	resp, err := wc.client.Push(ctx, req)
	if err != nil {
		return fmt.Errorf("push failed: %w", err)
	}

	if !resp.Accepted {
		return fmt.Errorf("push rejected: %s", resp.Debug)
	}

	return nil
}

// TimelineReader reads timeline files
type TimelineReader struct {
	tracks         []webm.TrackEntry
	clusters       []webm.Cluster
	currentCluster int
	currentBlock   int
	startTime      time.Time
}

// NewTimelineReader creates a new timeline reader
func NewTimelineReader(path string) (*TimelineReader, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	// Read entire file structure including all clusters
	var doc struct {
		Header  webm.EBMLHeader `ebml:"EBML"`
		Segment struct {
			Info    webm.Info      `ebml:"Info"`
			Tracks  webm.Tracks    `ebml:"Tracks"`
			Cluster []webm.Cluster `ebml:"Cluster"`
		} `ebml:"Segment,size=unknown"`
	}

	if err := ebml.Unmarshal(file, &doc); err != nil {
		return nil, fmt.Errorf("failed to unmarshal Matroska file: %w", err)
	}

	return &TimelineReader{
		tracks:         doc.Segment.Tracks.TrackEntry,
		clusters:       doc.Segment.Cluster,
		currentCluster: 0,
		currentBlock:   0,
		startTime:      time.Now(),
	}, nil
}

// Close closes the reader
func (r *TimelineReader) Close() error {
	// No file handle to close since we read everything in NewTimelineReader
	return nil
}

// Helper function to deserialize entities from bytes using pb.EntityChangeBatch
func deserializeEntities(data []byte) ([]*pb.Entity, error) {
	// Unmarshal EntityChangeBatch
	batch := &pb.EntityChangeBatch{}
	if err := proto.Unmarshal(data, batch); err != nil {
		return nil, fmt.Errorf("failed to unmarshal EntityChangeBatch: %w", err)
	}

	// Extract entities from events
	entities := make([]*pb.Entity, len(batch.Events))
	for i, event := range batch.Events {
		entities[i] = event.Entity
	}

	return entities, nil
}

// NewPlayer creates a new player from a timeline file
func NewPlayer(path string) (*Player, error) {
	reader, err := NewTimelineReader(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open timeline: %w", err)
	}

	// Find the track with Codec ID "X_HYDRA/EntityChangeBatch"
	entityTrackNumber := uint64(0)
	found := false
	for _, track := range reader.tracks {
		if track.CodecID == "X_HYDRA/EntityChangeBatch" {
			entityTrackNumber = track.TrackNumber
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("no track with Codec ID 'X_HYDRA/EntityChangeBatch' found")
	}

	// Index all blocks for random access
	var blocks []Frame
	var maxTimestamp time.Duration

	for clusterIdx, cluster := range reader.clusters {
		for blockIdx, block := range cluster.SimpleBlock {
			// Skip blocks from other tracks
			if block.TrackNumber != entityTrackNumber {
				continue
			}

			// Calculate absolute timestamp
			absoluteTimestamp := int64(cluster.Timecode) + int64(block.Timecode)
			timestamp := time.Duration(absoluteTimestamp) * time.Millisecond

			if timestamp > maxTimestamp {
				maxTimestamp = timestamp
			}

			// Extract block data
			if len(block.Data) == 0 {
				continue
			}

			// Deserialize entities
			entities, err := deserializeEntities(block.Data[0])
			if err != nil {
				fmt.Printf("Warning: failed to deserialize block %d in cluster %d: %v\n", blockIdx, clusterIdx, err)
				continue
			}

			// Convert entity timestamps from relative to absolute
			for _, entity := range entities {
				if entity.Lifetime != nil && entity.Lifetime.From != nil {
					relativeTime := entity.Lifetime.From.AsTime()
					// relativeTime is epoch + offset, extract offset
					offset := relativeTime.Sub(time.Unix(0, 0))
					absoluteTime := reader.startTime.Add(offset)
					entity.Lifetime.From = timestamppb.New(absoluteTime)

					if entity.Lifetime.Until != nil {
						relativeUntil := entity.Lifetime.Until.AsTime()
						offsetUntil := relativeUntil.Sub(time.Unix(0, 0))
						absoluteUntil := reader.startTime.Add(offsetUntil)
						entity.Lifetime.Until = timestamppb.New(absoluteUntil)
					}
				}
			}

			blocks = append(blocks, Frame{
				Timestamp: timestamp,
				Entities:  entities,
				BlockIdx:  len(blocks),
			})
		}
	}

	reader.Close()

	return &Player{
		clusters:      reader.clusters,
		blocks:        blocks,
		duration:      maxTimestamp,
		startTime:     reader.startTime,
		currentTime:   0,
		playbackRate:  1.0,
		playing:       false,
		lastPlayedIdx: -1,
		frameChan:     make(chan Frame, 10),
		stopChan:      make(chan struct{}),
		doneChan:      make(chan struct{}),
		worldClient:   nil,
	}, nil
}

// SetWorldClient sets the gRPC client for pushing entities
func (p *Player) SetWorldClient(client *WorldClient) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.worldClient = client
}

// Start begins the player goroutine with 1ms ticker
func (p *Player) Start() {
	go p.playLoop()
}

// playLoop runs the main playback loop with 1ms ticker
func (p *Player) playLoop() {
	ticker := time.NewTicker(1 * time.Millisecond)
	defer ticker.Stop()
	defer close(p.doneChan)

	for {
		select {
		case <-p.stopChan:
			return
		case <-ticker.C:
			p.tick()
		}
	}
}

// tick processes a single 1ms tick
func (p *Player) tick() {
	p.mu.Lock()

	if !p.playing {
		p.mu.Unlock()
		return
	}

	// Advance time by playback rate
	deltaTime := time.Millisecond * time.Duration(p.playbackRate*1000) / 1000
	p.currentTime += deltaTime

	// Clamp to duration
	if p.currentTime > p.duration {
		p.currentTime = p.duration
		p.playing = false
	}

	currentTime := p.currentTime
	p.mu.Unlock()

	// Find and emit all frames that should be played at this tick
	p.emitFramesForTime(currentTime)
}

// emitFramesForTime emits all frames that should be played up to the current playback time
func (p *Player) emitFramesForTime(currentTime time.Duration) {
	// Get what we need from shared state
	p.mu.RLock()
	worldClient := p.worldClient
	startIdx := p.lastPlayedIdx + 1
	p.mu.RUnlock()

	// Find all frames between lastPlayedIdx and current time
	// This handles speedup where multiple frames might need to be played in one tick
	lastIdx := -1
	for i := startIdx; i < len(p.blocks); i++ {
		frame := p.blocks[i]

		// If frame timestamp is beyond current time, stop
		if frame.Timestamp > currentTime {
			break
		}

		lastIdx = i

		// Push to gRPC if client is available
		if worldClient != nil && len(frame.Entities) > 0 {
			// Push asynchronously to avoid blocking playback
			go func(entities []*pb.Entity) {
				_ = worldClient.Push(entities)
			}(frame.Entities)
		}

		// Emit frame to UI
		select {
		case p.frameChan <- frame:
		default:
			// Channel full, skip frame
		}
	}

	// Update last played index
	if lastIdx >= 0 {
		p.mu.Lock()
		p.lastPlayedIdx = lastIdx
		p.mu.Unlock()
	}
}

// Play resumes playback
func (p *Player) Play() {
	p.mu.Lock()

	// Clear entities before starting playback for the first time
	if p.lastPlayedIdx == -1 && !p.playing && p.worldClient != nil {
		p.mu.Unlock()
		_ = p.worldClient.ClearOwnEntities()
		p.mu.Lock()
	}

	currentTime := p.currentTime
	p.playing = true
	p.mu.Unlock()

	// Emit any frames at the current time immediately
	p.emitFramesForTime(currentTime)
}

// Pause pauses playback
func (p *Player) Pause() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.playing = false
}

// TogglePlayPause toggles between play and pause
func (p *Player) TogglePlayPause() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.playing = !p.playing
}

// Seek sets the current playback time with bounds checking
func (p *Player) Seek(t time.Duration) {
	p.mu.Lock()

	if t < 0 {
		t = 0
	}
	if t > p.duration {
		t = p.duration
	}

	p.currentTime = t

	// Find the last frame before this time (not including frames at this time)
	p.lastPlayedIdx = -1
	for i, frame := range p.blocks {
		if frame.Timestamp < t {
			p.lastPlayedIdx = i
		} else {
			break
		}
	}

	// Clear entities when seeking to start
	// Pause playback during clear to avoid race condition
	if t == 0 && p.worldClient != nil {
		wasPlaying := p.playing
		p.playing = false
		p.mu.Unlock()
		_ = p.worldClient.ClearOwnEntities()
		p.mu.Lock()
		p.playing = wasPlaying
	}

	p.mu.Unlock()
}

// SeekRelative seeks relative to current position
func (p *Player) SeekRelative(delta time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()

	newTime := p.currentTime + delta
	if newTime < 0 {
		newTime = 0
	}
	if newTime > p.duration {
		newTime = p.duration
	}

	p.currentTime = newTime

	// Find the last frame before this time (not including frames at this time)
	p.lastPlayedIdx = -1
	for i, frame := range p.blocks {
		if frame.Timestamp < newTime {
			p.lastPlayedIdx = i
		} else {
			break
		}
	}
}

// SetPlaybackRate sets the playback speed multiplier
func (p *Player) SetPlaybackRate(rate float64) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if rate < 0.1 {
		rate = 0.1
	}
	if rate > 100.0 {
		rate = 100.0
	}

	p.playbackRate = rate
}

// FrameChan returns the channel for receiving frames
func (p *Player) FrameChan() <-chan Frame {
	return p.frameChan
}

// Stop stops the player goroutine
func (p *Player) Stop() {
	close(p.stopChan)
	<-p.doneChan
}

// GetDuration returns the total duration
func (p *Player) GetDuration() time.Duration {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.duration
}

// GetCurrentTime returns the current playback time
func (p *Player) GetCurrentTime() time.Duration {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.currentTime
}

// IsPlaying returns whether the player is currently playing
func (p *Player) IsPlaying() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.playing
}

// GetPlaybackRate returns the current playback rate
func (p *Player) GetPlaybackRate() float64 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.playbackRate
}

// Bubbletea types and model
type (
	tickMsg  time.Time
	frameMsg Frame
)

type playModel struct {
	player       *Player
	timelinePath string
	grpcAddr     string
	width        int
	height       int

	// Display state
	currentFrame *Frame
	frameCount   int

	// Error state
	err error
}

func (m playModel) Init() tea.Cmd {
	return tea.Batch(
		tickCmd(),
		waitForFrame(m.player),
	)
}

func tickCmd() tea.Cmd {
	return tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func waitForFrame(player *Player) tea.Cmd {
	return func() tea.Msg {
		frame, ok := <-player.FrameChan()
		if !ok {
			return nil
		}
		return frameMsg(frame)
	}
}

func (m playModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {

		case "ctrl+c", "q", "esc":
			m.player.Stop()
			return m, tea.Quit

		case " ":
			m.player.TogglePlayPause()
			return m, nil

		case "left":
			// Seek backward 5 seconds
			m.player.SeekRelative(-5 * time.Second)
			return m, nil

		case "right":
			// Seek forward 5 seconds
			m.player.SeekRelative(5 * time.Second)
			return m, nil

		case "shift+left":
			// Seek backward 30 seconds
			m.player.SeekRelative(-30 * time.Second)
			return m, nil

		case "shift+right":
			// Seek forward 30 seconds
			m.player.SeekRelative(30 * time.Second)
			return m, nil

		case "up":
			// Increase playback speed
			rate := m.player.GetPlaybackRate()
			m.player.SetPlaybackRate(rate + 0.25)
			return m, nil

		case "down":
			// Decrease playback speed
			rate := m.player.GetPlaybackRate()
			m.player.SetPlaybackRate(rate - 0.25)
			return m, nil

		case "r", "0", "home":
			// Seek to start
			m.player.Seek(0)
			return m, nil

		case "end":
			// Seek to end
			m.player.Seek(m.player.GetDuration())
			return m, nil

		case "1":
			m.player.SetPlaybackRate(0.25)
			return m, nil
		case "2":
			m.player.SetPlaybackRate(0.5)
			return m, nil
		case "3":
			m.player.SetPlaybackRate(1.0)
			return m, nil
		case "4":
			m.player.SetPlaybackRate(2.0)
			return m, nil
		case "5":
			m.player.SetPlaybackRate(4.0)
			return m, nil
		case "6":
			m.player.SetPlaybackRate(8.0)
			return m, nil
		case "7":
			m.player.SetPlaybackRate(16.0)
			return m, nil
		case "8":
			m.player.SetPlaybackRate(32.0)
			return m, nil
		case "9":
			m.player.SetPlaybackRate(64.0)
			return m, nil
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.MouseMsg:
		if msg.Button == tea.MouseButtonLeft && msg.Action == tea.MouseActionPress {
			// Calculate progress bar width (same as in View)
			barWidth := m.width - 4
			if barWidth < 20 {
				barWidth = 20
			}
			if barWidth > 100 {
				barWidth = 100
			}

			// Check if click is on progress bar (line 1 or 2, after "connected to hydra" line)
			if msg.Y == 1 || msg.Y == 2 {
				if msg.X >= 1 && msg.X <= barWidth {
					// Calculate position (subtract 1 for opening bracket)
					clickX := msg.X - 1

					// Calculate seek position
					progress := float64(clickX) / float64(barWidth)
					if progress < 0 {
						progress = 0
					}
					if progress > 1 {
						progress = 1
					}
					seekTime := time.Duration(float64(m.player.GetDuration()) * progress)
					m.player.Seek(seekTime)
				}
			}
		}
		return m, nil

	case tickMsg:
		return m, tickCmd()

	case frameMsg:
		frame := Frame(msg)
		m.currentFrame = &frame
		m.frameCount++
		return m, waitForFrame(m.player)
	}

	return m, nil
}

func (m playModel) View() string {
	if m.err != nil {
		return fmt.Sprintf("Error: %v\n", m.err)
	}

	var b strings.Builder

	// Styles
	statusStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("205"))

	entityHeaderStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("cyan")).
		MarginTop(1).
		MarginBottom(1)

	entityStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("252"))

	helpStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("241")).
		MarginTop(1)

	// Connection info
	b.WriteString(fmt.Sprintf("connected to hydra at %s\n", m.grpcAddr))

	// Current state
	currentTime := m.player.GetCurrentTime()
	duration := m.player.GetDuration()
	playing := m.player.IsPlaying()
	rate := m.player.GetPlaybackRate()

	// Progress bar (line 1 for mouse clicks)
	barWidth := m.width - 4
	if barWidth < 20 {
		barWidth = 20
	}
	if barWidth > 100 {
		barWidth = 100
	}

	progress := 0.0
	if duration > 0 {
		progress = float64(currentTime) / float64(duration)
	}

	progressBar := renderProgressBar(progress, barWidth)
	b.WriteString(progressBar)
	b.WriteString("\n")

	// Time and status on same line
	playStatus := "⏸ PAUSED"
	if playing {
		playStatus = "▶ PLAYING"
	}
	statusLine := fmt.Sprintf("%s / %s | %s | %.2fx",
		formatDuration(currentTime),
		formatDuration(duration),
		playStatus,
		rate)
	b.WriteString(statusStyle.Render(statusLine))
	b.WriteString("\n")

	// Entity list header
	entityCount := 0
	if m.currentFrame != nil {
		entityCount = len(m.currentFrame.Entities)
	}
	headerText := fmt.Sprintf("Entities (%d)", entityCount)
	b.WriteString(entityHeaderStyle.Render(headerText))
	b.WriteString("\n")

	// Entity list - always render full height
	visibleCount := getVisibleEntityCount(m.height)
	entityList := []string{}

	if m.currentFrame != nil && len(m.currentFrame.Entities) > 0 {
		endIdx := min(visibleCount-1, len(m.currentFrame.Entities)) // Reserve one line for "... and N more"

		for i := 0; i < endIdx; i++ {
			entity := m.currentFrame.Entities[i]
			label := "<no label>"
			if entity.Label != nil {
				label = *entity.Label
			}

			// Truncate long labels
			maxLabelWidth := m.width - 10
			if maxLabelWidth < 20 {
				maxLabelWidth = 20
			}
			if len(label) > maxLabelWidth {
				label = label[:maxLabelWidth-3] + "..."
			}

			entityList = append(entityList, fmt.Sprintf("  %s", label))
		}

		// Show indicator if there are more entities
		if endIdx < len(m.currentFrame.Entities) {
			entityList = append(entityList, fmt.Sprintf("  ... and %d more", len(m.currentFrame.Entities)-endIdx))
		}
	}

	// Pad with empty lines to maintain consistent height
	for len(entityList) < visibleCount {
		entityList = append(entityList, "")
	}

	// Render all lines
	for i, line := range entityList {
		if i < len(entityList)-1 || !strings.HasPrefix(line, "  ... and") {
			b.WriteString(entityStyle.Render(line))
		} else {
			b.WriteString(helpStyle.Render(line))
		}
		b.WriteString("\n")
	}

	// Controls (compact)
	b.WriteString("\n")
	controls := []string{
		"Space:Play/Pause  ←/→:Seek±5s  Shift+←/→:Seek±30s  ↑/↓:Speed±0.25x  1-9:Preset  r/0:Start  q:Quit",
	}
	b.WriteString(helpStyle.Render(strings.Join(controls, "\n")))

	return b.String()
}

func getVisibleEntityCount(height int) int {
	// Reserve space for header, progress bar, status, entity header, controls
	// Approximately: 1 (title) + 1 (progress) + 1 (status) + 2 (entity header) + 2 (controls) = 7 lines overhead
	overhead := 10
	available := height - overhead
	if available < 5 {
		available = 5
	}
	return available
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func renderProgressBar(progress float64, width int) string {
	if progress < 0 {
		progress = 0
	}
	if progress > 1 {
		progress = 1
	}

	filled := int(float64(width) * progress)
	empty := width - filled

	filledStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("86"))
	emptyStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("240"))

	bar := filledStyle.Render(strings.Repeat("█", filled)) +
		emptyStyle.Render(strings.Repeat("░", empty))

	return "[" + bar + "]"
}

func formatDuration(d time.Duration) string {
	d = d.Round(time.Second)
	h := d / time.Hour
	d -= h * time.Hour
	m := d / time.Minute
	d -= m * time.Minute
	s := d / time.Second

	if h > 0 {
		return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%02d:%02d", m, s)
}

func runPlay(cmd *cobra.Command, args []string) error {
	timelinePath := args[0]

	// Create player
	player, err := NewPlayer(timelinePath)
	if err != nil {
		return fmt.Errorf("error creating player: %w", err)
	}

	// Create gRPC client using the global conn variable
	worldClient := NewWorldClient(pb.NewWorldServiceClient(conn))
	player.SetWorldClient(worldClient)

	// Start player goroutine
	player.Start()

	// Start playing automatically
	player.Play()

	// Create bubbletea model
	model := playModel{
		player:       player,
		timelinePath: timelinePath,
		grpcAddr:     serverURL,
	}

	// Run bubbletea program
	p := tea.NewProgram(model, tea.WithMouseCellMotion())
	if _, err := p.Run(); err != nil {
		return fmt.Errorf("error running player: %w", err)
	}

	return nil
}
