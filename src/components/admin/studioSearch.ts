// Lightweight subsequence fuzzy match: every query character must appear in
// order. Consecutive and word-boundary hits score higher, so "sh" ranks
// "start-here" above "wash".
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const haystack = target.toLowerCase();
  let score = 0;
  let cursor = 0;
  let previousMatch = -2;
  for (const char of query.toLowerCase()) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    score += found === previousMatch + 1 ? 3 : 1;
    if (found === 0 || /[\s/-]/.test(haystack[found - 1] ?? '')) score += 2;
    previousMatch = found;
    cursor = found + 1;
  }
  // Prefer shorter targets when scores tie.
  return score - target.length * 0.01;
}
