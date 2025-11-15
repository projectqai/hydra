.PHONY: all build clean frontend aio

all: aio


gen:
	go generate

frontend:
	cd builtin/view && npm i
	cd builtin/view && npm run gen-proto
	cd builtin/view && npm run build

aio: gen frontend
	go build -o hydra .

build: all

clean:
	rm -rf builtin/view/dist
	rm -f hydra
