.PHONY: all build clean frontend aio

all: aio

gen:
	go generate

frontend:
	cd view/frontend && bun i
	cd view/frontend && bun build:web

aio: gen frontend
	go build -ldflags="-X 'github.com/projectqai/hydra/version.Version=$$(git describe --always --dirty --tags)'" -o hydra .

ext: gen
	go build -ldflags="-X 'github.com/projectqai/hydra/version.Version=$$(git describe --always --dirty --tags)'" -o hydra -tags ext .

build: all

clean:
	rm -rf view/dist
	rm -f hydra
