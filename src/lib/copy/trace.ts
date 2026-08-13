import { normalizeGuid } from "../guid";
import type { AuthoringClient } from "../marketplace/authoring";
import type { RenderingSubtree } from "../types";
import { classifyDataSource, needsPathResolution } from "./datasource";
import { mapLocalItems } from "./local-items";

export interface TraceInput {
  pageIdFromPages: string;
  pagePathFromPages: string;
  language: string;
  subtree: RenderingSubtree;
  targetPath?: string;
}

/**
 * Explain, without changing anything, what a copy would decide and why.
 *
 * Every failure in this app so far has been a silent misclassification rather
 * than an error, so the useful question is never "what broke" but "what did it
 * conclude, and from which inputs". This prints both.
 */
export async function traceCopy(
  authoring: AuthoringClient,
  input: TraceInput,
): Promise<string> {
  const lines: string[] = [];
  const note = (text = "") => lines.push(text);

  note("=== Source page ===");
  note(`  pages.context id:   ${input.pageIdFromPages || "(none)"}`);
  note(`  pages.context path: ${input.pagePathFromPages || "(none)"}`);
  note(`  language:           ${input.language || "(none)"}`);

  // The path from pages.context has never been verified to be a content path.
  // If it is not, every datasource classifies as "not under this page".
  let authoritativePath = input.pagePathFromPages;
  if (input.pageIdFromPages) {
    try {
      const item = await authoring.getItemById(input.pageIdFromPages, input.language);
      if (item?.path) {
        authoritativePath = item.path;
        note(`  path via itemId:    ${item.path}`);
        note(
          item.path.toLowerCase() === input.pagePathFromPages.toLowerCase()
            ? "  -> they agree"
            : "  -> THEY DISAGREE — classification uses the itemId path",
        );
      } else {
        note("  path via itemId:    (item not found)");
      }
    } catch (error) {
      note(`  path via itemId:    failed — ${describe(error)}`);
    }
  }

  note();
  note("=== Datasources on the selected component ===");
  const renderings = [input.subtree.root, ...input.subtree.descendants];
  const seen = new Set<string>();
  let localCount = 0;

  for (const rendering of renderings) {
    const dataSource = rendering.dataSource;
    if (!dataSource) continue;
    if (seen.has(dataSource)) continue;
    seen.add(dataSource);

    note(`  raw value: ${dataSource}`);
    note(`    needs id resolution: ${needsPathResolution(dataSource)}`);

    let resolvedPath: string | undefined;
    if (needsPathResolution(dataSource)) {
      try {
        const item = await authoring.getItemById(dataSource, input.language);
        resolvedPath = item?.path;
        note(`    getItemById -> ${item?.path ?? "(not found)"}`);
      } catch (error) {
        note(`    getItemById -> failed: ${describe(error)}`);
      }

      if (!resolvedPath) {
        try {
          const walked = await mapLocalItems(authoring, authoritativePath, input.language);
          resolvedPath = walked.get(normalizeGuid(dataSource));
          note(`    subtree walk -> ${resolvedPath ?? "(not under the page)"}`);
          note(`    walk saw ${walked.size} item(s) under the page`);
        } catch (error) {
          note(`    subtree walk -> failed: ${describe(error)}`);
        }
      }
    }

    const classification = classifyDataSource(dataSource, authoritativePath, resolvedPath);
    note(`    classified: ${classification.scope}${classification.relativePath ? ` (${classification.relativePath})` : ""}`);
    if (classification.scope === "local") localCount++;
    note();
  }

  if (seen.size === 0) note("  (the selected component has no datasource at all)");

  note("=== Target ===");
  if (!input.targetPath) {
    note("  (no target chosen yet)");
  } else {
    note(`  path: ${input.targetPath}`);
    const dataPath = `${input.targetPath}/Data`;
    try {
      const existing = await authoring.getItem(dataPath, input.language);
      note(`  Data folder: ${existing ? `exists (${existing.itemId})` : "missing — would be created"}`);
    } catch (error) {
      note(`  Data folder: check failed — ${describe(error)}`);
    }
  }

  note();
  note(`=== Verdict: ${localCount} datasource(s) would be copied ===`);
  if (localCount === 0 && seen.size > 0) {
    note("  Nothing classified as local. The two lines that explain why are the");
    note("  resolved path above and the source page path at the top.");
  }

  return lines.join("\n");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
