import { newGuid, normalizeGuid } from "../guid";
import { appendRenderings, parseLayoutXml, primaryDeviceId } from "../layout/layout-xml";
import { relocateSubtree } from "../layout/placeholders";
import type { AuthoringClient } from "../marketplace/authoring";
import {
  DEFAULT_DEVICE_ID,
  type CopyRequest,
  type CopyResult,
  type CopyStep,
  type Rendering,
  type RenderingSubtree,
} from "../types";
import { mapLocalItems } from "./local-items";
import {
  PAGE_DATA_TEMPLATE_ID,
  buildLocalDataSource,
  classifyDataSource,
  localSchemeRelativePath,
  needsPathResolution,
  splitRelativePath,
  uniqueName,
} from "./datasource";

export interface ExecuteOptions {
  onStep?: (targetPath: string, step: CopyStep) => void;
}

/**
 * Copy one component subtree onto each chosen target page.
 *
 * Targets are processed one at a time and independently: a failure on the
 * third page leaves the first two copied and reports the third, which is
 * friendlier than a half-applied "atomic" run that Sitecore cannot roll back
 * for us anyway.
 */
export async function executeCopy(
  authoring: AuthoringClient,
  request: CopyRequest,
  options: ExecuteOptions = {},
): Promise<CopyResult[]> {
  const sourcePagePath = await authoritativePagePath(authoring, request);
  const dataSourcePaths = await resolveDataSourcePaths(
    authoring,
    request.source.subtree,
    sourcePagePath,
    request.language,
  );
  const results: CopyResult[] = [];

  for (const target of request.targets) {
    const steps: CopyStep[] = [];
    const record = (step: CopyStep) => {
      steps.push(step);
      options.onStep?.(target.page.path, step);
    };

    try {
      const dataSourceMap = await copyLocalDataSources(
        authoring,
        request,
        sourcePagePath,
        target.page.itemId,
        target.page.path,
        dataSourcePaths,
        record,
      );

      const rebound = mapSubtree(request.source.subtree, (rendering) => ({
        ...rendering,
        dataSource: dataSourceMap.get(rendering.dataSource) ?? rendering.dataSource,
      }));

      const placeholderKey =
        target.placeholder.kind === "same"
          ? request.source.subtree.root.placeholderKey
          : target.placeholder.placeholderKey;

      const relocated = relocateSubtree(rebound, placeholderKey, newGuid);
      const existingXml = await authoring.getFinalRenderings(target.page.path, request.language);
      const deviceId = deviceFor(existingXml);

      const updated = appendRenderings(existingXml, deviceId, [
        relocated.root,
        ...relocated.descendants,
      ]);
      await authoring.setFinalRenderings(target.page.itemId, updated, request.language);

      const count = 1 + relocated.descendants.length;
      record({
        kind: "write-layout",
        label: `Added ${count} rendering${count === 1 ? "" : "s"} to ${placeholderKey}`,
        detail: target.page.path,
      });

      results.push({ targetPath: target.page.path, ok: true, steps });
    } catch (error) {
      results.push({
        targetPath: target.page.path,
        ok: false,
        steps,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Write into the device the target page already uses; writing into one it does
 * not would silently drop the component from the layout the author sees.
 * Headless XM Cloud only ever uses the Default device, which is the fallback
 * when the page has no final-renderings delta yet.
 */
function deviceFor(existingXml: string): string {
  const parsed = parseLayoutXml(existingXml);
  return parsed.devices.length > 0 ? primaryDeviceId(parsed) : DEFAULT_DEVICE_ID;
}

/**
 * The source page's path as Sitecore knows it.
 *
 * `pages.context` reports a `path`, but nothing guarantees it is a content
 * path rather than a route — and every datasource decision compares against
 * it, so a route here would classify all of them as "not under this page" and
 * skip them without an error. The page's own id is unambiguous, so it wins
 * when it resolves.
 */
async function authoritativePagePath(
  authoring: AuthoringClient,
  request: CopyRequest,
): Promise<string> {
  if (!request.source.pageItemId) return request.source.pagePath;
  try {
    const item = await authoring.getItemById(request.source.pageItemId, request.language);
    if (item?.path) return item.path;
  } catch {
    // Fall back to what Pages reported.
  }
  return request.source.pagePath;
}

/** What a lookup produced: a path, or the reason there isn't one. */
interface ResolvedDataSource {
  path?: string;
  failure?: string;
}

/**
 * Resolve id-form datasources to paths once, so classification can compare
 * against the page path.
 *
 * A failure here used to be swallowed, which made the datasource classify as
 * shared and get skipped without a word — the copy looked like it worked and
 * simply had no content. Failures are now carried through to the report.
 */
async function resolveDataSourcePaths(
  authoring: AuthoringClient,
  subtree: RenderingSubtree,
  sourcePagePath: string,
  language?: string,
): Promise<Map<string, ResolvedDataSource>> {
  const resolved = new Map<string, ResolvedDataSource>();
  const pending = new Set(
    allRenderings(subtree)
      .map((r) => r.dataSource)
      .filter((ds) => needsPathResolution(ds)),
  );
  if (pending.size === 0) return resolved;

  // Built only if an id lookup comes up empty — walking the page's subtree
  // costs a query per level, so it stays a fallback rather than the default.
  let localItems: Map<string, string> | null = null;
  const walkedItems = async () => {
    localItems ??= await mapLocalItems(authoring, sourcePagePath, language);
    return localItems;
  };

  for (const dataSource of pending) {
    const { item, errors } = await authoring.resolveItem(dataSource);
    if (item?.path) {
      resolved.set(dataSource, { path: item.path });
      continue;
    }

    // The id query found nothing. Before calling it shared — the answer that
    // silently skipped local datasources for three releases — look for it
    // under the page directly.
    const localPath = (await walkedItems()).get(normalizeGuid(dataSource));
    resolved.set(
      dataSource,
      localPath
        ? { path: localPath }
        : { failure: errors.length > 0 ? errors.join("; ") : "no item found with that id" },
    );
  }
  return resolved;
}

/** Copy every local datasource under the target page, returning old value -> new id. */
async function copyLocalDataSources(
  authoring: AuthoringClient,
  request: CopyRequest,
  sourcePagePath: string,
  targetPageId: string,
  targetPagePath: string,
  dataSourcePaths: Map<string, ResolvedDataSource>,
  record: (step: CopyStep) => void,
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  const folderCache = new Map<string, string>();
  const reported = new Set<string>();

  for (const rendering of allRenderings(request.source.subtree)) {
    const dataSource = rendering.dataSource;
    if (!dataSource || mapping.has(dataSource) || reported.has(dataSource)) continue;

    const lookup = dataSourcePaths.get(dataSource);
    const classification = classifyDataSource(dataSource, sourcePagePath, lookup?.path);

    if (classification.scope !== "local" || !classification.relativePath) {
      reported.add(dataSource);
      record(explainSkip(dataSource, sourcePagePath, lookup));
      continue;
    }

    const { folders, name } = splitRelativePath(classification.relativePath);
    const parentId = await ensureFolderChain(
      authoring,
      request,
      sourcePagePath,
      targetPageId,
      targetPagePath,
      folders,
      folderCache,
      record,
    );

    const siblings = await authoring.getChildren(parentId, request.language);
    const copyName = uniqueName(name, siblings.map((s) => s.name));

    // `local:/Data/Promo` is not something the API can copy from — resolve it
    // against the source page to get a real path first.
    const isPageRelative = localSchemeRelativePath(dataSource) !== null;
    const copySource = isPageRelative
      ? `${sourcePagePath}/${classification.relativePath}`
      : dataSource;
    const copied = await authoring.copyItem(copySource, parentId, copyName);

    // A page-relative value resolves against whichever page renders it, so the
    // copy points at the target's own item with no rewriting — unless a name
    // collision renamed it, which is exactly when the value must be rebuilt.
    mapping.set(
      dataSource,
      isPageRelative ? buildLocalDataSource(folders, copyName) : copied.itemId,
    );
    record({
      kind: "copy-datasource",
      label: `Copied datasource "${name}"${copyName === name ? "" : ` as "${copyName}"`}`,
      detail: copied.path,
    });
  }

  return mapping;
}

/**
 * Say why a datasource was left pointing at the original.
 *
 * "Shared, on purpose" and "I could not tell, so I left it alone" look
 * identical in the copied page but mean very different things, so they read
 * differently here — and the unresolvable case carries the page path it was
 * compared against, which is what makes a wrong path obvious at a glance.
 */
function explainSkip(
  dataSource: string,
  sourcePagePath: string,
  lookup: ResolvedDataSource | undefined,
): CopyStep {
  if (lookup?.failure) {
    return {
      kind: "skip-datasource",
      label: "Could not resolve a datasource — left pointing at the original",
      detail: `${dataSource} (${lookup.failure})`,
      warn: true,
    };
  }

  if (/^(query:|\$)/i.test(dataSource.trim())) {
    return {
      kind: "skip-datasource",
      label: "Dynamic datasource left as-is",
      detail: dataSource,
    };
  }

  const path = lookup?.path ?? dataSource;
  return {
    kind: "skip-datasource",
    label: "Shared datasource left pointing at the original",
    detail: `${path} is not under ${sourcePagePath}`,
  };
}

/**
 * Walk (and create) the folder chain under the target page, mirroring the
 * source's own folder templates so a copied `Data` folder is the same kind of
 * folder Sitecore would have made.
 */
async function ensureFolderChain(
  authoring: AuthoringClient,
  request: CopyRequest,
  sourcePagePath: string,
  targetPageId: string,
  targetPagePath: string,
  folders: string[],
  cache: Map<string, string>,
  record: (step: CopyStep) => void,
): Promise<string> {
  let parentId = targetPageId;
  let parentPath = targetPagePath;
  let sourcePath = sourcePagePath;

  for (const folderName of folders) {
    sourcePath = `${sourcePath}/${folderName}`;
    const childPath = `${parentPath}/${folderName}`;

    const cached = cache.get(childPath.toLowerCase());
    if (cached) {
      parentId = cached;
      parentPath = childPath;
      continue;
    }

    const existing = await authoring.getItem(childPath, request.language);
    if (existing) {
      parentId = existing.itemId;
    } else {
      const { templateId, mirrored } = await folderTemplateOf(authoring, sourcePath);
      const created = await authoring.createItem(
        parentId,
        folderName,
        templateId,
        request.language,
      );
      parentId = created.itemId;
      record({
        kind: "create-folder",
        label: `Created "${folderName}" folder`,
        // Name the template: creating this from the wrong one produces a
        // folder that looks right in the tree but that SXA does not treat as
        // page data.
        detail: `${created.path} (${mirrored ? "matching the source folder" : "Page Data"}: ${templateId})`,
      });
    }

    cache.set(childPath.toLowerCase(), parentId);
    parentPath = childPath;
  }

  return parentId;
}

/**
 * Which template a missing folder should be created from.
 *
 * Mirroring the source page's own folder is preferred — a site using a custom
 * local-datasource template keeps it that way. SXA's Page Data template is the
 * fallback when the source folder cannot be read, since that is what a page's
 * `Data` folder is in a stock XM Cloud site.
 */
async function folderTemplateOf(
  authoring: AuthoringClient,
  sourcePath: string,
): Promise<{ templateId: string; mirrored: boolean }> {
  try {
    const item = await authoring.getItem(sourcePath);
    if (item?.template?.templateId) {
      return { templateId: item.template.templateId, mirrored: true };
    }
  } catch {
    // Fall through to the SXA Page Data template.
  }
  return { templateId: PAGE_DATA_TEMPLATE_ID, mirrored: false };
}

function allRenderings(subtree: RenderingSubtree): Rendering[] {
  return [subtree.root, ...subtree.descendants];
}

function mapSubtree(
  subtree: RenderingSubtree,
  transform: (rendering: Rendering) => Rendering,
): RenderingSubtree {
  return {
    root: transform(subtree.root),
    descendants: subtree.descendants.map(transform),
  };
}
