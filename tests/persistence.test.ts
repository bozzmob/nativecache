import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createClient } from "../src/index";

async function createSnapshotPath(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "flashstore-"));
  return {
    path: join(dir, "snapshot.json"),
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

describe("persistence", () => {
  it("persists values across restarts", async () => {
    const snapshot = await createSnapshotPath();

    try {
      const writer = createClient({
        isolated: true,
        persistence: { path: snapshot.path, flushIntervalMs: 0 }
      });
      await writer.connect();
      await writer.set("name", "ada");
      await writer.hSet("profile", { role: "engineer" });
      await writer.set("session", "alive", { EX: 30 });
      await writer.disconnect();

      const reader = createClient({
        isolated: true,
        persistence: { path: snapshot.path, flushIntervalMs: 0 }
      });
      await reader.connect();

      expect(await reader.get("name")).toBe("ada");
      expect(await reader.hGet("profile", "role")).toBe("engineer");
      expect(await reader.ttl("session")).toBeGreaterThan(0);

      await reader.disconnect();
    } finally {
      await snapshot.cleanup();
    }
  });

  it("skips expired keys while loading snapshot", async () => {
    const snapshot = await createSnapshotPath();

    try {
      const writer = createClient({
        isolated: true,
        persistence: { path: snapshot.path, flushIntervalMs: 0 }
      });
      await writer.connect();
      await writer.set("short", "value", { PX: 50 });
      await writer.disconnect();

      await sleep(80);

      const reader = createClient({
        isolated: true,
        persistence: { path: snapshot.path, flushIntervalMs: 0 }
      });
      await reader.connect();

      expect(await reader.get("short")).toBeNull();

      await reader.disconnect();
    } finally {
      await snapshot.cleanup();
    }
  });

  it("persists flushdb operations", async () => {
    const snapshot = await createSnapshotPath();

    try {
      const writer = createClient({
        isolated: true,
        persistence: { path: snapshot.path, flushIntervalMs: 0 }
      });
      await writer.connect();
      await writer.set("key", "value");
      await writer.disconnect();

      const cleaner = createClient({
        isolated: true,
        persistence: { path: snapshot.path, flushIntervalMs: 0 }
      });
      await cleaner.connect();
      expect(await cleaner.get("key")).toBe("value");
      await cleaner.flushDb();
      await cleaner.disconnect();

      const reader = createClient({
        isolated: true,
        persistence: { path: snapshot.path, flushIntervalMs: 0 }
      });
      await reader.connect();
      expect(await reader.get("key")).toBeNull();
      await reader.disconnect();
    } finally {
      await snapshot.cleanup();
    }
  });

  it("supports manual save and load", async () => {
    const snapshot = await createSnapshotPath();

    try {
      const client = createClient({
        isolated: true,
        persistence: { path: snapshot.path, flushIntervalMs: 0 }
      });

      await client.connect();
      await client.set("mode", "saved");
      await client.save();
      await client.set("mode", "changed");
      await client.load();

      expect(await client.get("mode")).toBe("saved");

      await client.disconnect();
    } finally {
      await snapshot.cleanup();
    }
  });

  it("rejects conflicting persistence configs on shared server", async () => {
    const snapshotA = await createSnapshotPath();
    const snapshotB = await createSnapshotPath();

    try {
      const first = createClient({
        persistence: { path: snapshotA.path, flushIntervalMs: 0 }
      });
      await first.connect();

      expect(() =>
        createClient({
          persistence: { path: snapshotB.path, flushIntervalMs: 0 }
        })
      ).toThrow("ERR persistence options conflict for clients sharing the same server instance");

      await first.disconnect();
    } finally {
      await snapshotA.cleanup();
      await snapshotB.cleanup();
    }
  });
});
