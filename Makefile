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

ext: gen frontend
	go build -o hydra -tags ext .

build: all

clean:
	rm -rf view/dist
	rm -f hydra
