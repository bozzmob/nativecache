import { describe, it, expect } from "vitest";
import { createIsolatedClient } from "./helpers";

describe("multi", () => {
  it("executes queued commands", async () => {
    const client = await createIsolatedClient();
    const results = await client
      .multi()
      .set("counter", 1)
      .incr("counter")
      .get("counter")
      .exec();

    expect(results).toEqual(["OK", 2, "2"]);
  });

  it("clears queued operations when exec fails", async () => {
    const client = await createIsolatedClient();
    const tx = client.multi().set("key", "value").lPush("key", "x");
    await expect(tx.exec()).rejects.toThrow(
      "WRONGTYPE Operation against a key holding the wrong kind of value"
    );
    await expect(tx.exec()).resolves.toEqual([]);
  });
});
