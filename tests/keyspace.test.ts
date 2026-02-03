import { describe, it, expect } from "vitest";
import { createIsolatedClient } from "./helpers";

describe("keyspace", () => {
  it("handles keys and dbsize", async () => {
    const client = await createIsolatedClient();
    await client.set("user:1", "a");
    await client.set("user:2", "b");
    await client.set("admin:1", "c");
    expect(await client.dbSize()).toBe(3);
    const users = await client.keys("user:*");
    expect(users.sort()).toEqual(["user:1", "user:2"]);
    await client.flushDb();
    expect(await client.dbSize()).toBe(0);
  });
});
