import express, { type NextFunction, type Request, type Response } from "express";
import { createClient, type RedisValue } from "flashstore";

const PORT = Number(process.env.PORT ?? 3000);

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function parseTtlSeconds(input: unknown): number | undefined {
  if (input === undefined || input === null) return undefined;
  const value = Number(input);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, "ttlSeconds must be a positive integer");
  }
  return value;
}

function parseValue(input: unknown): RedisValue {
  if (typeof input === "string" || typeof input === "number") return input;
  throw new HttpError(400, "value must be a string or number");
}

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

async function bootstrap() {
  const client = createClient({ persistence: true });
  await client.connect();

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get(
    "/cache/:key",
    asyncHandler(async (req, res) => {
      const key = req.params.key;
      if (!key) throw new HttpError(400, "key is required");
      const value = await client.get(key);
      if (value === null) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ key, value });
    })
  );

  app.put(
    "/cache/:key",
    asyncHandler(async (req, res) => {
      const key = req.params.key;
      if (!key) throw new HttpError(400, "key is required");
      const body = req.body as { value?: RedisValue; ttlSeconds?: number } | undefined;
      const rawValue = body?.value;
      if (rawValue === undefined) {
        throw new HttpError(400, "value is required");
      }
      const value = parseValue(rawValue);
      const ttlSeconds = parseTtlSeconds(body?.ttlSeconds);
      if (ttlSeconds !== undefined) {
        await client.set(key, value, { EX: ttlSeconds });
      } else {
        await client.set(key, value);
      }
      res.json({ ok: true });
    })
  );

  app.delete(
    "/cache/:key",
    asyncHandler(async (req, res) => {
      const key = req.params.key;
      if (!key) throw new HttpError(400, "key is required");
      const removed = await client.del(key);
      res.json({ removed });
    })
  );

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Internal Server Error" });
  });

  const server = app.listen(PORT, () => {
    console.log(`Flashstore Express example listening on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await client.disconnect();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void bootstrap();
