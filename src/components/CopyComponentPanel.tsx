"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RenderingPicker } from "./RenderingPicker";
import { TargetPagePicker } from "./TargetPagePicker";
import { PlaceholderPrompt, type TargetPlaceholders } from "./PlaceholderPrompt";
import { ResultList } from "./ResultList";
import { SchemaCheck } from "./SchemaCheck";
import { executeCopy } from "@/src/lib/copy/execute";
import { findSiteRoot } from "@/src/lib/copy/site-root";
import { collectSubtree, parsePresentationDetails } from "@/src/lib/layout/presentation";
import { resolveLayout } from "@/src/lib/layout/merge";
import { keysEqual, usedPlaceholderKeys } from "@/src/lib/layout/placeholders";
import { AuthoringClient } from "@/src/lib/marketplace/authoring";
import { useMarketplaceClient } from "@/src/lib/marketplace/useMarketplaceClient";
import { usePagesContext } from "@/src/lib/marketplace/usePagesContext";
import type {
  CopyResult,
  PageSummary,
  PlaceholderChoice,
  Rendering,
} from "@/src/lib/types";

type Stage = "pick-component" | "pick-targets" | "placeholders" | "running" | "done";

export function CopyComponentPanel() {
  const { client, error: clientError, isLoading: clientLoading } = useMarketplaceClient();
  const { context, error: contextError, isLoading: contextLoading } = usePagesContext(client);

  const [contextId, setContextId] = useState<string | undefined>();
  const [stage, setStage] = useState<Stage>("pick-component");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [targets, setTargets] = useState<PageSummary[]>([]);
  const [choices, setChoices] = useState<Record<string, PlaceholderChoice>>({});
  const [targetPlaceholders, setTargetPlaceholders] = useState<TargetPlaceholders[]>([]);
  const [placeholdersLoading, setPlaceholdersLoading] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [siteRoot, setSiteRoot] = useState<string | null>(null);
  const [fetchedRenderings, setFetchedRenderings] = useState<Rendering[]>([]);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [results, setResults] = useState<CopyResult[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  const authoring = useMemo(
    () => (client ? new AuthoringClient(client, contextId) : null),
    [client, contextId],
  );

  const renderings: Rendering[] = useMemo(() => {
    const fromPages = parsePresentationDetails(context?.presentationDetails);
    return fromPages.length > 0 ? fromPages : fetchedRenderings;
  }, [context?.presentationDetails, fetchedRenderings]);

  // `pages.context` usually carries the page's presentation, but the field is
  // typed loosely and is not guaranteed to be populated. Falling back to the
  // Authoring API keeps the panel from claiming a page has no components when
  // it simply was not told about them.
  useEffect(() => {
    if (!authoring || !context?.pagePath) return;
    if (parsePresentationDetails(context.presentationDetails).length > 0) return;
    let active = true;
    authoring
      .getLayoutFields(context.pagePath, context.language)
      .then(({ shared, final }) => {
        if (active) setFetchedRenderings(resolveLayout(shared, final));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFetchedRenderings([]);
        setLayoutError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [authoring, context?.pagePath, context?.language, context?.presentationDetails]);

  const subtree = useMemo(
    () => (selectedUid ? collectSubtree(renderings, selectedUid) : null),
    [renderings, selectedUid],
  );

  // The Authoring passthrough needs the environment's context id, which comes
  // from the app's own metadata rather than the page context. `preview` is the
  // authoring (master) context; `live` would read published content.
  useEffect(() => {
    if (!client) return;
    let active = true;
    client
      .query("application.context")
      .then((result) => {
        const appContext = result.data;
        const resources = appContext?.resourceAccess ?? appContext?.resources;
        const preview = resources?.[0]?.context?.preview;
        if (active && preview) setContextId(preview);
      })
      .catch(() => {
        // Optional: the passthrough falls back to the app's default resource.
      });
    return () => {
      active = false;
    };
  }, [client]);

  // Resolve rendering ids to component names so the picker is readable.
  useEffect(() => {
    if (!authoring || renderings.length === 0) return;
    let active = true;
    authoring
      .getItemNames(renderings.map((r) => r.renderingItemId))
      .then((resolved) => {
        if (active) setNames(resolved);
      })
      .catch(() => {
        // Names are a nicety — the picker still works with the fallback label.
      });
    return () => {
      active = false;
    };
  }, [authoring, renderings]);

  // Scope the target picker to the site the author is working in.
  useEffect(() => {
    if (!authoring || !context?.pagePath) return;
    let active = true;
    findSiteRoot(authoring, context.pagePath, context.language)
      .then((root) => {
        if (active) setSiteRoot(root);
      })
      .catch(() => {
        if (active) setSiteRoot(context.pagePath);
      });
    return () => {
      active = false;
    };
  }, [authoring, context?.pagePath, context?.language]);

  // Navigating the canvas invalidates everything downstream of the component.
  useEffect(() => {
    setStage("pick-component");
    setSelectedUid(null);
    setTargets([]);
    setChoices({});
    setResults([]);
    setRunError(null);
    setFetchedRenderings([]);
    setLayoutError(null);
  }, [context?.pageId, context?.language]);

  const loadPlaceholders = useCallback(async () => {
    if (!authoring || !subtree) return;
    setPlaceholdersLoading(true);
    setStage("placeholders");

    const sourceKey = subtree.root.placeholderKey;
    const loaded: TargetPlaceholders[] = [];
    const nextChoices: Record<string, PlaceholderChoice> = {};

    for (const page of targets) {
      try {
        const { shared, final } = await authoring.getLayoutFields(page.path, context?.language);
        const available = usedPlaceholderKeys(resolveLayout(shared, final));
        const sameKeyExists = available.some((key) => keysEqual(key, sourceKey));
        loaded.push({ page, available, sameKeyExists });
        // Default to the source key where it exists — that is the "same
        // placeholder" answer, and it is right far more often than not.
        nextChoices[page.itemId] =
          sameKeyExists || available.length === 0
            ? { kind: "same" }
            : { kind: "pick", placeholderKey: available[0] };
      } catch (error) {
        loaded.push({
          page,
          available: [],
          sameKeyExists: false,
          error: error instanceof Error ? error.message : String(error),
        });
        nextChoices[page.itemId] = { kind: "same" };
      }
    }

    setTargetPlaceholders(loaded);
    setChoices(nextChoices);
    setPlaceholdersLoading(false);
  }, [authoring, subtree, targets, context?.language]);

  const run = useCallback(async () => {
    if (!authoring || !subtree || !context) return;
    setStage("running");
    setRunError(null);
    setResults([]);

    try {
      const copyResults = await executeCopy(authoring, {
        source: {
          pageItemId: context.pageId,
          pagePath: context.pagePath,
          language: context.language,
          subtree,
        },
        targets: targets.map((page) => ({
          page,
          placeholder: choices[page.itemId] ?? { kind: "same" },
        })),
        language: context.language,
      });
      setResults(copyResults);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setStage("done");
    }
  }, [authoring, subtree, context, targets, choices]);

  const startOver = useCallback(() => {
    setStage("pick-component");
    setSelectedUid(null);
    setTargets([]);
    setChoices({});
    setResults([]);
    setRunError(null);
  }, []);

  if (clientLoading || contextLoading) {
    return (
      <main className="panel">
        <p className="spinner">Connecting to Pages…</p>
      </main>
    );
  }

  if (clientError || !client) {
    return (
      <main className="panel">
        <p className="notice notice--error">
          This app runs inside the XM Cloud Pages context panel. Open it from the
          Pages sidebar rather than directly in a browser tab.
        </p>
      </main>
    );
  }

  if (contextError || !context) {
    return (
      <main className="panel">
        <p className="notice notice--error">
          Could not read the current page from Pages.
          {contextError ? ` ${contextError.message}` : ""}
        </p>
      </main>
    );
  }

  return (
    <main className="panel">
      <header className="panel__header">
        <h1 className="panel__title">Copy component</h1>
        <p className="panel__subtitle">
          {context.pageName} · {context.language}
        </p>
      </header>

      {!context.canWrite && (
        <p className="notice notice--error">
          You have read-only access to this page.
        </p>
      )}

      {layoutError && renderings.length === 0 && (
        <p className="notice notice--error">
          Could not read this page&apos;s layout. {layoutError}
        </p>
      )}

      {stage === "pick-component" && (
        <>
          <RenderingPicker
            renderings={renderings}
            names={names}
            selectedUid={selectedUid}
            onSelect={setSelectedUid}
          />
          <div className="actions">
            <button
              type="button"
              className="button button--primary"
              disabled={!subtree}
              onClick={() => setStage("pick-targets")}
            >
              Next
            </button>
          </div>
        </>
      )}

      {stage === "pick-targets" && authoring && (
        <>
          {subtree && subtree.descendants.length > 0 && (
            <p className="notice">
              Copying this component brings {subtree.descendants.length} nested
              component{subtree.descendants.length === 1 ? "" : "s"} with it.
            </p>
          )}
          {siteRoot ? (
            <TargetPagePicker
              authoring={authoring}
              rootPath={siteRoot}
              language={context.language}
              sourcePagePath={context.pagePath}
              selected={targets}
              onChange={setTargets}
            />
          ) : (
            <p className="spinner">Finding the site&apos;s pages…</p>
          )}
          <div className="actions">
            <button type="button" className="button" onClick={() => setStage("pick-component")}>
              Back
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={targets.length === 0}
              onClick={loadPlaceholders}
            >
              Next
            </button>
          </div>
        </>
      )}

      {stage === "placeholders" && subtree && (
        <>
          <PlaceholderPrompt
            sourceKey={subtree.root.placeholderKey}
            targets={targetPlaceholders}
            choices={choices}
            onChange={(itemId, choice) =>
              setChoices((prev) => ({ ...prev, [itemId]: choice }))
            }
            isLoading={placeholdersLoading}
          />
          <div className="actions">
            <button type="button" className="button" onClick={() => setStage("pick-targets")}>
              Back
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={placeholdersLoading || !context.canWrite}
              onClick={run}
            >
              Copy to {targets.length} page{targets.length === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}

      {stage === "running" && <p className="spinner">Copying…</p>}

      {stage === "done" && (
        <>
          {runError && <p className="notice notice--error">{runError}</p>}
          <ResultList results={results} />
          <SchemaCheck authoring={authoring} />
          <div className="actions">
            <button type="button" className="button button--primary" onClick={startOver}>
              Copy another
            </button>
          </div>
        </>
      )}
    </main>
  );
}
