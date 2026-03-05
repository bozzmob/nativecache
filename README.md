# NativeCache

NativeCache is a Redis-like, in-memory key-value store written in TypeScript with a Promise API.
It is designed for local development, tests, and app-level caching where you want Redis-style commands without running a Redis server.

## Table Of Contents
- [Install](#install)
- [Quick Start](#quick-start)
- [What NativeCache Implements](#what-nativecache-implements)
- [Exports](#exports)
- [createClient](#createclient)
- [ClientOptions](#clientoptions)
- [Persistence](#persistence)
- [RedisClient API](#redisclient-api)
- [Connection And Lifecycle](#connection-and-lifecycle)
- [String Commands](#string-commands)
- [Keyspace Commands](#keyspace-commands)
- [Expiration Commands](#expiration-commands)
- [Hash Commands](#hash-commands)
- [List Commands](#list-commands)
- [Set Commands](#set-commands)
- [Sorted Set Commands](#sorted-set-commands)
- [Transactions With RedisMulti](#transactions-with-redismulti)
- [Error Handling](#error-handling)
- [Example Projects](#example-projects)
- [Notes And Behavior](#notes-and-behavior)
- [License](#license)

## Install
```bash
npm install nativecache
```

## Quick Start
```ts
import { createClient } from "nativecache";

const client = createClient({ autoConnect: true, persistence: true });

await client.set("user:1", "Ada", { EX: 60 });
console.log(await client.get("user:1")); // "Ada"

const result = await client
  .multi()
  .set("counter", 1)
  .incr("counter")
  .get("counter")
  .exec();

console.log(result); // ["OK", 2, "2"]
await client.disconnect();
```

## What NativeCache Implements
- Strings
- Hashes
- Lists
- Sets
- Sorted sets (ZSET)
- TTL and expiration scheduling
- Multi-command queue (`multi().exec()`)
- Optional filesystem snapshot persistence

## Exports
```ts
import {
  createClient,
  RedisClient,
  RedisMulti,
  RedisError,
  defaultPersistencePath,
  type ClientOptions,
  type PersistenceOptions,
  type RedisValue,
  type SetOptions,
  type ZAddItem,
  type ZRangeOptions,
  type ZRangeResult
} from "nativecache";
```

## createClient
Signature:
```ts
createClient(options?: ClientOptions): RedisClient
```

Example:
```ts
import { createClient } from "nativecache";

const client = createClient({ autoConnect: true, keyPrefix: "app:" });
```

## ClientOptions
```ts
interface ClientOptions {
  database?: number;
  keyPrefix?: string;
  isolated?: boolean;
  autoConnect?: boolean;
  persistence?: boolean | PersistenceOptions;
}
```

```ts
interface PersistenceOptions {
  path?: string;
  flushIntervalMs?: number;
}
```

Behavior:
- `database`: DB index from `0` to `15`.
- `keyPrefix`: Prefix applied to every key command.
- `isolated`: If `true`, client uses a private in-memory server state.
- `autoConnect`: If `true`, calls `connect()` automatically on next microtask.
- `persistence`: Enables JSON snapshot persistence.

## Persistence
If enabled, snapshots are written to local filesystem.

Default path:
- `defaultPersistencePath()` returns `<process.cwd()>/.nativecache/snapshot.json`

Persistence config example:
```ts
import { createClient } from "nativecache";

const client = createClient({
  autoConnect: true,
  persistence: {
    path: "./data/nativecache.snapshot.json",
    flushIntervalMs: 100
  }
});
```

Manual persistence controls:
```ts
await client.save(); // force immediate snapshot write
await client.load(); // reload snapshot from disk
```

Important behavior:
- `flushIntervalMs` default is `50` ms, accepts non-negative integers.
- `flushIntervalMs: 0` writes immediately after each mutation.
- Snapshot writes are atomic (temp file + rename).
- On `connect()`, snapshot is loaded once.
- On `disconnect()`, pending snapshot is flushed.
- For clients sharing the same non-isolated server, persistence options must match.

## RedisClient API
All methods below are async unless otherwise noted.

## Connection And Lifecycle
| Method | Return Type | Example |
|---|---|---|
| `connect()` | `Promise<void>` | `await client.connect();` |
| `disconnect()` | `Promise<void>` | `await client.disconnect();` |
| `quit()` | `Promise<"OK">` | `await client.quit();` |
| `duplicate(options?)` | `RedisClient` | `const copy = client.duplicate({ keyPrefix: "worker:" });` |
| `select(index)` | `Promise<"OK">` | `await client.select(1);` |
| `save()` | `Promise<"OK">` | `await client.save();` |
| `load()` | `Promise<"OK">` | `await client.load();` |
| `isOpen` (property) | `boolean` | `console.log(client.isOpen);` |

## String Commands
| Method | Return Type | Example |
|---|---|---|
| `get(key)` | `Promise<string \| null>` | `const v = await client.get("name");` |
| `set(key, value, options?)` | `Promise<"OK" \| null>` | `await client.set("name", "Ada", { NX: true });` |
| `mGet(keys)` | `Promise<Array<string \| null>>` | `const values = await client.mGet(["a", "b"]);` |
| `mSet(entries)` | `Promise<"OK">` | `await client.mSet({ a: 1, b: 2 });` |
| `append(key, value)` | `Promise<number>` | `const len = await client.append("msg", "!");` |
| `strlen(key)` | `Promise<number>` | `const len = await client.strlen("msg");` |
| `getRange(key, start, stop)` | `Promise<string>` | `const sub = await client.getRange("msg", 0, 4);` |
| `setRange(key, offset, value)` | `Promise<number>` | `await client.setRange("msg", 6, "flash");` |
| `incr(key)` | `Promise<number>` | `await client.incr("counter");` |
| `decr(key)` | `Promise<number>` | `await client.decr("counter");` |
| `incrBy(key, increment)` | `Promise<number>` | `await client.incrBy("counter", 10);` |
| `decrBy(key, decrement)` | `Promise<number>` | `await client.decrBy("counter", 2);` |

`set` options:
```ts
interface SetOptions {
  EX?: number;   // TTL in seconds
  PX?: number;   // TTL in milliseconds
  EXAT?: number; // UNIX time in seconds
  PXAT?: number; // UNIX time in milliseconds
  KEEPTTL?: boolean;
  NX?: boolean;
  XX?: boolean;
}
```

Set options example:
```ts
await client.set("token", "abc", { EX: 60, NX: true });
```

## Keyspace Commands
| Method | Return Type | Example |
|---|---|---|
| `del(...keys)` | `Promise<number>` | `await client.del("a", "b");` |
| `exists(...keys)` | `Promise<number>` | `await client.exists("a", "b", "c");` |
| `type(key)` | `Promise<"none" \| "string" \| "hash" \| "list" \| "set" \| "zset">` | `await client.type("a");` |
| `keys(pattern?)` | `Promise<string[]>` | `await client.keys("user:*");` |
| `dbSize()` | `Promise<number>` | `await client.dbSize();` |
| `flushDb()` | `Promise<"OK">` | `await client.flushDb();` |

`keys(pattern)` supports glob patterns such as `*`, `?`, character sets `[abc]`, and negated sets `[!abc]`.

## Expiration Commands
| Method | Return Type | Example |
|---|---|---|
| `expire(key, seconds)` | `Promise<number>` | `await client.expire("session", 60);` |
| `pExpire(key, milliseconds)` | `Promise<number>` | `await client.pExpire("session", 1500);` |
| `expireAt(key, unixSeconds)` | `Promise<number>` | `await client.expireAt("session", Math.floor(Date.now() / 1000) + 30);` |
| `pExpireAt(key, unixMilliseconds)` | `Promise<number>` | `await client.pExpireAt("session", Date.now() + 30000);` |
| `ttl(key)` | `Promise<number>` | `const ttl = await client.ttl("session");` |
| `pTtl(key)` | `Promise<number>` | `const pttl = await client.pTtl("session");` |
| `persist(key)` | `Promise<number>` | `await client.persist("session");` |

`ttl`/`pTtl` semantics:
- `-2`: key does not exist
- `-1`: key exists without expiry

## Hash Commands
| Method | Return Type | Example |
|---|---|---|
| `hSet(key, field, value)` | `Promise<number>` | `await client.hSet("user:1", "name", "Ada");` |
| `hSet(key, valuesObject)` | `Promise<number>` | `await client.hSet("user:1", { role: "engineer", level: 5 });` |
| `hGet(key, field)` | `Promise<string \| null>` | `await client.hGet("user:1", "name");` |
| `hDel(key, ...fields)` | `Promise<number>` | `await client.hDel("user:1", "role", "level");` |
| `hGetAll(key)` | `Promise<Record<string, string>>` | `await client.hGetAll("user:1");` |
| `hExists(key, field)` | `Promise<number>` | `await client.hExists("user:1", "name");` |
| `hLen(key)` | `Promise<number>` | `await client.hLen("user:1");` |
| `hIncrBy(key, field, increment)` | `Promise<number>` | `await client.hIncrBy("user:1", "visits", 1);` |

## List Commands
| Method | Return Type | Example |
|---|---|---|
| `lPush(key, ...values)` | `Promise<number>` | `await client.lPush("jobs", "a", "b");` |
| `rPush(key, ...values)` | `Promise<number>` | `await client.rPush("jobs", "c");` |
| `lPop(key)` | `Promise<string \| null>` | `await client.lPop("jobs");` |
| `rPop(key)` | `Promise<string \| null>` | `await client.rPop("jobs");` |
| `lLen(key)` | `Promise<number>` | `await client.lLen("jobs");` |
| `lRange(key, start, stop)` | `Promise<string[]>` | `await client.lRange("jobs", 0, -1);` |

## Set Commands
| Method | Return Type | Example |
|---|---|---|
| `sAdd(key, ...members)` | `Promise<number>` | `await client.sAdd("tags", "a", "b", "c");` |
| `sRem(key, ...members)` | `Promise<number>` | `await client.sRem("tags", "c");` |
| `sMembers(key)` | `Promise<string[]>` | `await client.sMembers("tags");` |
| `sIsMember(key, member)` | `Promise<number>` | `await client.sIsMember("tags", "a");` |
| `sCard(key)` | `Promise<number>` | `await client.sCard("tags");` |
| `sPop(key)` | `Promise<string \| null>` | `await client.sPop("tags");` |

## Sorted Set Commands
| Method | Return Type | Example |
|---|---|---|
| `zAdd(key, itemOrItems)` | `Promise<number>` | `await client.zAdd("scores", { value: "u1", score: 100 });` |
| `zRem(key, ...members)` | `Promise<number>` | `await client.zRem("scores", "u1");` |
| `zScore(key, member)` | `Promise<number \| null>` | `await client.zScore("scores", "u1");` |
| `zIncrBy(key, increment, member)` | `Promise<number>` | `await client.zIncrBy("scores", 5, "u1");` |
| `zRange(key, start, stop, options?)` | `Promise<ZRangeResult>` | `await client.zRange("scores", 0, -1, { WITHSCORES: true });` |
| `zRank(key, member, rev?)` | `Promise<number \| null>` | `await client.zRank("scores", "u1", true);` |
| `zCard(key)` | `Promise<number>` | `await client.zCard("scores");` |

Sorted set types:
```ts
interface ZAddItem {
  value: string;
  score: number;
}

interface ZRangeOptions {
  REV?: boolean;
  WITHSCORES?: boolean;
}

type ZRangeResult = string[] | Array<{ value: string; score: number }>;
```

## Transactions With RedisMulti
Create a queue with `client.multi()`, then execute with `exec()`.

```ts
const tx = client.multi();
tx.set("counter", 1);
tx.incr("counter");
tx.get("counter");
const results = await tx.exec();
```

`RedisMulti` API:
| Method | Return Type | Example |
|---|---|---|
| `get(key)` | `RedisMulti` | `client.multi().get("k")` |
| `set(key, value, options?)` | `RedisMulti` | `client.multi().set("k", "v")` |
| `del(...keys)` | `RedisMulti` | `client.multi().del("a", "b")` |
| `incr(key)` | `RedisMulti` | `client.multi().incr("counter")` |
| `decr(key)` | `RedisMulti` | `client.multi().decr("counter")` |
| `hSet(key, field, value)` | `RedisMulti` | `client.multi().hSet("h", "f", "v")` |
| `hGet(key, field)` | `RedisMulti` | `client.multi().hGet("h", "f")` |
| `lPush(key, ...values)` | `RedisMulti` | `client.multi().lPush("list", "a")` |
| `rPush(key, ...values)` | `RedisMulti` | `client.multi().rPush("list", "b")` |
| `sAdd(key, ...members)` | `RedisMulti` | `client.multi().sAdd("set", "x")` |
| `zAdd(key, itemOrItems)` | `RedisMulti` | `client.multi().zAdd("z", { value: "a", score: 1 })` |
| `exec()` | `Promise<unknown[]>` | `await client.multi().get("k").exec()` |

## Error Handling
NativeCache throws `RedisError` for invalid command usage and type conflicts.

Example:
```ts
import { RedisError } from "nativecache";

try {
  await client.lPush("list", "a");
  await client.get("list");
} catch (error) {
  if (error instanceof RedisError) {
    console.error(error.message);
  }
}
```

Common error cases:
- Wrong type operation (for example calling `get` on a hash key).
- Invalid integer arguments (`incrBy`, `hIncrBy`, TTL fields).
- Invalid float values for sorted set scores.
- Incompatible `SET` options (`NX` + `XX`, or `KEEPTTL` with `EX`/`PX`/`EXAT`/`PXAT`).

## Example Projects
Framework examples live in `/examples`:
- `examples/express`
- `examples/fastify`
- `examples/nestjs`

Each example uses:
```ts
createClient({ persistence: true })
```

Run examples:
```bash
cd examples/express && npm install && npm run dev
cd examples/fastify && npm install && npm run dev
cd examples/nestjs && npm install && npm run start
```

Common HTTP endpoints:
- `GET /health`
- `GET /cache/:key`
- `PUT /cache/:key` with `{ "value": "...", "ttlSeconds": 60 }`
- `DELETE /cache/:key`

## Notes And Behavior
- Data is in-memory first; persistence is optional JSON snapshotting.
- Non-isolated clients share one in-process server state.
- `Buffer` values are stored as UTF-8 strings.
- Integer commands enforce safe integer bounds.
- TTL precision is milliseconds.
- NativeCache is not a Redis network server and does not speak the Redis TCP protocol.

## License
MIT
