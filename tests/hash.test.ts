import { describe, it, expect } from "vitest";
import { createIsolatedClient } from "./helpers";

describe("hashes", () => {
  it("sets and gets hash fields", async () => {
    const client = await createIsolatedClient();
    expect(await client.hSet("profile", "name", "Ada")).toBe(1);
    expect(await client.hSet("profile", { title: "Engineer", level: 5 })).toBe(2);
    expect(await client.hGet("profile", "name")).toBe("Ada");
    expect(await client.hGetAll("profile")).toEqual({
      name: "Ada",
      title: "Engineer",
      level: "5"
    });
    expect(await client.hExists("profile", "name")).toBe(1);
    expect(await client.hLen("profile")).toBe(3);
  });

  it("increments hash fields", async () => {
    const client = await createIsolatedClient();
    expect(await client.hIncrBy("stats", "visits", 2)).toBe(2);
    expect(await client.hIncrBy("stats", "visits", 3)).toBe(5);
  });

  it("rejects non-integer hash increment argument", async () => {
    const client = await createIsolatedClient();
    await expect(client.hIncrBy("stats", "visits", 0.5)).rejects.toThrow(
      "ERR increment is not an integer or out of range"
    );
  });

  it("rejects overflowing hash increments", async () => {
    const client = await createIsolatedClient();
    await client.hSet("stats", "visits", Number.MAX_SAFE_INTEGER.toString());
    await expect(client.hIncrBy("stats", "visits", 1)).rejects.toThrow(
      "ERR increment or decrement would overflow"
    );
  });

  it("deletes hash fields", async () => {
    const client = await createIsolatedClient();
    await client.hSet("profile", { name: "Ada", role: "dev" });
    expect(await client.hDel("profile", "role")).toBe(1);
    expect(await client.hDel("profile", "role")).toBe(0);
    expect(await client.hGetAll("profile")).toEqual({ name: "Ada" });
  });

  it("rejects invalid hset argument count", async () => {
    const client = await createIsolatedClient();
    const unsafeClient = client as unknown as { hSet: (k: string, f: string) => Promise<number> };
    await expect(unsafeClient.hSet("profile", "name")).rejects.toThrow(
      "ERR wrong number of arguments for 'hset' command"
    );
  });
});
