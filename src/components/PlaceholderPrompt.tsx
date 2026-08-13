"use client";

import type { PageSummary, PlaceholderChoice } from "@/src/lib/types";

export interface TargetPlaceholders {
  page: PageSummary;
  /** Placeholder keys the target page actually uses. */
  available: string[];
  /** True when the source's own key is one of them. */
  sameKeyExists: boolean;
  error?: string;
}

interface Props {
  sourceKey: string;
  targets: TargetPlaceholders[];
  choices: Record<string, PlaceholderChoice>;
  onChange: (itemId: string, choice: PlaceholderChoice) => void;
  isLoading: boolean;
}

/**
 * The last question before the copy runs, asked per target page.
 *
 * Nested placeholder keys embed the parent rendering's uid, so the source key
 * usually does not exist on another page — offering it blindly would drop the
 * component into a placeholder nothing renders. "Same key" is therefore only
 * offered when the target genuinely has it.
 */
export function PlaceholderPrompt({
  sourceKey,
  targets,
  choices,
  onChange,
  isLoading,
}: Props) {
  if (isLoading) {
    return <p className="spinner">Reading placeholders on the target pages…</p>;
  }

  return (
    <div className="section">
      <p className="section__label">Where should it land?</p>
      <p className="option__meta">
        On this page it sits in <strong>{sourceKey}</strong>.
      </p>

      {targets.map(({ page, available, sameKeyExists, error }) => {
        const choice = choices[page.itemId];
        return (
          <div key={page.itemId} className="result">
            <span className="option__name">{page.displayName}</span>

            {/* A failed read is not a blocker: the copy can still go ahead
                using the source key, so say that rather than dead-ending. */}
            {error && (
              <p className="notice notice--error">
                Could not read this page&apos;s placeholders, so they cannot be listed.
                You can still copy into <strong>{sourceKey}</strong>. {error}
              </p>
            )}

            {!error && available.length === 0 && (
              <p className="option__meta">
                This page has no components yet, so it exposes no placeholder to
                read. The component will be added to <strong>{sourceKey}</strong>.
              </p>
            )}

            {!error && available.length > 0 && (
              <>
                <label className="radio">
                  <input
                    type="radio"
                    name={`ph-${page.itemId}`}
                    checked={choice?.kind === "same"}
                    disabled={!sameKeyExists}
                    onChange={() => onChange(page.itemId, { kind: "same" })}
                  />
                  <span>
                    Same placeholder
                    {!sameKeyExists && (
                      <span className="option__meta"> — not present on this page</span>
                    )}
                  </span>
                </label>

                <label className="radio">
                  <input
                    type="radio"
                    name={`ph-${page.itemId}`}
                    checked={choice?.kind === "pick"}
                    onChange={() =>
                      onChange(page.itemId, {
                        kind: "pick",
                        placeholderKey: available[0],
                      })
                    }
                  />
                  <span>A different placeholder</span>
                </label>

                {choice?.kind === "pick" && (
                  <div className="field">
                    <select
                      value={choice.placeholderKey}
                      onChange={(event) =>
                        onChange(page.itemId, {
                          kind: "pick",
                          placeholderKey: event.target.value,
                        })
                      }
                    >
                      {available.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
