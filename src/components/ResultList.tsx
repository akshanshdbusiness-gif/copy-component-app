"use client";

import type { CopyResult } from "@/src/lib/types";

/**
 * Every target reports separately. A run that half-succeeds is a normal
 * outcome — Sitecore gives us no transaction across pages — so the panel
 * states plainly which pages took the copy and which did not.
 */
export function ResultList({ results }: { results: CopyResult[] }) {
  if (results.length === 0) return null;

  const failed = results.filter((r) => !r.ok).length;

  return (
    <div className="section">
      <p className="section__label">
        {failed === 0
          ? `Copied to ${results.length} page${results.length === 1 ? "" : "s"}`
          : `${results.length - failed} of ${results.length} pages copied`}
      </p>

      {results.map((result) => (
        <div
          key={result.targetPath}
          className={`result ${result.ok ? "result--ok" : "result--failed"}`}
        >
          <span className="option__name">{result.targetPath.split("/").pop()}</span>
          <span className="option__meta">{result.targetPath}</span>

          {result.error && <p className="notice notice--error">{result.error}</p>}

          {result.steps.length > 0 && (
            <ul className="result__steps">
              {result.steps.map((step, index) => (
                <li key={`${step.kind}-${index}`}>
                  {step.label}
                  {step.detail && <span className="option__meta"> — {step.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
