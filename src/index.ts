export { createClient, RedisClient, RedisMulti } from "./client";
export { defaultPersistencePath } from "./persistence";
export { RedisError } from "./errors";
export type {
  ClientOptions,
  PersistenceOptions,
  RedisValue,
  SetOptions,
  ZAddItem,
  ZRangeOptions,
  ZRangeResult
} from "./types";
