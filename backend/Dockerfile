FROM rust:1-bookworm AS build
WORKDIR /build
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY backend/sql ./sql
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/target \
    cargo build --locked --release && cp target/release/correctional-healthcare-api /build/api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build /build/api /app/api
USER app
ENV BIND_ADDRESS=0.0.0.0:8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD curl --fail http://localhost:8000/health || exit 1
CMD ["/app/api"]
