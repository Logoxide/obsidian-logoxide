import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError, logoxideError } from "../src/core/errors.ts";

/** What logoxide's bindings throw: an Error whose message is only "LogoxideError", with the error in `value` */
function thrown(tag: string, message: string): Error {
  return Object.assign(new Error("LogoxideError"), { value: { tag, message } });
}

test("a logoxide error is described by its value, not its exception's message", () => {
  assert.equal(describeError(thrown("NotFound", "kjv: not installed")), "kjv: not installed");
  assert.deepEqual(logoxideError(thrown("Network", "timed out")), { tag: "Network", message: "timed out" });
  assert.equal(logoxideError(new Error("plain")), null);
  assert.equal(describeError(new Error("plain")), "plain");
  assert.equal(describeError("text"), "text");
});

test("busy and conflict errors say what to do", () => {
  assert.match(describeError(thrown("Busy", "library: locked by another process")), /^library: locked by another process \(another program.*try again in a moment\)$/);
  const conflict = describeError(thrown("Conflict", "logoxide.toml: changed since it was read (open it again and redo the change)"));
  assert.equal(conflict, "logoxide.toml: changed since it was read (it changed while this ran, by lx or another device's sync: try again)");
});
