"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthoringClient } from "@/src/lib/marketplace/authoring";
import type { PageSummary } from "@/src/lib/types";

interface Props {
  authoring: AuthoringClient;
  rootPath: string;
  language: string;
  /** The page being edited — it is listed but cannot be its own target. */
  sourcePagePath: string;
  selected: PageSummary[];
  onChange: (selected: PageSummary[]) => void;
}

/**
 * A drill-down browser rather than a flat list: a site's page tree is far too
 * big to enumerate, and authors think in terms of where a page sits.
 * Selections survive navigation, which is what makes copying to several pages
 * in one pass workable.
 */
export function TargetPagePicker({
  authoring,
  rootPath,
  language,
  sourcePagePath,
  selected,
  onChange,
}: Props) {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [children, setChildren] = useState<PageSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentPath(rootPath);
  }, [rootPath]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    authoring
      .getChildren(currentPath, language)
      .then((nodes) => {
        if (!active) return;
        setChildren(nodes.filter((node) => node.hasPresentation || node.hasChildren));
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authoring, currentPath, language]);

  const toggle = useCallback(
    (page: PageSummary) => {
      const isSelected = selected.some((p) => p.itemId === page.itemId);
      onChange(
        isSelected ? selected.filter((p) => p.itemId !== page.itemId) : [...selected, page],
      );
    },
    [selected, onChange],
  );

  const canGoUp = currentPath.toLowerCase() !== rootPath.toLowerCase();

  return (
    <div className="section">
      <p className="section__label">
        Copy to {selected.length > 0 ? `(${selected.length} selected)` : ""}
      </p>

      <div className="crumbs">
        {canGoUp && (
          <button
            type="button"
            className="linkbutton"
            onClick={() => setCurrentPath(parentOf(currentPath))}
          >
            ↑ Up
          </button>
        )}
        <span>{shorten(currentPath, rootPath)}</span>
      </div>

      {error && <p className="notice notice--error">{error}</p>}
      {isLoading && <p className="spinner">Loading pages…</p>}

      {!isLoading && !error && children.length === 0 && (
        <p className="notice">No pages here.</p>
      )}

      <ul className="list">
        {children.map((page) => {
          const isSource = page.path.toLowerCase() === sourcePagePath.toLowerCase();
          const isSelected = selected.some((p) => p.itemId === page.itemId);
          return (
            <li key={page.itemId}>
              <div className="option" data-selected={isSelected}>
                <label className="radio option__body">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isSource || !page.hasPresentation}
                    onChange={() => toggle(page)}
                  />
                  <span className="option__body">
                    <span className="option__name">{page.displayName}</span>
                    <span className="option__meta">
                      {isSource
                        ? "The page you are editing"
                        : page.hasPresentation
                          ? page.path
                          : "Folder — no presentation"}
                    </span>
                  </span>
                </label>
                {page.hasChildren && (
                  <button
                    type="button"
                    className="linkbutton"
                    onClick={() => setCurrentPath(page.path)}
                  >
                    Open →
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function parentOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return `/${segments.slice(0, -1).join("/")}`;
}

/** Paths are long and the panel is narrow — show the part below the site root. */
function shorten(path: string, rootPath: string): string {
  if (path.toLowerCase() === rootPath.toLowerCase()) return path.split("/").pop() ?? path;
  if (path.toLowerCase().startsWith(rootPath.toLowerCase() + "/")) {
    return `${rootPath.split("/").pop()}/${path.slice(rootPath.length + 1)}`;
  }
  return path;
}
