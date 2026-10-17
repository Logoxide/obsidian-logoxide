import { test } from "node:test";
import assert from "node:assert/strict";
import { moveTo, pickOrder } from "../src/core/pick.ts";

test("a pick list shows the picked first, in their order", () => {
  assert.deepEqual(pickOrder(["a", "b", "c", "d"], ["c", "a", "gone"]), ["c", "a", "b", "d"]);
  assert.deepEqual(pickOrder(["a", "b"], []), ["a", "b"]);
});

test("moving a picked choice", () => {
  assert.deepEqual(moveTo(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(moveTo(["a", "b", "c"], "a", 2), ["b", "c", "a"]);
  assert.deepEqual(moveTo(["a", "b", "c"], "a", 9), ["b", "c", "a"]);
  assert.deepEqual(moveTo(["a", "b"], "x", 0), ["a", "b"]);
});
