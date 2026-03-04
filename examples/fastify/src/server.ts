import fastify from "fastify";
import { createClient, type RedisValue } from "flashstore";

const PORT = Number(process.env.PORT ?? 3001);

function parseTtlSeconds(input: unknown): number | undefined {
  if (input === undefined || input === null) return undefined;
  const value = Number(input);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    const error = new Error("ttlSeconds must be a positive integer");
    (error as { statusCode?: number }).statusCode = 400;
    throw error;
  }
  return value;
}

function parseValue(input: unknown): RedisValue {
  if (typeof input === "string" || typeof input === "number") return input;
  const error = new Error("value must be a string or number");
  (error as { statusCode?: number }).statusCode = 400;
  throw error;
}

async function bootstrap() {
  const client = createClient({ persistence: true });
  await client.connect();

  const app = fastify({ logger: true });

  app.addHook("onClose", async () => {
    await client.disconnect();
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get<{ Params: { key: string } }>("/cache/:key", async (request, reply) => {
    const value = await client.get(request.params.key);
    if (value === null) {
      reply.code(404);
      return { error: "Not found" };
    }
    return { key: request.params.key, value };
  });

  app.put<{ Params: { key: string }; Body: { value?: RedisValue; ttlSeconds?: number } }>(
    "/cache/:key",
    async (request) => {
      const rawValue = request.body?.value;
      if (rawValue === undefined) {
        const error = new Error("value is required");
        (error as { statusCode?: number }).statusCode = 400;
        throw error;
      }
      const value = parseValue(rawValue);
      const ttlSeconds = parseTtlSeconds(request.body?.ttlSeconds);
      if (ttlSeconds !== undefined) {
        await client.set(request.params.key, value, { EX: ttlSeconds });
      } else {
        await client.set(request.params.key, value);
      }
      return { ok: true };
    }
  );

  app.delete<{ Params: { key: string } }>("/cache/:key", async (request) => {
    const removed = await client.del(request.params.key);
    return { removed };
  });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    reply.code(statusCode).send({ error: error.message || "Internal Server Error" });
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

void bootstrap();
