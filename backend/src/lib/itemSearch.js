// Relevance ranking for the POS item picker (spec slice: category-aware search).
//
// The Inventory grid (listItems) browses alphabetically + paginated; the POS
// picker has a different job: given a short, loose query, surface the few MOST
// RELEVANT items fast. The old picker did a single case-insensitive substring on
// name|sku with NO ranking, so a loose query (e.g. "ac/dc") buried the right
// category under incidental substring hits (a color like "Black" contains "ac")
// and never matched the category at all.
//
// This ranker fixes both: it tokenizes the query, requires EVERY token to match a
// word-prefix in the item's name, sku, OR category name (AND across tokens — this
// is what drops "Black" from "ac/dc"), then scores name relevance above category
// above sku so the right items rise to the top.

/** Lowercase + split on any non-alphanumeric run → word tokens. "AC/DC" → [ac,dc]. */
export function tokenize(s) {
  return String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

// Does some word in `words` start with `token`? (word-prefix match)
function prefixHit(words, token) {
  return words.some((w) => w.startsWith(token));
}
// Does some word in `words` equal `token` exactly?
function exactHit(words, token) {
  return words.some((w) => w === token);
}

// Per-token score against one field's word list: exact word > prefix > none.
function tokenFieldScore(words, token, exactPts, prefixPts) {
  if (exactHit(words, token)) return exactPts;
  if (prefixHit(words, token)) return prefixPts;
  return 0;
}

/**
 * Rank `items` by relevance to `query`, returning the top `limit` (default 8).
 * Each item is `{ name, sku, categoryId: { name } | null, ... }` (category may be
 * an unpopulated id or null — treated as no category name). Items are returned
 * unchanged (same references), just filtered + ordered.
 */
export function rankItemMatches(items, query, limit = 8) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const fullQuery = tokens.join(" "); // normalized, separator-free

  const scored = [];
  for (const item of items) {
    const nameLower = String(item.name ?? "").toLowerCase();
    const nameWords = tokenize(item.name);
    const skuWords = tokenize(item.sku);
    const catName = item.categoryId && typeof item.categoryId === "object" ? item.categoryId.name : "";
    const catWords = tokenize(catName);

    // Candidacy: every token must word-prefix-match name, sku, or category.
    const everyTokenMatches = tokens.every(
      (t) => prefixHit(nameWords, t) || prefixHit(skuWords, t) || prefixHit(catWords, t)
    );
    if (!everyTokenMatches) continue;

    let score = 0;
    // Whole-query shortcuts (most specific wins the top slot).
    if (nameLower === fullQuery) score += 1000;
    else if (nameLower.startsWith(fullQuery)) score += 400;

    let allTokensInName = true;
    for (const t of tokens) {
      const nameScore = tokenFieldScore(nameWords, t, 60, 40);
      const catScore = tokenFieldScore(catWords, t, 30, 20);
      const skuScore = tokenFieldScore(skuWords, t, 15, 12);
      score += nameScore + catScore + skuScore;
      if (nameScore === 0) allTokensInName = false;
    }
    // Reward items whose NAME carries the whole query over category-only matches.
    if (allTokensInName) score += 50;

    scored.push({ item, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.item.name).length - String(b.item.name).length || // shorter = more specific
      String(a.item.name).localeCompare(String(b.item.name))
  );

  return scored.slice(0, limit).map((s) => s.item);
}
