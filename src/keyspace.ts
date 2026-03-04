import { ExpiryScheduler } from "./expiry";
import { RedisError, WRONGTYPE_ERROR } from "./errors";
import { Deque } from "./structures/deque";
import { SortedSet, type ZSetEntry } from "./structures/zset";
import type { KeyType, RedisValue, SetOptions, ZAddItem, ZRangeOptions, ZRangeResult } from "./types";
import { globToRegExp } from "./utils/glob";
import { normalizeRange } from "./utils/range";
import {
  assertFiniteNumber,
  assertNonNegativeInteger,
  assertPositiveInteger,
  assertSafeInteger,
  parseInteger,
  toRedisString
} from "./utils/values";

interface BaseEntry {
  type: KeyType;
  expiresAt: number | null;
}

interface StringEntry extends BaseEntry {
  type: "string";
  value: string;
}

interface HashEntry extends BaseEntry {
  type: "hash";
  value: Map<string, string>;
}

interface ListEntry extends BaseEntry {
  type: "list";
  value: Deque<string>;
}

interface SetEntry extends BaseEntry {
  type: "set";
  value: Set<string>;
}

interface ZSetValueEntry extends BaseEntry {
  type: "zset";
  value: SortedSet;
}

export type Entry = StringEntry | HashEntry | ListEntry | SetEntry | ZSetValueEntry;

const MAX_DB_INDEX = 15;

function assertDbIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_DB_INDEX) {
    throw new RedisError("ERR DB index is out of range");
  }
}

export class Keyspace {
  private entries = new Map<string, Entry>();
  private expiry: ExpiryScheduler;

  constructor() {
    this.expiry = new ExpiryScheduler((key) => this.expireIfNeeded(key));
  }

  stop(): void {
    this.expiry.stop();
  }

  size(): number {
    this.purgeExpired();
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.expiry.clear();
  }

  keys(pattern = "*"): string[] {
    this.purgeExpired();
    if (pattern === "*") return Array.from(this.entries.keys());
    const matcher = globToRegExp(pattern);
    return Array.from(this.entries.keys()).filter((key) => matcher.test(key));
  }

  typeOf(key: string): KeyType | "none" {
    const entry = this.getEntry(key);
    return entry ? entry.type : "none";
  }

