/**
 * Sitecore stores ids in registry form — braced, upper-case, hyphenated.
 * The Authoring API accepts either form on input but echoes this one back,
 * so everything is normalised to it before comparison.
 */
export function normalizeGuid(value: string): string {
  const hex = value.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 32) return value.trim().toUpperCase();
  const upper = hex.toUpperCase();
  return `{${upper.slice(0, 8)}-${upper.slice(8, 12)}-${upper.slice(12, 16)}-${upper.slice(16, 20)}-${upper.slice(20)}}`;
}

export function guidsEqual(a: string, b: string): boolean {
  return normalizeGuid(a) === normalizeGuid(b);
}

/** True when the string is a guid in any of the forms Sitecore accepts. */
export function isGuid(value: string): boolean {
  return /^[0-9a-fA-F]{32}$/.test(value.replace(/[^0-9a-fA-F]/g, ""));
}

/**
 * New rendering uids must be unique per page. crypto.randomUUID is available in
 * every browser the Cloud Portal supports and in Node 19+, which covers the
 * tests too.
 */
export function newGuid(): string {
  return normalizeGuid(crypto.randomUUID());
}
