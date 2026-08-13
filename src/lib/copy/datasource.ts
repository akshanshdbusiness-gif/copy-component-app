import { isGuid } from "../guid";
import type { DataSourceClassification } from "../types";

/** /sitecore/templates/Common/Folder — the fallback when the source folder's own template is unknown. */
export const COMMON_FOLDER_TEMPLATE_ID = "{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}";

/**
 * A datasource is "local" when it lives under the page that renders it — the
 * `<page>/Data/...` convention. Those get copied alongside the component, so
 * the copy owns its own content. Anything else is shared on purpose, and the
 * copy points at the same item rather than forking it.
 */
export function classifyDataSource(
  dataSource: string,
  sourcePagePath: string,
  resolvedPath?: string,
): DataSourceClassification {
  const value = (dataSource ?? "").trim();
  if (!value) return { scope: "none" };

  // Sitecore query and token datasources resolve per-page at render time —
  // copying whatever they happen to point at right now would be wrong.
  if (/^(query:|\$)/i.test(value)) return { scope: "global" };

  const path = value.startsWith("/") ? value : resolvedPath;
  if (!path) {
    // An unresolvable id is treated as shared: pointing the copy at the
    // original is recoverable, inventing a copy of an unknown item is not.
    return { scope: "global" };
  }

  const relative = relativeUnder(path, sourcePagePath);
  return relative ? { scope: "local", relativePath: relative } : { scope: "global" };
}

/** "…/home/about" + "…/home" -> "about"; null when `path` is not underneath `ancestor`. */
export function relativeUnder(path: string, ancestor: string): string | null {
  const p = path.replace(/\/+$/, "");
  const a = ancestor.replace(/\/+$/, "");
  if (p.toLowerCase() === a.toLowerCase()) return null;
  if (!p.toLowerCase().startsWith(a.toLowerCase() + "/")) return null;
  return p.slice(a.length + 1);
}

/** "Data/Promo" -> { folders: ["Data"], name: "Promo" } */
export function splitRelativePath(relativePath: string): { folders: string[]; name: string } {
  const segments = relativePath.split("/").filter(Boolean);
  return { folders: segments.slice(0, -1), name: segments[segments.length - 1] ?? "" };
}

/**
 * Sitecore permits duplicate sibling names but Pages and link fields get
 * ambiguous fast, so a collision is resolved by suffixing rather than
 * overwriting — a second copy of a component must never edit the first one's
 * content.
 */
export function uniqueName(desired: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;
  for (let suffix = 1; suffix < 1000; suffix++) {
    const candidate = `${desired}-${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${desired}-${Date.now()}`;
}

/** Datasource values that need resolving from an id to a path before classification. */
export function needsPathResolution(dataSource: string): boolean {
  const value = (dataSource ?? "").trim();
  return Boolean(value) && !value.startsWith("/") && !/^(query:|\$)/i.test(value) && isGuid(value);
}
