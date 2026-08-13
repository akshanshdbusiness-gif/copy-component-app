import { normalizeGuid } from "../guid";
import type { Rendering, RenderingSubtree } from "../types";

/**
 * Nested placeholder keys embed the parent rendering's uid, e.g.
 *   /headless-main/container-1-{81AFA0B5-2B9A-4B0F-B34E-5F5EC4C1E52C}-0
 * SXA and JSS have both emitted braced and bare uids over the years, so match
 * either and preserve whichever form the original key used.
 */
const UID_IN_KEY =
  /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/g;

/** Keys are compared case- and leading-slash-insensitively; Sitecore is inconsistent about both. */
export function normalizeKey(key: string): string {
  return key.trim().replace(/^\/+/, "").toLowerCase();
}

export function keysEqual(a: string, b: string): boolean {
  return normalizeKey(a) === normalizeKey(b);
}

/** True when `child` sits inside `parent`'s placeholder path (not equal to it). */
export function isDescendantKey(child: string, parent: string): boolean {
  const c = normalizeKey(child);
  const p = normalizeKey(parent);
  return c.startsWith(p + "/");
}

/**
 * Swap a key's leading `from` path for `to`, leaving the nested remainder alone.
 * Boundary-aware so "/main" never matches "/main-hero".
 */
export function rebasePrefix(key: string, from: string, to: string): string {
  const trimmed = key.trim();
  if (keysEqual(trimmed, from)) return to;
  if (!isDescendantKey(trimmed, from)) return key;
  // Normalisation only strips leading slashes and lowercases, so the tail keeps
  // its length — slice the original to preserve the remainder's casing.
  const remainder = normalizeKey(trimmed).slice(normalizeKey(from).length);
  return to + trimmed.slice(trimmed.length - remainder.length);
}

/**
 * Rewrite every uid that appears in a placeholder key, using a map of old to
 * new uids. Uids not in the map are left untouched — they belong to renderings
 * outside the subtree being copied.
 */
export function remapUidsInKey(key: string, uidMap: Map<string, string>): string {
  return key.replace(UID_IN_KEY, (match) => {
    const wasBraced = match.startsWith("{");
    const replacement = uidMap.get(normalizeGuid(match));
    if (!replacement) return match;
    return wasBraced ? replacement : replacement.replace(/[{}]/g, "");
  });
}

/**
 * Build old-uid to new-uid pairs for a whole subtree. Every instance gets a
 * fresh uid: uids must be unique per page, and reusing them would collide when
 * the target page already holds a copy.
 */
export function buildUidMap(
  subtree: RenderingSubtree,
  mintUid: () => string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const rendering of [subtree.root, ...subtree.descendants]) {
    map.set(normalizeGuid(rendering.uid), mintUid());
  }
  return map;
}

/**
 * Relocate a subtree into `targetKey` on another page: fresh uids throughout,
 * the root moved to the chosen placeholder, and every descendant key rebased
 * onto the root's new path with its embedded uids remapped.
 */
export function relocateSubtree(
  subtree: RenderingSubtree,
  targetKey: string,
  mintUid: () => string,
): RenderingSubtree {
  const uidMap = buildUidMap(subtree, mintUid);
  const sourceRootKey = subtree.root.placeholderKey;

  const relocate = (rendering: Rendering, isRoot: boolean): Rendering => {
    const rebased = isRoot
      ? targetKey
      : rebasePrefix(rendering.placeholderKey, sourceRootKey, targetKey);
    return {
      ...rendering,
      uid: uidMap.get(normalizeGuid(rendering.uid)) ?? rendering.uid,
      placeholderKey: remapUidsInKey(rebased, uidMap),
    };
  };

  return {
    root: relocate(subtree.root, true),
    descendants: subtree.descendants.map((d) => relocate(d, false)),
  };
}

/**
 * The placeholder keys a page currently uses. A key that no rendering occupies
 * is invisible here — Sitecore only records placeholders that hold something —
 * so this is the set an author can safely drop a component into, not every
 * placeholder the page's templates technically allow.
 */
export function usedPlaceholderKeys(renderings: Rendering[]): string[] {
  const seen = new Map<string, string>();
  for (const rendering of renderings) {
    const key = rendering.placeholderKey;
    if (!key) continue;
    if (!seen.has(normalizeKey(key))) seen.set(normalizeKey(key), key);
  }
  return [...seen.values()].sort((a, b) => {
    // Shallow keys first, then alphabetical — top-level placeholders are the
    // ones authors reach for most.
    const depth = (k: string) => normalizeKey(k).split("/").length;
    return depth(a) - depth(b) || a.localeCompare(b);
  });
}
