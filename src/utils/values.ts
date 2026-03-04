import { RedisError } from "../errors";
import type { RedisValue } from "../types";

export function toRedisString(value: RedisValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString(10);
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

export function parseInteger(value: string, command: string): number {
  if (!/^[+-]?\d+$/.test(value)) {
    throw new RedisError(`ERR value is not an integer or out of range for ${command}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RedisError(`ERR value is not an integer or out of range for ${command}`);
  }
  return parsed;
}

export function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RedisError(`ERR ${name} is not an integer or out of range`);
  }
}

export function assertPositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RedisError(`ERR ${name} must be a positive number`);
  }
}

export function assertNonNegativeNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RedisError(`ERR ${name} must be a non-negative number`);
  }
}

export function assertPositiveInteger(value: number, name: string): void {
  assertSafeInteger(value, name);
  if (value <= 0) {
    throw new RedisError(`ERR ${name} must be a positive number`);
  }
}

export function assertNonNegativeInteger(value: number, name: string): void {
  assertSafeInteger(value, name);
  if (value < 0) {
    throw new RedisError(`ERR ${name} must be a non-negative number`);
  }
}
