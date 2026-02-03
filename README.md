# Flashstore

Flashstore is a fully in-memory, TypeScript-first Redis-compatible drop-in replacement aimed at local development, tests, and edge runtimes. It implements a high-performance keyspace with TTL scheduling, common data structures, and a Promise-based API that mirrors the popular `redis` client.

## Highlights
- Pure TypeScript, zero runtime dependencies
- Promise-based API similar to `redis` (v4)
- String, hash, list, set, and sorted set support
- Expiration scheduler with lazy + timed eviction
- Multi/transaction-style command batching via `multi()`

## Install

```bash
npm install flashstore
```

## Usage

```ts
import { createClient } from "flashstore";

const client = createClient({ autoConnect: true });

await client.set("user:1", "Ada", { EX: 60 });
const value = await client.get("user:1");
console.log(value); // "Ada"

await client.hSet("profile:1", { name: "Ada", title: "Engineer" });
const profile = await client.hGetAll("profile:1");
console.log(profile);

const pipeline = client.multi();
const results = await pipeline
  .set("counter", 1)
  .incr("counter")
  .get("counter")
  .exec();

console.log(results); // ["OK", 2, "2"]
```

## Supported commands

- Strings: `GET`, `SET`, `MGET`, `MSET`, `APPEND`, `STRLEN`, `GETRANGE`, `SETRANGE`, `INCR`, `DECR`, `INCRBY`
- Keyspace: `DEL`, `EXISTS`, `TYPE`, `KEYS`, `DBSIZE`, `FLUSHDB`
- Expiration: `EXPIRE`, `PEXPIRE`, `EXPIREAT`, `PEXPIREAT`, `TTL`, `PTTL`, `PERSIST`
- Hashes: `HSET`, `HGET`, `HDEL`, `HGETALL`, `HEXISTS`, `HLEN`, `HINCRBY`
- Lists: `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `LLEN`, `LRANGE`
- Sets: `SADD`, `SREM`, `SMEMBERS`, `SISMEMBER`, `SCARD`, `SPOP`
- Sorted sets: `ZADD`, `ZREM`, `ZSCORE`, `ZINCRBY`, `ZRANGE`, `ZRANK`, `ZCARD`

## Notes
- This is an in-memory store intended for development and tests. It does not implement Redis networking or persistence.
- Values are stored as UTF-8 strings internally; `Buffer` values are converted to strings.
- TTL precision is millisecond based, using a min-heap scheduler + lazy eviction on access.

## License

MIT
