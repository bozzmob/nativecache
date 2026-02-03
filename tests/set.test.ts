import { describe, it, expect } from "vitest";
import { createIsolatedClient } from "./helpers";

describe("sets", () => {
  it("adds and removes members", async () => {
    const client = await createIsolatedClient();
    expect(await client.sAdd("tags", "a", "b", "c")).toBe(3);
    expect(await client.sAdd("tags", "c")).toBe(0);
    expect(await client.sMembers("tags").then((members) => members.sort())).toEqual(["a", "b", "c"]);
    expect(await client.sIsMember("tags", "b")).toBe(1);
    expect(await client.sCard("tags")).toBe(3);
    expect(await client.sRem("tags", "b")).toBe(1);
    expect(await client.sCard("tags")).toBe(2);
  });

  it("pops members", async () => {
    const client = await createIsolatedClient();
    await client.sAdd("pool", "x", "y");
    const popped = await client.sPop("pool");
    expect(popped === "x" || popped === "y").toBe(true);
    expect(await client.sCard("pool")).toBe(1);
  });
});
