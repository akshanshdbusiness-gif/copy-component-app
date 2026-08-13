"use client";

import { useState } from "react";
import type { AuthoringClient } from "@/src/lib/marketplace/authoring";
import { runSchemaCheck } from "@/src/lib/marketplace/introspect";

/**
 * Ask the tenant what its Authoring schema actually looks like.
 *
 * Kept in the shipped panel rather than a scratch script because the schema is
 * the thing this app cannot see from the outside: when a copy misbehaves, the
 * fastest path to an answer is the real field list, not another guess.
 */
export function SchemaCheck({ authoring }: { authoring: AuthoringClient | null }) {
  const [report, setReport] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const run = async () => {
    if (!authoring) return;
    setIsRunning(true);
    try {
      setReport(await runSchemaCheck(authoring));
    } catch (error) {
      setReport(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <details
      className="section"
      open={isOpen}
      onToggle={(event) => setIsOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="section__label" style={{ cursor: "pointer" }}>
        Schema check
      </summary>

      <p className="option__meta">
        Reports what this environment&apos;s Authoring API accepts. Useful when a
        copy fails in a way the error message does not explain.
      </p>

      <button type="button" className="button" disabled={!authoring || isRunning} onClick={run}>
        {isRunning ? "Checking…" : "Run schema check"}
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
