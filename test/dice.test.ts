import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatRoll,
  parseDiceNotation,
  rollDice,
  rollDie,
} from "../src/dice.js";

describe("parseDiceNotation", () => {
  test("accepts the supported grammar and returns canonical notation", () => {
    assert.deepEqual(parseDiceNotation("d6"), {
      count: 1,
      sides: 6,
      modifier: 0,
      notation: "1d6",
    });
    assert.deepEqual(parseDiceNotation("2d20+3"), {
      count: 2,
      sides: 20,
      modifier: 3,
      notation: "2d20+3",
    });
    assert.deepEqual(parseDiceNotation("3d6-2"), {
      count: 3,
      sides: 6,
      modifier: -2,
      notation: "3d6-2",
    });
  });

  test("accepts uppercase D and outer ASCII whitespace", () => {
    assert.deepEqual(parseDiceNotation("\t 02D006+0003\r\n"), {
      count: 2,
      sides: 6,
      modifier: 3,
      notation: "2d6+3",
    });
  });

  test("accepts every numeric boundary", () => {
    assert.equal(parseDiceNotation("1d2-1000000")?.notation, "1d2-1000000");
    assert.equal(parseDiceNotation("100d1000+1000000")?.notation, "100d1000+1000000");
  });

  test("rejects unsupported grammar before rolling", () => {
    const invalid = [
      "",
      "d",
      "2d",
      "2d6 + 1",
      "2 d6",
      "2d6*2",
      "2d6+1+1",
      "-1d6",
      "2d6.5",
      "2d6x",
      "\u00a0d6\u00a0",
    ];
    for (const notation of invalid) {
      assert.equal(parseDiceNotation(notation), null, notation);
    }
  });

  test("rejects values outside every numeric boundary", () => {
    const invalid = ["0d6", "101d6", "d1", "d1001", "d6+1000001", "d6-1000001"];
    for (const notation of invalid) {
      assert.equal(parseDiceNotation(notation), null, notation);
    }
  });

  test("rejects raw notation longer than 32 characters", () => {
    assert.equal(parseDiceNotation(`${" ".repeat(30)}d6`)?.notation, "1d6");
    assert.equal(parseDiceNotation(`${" ".repeat(31)}d6`), null);
  });
});

describe("rolling", () => {
  test("uses rejection sampling instead of modulo bias", () => {
    const samples = [0xffffffff, 5];
    assert.equal(rollDie(6, () => samples.shift()!), 6);
    assert.equal(samples.length, 0);
  });

  test("returns individual values and the modifier-adjusted total", () => {
    const values = [3, 7];
    const result = rollDice(
      { count: 2, sides: 20, modifier: 3, notation: "2d20+3" },
      () => values.shift()! - 1,
    );
    assert.deepEqual(result, { values: [3, 7], total: 13 });
  });

  test("formats canonical notation, individual values, and total", () => {
    assert.equal(
      formatRoll(
        { count: 3, sides: 6, modifier: -2, notation: "3d6-2" },
        { values: [2, 4, 6], total: 10 },
      ),
      "3d6-2: [2, 4, 6] = 10",
    );
  });

  test("keeps the maximum supported result below Discord's content limit", () => {
    const spec = parseDiceNotation("100d1000+1000000");
    assert.ok(spec);
    const output = formatRoll(spec, {
      values: Array.from({ length: 100 }, () => 1000),
      total: 1_100_000,
    });
    assert.ok(output.length < 2_000);
  });
});
