import { describe, it, expect } from "vitest";
import { createIsolatedClient } from "./helpers";

describe("sorted sets", () => {
  it("adds members and ranges", async () => {
    const client = await createIsolatedClient();
    expect(
      await client.zAdd("leaderboard", [
        { value: "a", score: 1 },
        { value: "b", score: 3 },
        { value: "c", score: 2 }
      ])
    ).toBe(3);

    expect(await client.zRange("leaderboard", 0, -1)).toEqual(["a", "c", "b"]);
    expect(await client.zRange("leaderboard", 0, 1, { REV: true })).toEqual(["b", "c"]);

    const withScores = await client.zRange("leaderboard", 0, -1, { WITHSCORES: true });
    expect(withScores).toEqual([
      { value: "a", score: 1 },
      { value: "c", score: 2 },
      { value: "b", score: 3 }
    ]);
  });

  it("updates scores and ranks", async () => {
    const client = await createIsolatedClient();
    await client.zAdd("scores", [
      { value: "x", score: 10 },
      { value: "y", score: 20 }
    ]);
    expect(await client.zScore("scores", "x")).toBe(10);
    expect(await client.zIncrBy("scores", 5, "x")).toBe(15);
    expect(await client.zRank("scores", "x")).toBe(0);
    expect(await client.zRank("scores", "x", true)).toBe(1);
  });

  it("removes members", async () => {
    const client = await createIsolatedClient();
    await client.zAdd("scores", [
      { value: "x", score: 10 },
      { value: "y", score: 20 }
    ]);
    expect(await client.zRem("scores", "x")).toBe(1);
    expect(await client.zCard("scores")).toBe(1);
  });

  it("rejects invalid zset score values", async () => {
    const client = await createIsolatedClient();
    await expect(
      client.zAdd("scores", [{ value: "x", score: Number.NaN }])
    ).rejects.toThrow("ERR score is not a valid float");
    await expect(client.zIncrBy("scores", Number.POSITIVE_INFINITY, "x")).rejects.toThrow(
      "ERR increment is not a valid float"
    );
  });

  it("rejects zset increment overflow to infinity", async () => {
    const client = await createIsolatedClient();
    await client.zAdd("scores", [{ value: "x", score: Number.MAX_VALUE }]);
    await expect(client.zIncrBy("scores", Number.MAX_VALUE, "x")).rejects.toThrow(
      "ERR resulting score is not a valid float"
    );
  });
});
