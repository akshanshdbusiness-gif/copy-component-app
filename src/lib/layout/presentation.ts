import { normalizeGuid } from "../guid";
import type { Rendering, RenderingSubtree } from "../types";
import { parseLayoutXml, renderingsForDevice } from "./layout-xml";

/**
 * `presentationDetails` is the *resolved* layout (shared + final merged), which
 * is what the picker needs — a component inherited from standard values is
 * absent from the final-renderings delta but is very much on the page.
 *
 * Pages and the Authoring API have both been observed handing this back as a
 * JSON string and as raw XML, so accept either rather than betting on one.
 */
export function parsePresentationDetails(
  details: string | Record<string, unknown> | null | undefined,
  deviceId?: string,
): Rendering[] {
  if (!details) return [];

  if (typeof details === "object") {
    return fromJson(details as JsonLayout, deviceId);
  }

  const text = details.trim();
  if (!text) return [];

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return fromJson(JSON.parse(text) as JsonLayout, deviceId);
    } catch {
      // Fall through — a leading brace could still be a braced device id in
      // some other encoding, and XML parsing simply returns [] if it isn't.
    }
  }

  return renderingsForDevice(parseLayoutXml(text), deviceId);
}

interface JsonRendering {
  [key: string]: unknown;
}

interface JsonLayout {
  devices?: Array<{ id?: string; renderings?: JsonRendering[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Pick the first present key — Sitecore's JSON layout naming has drifted across versions. */
function pick(source: JsonRendering, ...names: string[]): string {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function fromJson(layout: JsonLayout, deviceId?: string): Rendering[] {
  const devices = Array.isArray(layout.devices) ? layout.devices : [];
  if (devices.length === 0) return [];

  const device =
    (deviceId
      ? devices.find((d) => d.id && normalizeGuid(d.id) === normalizeGuid(deviceId))
      : undefined) ??
    devices.find((d) => Array.isArray(d.renderings) && d.renderings.length > 0) ??
    devices[0];

  const renderings = Array.isArray(device?.renderings) ? device.renderings : [];
  return renderings.map((r) => ({
    uid: pick(r, "instanceId", "uid", "uniqueId"),
    renderingItemId: pick(r, "id", "renderingId", "itemId"),
    placeholderKey: pick(r, "placeholderKey", "placeholder", "ph"),
    dataSource: pick(r, "dataSource", "datasource", "ds"),
    parameters: pick(r, "parameters", "renderingParameters", "par"),
    // Caching and personalization live in nested objects in the JSON form.
    // They are deliberately not carried over: personalization rules reference
    // the source page's own datasources and variants, and silently copying a
    // broken rule set is worse than leaving the copy unpersonalized.
    extraAttributes: {},
  }));
}

/**
 * Collect a rendering and everything nested inside it.
 *
 * Nested placeholder keys embed the parent instance's uid, so descendants are
 * found by uid reachability rather than by string-prefixing the key — that
 * survives the several key formats SXA and JSS have emitted, and it correctly
 * ignores a sibling whose key merely starts with the same text.
 */
export function collectSubtree(
  renderings: Rendering[],
  rootUid: string,
): RenderingSubtree | null {
  const root = renderings.find((r) => normalizeGuid(r.uid) === normalizeGuid(rootUid));
  if (!root) return null;

  const reachable = new Set([normalizeGuid(root.uid)]);
  const descendants: Rendering[] = [];

  // Iterate to a fixed point: each pass can reveal a deeper level of nesting.
  let grew = true;
  while (grew) {
    grew = false;
    for (const rendering of renderings) {
      const uid = normalizeGuid(rendering.uid);
      if (reachable.has(uid)) continue;
      if (!keyReferencesAny(rendering.placeholderKey, reachable)) continue;
      reachable.add(uid);
      descendants.push(rendering);
      grew = true;
    }
  }

  // Restore document order — the fixed-point walk visits by depth, and
  // rendering order within a placeholder is author-visible.
  const order = new Map(renderings.map((r, i) => [normalizeGuid(r.uid), i]));
  descendants.sort(
    (a, b) => (order.get(normalizeGuid(a.uid)) ?? 0) - (order.get(normalizeGuid(b.uid)) ?? 0),
  );

  return { root, descendants };
}

const UID_IN_KEY =
  /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/g;

function keyReferencesAny(key: string, uids: Set<string>): boolean {
  if (!key) return false;
  const matches = key.match(UID_IN_KEY);
  if (!matches) return false;
  return matches.some((m) => uids.has(normalizeGuid(m)));
}
