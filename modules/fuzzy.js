// Small fuzzy matcher for the area search. Pure: no DOM, no dependencies.
//
// Names and queries are folded to lowercase ASCII letters and digits ("compact"
// form); punctuation, hyphens, apostrophes and spaces only mark token edges.
// Match tiers, best first: exact > prefix > word-start > substring > one typo
// (queries of 4+ characters, Damerau distance on tokens) > subsequence.

export const TIER = Object.freeze({
  exact: 1000, prefix: 900, wordStart: 700, substring: 500, typo: 300, typoPrefix: 250, subsequence: 100,
});

/** Extra searchable names (key: compact form of the official CBS name). */
export const ALIASES = Object.freeze({
  sgravenhage:     ['Den Haag', 'The Hague'],
  shertogenbosch:  ['Den Bosch'],
  noordoostpolder: ['Emmeloord'],
  sudwestfryslan:  ['Súdwest Fryslân', 'Zuidwest Friesland'],
  fryslan:         ['Friesland'],
});

const LEVEL_ORDER = {
  rotterdam: { wijk: 0, buurt: 1, gemeente: 2, provincie: 3 },
  nederland: { gemeente: 0, provincie: 1, wijk: 2, buurt: 3 },
};

/** Folds one string: lowercase, diacritics stripped (NFKD), only [a-z0-9]. */
export function normalize(str) {
  return prep(str).compact;
}

/**
 * Prepares a string for matching. Returns
 * { text, compact, map: compact index → index in `text`, tokens: [{ text, start }] }.
 */
export function prep(text) {
  const src = String(text ?? '');
  let compact = '';
  const map = [];
  const tokens = [];
  let tokenStart = -1;
  for (let i = 0; i < src.length; i++) {
    const folded = src[i].normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!folded) {
      // Diacritic marks that NFKD left as separate code points do not split a token.
      if (/\p{M}/u.test(src[i])) continue;
      if (tokenStart >= 0) { tokens.push({ text: compact.slice(tokenStart), start: tokenStart }); tokenStart = -1; }
      continue;
    }
    if (tokenStart < 0) tokenStart = compact.length;
    for (const ch of folded) { compact += ch; map.push(i); }
  }
  if (tokenStart >= 0) tokens.push({ text: compact.slice(tokenStart), start: tokenStart });
  return { text: src, compact, map, tokens };
}

/** Optimal-string-alignment (Damerau) distance, capped: returns max + 1 when larger. */
export function damerau(a, b, max = 1) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i++) {
    rows[i] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) { rows[0][j] = j; continue; }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2][j - 2] + 1);
      rows[i][j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (i > 0 && rowMin > max) return max + 1;
  }
  return Math.min(rows[a.length][b.length], max + 1);
}

/** Smallest distance between `q` and `t` or a prefix of `t` (for half-typed words). */
function tokenDistance(q, t) {
  const full = damerau(q, t, 1);
  if (full === 0 || q.length >= t.length) return { dist: full, len: t.length, whole: true };
  let best = { dist: full, len: t.length, whole: true };
  for (const len of [q.length - 1, q.length, q.length + 1]) {
    if (len < 1 || len >= t.length) continue;
    const d = damerau(q, t.slice(0, len), 1);
    if (d < best.dist) best = { dist: d, len, whole: false };
  }
  return best;
}

function range(start, length) {
  return Array.from({ length }, (_, k) => start + k);
}

/**
 * Scores a prepared query against a prepared name.
 * Returns null (no match) or { score, indices: compact positions that matched }.
 */
export function scorePrepared(q, name) {
  const qc = q.compact;
  const nc = name.compact;
  if (!qc || !nc) return null;
  // Short names rank above long ones inside a tier, never across tiers.
  const lengthPenalty = Math.min(Math.max(nc.length - qc.length, 0), 50) / 100;

  if (nc === qc) return { score: TIER.exact, indices: range(0, qc.length) };
  // A query that ends on a word boundary ("kralingen" in "Kralingen West") matches every
  // such name equally well: no length penalty, so the level order breaks the tie.
  const endsOnWord = end => end === nc.length || name.tokens.some(t => t.start === end);
  if (nc.startsWith(qc)) {
    return { score: TIER.prefix - (endsOnWord(qc.length) ? 0 : lengthPenalty), indices: range(0, qc.length) };
  }

  const wordStart = name.tokens.find(t => t.start > 0 && nc.startsWith(qc, t.start));
  if (wordStart) {
    const end = wordStart.start + qc.length;
    return { score: TIER.wordStart - (endsOnWord(end) ? 0 : lengthPenalty), indices: range(wordStart.start, qc.length) };
  }

  if (qc.length >= 2) {
    const at = nc.indexOf(qc);
    if (at >= 0) return { score: TIER.substring - lengthPenalty, indices: range(at, qc.length) };
  }

  if (qc.length >= 4) {
    const typo = typoMatch(q, name);
    if (typo) return { score: typo.score - lengthPenalty, indices: typo.indices };
  }

  if (qc.length >= 3) {
    const indices = [];
    let j = 0;
    for (let i = 0; i < nc.length && j < qc.length; i++) if (nc[i] === qc[j]) { indices.push(i); j++; }
    if (j === qc.length) {
      const span = indices[indices.length - 1] - indices[0] + 1;
      // Denser subsequences score higher, still far below a typo match.
      return { score: TIER.subsequence + Math.round(50 * qc.length / span) - lengthPenalty, indices };
    }
  }
  return null;
}

