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

interface SerializedBaseEntry {
  type: KeyType;
  expiresAt: number | null;
}

interface SerializedStringEntry extends SerializedBaseEntry {
  type: "string";
  value: string;
}

interface SerializedHashEntry extends SerializedBaseEntry {
  type: "hash";
  value: Array<[string, string]>;
}

interface SerializedListEntry extends SerializedBaseEntry {
  type: "list";
  value: string[];
}

interface SerializedSetEntry extends SerializedBaseEntry {
  type: "set";
  value: string[];
}

interface SerializedZSetEntry extends SerializedBaseEntry {
  type: "zset";
  value: ZSetEntry[];
}

export type SerializedEntry =
  | SerializedStringEntry
  | SerializedHashEntry
  | SerializedListEntry
  | SerializedSetEntry
  | SerializedZSetEntry;

export interface KeyspaceSnapshot {
  entries: Array<{ key: string; entry: SerializedEntry }>;
}

export interface ServerSnapshot {
  version: 1;
  databases: Array<{ index: number; keyspace: KeyspaceSnapshot }>;
}

const MAX_DB_INDEX = 15;

function assertDbIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_DB_INDEX) {
    throw new RedisError("ERR DB index is out of range");
  }
}

export class Keyspace {
  private entries = new Map<string, Entry>();
  private expiry: ExpiryScheduler;

  constructor(private onMutation?: () => void) {
    this.expiry = new ExpiryScheduler((key) => this.expireIfNeeded(key));
  }

  stop(): void {
    this.expiry.stop();
  }

  size(): number {
    this.purgeExpired();
    return this.entries.size;
  }

  clear(notify = true): void {
    const hadEntries = this.entries.size > 0;
    this.entries.clear();
    this.expiry.clear();
    if (notify && hadEntries) this.markDirty();
  }

  snapshot(): KeyspaceSnapshot {
    this.purgeExpired();
    return {
      entries: Array.from(this.entries.entries()).map(([key, entry]) => ({
        key,
        entry: this.serializeEntry(entry)
      }))
    };
  }

