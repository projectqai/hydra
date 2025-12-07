.PHONY: all build clean frontend aio android

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

android:
	cd android && gomobile bind -target=android -androidapi 24 -o hydra.aar 
	cd view/frontend/android && ./gradlew assembleRelease
	@echo adb install -r view/frontend/android/app/build/outputs/apk/release/app-debug.apk

build: all

clean:
	rm -rf view/dist
	rm -f hydra
