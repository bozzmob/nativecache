export class RedisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisError";
  }
}

export const WRONGTYPE_ERROR =
  "WRONGTYPE Operation against a key holding the wrong kind of value";
