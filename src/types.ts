export type RedisValue = string | number | Buffer;

export type KeyType = "string" | "hash" | "list" | "set" | "zset";

export interface SetOptions {
  EX?: number; // seconds
  PX?: number; // milliseconds
  EXAT?: number; // unix seconds
  PXAT?: number; // unix milliseconds
  KEEPTTL?: boolean;
  NX?: boolean;
  XX?: boolean;
}

export interface ClientOptions {
  database?: number;
  keyPrefix?: string;
  isolated?: boolean;
  autoConnect?: boolean;
  persistence?: boolean | PersistenceOptions;
}

export interface PersistenceOptions {
  path?: string;
  flushIntervalMs?: number;
}

export interface ZAddItem {
  score: number;
  value: string;
}

export interface ZRangeOptions {
  REV?: boolean;
  WITHSCORES?: boolean;
}

export type ZRangeResult = string[] | Array<{ value: string; score: number }>;