  load(snapshot: KeyspaceSnapshot): void {
    this.clear(false);

    if (!snapshot || !Array.isArray(snapshot.entries)) {
      return;
    }

    const now = Date.now();

    for (const record of snapshot.entries) {
      if (!record || typeof record.key !== "string") continue;
      const entry = this.deserializeEntry(record.entry);
      if (!entry) continue;
      if (entry.expiresAt !== null && entry.expiresAt <= now) continue;
      this.entries.set(record.key, entry);
      this.applyExpiry(record.key, entry.expiresAt);
    }
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
    this.markDirty();
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
    this.markDirty();
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
    this.markDirty();
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
      this.markDirty();
      return increment;
    }
    if (existing.type !== "string") throw new RedisError(WRONGTYPE_ERROR);
    const current = parseInteger(existing.value, "INCRBY");
    const next = current + increment;
    if (!Number.isSafeInteger(next)) {
      throw new RedisError("ERR increment or decrement would overflow");
    }
    if (next !== current) {
      existing.value = next.toString(10);
      this.markDirty();
    }
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
    this.applyExpiry(key, null);
    this.markDirty();
    return 1;
  }

  hSet(key: string, pairs: Array<[string, RedisValue]>): number {
    const entry = this.getOrCreateHash(key);
    let added = 0;
    let changed = false;

    for (const [field, value] of pairs) {
      const next = toRedisString(value);
      const previous = entry.value.get(field);
      if (previous === undefined) {
        added += 1;
        changed = true;
        entry.value.set(field, next);
        continue;
      }
      if (previous !== next) {
        changed = true;
        entry.value.set(field, next);
      }
    }

    if (changed) {
      this.markDirty();
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
    if (removed > 0) {
      if (entry.value.size === 0) {
        this.deleteKey(key);
      } else {
        this.markDirty();
      }
    }
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
    const currentRaw = entry.value.get(field);
    const current = parseInteger(currentRaw ?? "0", "HINCRBY");
    const next = current + increment;
    if (!Number.isSafeInteger(next)) {
      throw new RedisError("ERR increment or decrement would overflow");
    }
    const nextRaw = next.toString(10);
    if (currentRaw !== nextRaw) {
      entry.value.set(field, nextRaw);
      this.markDirty();
    }
    return next;
  }

  lPush(key: string, values: RedisValue[]): number {
    if (values.length === 0) {
      const entry = this.getEntry(key);
      if (!entry) return 0;
      if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
      return entry.value.size;
    }

    const entry = this.getOrCreateList(key);
    for (const value of values) {
      entry.value.pushFront(toRedisString(value));
    }
    this.markDirty();
    return entry.value.size;
  }

  rPush(key: string, values: RedisValue[]): number {
    if (values.length === 0) {
      const entry = this.getEntry(key);
      if (!entry) return 0;
      if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
      return entry.value.size;
    }

    const entry = this.getOrCreateList(key);
    for (const value of values) {
      entry.value.pushBack(toRedisString(value));
    }
    this.markDirty();
    return entry.value.size;
  }

  lPop(key: string): string | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
    const value = entry.value.popFront() ?? null;
    if (value === null) return null;
    if (entry.value.size === 0) {
      this.deleteKey(key);
    } else {
      this.markDirty();
    }
    return value;
  }

  rPop(key: string): string | null {
    const entry = this.getEntry(key);
    if (!entry) return null;
    if (entry.type !== "list") throw new RedisError(WRONGTYPE_ERROR);
    const value = entry.value.popBack() ?? null;
    if (value === null) return null;
    if (entry.value.size === 0) {
      this.deleteKey(key);
    } else {
      this.markDirty();
    }
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
    if (members.length === 0) {
      const entry = this.getEntry(key);
      if (!entry) return 0;
      if (entry.type !== "set") throw new RedisError(WRONGTYPE_ERROR);
      return 0;
    }

    const entry = this.getOrCreateSet(key);
    let added = 0;
    for (const member of members) {
      const value = toRedisString(member);
      if (!entry.value.has(value)) {
        added += 1;
        entry.value.add(value);
      }
    }

    if (added > 0) {
      this.markDirty();
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
    if (removed > 0) {
      if (entry.value.size === 0) {
        this.deleteKey(key);
      } else {
        this.markDirty();
      }
    }
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
    if (entry.value.size === 0) {
      this.deleteKey(key);
    } else {
      this.markDirty();
    }
    return selected;
  }

  zAdd(key: string, items: ZAddItem[]): number {
    if (items.length === 0) {
      const entry = this.getEntry(key);
      if (!entry) return 0;
      if (entry.type !== "zset") throw new RedisError(WRONGTYPE_ERROR);
      return 0;
    }

    for (const item of items) {
      assertFiniteNumber(item.score, "score");
    }

    const entry = this.getOrCreateZSet(key);
    const normalized: ZSetEntry[] = items.map((item) => ({
      value: item.value,
      score: item.score
    }));

    const previousScores = new Map<string, number | null>();
    for (const item of normalized) {
      if (!previousScores.has(item.value)) {
        previousScores.set(item.value, entry.value.score(item.value));
      }
    }

    const added = entry.value.add(normalized);

    let changed = false;
    for (const [member, previousScore] of previousScores.entries()) {
      if (entry.value.score(member) !== previousScore) {
        changed = true;
        break;
      }
    }

    if (changed) {
      this.markDirty();
    }
    return added;
  }

  zRem(key: string, members: string[]): number {
    const entry = this.getEntry(key);
    if (!entry) return 0;
    if (entry.type !== "zset") throw new RedisError(WRONGTYPE_ERROR);
    let removed = 0;
    for (const member of members) {
      if (entry.value.remove(member)) removed += 1;
    }
    if (removed > 0) {
      if (entry.value.size === 0) {
        this.deleteKey(key);
      } else {
        this.markDirty();
      }
    }
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
    const previous = entry.value.score(member) ?? 0;
    const next = previous + increment;
    assertFiniteNumber(next, "resulting score");
    entry.value.add([{ value: member, score: next }]);
    if (previous !== next) {
      this.markDirty();
    }
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

    if (at <= Date.now()) {
      this.deleteKey(key);
      return 1;
    }

    if (entry.expiresAt === at) return 1;

    entry.expiresAt = at;
    this.applyExpiry(key, at);
    this.markDirty();
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
      this.markDirty();
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
      this.markDirty();
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
      this.markDirty();
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
      this.markDirty();
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
      this.markDirty();
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
      this.expiry.cancel(key);
      this.markDirty();
      return undefined;
    }
    return entry;
  }

  private deleteKey(key: string): boolean {
    if (!this.entries.has(key)) return false;
    this.entries.delete(key);
    this.expiry.cancel(key);
    this.markDirty();
    return true;
  }

  private purgeExpired(): void {
    if (this.entries.size === 0) return;
    const now = Date.now();
    let removed = false;

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key);
        this.expiry.cancel(key);
        removed = true;
      }
    }

    if (removed) {
      this.markDirty();
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
      this.expiry.cancel(key);
      this.markDirty();
    }
  }

  private applyExpiry(key: string, expiresAt: number | null): void {
    if (expiresAt === null) {
      this.expiry.cancel(key);
      return;
    }
    this.expiry.schedule(key, expiresAt);
  }

  private markDirty(): void {
    this.onMutation?.();
  }

  private serializeEntry(entry: Entry): SerializedEntry {
    switch (entry.type) {
      case "string":
        return { type: "string", value: entry.value, expiresAt: entry.expiresAt };
      case "hash":
        return {
          type: "hash",
          value: Array.from(entry.value.entries()),
          expiresAt: entry.expiresAt
        };
      case "list":
        return { type: "list", value: entry.value.toArray(), expiresAt: entry.expiresAt };
      case "set":
        return { type: "set", value: Array.from(entry.value.values()), expiresAt: entry.expiresAt };
      case "zset":
        return {
          type: "zset",
          value: entry.value.range(0, -1, false).map((item) => ({ value: item.value, score: item.score })),
          expiresAt: entry.expiresAt
        };
      default:
        throw new RedisError("ERR unsupported key type");
    }
  }

  private deserializeEntry(input: unknown): Entry | null {
    if (!input || typeof input !== "object") return null;

    const serialized = input as {
      type?: unknown;
      expiresAt?: unknown;
      value?: unknown;
    };

    const rawExpiresAt = serialized.expiresAt;
    if (rawExpiresAt !== null && (typeof rawExpiresAt !== "number" || !Number.isFinite(rawExpiresAt))) {
      return null;
    }

    const expiresAt = rawExpiresAt ?? null;

    switch (serialized.type) {
      case "string": {
        if (typeof serialized.value !== "string") return null;
        return { type: "string", value: serialized.value, expiresAt };
      }
      case "hash": {
        const value = this.deserializeHashValue(serialized.value);
        if (!value) return null;
        return { type: "hash", value, expiresAt };
      }
      case "list": {
        const list = this.deserializeStringArray(serialized.value);
        if (!list) return null;
        const deque = new Deque<string>(Math.max(16, list.length));
        for (const item of list) {
          deque.pushBack(item);
        }
        return { type: "list", value: deque, expiresAt };
      }
      case "set": {
        const values = this.deserializeStringArray(serialized.value);
        if (!values) return null;
        return { type: "set", value: new Set(values), expiresAt };
      }
      case "zset": {
        const value = this.deserializeZSetValue(serialized.value);
        if (!value) return null;
        return { type: "zset", value, expiresAt };
      }
      default:
        return null;
    }
  }

  private deserializeHashValue(input: unknown): Map<string, string> | null {
    if (!Array.isArray(input)) return null;

    const output = new Map<string, string>();
    for (const item of input) {
      if (!Array.isArray(item) || item.length !== 2) return null;
      const [field, value] = item;
      if (typeof field !== "string" || typeof value !== "string") return null;
      output.set(field, value);
    }
    return output;
  }

  private deserializeStringArray(input: unknown): string[] | null {
    if (!Array.isArray(input)) return null;

    const output: string[] = [];
    for (const item of input) {
      if (typeof item !== "string") return null;
      output.push(item);
    }
    return output;
  }

  private deserializeZSetValue(input: unknown): SortedSet | null {
    if (!Array.isArray(input)) return null;

    const items: ZSetEntry[] = [];
    for (const item of input) {
      if (!item || typeof item !== "object") return null;
      const record = item as { value?: unknown; score?: unknown };
      if (typeof record.value !== "string") return null;
      if (typeof record.score !== "number" || !Number.isFinite(record.score)) return null;
      items.push({ value: record.value, score: record.score });
    }

    const output = new SortedSet();
    if (items.length > 0) {
      output.add(items);
    }
    return output;
  }
}

