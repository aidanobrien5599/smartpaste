/**
 * Where you would work: a ranked list of places, and whether anywhere is fine.
 *
 * Forms ask this in many shapes -- "Which office would you prefer?" over a
 * dropdown of hubs, "Are you open to relocating to New York?", "List the
 * locations you'd consider" -- so the list is given to Jev three ways: the
 * whole ranking, the single top choice, and whether anywhere is fine. It
 * picks whichever the question needs; a dropdown of offices gets the
 * highest-ranked one it offers.
 */

/** Stored shape, cleaned: { ranked: [most preferred first], anywhere }. */
export function normalizePlaces(value) {
  const ranked = [];
  for (const place of Array.isArray(value?.ranked) ? value.ranked : []) {
    const text = String(place || "").replace(/\s+/g, " ").trim();
    if (text && !ranked.some((p) => p.toLowerCase() === text.toLowerCase())) ranked.push(text);
  }
  return { ranked, anywhere: Boolean(value?.anywhere) };
}

// "Open to any location" named no city, so asked "Are you based in or
// planning to relocate to the NYC area?" (Garner Health) Jev reached for the
// top-ranked city -- a place, not a Yes -- and the dropdown stayed blank.
// Worded as the question forms actually ask, it names the city they name.
const ANYWHERE = "Willing to work in, or relocate to, a particular city, " +
  "region or office the job names -- open to any location";

/** Profile options for these preferences, in buildOptions' shape. */
export function placesOptions(value) {
  const { ranked, anywhere } = normalizePlaces(value);
  const options = {};
  if (ranked.length) {
    options.work_locations = {
      field: "Places I would like to work, most preferred first (not where I live now)",
      value: ranked.map((p, i) => `${i + 1}. ${p}`).join("; ") +
        (anywhere ? "; and open to any other location" : ""),
    };
    options.top_work_location = {
      field: "Preferred office or city to work in (not where I live now)",
      value: ranked[0],
    };
  }
  if (anywhere || ranked.length) {
    options.open_to_any_location = {
      field: anywhere ? ANYWHERE : "Open to working in any location or office",
      value: anywhere
        ? "Yes, open to any location"
        : `No, only these: ${ranked.join("; ")}`,
    };
  }
  return options;
}

/**
 * A Yes/No question answered by a place preference says Yes when anywhere is
 * fine. Asked whether it would relocate to the NYC area, Jev picks the top
 * city ("New York City") -- the right entry, but a place, not a Yes. Jev
 * chose that the question is about where you would work; being open to any
 * location is what makes the answer Yes. Without "anywhere" a place is no
 * answer: matching "NYC area" against a list is a guess.
 */
export function placeSaysYes(key, options) {
  if (!["work_locations", "top_work_location", "open_to_any_location"].includes(key)) return false;
  return /^yes\b/i.test(String(options.open_to_any_location?.value || "").trim());
}
