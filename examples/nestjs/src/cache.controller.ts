import { BadRequestException, Controller, Delete, Get, NotFoundException, Param, Put, Body } from "@nestjs/common";
import type { RedisValue } from "nativecache";
import { CacheService } from "./cache.service";

function parseTtlSeconds(input: unknown): number | undefined {
  if (input === undefined || input === null) return undefined;
  const value = Number(input);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException("ttlSeconds must be a positive integer");
  }
  return value;
}

function parseValue(input: unknown): RedisValue {
  if (typeof input === "string" || typeof input === "number") return input;
  throw new BadRequestException("value must be a string or number");
}

@Controller()
export class CacheController {
  constructor(private readonly cache: CacheService) {}

  @Get("health")
  health() {
    return { status: "ok" };
  }

  @Get("cache/:key")
  async get(@Param("key") key: string) {
    const value = await this.cache.get(key);
    if (value === null) {
      throw new NotFoundException("Not found");
    }
    return { key, value };
  }

  @Put("cache/:key")
  async put(
    @Param("key") key: string,
    @Body() body: { value?: RedisValue; ttlSeconds?: number }
  ) {
    const rawValue = body?.value;
    if (rawValue === undefined) {
      throw new BadRequestException("value is required");
    }
    const value = parseValue(rawValue);
    const ttlSeconds = parseTtlSeconds(body?.ttlSeconds);
    await this.cache.set(key, value, ttlSeconds);
    return { ok: true };
  }

  @Delete("cache/:key")
  async remove(@Param("key") key: string) {
    const removed = await this.cache.del(key);
    return { removed };
  }
}
