import { RedisError } from "./errors";
import { type ServerSnapshot, ServerState } from "./keyspace";
import type { PersistenceOptions } from "./types";

const DEFAULT_RELATIVE_PERSISTENCE_PATH = ".nativecache/snapshot.json";
const DEFAULT_FLUSH_INTERVAL_MS = 50;

type FsPromisesModule = typeof import("node:fs/promises");
type PathModule = typeof import("node:path");

let fsPromisesModulePromise: Promise<FsPromisesModule> | null = null;
let pathModulePromise: Promise<PathModule> | null = null;

function getFsPromises(): Promise<FsPromisesModule> {
  if (!fsPromisesModulePromise) {
    fsPromisesModulePromise = import("node:fs/promises");
  }
  return fsPromisesModulePromise;
}

function getPathModule(): Promise<PathModule> {
  if (!pathModulePromise) {
    pathModulePromise = import("node:path");
  }
  return pathModulePromise;
}

export interface ResolvedPersistenceOptions {
  path: string;
  flushIntervalMs: number;
}

export function defaultPersistencePath(): string {
  if (typeof process === "undefined" || typeof process.cwd !== "function") {
    return DEFAULT_RELATIVE_PERSISTENCE_PATH;
  }
  return `${process.cwd()}/${DEFAULT_RELATIVE_PERSISTENCE_PATH}`;
}

export function resolvePersistenceOptions(
  persistence: boolean | PersistenceOptions | undefined
): ResolvedPersistenceOptions | null {
  if (!persistence) {
    return null;
  }

  if (persistence === true) {
    return {
      path: defaultPersistencePath(),
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS
    };
  }

  const flushIntervalMs = persistence.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  if (!Number.isInteger(flushIntervalMs) || flushIntervalMs < 0) {
    throw new RedisError("ERR persistence flushIntervalMs must be a non-negative integer");
  }

  const configuredPath = persistence.path ?? defaultPersistencePath();
  if (typeof configuredPath !== "string" || configuredPath.trim().length === 0) {
    throw new RedisError("ERR persistence path must be a non-empty string");
  }

  return {
    path: configuredPath,
    flushIntervalMs
  };
}

function isServerSnapshot(value: unknown): value is ServerSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { version?: unknown; databases?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.databases);
}

export class FilePersistence {
  private timer: NodeJS.Timeout | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private dirty = false;
  private resolvedPath: string | null = null;

  constructor(
    private server: ServerState,
    private options: ResolvedPersistenceOptions,
    private onError?: (error: Error) => void
  ) {}

  async load(): Promise<void> {
    const fsPromises = await getFsPromises();
    const filePath = await this.resolvePath();

    let raw: string;

    try {
      raw = await fsPromises.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RedisError(`ERR invalid persistence snapshot JSON at ${filePath}`);
    }

    if (!isServerSnapshot(parsed)) {
      throw new RedisError(`ERR invalid persistence snapshot structure at ${filePath}`);
    }

    this.server.load(parsed);
  }

  scheduleSave(): void {
    this.dirty = true;

    if (this.options.flushIntervalMs === 0) {
      this.queueWrite(false).catch((error: unknown) => {
        if (error instanceof Error) {
          this.onError?.(error);
        }
      });
      return;
    }

    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.queueWrite(false).catch((error: unknown) => {
        if (error instanceof Error) {
          this.onError?.(error);
        }
      });
    }, this.options.flushIntervalMs);

    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  async flush(force = false): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!force && !this.dirty) {
      await this.writeQueue;
      return;
    }

    await this.queueWrite(force);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private queueWrite(force: boolean): Promise<void> {
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.persist(force));

    return this.writeQueue;
  }

  private async persist(force: boolean): Promise<void> {
    if (!force && !this.dirty) return;

    this.dirty = false;

    const fsPromises = await getFsPromises();
    const pathModule = await getPathModule();
    const filePath = await this.resolvePath();

    const snapshot = this.server.snapshot();
    const payload = `${JSON.stringify(snapshot)}\n`;

    await fsPromises.mkdir(pathModule.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsPromises.writeFile(tempPath, payload, "utf8");
    await fsPromises.rename(tempPath, filePath);
  }

  private async resolvePath(): Promise<string> {
    if (this.resolvedPath) {
      return this.resolvedPath;
    }

    const pathModule = await getPathModule();
    if (pathModule.isAbsolute(this.options.path)) {
      this.resolvedPath = this.options.path;
      return this.resolvedPath;
    }

    const base =
      typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
    this.resolvedPath = pathModule.resolve(base, this.options.path);
    return this.resolvedPath;
  }
}
