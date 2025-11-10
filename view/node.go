package view

import (
	"encoding/json"
	"html/template"
	"net/http"
	"os"
	"runtime"
	"strings"

	"github.com/projectqai/hydra/metrics"
)

type NodeInfo struct {
	Hostname     string `json:"hostname"`
	NumCPU       int    `json:"num_cpu"`
	GOOS         string `json:"goos"`
	GOARCH       string `json:"goarch"`
	MemAllocMB   uint64 `json:"mem_alloc_mb"`
	MemTotalMB   uint64 `json:"mem_total_mb"`
	NumGoroutine int    `json:"num_goroutine"`
	EntityCount  int    `json:"entity_count"`
}

func getNodeInfo() (*NodeInfo, error) {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}

	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	return &NodeInfo{
		Hostname:     hostname,
		NumCPU:       runtime.NumCPU(),
		GOOS:         runtime.GOOS,
		GOARCH:       runtime.GOARCH,
		MemAllocMB:   m.Alloc / 1024 / 1024,
		MemTotalMB:   m.TotalAlloc / 1024 / 1024,
		NumGoroutine: runtime.NumGoroutine(),
		EntityCount:  metrics.GetEntityCount(),
	}, nil
}

const nodeTemplate = `<!DOCTYPE html>
<html>
<head>
    <title>Node Information</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 10px;
        }
        .info-row {
            display: flex;
            padding: 12px 0;
            border-bottom: 1px solid #eee;
        }
        .info-label {
            font-weight: bold;
            width: 200px;
            color: #555;
        }
        .info-value {
            color: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Node Information</h1>
        <div class="info-row">
            <div class="info-label">Hostname:</div>
            <div class="info-value">{{.Hostname}}</div>
        </div>
        <div class="info-row">
            <div class="info-label">CPU Cores:</div>
            <div class="info-value">{{.NumCPU}}</div>
        </div>
        <div class="info-row">
            <div class="info-label">Operating System:</div>
            <div class="info-value">{{.GOOS}}</div>
        </div>
        <div class="info-row">
            <div class="info-label">Architecture:</div>
            <div class="info-value">{{.GOARCH}}</div>
        </div>
        <div class="info-row">
            <div class="info-label">Go Memory Allocated:</div>
            <div class="info-value">{{.MemAllocMB}} MB</div>
        </div>
        <div class="info-row">
            <div class="info-label">Total Go Memory:</div>
            <div class="info-value">{{.MemTotalMB}} MB</div>
        </div>
        <div class="info-row">
            <div class="info-label">Active Goroutines:</div>
            <div class="info-value">{{.NumGoroutine}}</div>
        </div>
        <div class="info-row">
            <div class="info-label">Entity Count:</div>
            <div class="info-value">{{.EntityCount}}</div>
        </div>
    </div>
</body>
</html>`

func nodeHandler(w http.ResponseWriter, r *http.Request) {
	info, err := getNodeInfo()
	if err != nil {
		http.Error(w, "Failed to get node info", http.StatusInternalServerError)
		return
	}

	acceptHeader := r.Header.Get("Accept")
	wantsHTML := strings.Contains(acceptHeader, "text/html") ||
		strings.Contains(acceptHeader, "html")

	if wantsHTML {
		tmpl, err := template.New("node").Parse(nodeTemplate)
		if err != nil {
			http.Error(w, "Failed to parse template", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.Execute(w, info); err != nil {
			http.Error(w, "Failed to render template", http.StatusInternalServerError)
			return
		}
	} else {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(info); err != nil {
			http.Error(w, "Failed to encode JSON", http.StatusInternalServerError)
			return
		}
	}
}
