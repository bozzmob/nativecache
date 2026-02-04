# Flashstore Examples

This folder contains three standalone integrations that use `flashstore` as an in-memory Redis-compatible store.

## Express
Location: `examples/express`

## Fastify
Location: `examples/fastify`

## NestJS
Location: `examples/nestjs`

## Running locally
Each example uses the published `flashstore` package from npm. Install and run the example directly.

1. In the example folder, run `npm install`.
2. Start the app with `npm run dev`.

Endpoints are consistent across frameworks:
- `GET /health`
- `GET /cache/:key`
- `PUT /cache/:key` with JSON `{ "value": "...", "ttlSeconds": 60 }` (value is string or number)
- `DELETE /cache/:key`
