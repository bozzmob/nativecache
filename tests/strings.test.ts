import { describe, it, expect } from "vitest";
import { createIsolatedClient } from "./helpers";

describe("strings", () => {
  it("sets and gets values", async () => {
    const client = await createIsolatedClient();
    await client.set("greeting", "hello");
    await client.set("count", 42);
    expect(await client.get("greeting")).toBe("hello");
    expect(await client.get("count")).toBe("42");
  });

  it("supports NX/XX options", async () => {
    const client = await createIsolatedClient();
    expect(await client.set("once", "1", { NX: true })).toBe("OK");
    expect(await client.set("once", "2", { NX: true })).toBeNull();
    expect(await client.set("missing", "1", { XX: true })).toBeNull();
    expect(await client.set("once", "3", { XX: true })).toBe("OK");
    expect(await client.get("once")).toBe("3");
  });

  it("rejects incompatible NX/XX", async () => {
    const client = await createIsolatedClient();
    await expect(client.set("conflict", "1", { NX: true, XX: true })).rejects.toThrow(
      "ERR NX and XX options at the same time are not compatible"
    );
  });

  it("increments and decrements", async () => {
    const client = await createIsolatedClient();
    await client.set("counter", "10");
    expect(await client.incr("counter")).toBe(11);
    expect(await client.decr("counter")).toBe(10);
    expect(await client.incrBy("counter", 5)).toBe(15);
    expect(await client.decrBy("counter", 3)).toBe(12);
  });

  it("rejects non-integer increments", async () => {
    const client = await createIsolatedClient();
    await client.set("bad", "1e3");
    await expect(client.incr("bad")).rejects.toThrow(
      "ERR value is not an integer or out of range for INCRBY"
    );
  });

  it("supports append and length", async () => {
    const client = await createIsolatedClient();
    expect(await client.append("message", "hi")).toBe(2);
    expect(await client.append("message", "!")).toBe(3);
    expect(await client.get("message")).toBe("hi!");
    expect(await client.strlen("message")).toBe(3);
  });

  it("handles ranges", async () => {
    const client = await createIsolatedClient();
    await client.set("text", "hello world");
    expect(await client.getRange("text", 0, 4)).toBe("hello");
    expect(await client.getRange("text", -5, -1)).toBe("world");
    await client.setRange("text", 6, "flash");
    expect(await client.get("text")).toBe("hello flash");
  });

  it("handles mget/mset", async () => {
    const client = await createIsolatedClient();
    await client.mSet({ a: 1, b: 2 });
    expect(await client.mGet(["a", "b", "c"])).toEqual(["1", "2", null]);
  });
});
