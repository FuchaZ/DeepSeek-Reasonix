/** Structural equality for plain JSON data — what the stringify comparison
 *  answered, without building the strings. Key order is not data; a key that is
 *  there against one that is not, is. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const rest = b as unknown[];
    if (a.length !== rest.length) return false;
    return a.every((v, i) => sameJson(v, rest[i]));
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const xKeys = Object.keys(x);
  if (xKeys.length !== Object.keys(y).length) return false;
  for (const k of xKeys) {
    if (!Object.prototype.hasOwnProperty.call(y, k) || !sameJson(x[k], y[k])) return false;
  }
  return true;
}
