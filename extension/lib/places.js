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
      field: "Open to working in any location or office",
      value: anywhere
        ? "Yes, open to any location"
        : `No, only these: ${ranked.join("; ")}`,
    };
  }
  return options;
}
