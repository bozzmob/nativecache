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
});
