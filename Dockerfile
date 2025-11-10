# Build stage
FROM golang:1.25-alpine AS builder
RUN apk add --no-cache git make npm unzip curl bash
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /build
COPY . .
RUN make aio

# Runtime stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /build/hydra .
EXPOSE 50051
ENTRYPOINT ["./hydra"]
