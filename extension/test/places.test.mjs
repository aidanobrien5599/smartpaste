// Where you would work. Run: node --test extension/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlaces, placesOptions } from "../lib/places.js";
import { buildOptions } from "../lib/profile.js";

test("normalizePlaces trims, drops blanks and case-insensitive repeats, keeps rank", () => {
  assert.deepEqual(
    normalizePlaces({ ranked: ["New York, NY", "  ", "San  Francisco, CA", " new york, ny "], anywhere: 1 }),
    { ranked: ["New York, NY", "San Francisco, CA"], anywhere: true }
  );
  assert.deepEqual(normalizePlaces(undefined), { ranked: [], anywhere: false });
});

test("placesOptions: the ranking, the top choice, and whether anywhere is fine", () => {
  const o = placesOptions({ ranked: ["New York, NY", "San Francisco, CA"], anywhere: false });
  assert.equal(o.work_locations.value, "1. New York, NY; 2. San Francisco, CA");
  assert.equal(o.top_work_location.value, "New York, NY");
  assert.equal(o.open_to_any_location.value, "No, only these: New York, NY; San Francisco, CA");
  assert.match(o.top_work_location.field, /not where I live/);

  const any = placesOptions({ ranked: [], anywhere: true });
  assert.deepEqual(Object.keys(any), ["open_to_any_location"]);
  assert.equal(any.open_to_any_location.value, "Yes, open to any location");

  assert.deepEqual(placesOptions({ ranked: [], anywhere: false }), {});
});

test("buildOptions includes place preferences next to the current location", () => {
  const options = buildOptions({
    location: "Madison, Wisconsin",
    work_locations: { ranked: ["New York, NY"], anywhere: true },
  });
  assert.equal(options.location.value, "Madison, Wisconsin");
  assert.equal(options.top_work_location.value, "New York, NY");
  assert.match(options.work_locations.value, /and open to any other location$/);
});