// Every query token must match a distinct name token (whole or as prefix) and the
// edits over all tokens may add up to one. Query "krlingen" → "Kralingen-West".
function typoMatch(q, name) {
  const qTokens = q.tokens.length ? q.tokens : [{ text: q.compact, start: 0 }];
  const candidates = [qTokens];
  if (qTokens.length > 1) candidates.push([{ text: q.compact, start: 0 }]);   // "zuid holand" vs "zuidholland"
  let best = null;
  for (const tokens of candidates) {
    const nameTokens = tokens.length === 1 && name.tokens.length > 1
      ? [...name.tokens, { text: name.compact, start: 0 }]
      : name.tokens;
    const used = new Set();
    let edits = 0;
    let whole = true;
    const indices = [];
    let ok = true;
    for (const qt of tokens) {
      let pick = null;
      nameTokens.forEach((nt, k) => {
        if (used.has(k)) return;
        const d = tokenDistance(qt.text, nt.text);
        if (d.dist > 1) return;
        if (!pick || d.dist < pick.d.dist || (d.dist === pick.d.dist && d.whole && !pick.d.whole)) pick = { k, nt, d };
      });
      if (!pick) { ok = false; break; }
      used.add(pick.k);
      edits += pick.d.dist;
      whole = whole && pick.d.whole;
      indices.push(...range(pick.nt.start, Math.min(pick.d.len, pick.nt.text.length)));
    }
    if (!ok || edits > 1) continue;
    const score = whole ? TIER.typo : TIER.typoPrefix;
    if (!best || score > best.score) best = { score, indices };
  }
  return best;
}

/** Compact positions → [start, end) ranges in the original text (for <mark>). */
export function toRanges(prepared, indices) {
  const orig = [...new Set(indices.map(i => prepared.map[i]))].sort((a, b) => a - b);
  const out = [];
  for (const i of orig) {
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}

/** Scores raw strings: { score, ranges } or null. Handy for tests. */
export function scoreName(query, name) {
  const n = prep(name);
  const hit = scorePrepared(prep(query), n);
  return hit ? { score: hit.score, ranges: toRanges(n, hit.indices) } : null;
}

/**
 * Builds a search function over `items` ({ code, name, level, scope }).
 * search(query, { scope, limit }) → [{ item, score, ranges, alias }], best first.
 * `ranges` index into `alias` when the hit came from an alias, else into `item.name`.
 */
export function createSearcher(items) {
  const entries = items.map(item => {
    const main = prep(item.name);
    const aliases = item.level === 'gemeente' || item.level === 'provincie'
      ? (ALIASES[main.compact] ?? []).map(prep)
      : [];
    return { item, names: [main, ...aliases] };
  });

  return function search(query, { scope = 'rotterdam', limit = 12 } = {}) {
    const q = prep(query);
    if (!q.compact) return [];
    const order = LEVEL_ORDER[scope] ?? LEVEL_ORDER.rotterdam;
    const hits = [];
    for (const { item, names } of entries) {
      let best = null;
      names.forEach((n, k) => {
        const hit = scorePrepared(q, n);
        if (hit && (!best || hit.score > best.score)) best = { ...hit, name: n, alias: k > 0 };
      });
      if (best) hits.push({ item, score: best.score, ranges: toRanges(best.name, best.indices), alias: best.alias ? best.name.text : null });
    }
    hits.sort((a, b) =>
      (b.score - a.score)
      || ((order[a.item.level] ?? 9) - (order[b.item.level] ?? 9))
      || a.item.name.localeCompare(b.item.name, 'nl'));
    return hits.slice(0, limit);
  };
}
