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

  it("deletes hash fields", async () => {
    const client = await createIsolatedClient();
    await client.hSet("profile", { name: "Ada", role: "dev" });
    expect(await client.hDel("profile", "role")).toBe(1);
    expect(await client.hDel("profile", "role")).toBe(0);
    expect(await client.hGetAll("profile")).toEqual({ name: "Ada" });
  });
});
