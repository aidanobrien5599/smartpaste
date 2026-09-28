// background.js is still JavaScript, so tsc cannot see it drift from the
// message types. This reads it instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MESSAGE_TYPES } from "../src/shared/messages.ts";

const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");

test("background handles exactly the message types shared/messages.ts lists", () => {
  const handled = [...background.matchAll(/message\.type === "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(handled, [...MESSAGE_TYPES].sort());
});
