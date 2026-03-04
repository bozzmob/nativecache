import { describe, it, expect, vi, afterEach } from "vitest";
import { createIsolatedClient } from "./helpers";

describe("ttl", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires keys", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));

    const client = await createIsolatedClient();
    await client.set("temp", "1", { EX: 1 });
    expect(await client.ttl("temp")).toBe(1);

    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();

    expect(await client.get("temp")).toBeNull();
    expect(await client.ttl("temp")).toBe(-2);
  });

  it("supports persist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));

    const client = await createIsolatedClient();
    await client.set("session", "abc", { PX: 5000 });
    expect(await client.persist("session")).toBe(1);
    expect(await client.ttl("session")).toBe(-1);

    vi.advanceTimersByTime(6000);
    await vi.runOnlyPendingTimersAsync();
    expect(await client.get("session")).toBe("abc");
  });

  it("rejects non-integer expire values", async () => {
    const client = await createIsolatedClient();
    await client.set("temp", "1");
    await expect(client.expire("temp", 1.5)).rejects.toThrow(
      "ERR seconds is not an integer or out of range"
    );
    await expect(client.pExpire("temp", 100.1)).rejects.toThrow(
      "ERR milliseconds is not an integer or out of range"
    );
  });
});
