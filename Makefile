.PHONY: all build clean frontend aio

all: aio


gen:
	go generate

frontend:
	cd view && npm i
	cd view && npm run gen-proto
	cd view && npm run build

aio: gen frontend
	go build -o hydra .

build: all

clean:
	rm -rf builtin/view/dist
	rm -f hydra
