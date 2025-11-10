package policy

type Engine struct{}

// this does nothing in the FOSS build for now.
func NewEngine(filePath string) (*Engine, error) { return &Engine{}, nil }