  get(key: string): string | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "string") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value;
  }

  set(key: string, value: RedisValue, options: SetOptions = {}): "OK" | null {
    const existing = this.getEntry(key);
    if (options.NX && options.XX) {
      throw new RedisError("ERR NX and XX options at the same time are not compatible");
    }
    if (options.NX && existing) return null;
    if (options.XX && !existing) return null;

    const { expiresAt, keepTtl } = this.resolveExpiry(options, existing);

    const entry: StringEntry = {
      type: "string",
      value: toRedisString(value),
      expiresAt: keepTtl ? existing?.expiresAt ?? null : expiresAt
    };

    this.entries.set(key, entry);
    this.applyExpiry(key, entry.expiresAt);
    return "OK";
  }

  mGet(keys: string[]): Array<string | null> {
    return keys.map((key) => this.get(key));
  }

  mSet(pairs: Array<[string, RedisValue]>): "OK" {
    for (const [key, value] of pairs) {
      this.set(key, value);
    }
    return "OK";
  }

  append(key: string, value: RedisValue): number {
    const entry = this.getOrCreateString(key);
    entry.value += toRedisString(value);
    return entry.value.length;
  }

  strlen(key: string): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "string") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.length;
  }

  getRange(key: string, start: number, stop: number): string {
    const entry = this.getEntry(key);
    if (!entry) return "";
    if (entry.type !== "string") throw new RedisError(WRONGTYPE_ERROR);
    const range = normalizeRange(start, stop, entry.value.length);
    if (!range) return "";
    const [startIndex, stopIndex] = range;
    return entry.value.substring(startIndex, stopIndex + 1);
  }

  setRange(key: string, offset: number, value: RedisValue): number {
    assertNonNegativeInteger(offset, "offset");
    const entry = this.getOrCreateString(key);
    const input = toRedisString(value);
    const padded = entry.value.padEnd(offset, "\0");
    const prefix = padded.slice(0, offset);
    const suffix = padded.slice(offset + input.length);
    entry.value = prefix + input + suffix;
    return entry.value.length;
  }

  incr(key: string): number {
    return this.incrBy(key, 1);
  }

  decr(key: string): number {
    return this.incrBy(key, -1);
  }

  incrBy(key: string, increment: number): number {
    assertSafeInteger(increment, "increment");
    const existing = this.getEntry(key);
    if (!existing) {
      const created: StringEntry = {
        type: "string",
        value: increment.toString(10),
        expiresAt: null
      };
      this.entries.set(key, created);
      return increment;
    }
    if (existing.type !== "string") throw new RedisError(WRONGTYPE_ERROR);
    const current = parseInteger(existing.value, "INCRBY");
    const next = current + increment;
    if (!Number.isSafeInteger(next)) {
      throw new RedisError("ERR increment or decrement would overflow");
    }
    existing.value = next.toString(10);
    return next;
  }

  del(keys: string[]): number {
    let removed = 0;
    for (const key of keys) {
      if (this.deleteKey(key)) removed += 1;
    }
    return removed;
  }

  exists(keys: string[]): number {
    let count = 0;
    for (const key of keys) {
      if (this.getEntry(key)) count += 1;
    }
    return count;
  }

  expire(key: string, seconds: number): number {
    assertPositiveInteger(seconds, "seconds");
    return this.setExpiryInMs(key, seconds * 1000);
  }

  pExpire(key: string, milliseconds: number): number {
    assertPositiveInteger(milliseconds, "milliseconds");
    return this.setExpiryInMs(key, milliseconds);
  }

  expireAt(key: string, unixSeconds: number): number {
    assertPositiveInteger(unixSeconds, "unixSeconds");
    return this.setExpiryAt(key, unixSeconds * 1000);
  }

  pExpireAt(key: string, unixMilliseconds: number): number {
    assertPositiveInteger(unixMilliseconds, "unixMilliseconds");
    return this.setExpiryAt(key, unixMilliseconds);
  }

  ttl(key: string): number {
    const entry = this.getEntry(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    const diff = entry.expiresAt - Date.now();
    if (diff <= 0) {
      this.deleteKey(key);
      return -2;
    }
    return Math.floor(diff / 1000);
  }

  pTtl(key: string): number {
    const entry = this.getEntry(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    const diff = entry.expiresAt - Date.now();
    if (diff <= 0) {
      this.deleteKey(key);
      return -2;
    }
    return diff;
  }

  persist(key: string): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.expiresAt === null) return 0;
    entry.expiresAt = null;
    return 1;
  }

  hSet(key: string, pairs: Array<[string, RedisValue]>): number {
    const entry = this.getOrCreateHash(key);
    let added = 0;
    for (const [field, value] of pairs) {
      if (!entry.value.has(field)) added += 1;
      entry.value.set(field, toRedisString(value));
    }
    return added;
  }

  hGet(key: string, field: string): string | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "hash") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.get(field) ?? null;
  }

  hDel(key: string, fields: string[]): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "hash") throw new RedisError(WRONGTYPE_ERROR);
    let removed = 0;
    for (const field of fields) {
      if (entry.value.delete(field)) removed += 1;
    }
    if (entry.value.size === 0) this.entries.delete(key);
    return removed;
  }

  hGetAll(key: string): Record<string, string> {
    const entry = this.getEntry(key);
    if (!entry) return {};
    if (entry.type !== "hash") throw new RedisError(WRONGTYPE_ERROR);
    const output: Record<string, string> = {};
    for (const [field, value] of entry.value.entries()) {
      output[field] = value;
    }
    return output;
  }

  hExists(key: string, field: string): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "hash") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.has(field) ? 1 : 0;
  }

  hLen(key: string): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "hash") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.size;
  }

  hIncrBy(key: string, field: string, increment: number): number {
    assertSafeInteger(increment, "increment");
    const entry = this.getOrCreateHash(key);
    const currentRaw = entry.value.get(field) ?? "0";
    const current = parseInteger(currentRaw, "HINCRBY");
    const next = current + increment;
    if (!Number.isSafeInteger(next)) {
      throw new RedisError("ERR increment or decrement would overflow");
    }
    entry.value.set(field, next.toString(10));
    return next;
  }

  lPush(key: string, values: RedisValue[]): number {
    const entry = this.getOrCreateList(key);
    for (const value of values) {
      entry.value.pushFront(toRedisString(value));
    }
    return entry.value.size;
  }

  rPush(key: string, values: RedisValue[]): number {
    const entry = this.getOrCreateList(key);
    for (const value of values) {
      entry.value.pushBack(toRedisString(value));
    }
    return entry.value.size;
  }

  lPop(key: string): string | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
    const value = entry.value.popFront() ?? null;
    if (entry.value.size === 0) this.entries.delete(key);
    return value;
  }

  rPop(key: string): string | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
    const value = entry.value.popBack() ?? null;
    if (entry.value.size === 0) this.entries.delete(key);
    return value;
  }

  lLen(key: string): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.size;
  }

  lRange(key: string, start: number, stop: number): string[] {
    const entry = this.getEntry(key);
    if (!entry) return [];
    if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
    const range = normalizeRange(start, stop, entry.value.size);
    if (!range) return [];
    const [startIndex, stopIndex] = range;
    const output: string[] = [];
    for (let i = startIndex; i <= stopIndex; i += 1) {
      const item = entry.value.get(i);
      if (item !== undefined) output.push(item);
    }
    return output;
  }

  sAdd(key: string, members: RedisValue[]): number {
    const entry = this.getOrCreateSet(key);
    let added = 0;
    for (const member of members) {
      const value = toRedisString(member);
      if (!entry.value.has(value)) {
        added += 1;
        entry.value.add(value);
      }
    }
    return added;
  }

  sRem(key: string, members: RedisValue[]): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "set") throw new RedisError(WRONGTYPE_ERROR);
    let removed = 0;
    for (const member of members) {
      if (entry.value.delete(toRedisString(member))) removed += 1;
    }
    if (entry.value.size === 0) this.entries.delete(key);
    return removed;
  }

  sMembers(key: string): string[] {
    const entry = this.getEntry(key);
    if (!entry) return [];
    if (entry.type !== "set") throw new RedisError(WRONGTYPE_ERROR);
    return Array.from(entry.value.values());
  }

  sIsMember(key: string, member: RedisValue): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "set") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.has(toRedisString(member)) ? 1 : 0;
  }

  sCard(key: string): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "set") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.size;
  }

  sPop(key: string): string | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "set") throw new RedisError(WRONGTYPE_ERROR);
    const targetIndex = Math.floor(Math.random() * entry.value.size);
    let index = 0;
    let selected: string | null = null;
    for (const value of entry.value) {
      if (index === targetIndex) {
        selected = value;
        break;
      }
      index += 1;
    }
    if (selected === null) return null;
    entry.value.delete(selected);
    if (entry.value.size === 0) this.entries.delete(key);
    return selected;
  }

  zAdd(key: string, items: ZAddItem[]): number {
    for (const item of items) {
      assertFiniteNumber(item.score, "score");
    }
    const entry = this.getOrCreateZSet(key);
    const normalized: ZSetEntry[] = items.map((item) => ({
      value: item.value,
      score: item.score
    }));
    return entry.value.add(normalized);
  }

  zRem(key: string, members: string[]): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "zset") throw new RedisError(WRONGTYPE_ERROR);
    let removed = 0;
    for (const member of members) {
      if (entry.value.remove(member)) removed += 1;
    }
    if (entry.value.size === 0) this.entries.delete(key);
    return removed;
  }

  zScore(key: string, member: string): number | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "zset") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.score(member);
  }

  zIncrBy(key: string, increment: number, member: string): number {
    assertFiniteNumber(increment, "increment");
    const entry = this.getOrCreateZSet(key);
    const next = entry.value.incrBy(member, increment);
    assertFiniteNumber(next, "resulting score");
    return next;
  }

  zRange(key: string, start: number, stop: number, options: ZRangeOptions = {}): ZRangeResult {
    const entry = this.getEntry(key);
    if (!entry) return [];
    if (entry.type !== "zset") throw new RedisError(WRONGTYPE_ERROR);
    const items = entry.value.range(start, stop, Boolean(options.REV));
    if (options.WITHSCORES) {
      return items.map((item) => ({ value: item.value, score: item.score }));
    }
    return items.map((item) => item.value);
  }

  zRank(key: string, member: string, rev = false): number | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "zset") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.rank(member, rev);
  }

  zCard(key: string): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "zset") throw new RedisError(WRONGTYPE_ERROR);
    return entry.value.size;
  }

  select(index: number): void {
    assertDbIndex(index);
  }

  private setExpiryInMs(key: string, milliseconds: number): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    return this.setExpiryAt(key, Date.now() + milliseconds);
  }

  private setExpiryAt(key: string, at: number): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    entry.expiresAt = at;
    this.applyExpiry(key, entry.expiresAt);
    return 1;
  }

  private resolveExpiry(
    options: SetOptions,
    existing?: Entry
  ): { expiresAt: number | null; keepTtl: boolean } {
    const ttlOptions = [options.EX, options.PX, options.EXAT, options.PXAT].filter(
      (value) => value !== undefined
    );
    if (ttlOptions.length > 1) {
      throw new RedisError("ERR only one of EX, PX, EXAT, or PXAT can be specified");
    }
    if (options.KEEPTTL && ttlOptions.length > 0) {
      throw new RedisError("ERR KEEPTTL is not compatible with EX, PX, EXAT, or PXAT");
    }

    if (options.KEEPTTL) {
      return { expiresAt: existing?.expiresAt ?? null, keepTtl: true };
    }

    if (options.EX !== undefined) {
      assertPositiveInteger(options.EX, "EX");
      return { expiresAt: Date.now() + options.EX * 1000, keepTtl: false };
    }

    if (options.PX !== undefined) {
      assertPositiveInteger(options.PX, "PX");
      return { expiresAt: Date.now() + options.PX, keepTtl: false };
    }

    if (options.EXAT !== undefined) {
      assertPositiveInteger(options.EXAT, "EXAT");
      return { expiresAt: options.EXAT * 1000, keepTtl: false };
    }

    if (options.PXAT !== undefined) {
      assertPositiveInteger(options.PXAT, "PXAT");
      return { expiresAt: options.PXAT, keepTtl: false };
    }

    return { expiresAt: null, keepTtl: false };
  }

  private getOrCreateString(key: string): StringEntry {
    const entry = this.getEntry(key);
    if (!entry) {
      const created: StringEntry = { type: "string", value: "", expiresAt: null };
      this.entries.set(key, created);
      return created;
    }
    if (entry.type !== "string") throw new RedisError(WRONGTYPE_ERROR);
    return entry;
  }

  private getOrCreateHash(key: string): HashEntry {
    const entry = this.getEntry(key);
    if (!entry) {
      const created: HashEntry = { type: "hash", value: new Map(), expiresAt: null };
      this.entries.set(key, created);
      return created;
    }
    if (entry.type !== "hash") throw new RedisError(WRONGTYPE_ERROR);
    return entry;
  }

  private getOrCreateList(key: string): ListEntry {
    const entry = this.getEntry(key);
    if (!entry) {
      const created: ListEntry = { type: "list", value: new Deque(), expiresAt: null };
      this.entries.set(key, created);
      return created;
    }
    if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
    return entry;
  }

  private getOrCreateSet(key: string): SetEntry {
    const entry = this.getEntry(key);
    if (!entry) {
      const created: SetEntry = { type: "set", value: new Set(), expiresAt: null };
      this.entries.set(key, created);
      return created;
    }
    if (entry.type !== "set") throw new RedisError(WRONGTYPE_ERROR);
    return entry;
  }

  private getOrCreateZSet(key: string): ZSetValueEntry {
    const entry = this.getEntry(key);
    if (!entry) {
      const created: ZSetValueEntry = { type: "zset", value: new SortedSet(), expiresAt: null };
      this.entries.set(key, created);
      return created;
    }
    if (entry.type !== "zset") throw new RedisError(WRONGTYPE_ERROR);
    return entry;
  }

  private getEntry(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private deleteKey(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    return true;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  private expireIfNeeded(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
    }
  }

  private applyExpiry(key: string, expiresAt: number | null): void {
    if (expiresAt === null) return;
    this.expiry.schedule(key, expiresAt);
  }
}

export class ServerState {
  private keyspaces = new Map<number, Keyspace>();

  getKeyspace(index: number): Keyspace {
    assertDbIndex(index);
    let keyspace = this.keyspaces.get(index);
    if (!keyspace) {
      keyspace = new Keyspace();
      this.keyspaces.set(index, keyspace);
    }
    return keyspace;
  }

  stop(): void {
    for (const space of this.keyspaces.values()) {
      space.stop();
    }
  }
}
