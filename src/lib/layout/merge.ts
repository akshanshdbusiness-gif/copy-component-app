import { normalizeGuid } from "../guid";
import type { Rendering } from "../types";
import { parseLayoutXml, renderingsForDevice } from "./layout-xml";

/**
 * Resolve a page's effective layout from its two stored fields.
 *
 * The Authoring API exposes no pre-resolved layout, so the merge Sitecore does
 * internally has to happen here: `__Renderings` is the base (already inherited
 * through standard values by the field read) and `__Final Renderings` is a
 * patch on top of it.
 *
 * Patch semantics that matter:
 * - A final entry whose uid exists in the base *overrides* it, and may carry
 *   only the attributes that changed — so attributes are overlaid one by one
 *   rather than the whole entry being swapped, or an unchanged datasource
 *   would be read as empty.
 * - A final entry with a new uid is an addition.
 * - Base entries the delta says nothing about survive untouched.
 */
export function resolveLayout(
  sharedXml: string | null | undefined,
  finalXml: string | null | undefined,
  deviceId?: string,
): Rendering[] {
  const base = renderingsForDevice(parseLayoutXml(sharedXml), deviceId);
  const delta = renderingsForDevice(parseLayoutXml(finalXml), deviceId);
  if (delta.length === 0) return base;

  const merged = base.map((rendering) => ({ ...rendering }));
  const indexByUid = new Map(
    merged.map((rendering, index) => [normalizeGuid(rendering.uid), index]),
  );

  for (const override of delta) {
    const existing = indexByUid.get(normalizeGuid(override.uid));
    if (existing === undefined) {
      merged.push({ ...override });
      indexByUid.set(normalizeGuid(override.uid), merged.length - 1);
      continue;
    }
    merged[existing] = overlay(merged[existing], override);
  }

  return merged;
}

/** Non-empty values from the patch win; anything it omits keeps the base value. */
function overlay(base: Rendering, patch: Rendering): Rendering {
  return {
    uid: base.uid,
    renderingItemId: patch.renderingItemId || base.renderingItemId,
    placeholderKey: patch.placeholderKey || base.placeholderKey,
    dataSource: patch.dataSource || base.dataSource,
    parameters: patch.parameters || base.parameters,
    extraAttributes: { ...base.extraAttributes, ...patch.extraAttributes },
  };
}
