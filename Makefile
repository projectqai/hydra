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
	cp android/hydra.aar  view/frontend/packages/hydra-engine/android/libs/hydra.aar
	cd view/frontend && bun i
	cd view/frontend/apps/foss && bun expo prebuild --clean --platform android
	cd view/frontend/apps/foss/android && ./gradlew assembleRelease
	@echo adb install -r view/frontend/apps/foss/android/app/build/outputs/apk/release/app-release.apk 

build: all

clean:
	rm -rf view/dist
	rm -f hydra
