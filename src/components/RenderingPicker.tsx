"use client";

import type { Rendering } from "@/src/lib/types";
import { normalizeGuid } from "@/src/lib/guid";
import { collectSubtree } from "@/src/lib/layout/presentation";

interface Props {
  renderings: Rendering[];
  names: Map<string, string>;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
}

/**
 * Lists what is on the page, grouped by placeholder.
 *
 * Pages cannot put a button on the component itself — a Marketplace app only
 * gets the context panel — so the panel has to make "which component" an
 * explicit choice. Nesting counts are shown because picking a container copies
 * everything inside it.
 */
export function RenderingPicker({ renderings, names, selectedUid, onSelect }: Props) {
  if (renderings.length === 0) {
    return <p className="notice">This page has no components to copy.</p>;
  }

  const groups = groupByPlaceholder(renderings);

  return (
    <div className="section">
      <p className="section__label">Component to copy</p>
      {groups.map(([placeholderKey, items]) => (
        <div key={placeholderKey} className="section">
          <p className="option__meta">{placeholderKey}</p>
          <ul className="list">
            {items.map((rendering) => {
              const nested = countNested(renderings, rendering.uid);
              return (
                <li key={rendering.uid}>
                  <button
                    type="button"
                    className="option"
                    aria-pressed={isSelected(selectedUid, rendering.uid)}
                    onClick={() => onSelect(rendering.uid)}
                  >
                    <span className="option__body">
                      <span className="option__name">
                        {names.get(rendering.renderingItemId) ?? "Component"}
                      </span>
                      <span className="option__meta">
                        {describeDataSource(rendering.dataSource)}
                      </span>
                    </span>
                    {nested > 0 && (
                      <span className="badge">+{nested} nested</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function isSelected(selectedUid: string | null, uid: string): boolean {
  return selectedUid !== null && normalizeGuid(selectedUid) === normalizeGuid(uid);
}

/** Top-level placeholders first, so the page reads roughly top to bottom. */
function groupByPlaceholder(renderings: Rendering[]): Array<[string, Rendering[]]> {
  const groups = new Map<string, Rendering[]>();
  for (const rendering of renderings) {
    const key = rendering.placeholderKey || "(no placeholder)";
    const existing = groups.get(key);
    if (existing) existing.push(rendering);
    else groups.set(key, [rendering]);
  }
  return [...groups.entries()].sort(
    ([a], [b]) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
}

function countNested(renderings: Rendering[], uid: string): number {
  return collectSubtree(renderings, uid)?.descendants.length ?? 0;
}

function describeDataSource(dataSource: string): string {
  if (!dataSource) return "No datasource";
  if (dataSource.startsWith("/")) return dataSource;
  if (/^(query:|\$)/i.test(dataSource)) return `Dynamic datasource (${dataSource})`;
  return "Datasource set";
}
