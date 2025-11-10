package engine

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

func (s *WorldServer) LoadFromFile(path string) error {
	inputBytes, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to read file: %w", err)
	}

	if len(bytes.TrimSpace(inputBytes)) == 0 {
		return nil
	}

	entities, err := parseEntities(inputBytes)
	if err != nil {
		return err
	}

	s.l.Lock()
	defer s.l.Unlock()

	for _, e := range entities {
		s.head[e.Id] = e
		s.bus.Dirty(e.Id, e, pb.EntityChange_EntityChangeUpdated)
	}

	fmt.Printf("Loaded %d entities from %s\n", len(entities), path)
	return nil
}

func parseEntities(b []byte) ([]*pb.Entity, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(b))
	var entities []*pb.Entity

	for {
		var data map[string]interface{}
		err := decoder.Decode(&data)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to decode YAML document: %w", err)
		}

		// Skip empty documents
		if len(data) == 0 {
			continue
		}

		// Convert to JSON then to protobuf
		jsonBytes, err := json.Marshal(data)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal to JSON: %w", err)
		}

		entity := &pb.Entity{}
		unmarshaler := protojson.UnmarshalOptions{
			DiscardUnknown: false,
		}

		if err := unmarshaler.Unmarshal(jsonBytes, entity); err != nil {
			return nil, fmt.Errorf("failed to unmarshal entity: %w", err)
		}

		entities = append(entities, entity)
	}

	return entities, nil
}

func shouldPersist(e *pb.Entity) bool {
	// Skip entities with a controller - they are managed by the controller
	if e.Controller != nil {
		return false
	}
	// Skip entities with lifetime.until set - they are expiring/temporary
	if e.Lifetime != nil && e.Lifetime.Until != nil && e.Lifetime.Until.IsValid() {
		return false
	}
	return true
}

// FlushToFile writes the current head state to the world file atomically.
// Only entities without a controller and without lifetime.until are written.
func (s *WorldServer) FlushToFile() error {
	if s.worldFile == "" {
		return nil
	}

	s.l.RLock()
	entities := make([]*pb.Entity, 0, len(s.head))
	for _, e := range s.head {
		if shouldPersist(e) {
			entities = append(entities, e)
		}
	}
	s.l.RUnlock()

	// Sort entities by ID for consistent output
	slices.SortFunc(entities, func(a, b *pb.Entity) int {
		return strings.Compare(a.Id, b.Id)
	})

	// Convert to YAML
	yamlBytes, err := entitiesToYAML(entities)
	if err != nil {
		return fmt.Errorf("failed to marshal entities to YAML: %w", err)
	}

	// Write atomically: write to temp file, then rename
	dir := filepath.Dir(s.worldFile)
	tmpFile, err := os.CreateTemp(dir, ".hydra-world-*.yaml.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	_, err = tmpFile.Write(yamlBytes)
	if err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := tmpFile.Sync(); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("failed to sync temp file: %w", err)
	}

	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to close temp file: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tmpPath, s.worldFile); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to rename temp file to %s: %w", s.worldFile, err)
	}

	return nil
}

// Canonical field order for YAML output
var canonicalFieldOrder = []string{"id", "label", "controller", "lifetime", "priority", "symbol", "geo"}

// entitiesToYAML converts entities to multi-document YAML format with canonical field order.
func entitiesToYAML(entities []*pb.Entity) ([]byte, error) {
	if len(entities) == 0 {
		return []byte{}, nil
	}

	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}

	var buf bytes.Buffer

	for i, entity := range entities {
		if i > 0 {
			buf.WriteString("---\n")
		}

		// Convert proto to JSON first
		jsonBytes, err := marshaler.Marshal(entity)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal entity %s to JSON: %w", entity.Id, err)
		}

		// Convert JSON to map
		var data map[string]interface{}
		if err := json.Unmarshal(jsonBytes, &data); err != nil {
			return nil, fmt.Errorf("failed to unmarshal JSON for entity %s: %w", entity.Id, err)
		}

		// Build ordered YAML node
		node := buildOrderedYAMLNode(data)

		// Marshal to YAML
		yamlBytes, err := yaml.Marshal(node)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal entity %s to YAML: %w", entity.Id, err)
		}

		buf.Write(yamlBytes)
	}

	return buf.Bytes(), nil
}

// buildOrderedYAMLNode creates a yaml.Node with fields in canonical order.
func buildOrderedYAMLNode(data map[string]interface{}) *yaml.Node {
	node := &yaml.Node{
		Kind: yaml.MappingNode,
	}

	// First add canonical fields in order
	for _, key := range canonicalFieldOrder {
		if val, ok := data[key]; ok {
			addKeyValue(node, key, val)
		}
	}

	// Collect remaining keys and sort them
	var remainingKeys []string
	for key := range data {
		if !slices.Contains(canonicalFieldOrder, key) {
			remainingKeys = append(remainingKeys, key)
		}
	}
	slices.Sort(remainingKeys)

	// Add remaining fields in sorted order
	for _, key := range remainingKeys {
		addKeyValue(node, key, data[key])
	}

	return node
}

// addKeyValue adds a key-value pair to a yaml mapping node.
func addKeyValue(node *yaml.Node, key string, val interface{}) {
	keyNode := &yaml.Node{
		Kind:  yaml.ScalarNode,
		Value: key,
	}
	var valNode yaml.Node
	valNode.Encode(val)
	node.Content = append(node.Content, keyNode, &valNode)
}

// StartPeriodicFlush starts a goroutine that periodically flushes the head to the world file.
func (s *WorldServer) StartPeriodicFlush(interval time.Duration) {
	if s.worldFile == "" {
		return
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			if err := s.FlushToFile(); err != nil {
				fmt.Printf("Warning: failed to flush world state: %v\n", err)
			}
		}
	}()
}
