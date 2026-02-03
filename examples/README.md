# Flashstore Examples

This folder contains three standalone integrations that use `flashstore` as an in-memory Redis-compatible store.

## Express
Location: `examples/express`

## Fastify
Location: `examples/fastify`

## NestJS
Location: `examples/nestjs`

## Running locally
Each example uses `flashstore` via a local file dependency. Build the root library first, then install and run the example.

1. From the repo root, run `npm run build`.
2. In the example folder, run `npm install`.
3. Start the app with `npm run dev`.

Endpoints are consistent across frameworks:
- `GET /health`
- `GET /cache/:key`
- `PUT /cache/:key` with JSON `{ "value": "...", "ttlSeconds": 60 }` (value is string or number)
- `DELETE /cache/:key`
