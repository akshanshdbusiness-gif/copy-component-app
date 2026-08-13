/** Sitecore's Default device — used when a page has no layout to copy a device id from. */
export const DEFAULT_DEVICE_ID = "{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}";

/** A single rendering instance on a page. */
export interface Rendering {
  /** Instance uid, e.g. "{2E2C4B9B-...}". Unique per page. */
  uid: string;
  /** The rendering item's id (which component this is). */
  renderingItemId: string;
  /** Placeholder key this instance sits in, e.g. "/headless-main/container-1-{...}-0". */
  placeholderKey: string;
  /** Datasource, as stored: an id, a path, a query, or "" when unset. */
  dataSource: string;
  /** Raw rendering parameters string (url-encoded key=value pairs). */
  parameters: string;
  /** Any attributes we do not model explicitly, preserved verbatim on write. */
  extraAttributes: Record<string, string>;
}

/** A rendering plus the renderings nested inside its own placeholders. */
export interface RenderingSubtree {
  root: Rendering;
  /** Descendants in document order, parents before children. */
  descendants: Rendering[];
}

/** How a datasource relates to the page that renders it. */
export type DataSourceScope =
  /** Lives under the page item (typically <page>/Data/...) — gets copied. */
  | "local"
  /** Lives anywhere else, or is a query/empty — left pointing at the original. */
  | "global"
  | "none";

export interface DataSourceClassification {
  scope: DataSourceScope;
  /** Path of the datasource item relative to the source page, e.g. "Data/Promo". Local only. */
  relativePath?: string;
}

/** A page the author can copy into. */
export interface PageSummary {
  itemId: string;
  name: string;
  displayName: string;
  path: string;
  hasChildren: boolean;
  hasPresentation: boolean;
}

/** What the author chose to do about the placeholder key on one target page. */
export type PlaceholderChoice =
  /** Reuse the source key verbatim — only offered when it exists on the target. */
  | { kind: "same" }
  /** Drop the subtree into a different placeholder that exists on the target. */
  | { kind: "pick"; placeholderKey: string };

export interface CopyRequest {
  source: {
    pageItemId: string;
    pagePath: string;
    language: string;
    /** Version the layout was read from; writes target the same version. */
    version?: number;
    subtree: RenderingSubtree;
  };
  targets: Array<{
    page: PageSummary;
    placeholder: PlaceholderChoice;
  }>;
  language: string;
}

/**
 * One unit of work in an executed copy — surfaced to the author as a progress
 * line. Datasources that are deliberately *not* copied get a step too: a
 * silent skip is indistinguishable from a bug, which is exactly how a
 * misresolved datasource hid itself once already.
 */
export interface CopyStep {
  kind: "create-folder" | "copy-datasource" | "skip-datasource" | "write-layout";
  label: string;
  detail?: string;
  /** Marks a step the author probably wants to look at, without failing the copy. */
  warn?: boolean;
}

export interface CopyResult {
  targetPath: string;
  ok: boolean;
  steps: CopyStep[];
  error?: string;
}