export class ServerState {
  private keyspaces = new Map<number, Keyspace>();
  private mutationListeners = new Set<() => void>();

  getKeyspace(index: number): Keyspace {
    assertDbIndex(index);
    let keyspace = this.keyspaces.get(index);
    if (!keyspace) {
      keyspace = new Keyspace(() => this.markDirty());
      this.keyspaces.set(index, keyspace);
    }
    return keyspace;
  }

  onMutation(listener: () => void): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  snapshot(): ServerSnapshot {
    const databases: ServerSnapshot["databases"] = [];
    const indexes = Array.from(this.keyspaces.keys()).sort((a, b) => a - b);

    for (const index of indexes) {
      const keyspace = this.keyspaces.get(index);
      if (!keyspace) continue;
      const snapshot = keyspace.snapshot();
      if (snapshot.entries.length === 0) continue;
      databases.push({ index, keyspace: snapshot });
    }

    return {
      version: 1,
      databases
    };
  }

  load(snapshot: ServerSnapshot): void {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.databases)) {
      return;
    }

    const validDatabases = snapshot.databases.filter(
      (database) =>
        Boolean(database) &&
        Number.isInteger(database.index) &&
        database.index >= 0 &&
        database.index <= MAX_DB_INDEX &&
        Boolean(database.keyspace) &&
        Array.isArray(database.keyspace.entries)
    );

    for (const space of this.keyspaces.values()) {
      space.stop();
    }
    this.keyspaces.clear();

    for (const database of validDatabases) {
      const keyspace = new Keyspace(() => this.markDirty());
      keyspace.load(database.keyspace);
      if (keyspace.size() > 0) {
        this.keyspaces.set(database.index, keyspace);
      } else {
        keyspace.stop();
      }
    }
  }

  stop(): void {
    for (const space of this.keyspaces.values()) {
      space.stop();
    }
    this.keyspaces.clear();
  }

  private markDirty(): void {
    for (const listener of this.mutationListeners) {
      listener();
    }
  }
}
