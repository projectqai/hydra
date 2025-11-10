.PHONY: generate install run clean

generate: install
	@echo "Generating TypeScript proto files..."
	@mkdir -p generated
	@npx protoc --ts_out=./generated --proto_path=../../../PUBLIC-platform-proto/ ../../../PUBLIC-platform-proto/world.proto --ts_opt=generate_dependencies,long_type_string

install:
	@echo "Installing dependencies..."
	@bun install

run: generate
	@echo "Running push-entities script..."
	@bun run push-entities.ts

clean:
	@echo "Cleaning generated files..."
	@rm -rf generated node_modules bun.lockb
