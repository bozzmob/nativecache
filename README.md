# Flashstore

Flashstore is a fully in-memory, TypeScript-first Redis-compatible drop-in replacement aimed at local development, tests, and edge runtimes. It implements a high-performance keyspace with TTL scheduling, common data structures, and a Promise-based API that mirrors the popular `redis` client.

## Table of Contents
- [Install](#install)
- [Quickstart](#quickstart)
- [Examples](#examples)
- [API Reference](#api-reference)
- [Connection](#connection)
- [Strings](#strings)
- [Hashes](#hashes)
- [Lists](#lists)
- [Sets](#sets)
- [Sorted Sets](#sorted-sets)
- [Transactions](#transactions)
- [Notes](#notes)
- [License](#license)

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

## Quickstart
```ts
import { createClient } from "flashstore";

const client = createClient({ autoConnect: true });

await client.set("user:1", "Ada", { EX: 60 });
const value = await client.get("user:1");
console.log(value); // "Ada"

const pipeline = client.multi();
const results = await pipeline
  .set("counter", 1)
  .incr("counter")
  .get("counter")
  .exec();

console.log(results); // ["OK", 2, "2"]
```

## Examples
Standalone example apps live in `examples/` and are wired for local development with `"flashstore": "file:../.."`.
After publishing to npm, replace that dependency with a version range such as `"flashstore": "^0.1.0"` in each example.

### Express Example
Location: `examples/express`
1. `cd examples/express`
2. `npm install`
3. `npm run dev`

### Fastify Example
Location: `examples/fastify`
1. `cd examples/fastify`
2. `npm install`
3. `npm run dev`

### NestJS Example
Location: `examples/nestjs`
1. `cd examples/nestjs`
2. `npm install`
3. `npm run start`

### Common Endpoints
- `GET /health`
- `GET /cache/:key`
- `PUT /cache/:key` with JSON `{ "value": "...", "ttlSeconds": 60 }`
- `DELETE /cache/:key`

## API Reference
All client methods are async. Call `await client.connect()` unless you pass `autoConnect: true`.

### Create Client
`createClient(options?: ClientOptions): RedisClient`

Example:
```ts
import { createClient } from "flashstore";

const client = createClient({ autoConnect: true, keyPrefix: "app:" });
```

### Client Options
1. `database?: number` selects the logical database (0-15).
2. `keyPrefix?: string` prefixes all keys transparently.
3. `isolated?: boolean` creates a private in-memory server per client.
4. `autoConnect?: boolean` connects automatically on the next tick.

### Connection
1. `connect()` opens the client and emits `connect` and `ready`.
2. `disconnect()` closes the client and emits `end`.
3. `quit()` closes the client and returns `"OK"`.
4. `duplicate(options?)` clones the client, sharing the same server state.
5. `select(index)` switches databases and returns `"OK"`.
6. `isOpen` indicates whether the client is connected.

Example:
```ts
const client = createClient();
await client.connect();
const isOpen = client.isOpen;
const replica = client.duplicate({ keyPrefix: "shadow:" });
await client.select(1);
await client.quit();
await replica.disconnect();
```

### Strings
1. `get(key)` returns the string value or `null`.
2. `set(key, value, options?)` sets a string value and returns `"OK"` or `null` with `NX`/`XX`.
3. `mGet(keys)` returns an array of values or `null` per key.
4. `mSet(entries)` sets many values from an array or object and returns `"OK"`.
5. `append(key, value)` appends and returns the new length.
6. `strlen(key)` returns the length or 0 when missing.
7. `getRange(key, start, stop)` returns a substring.
8. `setRange(key, offset, value)` overwrites at offset and returns length.
9. `incr(key)` increments by 1 and returns the new number.
10. `decr(key)` decrements by 1 and returns the new number.
11. `incrBy(key, increment)` increments by the given amount.
12. `decrBy(key, decrement)` decrements by the given amount.

Example:
```ts
await client.set("greet", "hello");
await client.set("greet", "hello", { NX: true });
await client.set("greet", "hello", { XX: true });
await client.set("greet", "hello", { EX: 10 });
await client.set("greet", "hello", { PX: 500 });
await client.set("greet", "hello", { EXAT: 1700000000 });
await client.set("greet", "hello", { PXAT: Date.now() + 5000 });
await client.set("greet", "hello", { KEEPTTL: true });

await client.append("greet", "!");
const len = await client.strlen("greet");
const sub = await client.getRange("greet", 0, 4);
await client.setRange("greet", 6, "flash");

const a = await client.incr("counter");
const b = await client.decr("counter");
const c = await client.incrBy("counter", 5);
const d = await client.decrBy("counter", 2);

const values = await client.mGet(["a", "b"]);
await client.mSet({ a: 1, b: 2 });
await client.mSet([["c", 3], ["d", 4]]);
```

### Set Options
1. `EX` sets TTL in seconds.
2. `PX` sets TTL in milliseconds.
3. `EXAT` sets TTL at a UNIX timestamp (seconds).
4. `PXAT` sets TTL at a UNIX timestamp (milliseconds).
5. `KEEPTTL` keeps the current TTL.
6. `NX` sets only if the key does not exist.
7. `XX` sets only if the key already exists.

Example:
```ts
await client.set("token", "abc", { EX: 60, NX: true });
```

### Keyspace
1. `del(...keys)` deletes keys and returns the count removed.
2. `exists(...keys)` returns how many keys exist.
3. `type(key)` returns `"string" | "hash" | "list" | "set" | "zset" | "none"`.
4. `keys(pattern)` returns matching keys with glob-style patterns.
5. `dbSize()` returns the number of keys in the current DB.
6. `flushDb()` clears the current DB and returns `"OK"`.

Example:
```ts
await client.set("user:1", "a");
await client.set("user:2", "b");
const count = await client.exists("user:1", "user:3");
const kind = await client.type("user:1");
const matches = await client.keys("user:*");
const size = await client.dbSize();
const removed = await client.del("user:1", "user:2");
await client.flushDb();
```

### Expiration
1. `expire(key, seconds)` sets TTL in seconds.
2. `pExpire(key, milliseconds)` sets TTL in milliseconds.
3. `expireAt(key, unixSeconds)` expires at a UNIX time in seconds.
4. `pExpireAt(key, unixMilliseconds)` expires at a UNIX time in milliseconds.
5. `ttl(key)` returns TTL in seconds, `-1` for no TTL, `-2` for missing key.
6. `pTtl(key)` returns TTL in milliseconds.
7. `persist(key)` removes the TTL and returns 1 if removed.

Example:
```ts
await client.set("session", "abc");
await client.expire("session", 30);
await client.pExpire("session", 1000);
await client.expireAt("session", Math.floor(Date.now() / 1000) + 60);
await client.pExpireAt("session", Date.now() + 5000);
const ttl = await client.ttl("session");
const pttl = await client.pTtl("session");
const persisted = await client.persist("session");
```

### Hashes
1. `hSet(key, field, value)` sets a field and returns the number of new fields.
2. `hSet(key, values)` sets multiple fields from an object.
3. `hGet(key, field)` returns the field value or `null`.
4. `hDel(key, ...fields)` deletes fields and returns the count removed.
5. `hGetAll(key)` returns a field-value object.
6. `hExists(key, field)` returns 1 if the field exists.
7. `hLen(key)` returns the number of fields.
8. `hIncrBy(key, field, increment)` increments a field by an integer.

Example:
```ts
await client.hSet("profile", "name", "Ada");
await client.hSet("profile", { title: "Engineer", level: 5 });
const name = await client.hGet("profile", "name");
const all = await client.hGetAll("profile");
const exists = await client.hExists("profile", "name");
const len = await client.hLen("profile");
const inc = await client.hIncrBy("profile", "visits", 1);
const removed = await client.hDel("profile", "title");
```

### Lists
1. `lPush(key, ...values)` pushes to the left and returns the length.
2. `rPush(key, ...values)` pushes to the right and returns the length.
3. `lPop(key)` pops from the left or returns `null`.
4. `rPop(key)` pops from the right or returns `null`.
5. `lLen(key)` returns list length.
6. `lRange(key, start, stop)` returns a range of elements.

Example:
```ts
await client.lPush("queue", "a", "b");
await client.rPush("queue", "c");
const left = await client.lPop("queue");
const right = await client.rPop("queue");
const length = await client.lLen("queue");
const range = await client.lRange("queue", 0, -1);
```

### Sets
1. `sAdd(key, ...members)` adds members and returns the count added.
2. `sRem(key, ...members)` removes members and returns the count removed.
3. `sMembers(key)` returns all members.
4. `sIsMember(key, member)` returns 1 if present.
5. `sCard(key)` returns set cardinality.
6. `sPop(key)` removes and returns a random member or `null`.

Example:
```ts
await client.sAdd("tags", "a", "b", "c");
const members = await client.sMembers("tags");
const isMember = await client.sIsMember("tags", "b");
const card = await client.sCard("tags");
const popped = await client.sPop("tags");
const removed = await client.sRem("tags", "c");
```

### Sorted Sets
1. `zAdd(key, item | items)` adds members and returns count added.
2. `zRem(key, ...members)` removes members and returns count removed.
3. `zScore(key, member)` returns the score or `null`.
4. `zIncrBy(key, increment, member)` increments a score.
5. `zRange(key, start, stop, options?)` returns members or entries.
6. `zRank(key, member, rev?)` returns rank or `null`.
7. `zCard(key)` returns cardinality.

Example:
```ts
await client.zAdd("leaderboard", { value: "a", score: 1 });
await client.zAdd("leaderboard", [
  { value: "b", score: 3 },
  { value: "c", score: 2 }
]);
const range = await client.zRange("leaderboard", 0, -1);
const reverse = await client.zRange("leaderboard", 0, 1, { REV: true });
const withScores = await client.zRange("leaderboard", 0, -1, { WITHSCORES: true });
const score = await client.zScore("leaderboard", "a");
const newScore = await client.zIncrBy("leaderboard", 5, "a");
const rank = await client.zRank("leaderboard", "a");
const revRank = await client.zRank("leaderboard", "a", true);
const count = await client.zCard("leaderboard");
const removed = await client.zRem("leaderboard", "b");
```

### ZRange Options
1. `REV` returns results in descending order.
2. `WITHSCORES` returns `{ value, score }` objects.

Example:
```ts
const entries = await client.zRange("leaderboard", 0, -1, { WITHSCORES: true, REV: true });
```

### Transactions
`multi()` returns a `RedisMulti` pipeline that queues commands and runs them in order with `exec()`.

1. `get(key)`
2. `set(key, value, options?)`
3. `del(...keys)`
4. `incr(key)`
5. `decr(key)`
6. `hSet(key, field, value)`
7. `hGet(key, field)`
8. `lPush(key, ...values)`
9. `rPush(key, ...values)`
10. `sAdd(key, ...members)`
11. `zAdd(key, item | items)`
12. `exec()` returns an array of results

Example:
```ts
const results = await client
  .multi()
  .set("counter", 1)
  .incr("counter")
  .get("counter")
  .exec();
```

### Errors
`RedisError` is thrown for invalid operations (wrong key type, invalid options, non-integer increments).

Example:
```ts
try {
  await client.lPush("list", "a");
  await client.get("list");
} catch (err) {
  if (err instanceof Error) {
    console.error(err.message);
  }
}
```

### Types
1. `RedisValue` is `string | number | Buffer`.
2. `ZAddItem` is `{ value: string; score: number }`.
3. `ZRangeOptions` is `{ REV?: boolean; WITHSCORES?: boolean }`.
4. `ZRangeResult` is `string[] | Array<{ value: string; score: number }>`.

Example:
```ts
const scoreItem = { value: "user:1", score: 100 };
await client.zAdd("scores", scoreItem);
```

## Notes
- This is an in-memory store intended for development and tests. It does not implement Redis networking or persistence.
- Values are stored as UTF-8 strings internally; `Buffer` values are converted to strings.
- TTL precision is millisecond based, using a min-heap scheduler + lazy eviction on access.

## License
MIT
