import { describe, it, expect } from "vitest";
import { createIsolatedClient } from "./helpers";

describe("lists", () => {
  it("pushes and pops values", async () => {
    const client = await createIsolatedClient();
    expect(await client.lPush("queue", "a", "b")).toBe(2);
    expect(await client.rPush("queue", "c")).toBe(3);
    expect(await client.lRange("queue", 0, -1)).toEqual(["b", "a", "c"]);
    expect(await client.lPop("queue")).toBe("b");
    expect(await client.rPop("queue")).toBe("c");
    expect(await client.lLen("queue")).toBe(1);
  });

  it("handles ranges", async () => {
    const client = await createIsolatedClient();
    await client.rPush("numbers", 1, 2, 3, 4, 5);
    expect(await client.lRange("numbers", 1, 3)).toEqual(["2", "3", "4"]);
    expect(await client.lRange("numbers", -2, -1)).toEqual(["4", "5"]);
  });
});
