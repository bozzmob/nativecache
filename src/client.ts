import { EventEmitter } from "node:events";
import { RedisError } from "./errors";
import { Keyspace, ServerState } from "./keyspace";
import type { ClientOptions, RedisValue, SetOptions, ZAddItem, ZRangeOptions, ZRangeResult } from "./types";

const sharedServer = new ServerState();

export class RedisClient extends EventEmitter {
  private server: ServerState;
  private dbIndex: number;
  private keyPrefix: string;
  public isOpen = false;

  constructor(options: ClientOptions = {}, server?: ServerState) {
    super();
    this.server = server ?? (options.isolated ? new ServerState() : sharedServer);
    this.dbIndex = options.database ?? 0;
    this.keyPrefix = options.keyPrefix ?? "";
    if (options.autoConnect) {
      queueMicrotask(() => {
        void this.connect();
      });
    }
  }

  private ensureOpen(): void {
    if (!this.isOpen) {
      throw new RedisError("ERR Client is closed");
    }
  }

  private keyspace(): Keyspace {
    return this.server.getKeyspace(this.dbIndex);
  }

  private prefix(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}${key}` : key;
  }

  private prefixKeys(keys: string[]): string[] {
    if (!this.keyPrefix) return keys;
    return keys.map((key) => `${this.keyPrefix}${key}`);
  }

  async connect(): Promise<void> {
    if (this.isOpen) return;
    this.keyspace();
    this.isOpen = true;
    this.emit("connect");
    this.emit("ready");
  }

  async disconnect(): Promise<void> {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.emit("end");
  }

  async quit(): Promise<"OK"> {
    await this.disconnect();
    return "OK";
  }

  duplicate(options: ClientOptions = {}): RedisClient {
    return new RedisClient(
      {
        database: this.dbIndex,
        keyPrefix: this.keyPrefix,
        isolated: false,
        autoConnect: this.isOpen,
        ...options
      },
      this.server
    );
  }

  async select(index: number): Promise<"OK"> {
    this.ensureOpen();
    this.keyspace().select(index);
    this.dbIndex = index;
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    this.ensureOpen();
    return this.keyspace().get(this.prefix(key));
  }

  async set(key: string, value: RedisValue, options?: SetOptions): Promise<"OK" | null> {
    this.ensureOpen();
    return this.keyspace().set(this.prefix(key), value, options);
  }

  async mGet(keys: string[]): Promise<Array<string | null>> {
    this.ensureOpen();
    return this.keyspace().mGet(this.prefixKeys(keys));
  }

  async mSet(
    entries: Array<[string, RedisValue]> | Record<string, RedisValue>
  ): Promise<"OK"> {
    this.ensureOpen();
    const pairs = Array.isArray(entries) ? entries : Object.entries(entries);
    const prefixed = pairs.map(([key, value]) => [this.prefix(key), value] as [string, RedisValue]);
    return this.keyspace().mSet(prefixed);
  }

  async append(key: string, value: RedisValue): Promise<number> {
    this.ensureOpen();
    return this.keyspace().append(this.prefix(key), value);
  }

  async strlen(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().strlen(this.prefix(key));
  }

  async getRange(key: string, start: number, stop: number): Promise<string> {
    this.ensureOpen();
    return this.keyspace().getRange(this.prefix(key), start, stop);
  }

  async setRange(key: string, offset: number, value: RedisValue): Promise<number> {
    this.ensureOpen();
    return this.keyspace().setRange(this.prefix(key), offset, value);
  }

  async incr(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().incr(this.prefix(key));
  }

  async decr(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().decr(this.prefix(key));
  }

  async incrBy(key: string, increment: number): Promise<number> {
    this.ensureOpen();
    return this.keyspace().incrBy(this.prefix(key), increment);
  }

  async decrBy(key: string, decrement: number): Promise<number> {
    this.ensureOpen();
    return this.keyspace().incrBy(this.prefix(key), -decrement);
  }

  async del(...keys: string[]): Promise<number> {
    this.ensureOpen();
    return this.keyspace().del(this.prefixKeys(keys));
  }

  async exists(...keys: string[]): Promise<number> {
    this.ensureOpen();
    return this.keyspace().exists(this.prefixKeys(keys));
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.ensureOpen();
    return this.keyspace().expire(this.prefix(key), seconds);
  }

  async pExpire(key: string, milliseconds: number): Promise<number> {
    this.ensureOpen();
    return this.keyspace().pExpire(this.prefix(key), milliseconds);
  }

  async expireAt(key: string, unixSeconds: number): Promise<number> {
    this.ensureOpen();
    return this.keyspace().expireAt(this.prefix(key), unixSeconds);
  }

  async pExpireAt(key: string, unixMilliseconds: number): Promise<number> {
    this.ensureOpen();
    return this.keyspace().pExpireAt(this.prefix(key), unixMilliseconds);
  }

  async ttl(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().ttl(this.prefix(key));
  }

  async pTtl(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().pTtl(this.prefix(key));
  }

  async persist(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().persist(this.prefix(key));
  }

  async type(key: string): Promise<"none" | "string" | "hash" | "list" | "set" | "zset"> {
    this.ensureOpen();
    return this.keyspace().typeOf(this.prefix(key));
  }

  async keys(pattern = "*"): Promise<string[]> {
    this.ensureOpen();
    const prefixed = this.keyPrefix ? `${this.keyPrefix}${pattern}` : pattern;
    const rawKeys = this.keyspace().keys(prefixed);
    if (!this.keyPrefix) return rawKeys;
    return rawKeys.map((key) => key.slice(this.keyPrefix.length));
  }

  async dbSize(): Promise<number> {
    this.ensureOpen();
    return this.keyspace().size();
  }

  async flushDb(): Promise<"OK"> {
    this.ensureOpen();
    this.keyspace().clear();
    return "OK";
  }

  async hSet(key: string, field: string, value: RedisValue): Promise<number>;
  async hSet(key: string, values: Record<string, RedisValue>): Promise<number>;
  async hSet(
    key: string,
    fieldOrValues: string | Record<string, RedisValue>,
    value?: RedisValue
  ): Promise<number> {
    this.ensureOpen();
    const prefixed = this.prefix(key);
    if (typeof fieldOrValues === "string") {
      return this.keyspace().hSet(prefixed, [[fieldOrValues, value as RedisValue]]);
    }
    const pairs = Object.entries(fieldOrValues);
    return this.keyspace().hSet(prefixed, pairs);
  }

  async hGet(key: string, field: string): Promise<string | null> {
    this.ensureOpen();
    return this.keyspace().hGet(this.prefix(key), field);
  }

  async hDel(key: string, ...fields: string[]): Promise<number> {
    this.ensureOpen();
    return this.keyspace().hDel(this.prefix(key), fields);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    this.ensureOpen();
    return this.keyspace().hGetAll(this.prefix(key));
  }

  async hExists(key: string, field: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().hExists(this.prefix(key), field);
  }

  async hLen(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().hLen(this.prefix(key));
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    this.ensureOpen();
    return this.keyspace().hIncrBy(this.prefix(key), field, increment);
  }

  async lPush(key: string, ...values: RedisValue[]): Promise<number> {
    this.ensureOpen();
    return this.keyspace().lPush(this.prefix(key), values);
  }

  async rPush(key: string, ...values: RedisValue[]): Promise<number> {
    this.ensureOpen();
    return this.keyspace().rPush(this.prefix(key), values);
  }

  async lPop(key: string): Promise<string | null> {
    this.ensureOpen();
    return this.keyspace().lPop(this.prefix(key));
  }

  async rPop(key: string): Promise<string | null> {
    this.ensureOpen();
    return this.keyspace().rPop(this.prefix(key));
  }

  async lLen(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().lLen(this.prefix(key));
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    this.ensureOpen();
    return this.keyspace().lRange(this.prefix(key), start, stop);
  }

  async sAdd(key: string, ...members: RedisValue[]): Promise<number> {
    this.ensureOpen();
    return this.keyspace().sAdd(this.prefix(key), members);
  }

  async sRem(key: string, ...members: RedisValue[]): Promise<number> {
    this.ensureOpen();
    return this.keyspace().sRem(this.prefix(key), members);
  }

  async sMembers(key: string): Promise<string[]> {
    this.ensureOpen();
    return this.keyspace().sMembers(this.prefix(key));
  }

  async sIsMember(key: string, member: RedisValue): Promise<number> {
    this.ensureOpen();
    return this.keyspace().sIsMember(this.prefix(key), member);
  }

  async sCard(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().sCard(this.prefix(key));
  }

  async sPop(key: string): Promise<string | null> {
    this.ensureOpen();
    return this.keyspace().sPop(this.prefix(key));
  }

  async zAdd(key: string, item: ZAddItem | ZAddItem[]): Promise<number> {
    this.ensureOpen();
    const items = Array.isArray(item) ? item : [item];
    return this.keyspace().zAdd(this.prefix(key), items);
  }

  async zRem(key: string, ...members: string[]): Promise<number> {
    this.ensureOpen();
    return this.keyspace().zRem(this.prefix(key), members);
  }

  async zScore(key: string, member: string): Promise<number | null> {
    this.ensureOpen();
    return this.keyspace().zScore(this.prefix(key), member);
  }

  async zIncrBy(key: string, increment: number, member: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().zIncrBy(this.prefix(key), increment, member);
  }

  async zRange(
    key: string,
    start: number,
    stop: number,
    options?: ZRangeOptions
  ): Promise<ZRangeResult> {
    this.ensureOpen();
    return this.keyspace().zRange(this.prefix(key), start, stop, options);
  }

  async zRank(key: string, member: string, rev = false): Promise<number | null> {
    this.ensureOpen();
    return this.keyspace().zRank(this.prefix(key), member, rev);
  }

  async zCard(key: string): Promise<number> {
    this.ensureOpen();
    return this.keyspace().zCard(this.prefix(key));
  }

  multi(): RedisMulti {
    this.ensureOpen();
    return new RedisMulti(this);
  }
}

export class RedisMulti {
  private queue: Array<() => Promise<unknown>> = [];

  constructor(private client: RedisClient) {}

  private enqueue<T>(fn: () => Promise<T>): RedisMulti {
    this.queue.push(fn);
    return this;
  }

  get(key: string): RedisMulti {
    return this.enqueue(() => this.client.get(key));
  }

  set(key: string, value: RedisValue, options?: SetOptions): RedisMulti {
    return this.enqueue(() => this.client.set(key, value, options));
  }

  del(...keys: string[]): RedisMulti {
    return this.enqueue(() => this.client.del(...keys));
  }

  incr(key: string): RedisMulti {
    return this.enqueue(() => this.client.incr(key));
  }

  decr(key: string): RedisMulti {
    return this.enqueue(() => this.client.decr(key));
  }

  hSet(key: string, field: string, value: RedisValue): RedisMulti {
    return this.enqueue(() => this.client.hSet(key, field, value));
  }

  hGet(key: string, field: string): RedisMulti {
    return this.enqueue(() => this.client.hGet(key, field));
  }

  lPush(key: string, ...values: RedisValue[]): RedisMulti {
    return this.enqueue(() => this.client.lPush(key, ...values));
  }

  rPush(key: string, ...values: RedisValue[]): RedisMulti {
    return this.enqueue(() => this.client.rPush(key, ...values));
  }

  sAdd(key: string, ...members: RedisValue[]): RedisMulti {
    return this.enqueue(() => this.client.sAdd(key, ...members));
  }

  zAdd(key: string, item: ZAddItem | ZAddItem[]): RedisMulti {
    return this.enqueue(() => this.client.zAdd(key, item));
  }

  async exec(): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const task of this.queue) {
      results.push(await task());
    }
    this.queue = [];
    return results;
  }
}

export function createClient(options?: ClientOptions): RedisClient {
  return new RedisClient(options);
}
