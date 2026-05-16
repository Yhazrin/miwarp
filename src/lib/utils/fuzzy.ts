/**
 * Fuzzy search utilities for command palette and skill discovery.
 * Implements Levenshtein distance and various fuzzy matching strategies.
 */

/**
 * Calculate Levenshtein distance between two strings.
 * This measures the minimum number of single-character edits needed to change one string into another.
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  // Quick check: if strings are equal (ignoring case), distance is 0
  if (aLower === bLower) return 0;

  // Quick check: if one is substring of the other, use a smaller matrix
  if (aLower.includes(bLower)) {
    return aLower.length - bLower.length;
  }
  if (bLower.includes(aLower)) {
    return bLower.length - aLower.length;
  }

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= bLower.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= aLower.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      if (bLower.charAt(i - 1) === aLower.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[bLower.length][aLower.length];
}

/**
 * Calculate similarity ratio between two strings (0-1).
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  return 1 - distance / maxLength;
}

/**
 * Check if query fuzzy matches target string.
 * Returns match score (higher = better match) or -1 if no match.
 *
 * Strategies:
 * 1. Exact substring match (highest priority)
 * 2. Word boundary match (query words start at word boundaries)
 * 3. Acronym match (query letters appear in sequence)
 * 4. Fuzzy match (Levenshtein distance within threshold)
 */
export interface FuzzyMatchResult {
  matched: boolean;
  score: number;
  strategy: "exact" | "substring" | "word_boundary" | "acronym" | "fuzzy" | null;
  matchedText?: string;
}

export function fuzzyMatch(query: string, target: string): FuzzyMatchResult {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();

  if (!q) {
    return { matched: true, score: 1, strategy: "exact" };
  }

  // Strategy 1: Exact match
  if (t === q) {
    return { matched: true, score: 1, strategy: "exact" };
  }

  // Strategy 2: Substring match
  if (t.includes(q)) {
    return {
      matched: true,
      score: 0.9 * (q.length / t.length),
      strategy: "substring",
      matchedText: t.substring(t.indexOf(q), t.indexOf(q) + q.length),
    };
  }

  // Strategy 3: Word boundary match - each query word starts at a word boundary
  const words = t.split(/\s+|-/);
  const queryWords = q.split(/\s+/);
  if (queryWords.every((qw) => words.some((w) => w.startsWith(qw)))) {
    return {
      matched: true,
      score: 0.8,
      strategy: "word_boundary",
    };
  }

  // Strategy 4: Acronym match - query letters appear in sequence
  if (matchAcronym(q, t)) {
    return { matched: true, score: 0.7, strategy: "acronym" };
  }

  // Strategy 5: Fuzzy match with Levenshtein
  const distance = levenshteinDistance(q, t);
  const threshold = Math.max(2, Math.floor(t.length / 4)); // Allow ~25% errors

  if (distance <= threshold) {
    const score = 1 - distance / Math.max(q.length, t.length);
    return { matched: true, score, strategy: "fuzzy" };
  }

  return { matched: false, score: 0, strategy: null };
}

/**
 * Check if query is an acronym of target.
 * e.g., "cte" matches "create trigger explanation"
 */
function matchAcronym(query: string, target: string): boolean {
  const letters = query.toLowerCase().replace(/\s+/g, "");
  const words = target.toLowerCase().split(/\s+|-/);

  let queryIndex = 0;
  for (const word of words) {
    if (queryIndex >= letters.length) return true;
    if (word.startsWith(letters[queryIndex])) {
      queryIndex++;
    }
  }

  return queryIndex === letters.length;
}

/**
 * Multi-field fuzzy search.
 * Searches across multiple fields and returns the best match score.
 */
export interface FuzzySearchOptions {
  threshold?: number; // Minimum score to consider a match (default: 0.3)
  weights?: Record<string, number>; // Field weights for scoring
}

export function multiFieldFuzzyMatch(
  query: string,
  fields: Record<string, string>,
  options: FuzzySearchOptions = {},
): { matched: boolean; score: number; field: string | null } {
  const { threshold = 0.3, weights = {} } = options;
  let bestScore = 0;
  let bestField: string | null = null;

  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    if (!fieldValue) continue;

    const result = fuzzyMatch(query, fieldValue);
    if (result.matched) {
      const weight = weights[fieldName] ?? 1;
      const weightedScore = result.score * weight;

      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestField = fieldName;
      }
    }
  }

  return {
    matched: bestScore >= threshold,
    score: bestScore,
    field: bestField,
  };
}

/**
 * Sort items by fuzzy match score (highest first).
 */
export function sortByFuzzyMatch<T>(
  items: T[],
  query: string,
  getSearchFields: (item: T) => Record<string, string>,
  options: FuzzySearchOptions = {},
): T[] {
  const scored = items.map((item) => {
    const fields = getSearchFields(item);
    const result = multiFieldFuzzyMatch(query, fields, options);
    return { item, ...result };
  });

  return scored
    .filter((s) => s.matched)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

/**
 * Highlight matched portions of text.
 * Returns segments of text with match info.
 */
export function highlightMatches(
  text: string,
  query: string,
): { text: string; highlighted: boolean }[] {
  if (!query) {
    return [{ text, highlighted: false }];
  }

  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const index = t.indexOf(q);

  if (index === -1) {
    return [{ text, highlighted: false }];
  }

  const segments: { text: string; highlighted: boolean }[] = [];

  if (index > 0) {
    segments.push({ text: text.substring(0, index), highlighted: false });
  }

  segments.push({
    text: text.substring(index, index + query.length),
    highlighted: true,
  });

  if (index + query.length < text.length) {
    segments.push({
      text: text.substring(index + query.length),
      highlighted: false,
    });
  }

  return segments;
}
