"use client";

import { useState } from "react";
import type { AuthoringClient } from "@/src/lib/marketplace/authoring";
import { runSchemaCheck } from "@/src/lib/marketplace/introspect";
import { traceCopy, type TraceInput } from "@/src/lib/copy/trace";

/**
 * Diagnostics for the two things this app cannot see from the outside: the
 * tenant's Authoring schema, and what the copy concluded about the current
 * selection.
 *
 * Every failure so far has been a silent misclassification rather than an
 * error, so "run this and read the verdict" beats reasoning from the outcome.
 */
export function SchemaCheck({
  authoring,
  trace,
}: {
  authoring: AuthoringClient | null;
  trace?: TraceInput | null;
}) {
  const [report, setReport] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const run = async (task: () => Promise<string>) => {
    if (!authoring) return;
    setIsRunning(true);
    try {
      setReport(await task());
    } catch (error) {
      setReport(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <details className="section">
      <summary className="section__label" style={{ cursor: "pointer" }}>
        Diagnostics
      </summary>

      <p className="option__meta">
        Run these when a copy does something you did not expect, and share the
        output.
      </p>

      {trace && (
        <button
          type="button"
          className="button"
          disabled={!authoring || isRunning}
          onClick={() => run(() => traceCopy(authoring!, trace))}
        >
          {isRunning ? "Working…" : "Trace this copy"}
        </button>
      )}

      <button
        type="button"
        className="button"
        disabled={!authoring || isRunning}
        onClick={() => run(() => runSchemaCheck(authoring!))}
      >
        {isRunning ? "Working…" : "Schema check"}
      </button>

      {report && (
        <>
          <button
            type="button"
            className="linkbutton"
            onClick={() => navigator.clipboard?.writeText(report)}
          >
            Copy to clipboard
          </button>
          <pre className="report">{report}</pre>
        </>
      )}
    </details>
  );
}
