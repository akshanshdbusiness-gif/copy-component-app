import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { guidsEqual, normalizeGuid } from "../guid";
import { DEFAULT_DEVICE_ID, type Rendering } from "../types";

/**
 * `__Final Renderings` holds an XML *delta* against the shared layout, not a
 * standalone document: `p:p="1"` marks it as a patch, and a `<r>` element whose
 * uid is absent from the base is an addition. Appending to the delta is what
 * keeps a copied component from severing the page's inheritance of its
 * standard-values presentation — so every write here is an append, never a
 * rewrite of the resolved layout.
 */
const DELTA_ROOT_ATTRS: Record<string, string> = {
  "@_xmlns:p": "p",
  "@_xmlns:s": "s",
  "@_p:p": "1",
};

/** Attributes we model explicitly; everything else rides along in extraAttributes. */
const UID = "@_uid";
const RENDERING_ID = "@_s:id";
const DATASOURCE = "@_s:ds";
const PARAMETERS = "@_s:par";
const PLACEHOLDER = "@_s:ph";

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  // Layout attributes are opaque strings — coercing "1" to a number or "" to
  // true corrupts parameters and cache flags on the way back out.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  preserveOrder: true,
} as const;

const parser = new XMLParser(parserOptions);
const builder = new XMLBuilder({ ...parserOptions, suppressEmptyNode: true });

/** preserveOrder nodes are `{ tag: children[], ":@"?: attrs }`. */
type OrderedNode = Record<string, unknown> & { ":@"?: Record<string, string> };

function tagOf(node: OrderedNode): string | undefined {
  return Object.keys(node).find((k) => k !== ":@");
}

function childrenOf(node: OrderedNode): OrderedNode[] {
  const tag = tagOf(node);
  const value = tag ? node[tag] : undefined;
  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

function attrsOf(node: OrderedNode): Record<string, string> {
  return node[":@"] ?? {};
}

function findByTag(nodes: OrderedNode[], tag: string): OrderedNode | undefined {
  return nodes.find((n) => tagOf(n) === tag);
}

function toRendering(node: OrderedNode): Rendering {
  const attrs = attrsOf(node);
  const known = new Set([UID, RENDERING_ID, DATASOURCE, PARAMETERS, PLACEHOLDER]);
  const extraAttributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!known.has(name)) extraAttributes[name] = value;
  }
  return {
    uid: attrs[UID] ?? "",
    renderingItemId: attrs[RENDERING_ID] ?? "",
    placeholderKey: attrs[PLACEHOLDER] ?? "",
    dataSource: attrs[DATASOURCE] ?? "",
    parameters: attrs[PARAMETERS] ?? "",
    extraAttributes,
  };
}

function toNode(rendering: Rendering): OrderedNode {
  // Sitecore reads attributes by name, but keeping uid first and the s:*
  // attributes in their usual order makes the stored XML diffable by hand.
  const attrs: Record<string, string> = { [UID]: rendering.uid };
  if (rendering.renderingItemId) attrs[RENDERING_ID] = rendering.renderingItemId;
  if (rendering.dataSource) attrs[DATASOURCE] = rendering.dataSource;
  if (rendering.parameters) attrs[PARAMETERS] = rendering.parameters;
  if (rendering.placeholderKey) attrs[PLACEHOLDER] = rendering.placeholderKey;
  Object.assign(attrs, rendering.extraAttributes);
  return { r: [], ":@": attrs };
}

export interface ParsedLayout {
  /** Devices in document order, with their renderings. */
  devices: Array<{ id: string; renderings: Rendering[] }>;
}

/** Read every rendering out of a layout field value (delta or full). */
export function parseLayoutXml(xml: string | null | undefined): ParsedLayout {
  if (!xml || !xml.trim()) return { devices: [] };
  let tree: OrderedNode[];
  try {
    tree = parser.parse(xml) as OrderedNode[];
  } catch {
    return { devices: [] };
  }
  const root = findByTag(tree, "r");
  if (!root) return { devices: [] };

  const devices = childrenOf(root)
    .filter((n) => tagOf(n) === "d")
    .map((deviceNode) => ({
      id: attrsOf(deviceNode)["@_id"] ?? "",
      renderings: childrenOf(deviceNode)
        .filter((n) => tagOf(n) === "r")
        .map(toRendering),
    }));

  return { devices };
}

/** Flatten to the renderings of one device — the Default device unless told otherwise. */
export function renderingsForDevice(
  layout: ParsedLayout,
  deviceId?: string,
): Rendering[] {
  if (layout.devices.length === 0) return [];
  const match = deviceId
    ? layout.devices.find((d) => guidsEqual(d.id, deviceId))
    : undefined;
  return (match ?? layout.devices[0]).renderings;
}

/** The device a page's layout is written against, for pages that already have one. */
export function primaryDeviceId(layout: ParsedLayout): string {
  const withRenderings = layout.devices.find((d) => d.renderings.length > 0);
  return normalizeGuid(withRenderings?.id ?? layout.devices[0]?.id ?? DEFAULT_DEVICE_ID);
}

/**
 * Append renderings to a layout field value, preserving whatever is already
 * there. An empty or unparseable value yields a fresh delta so the page keeps
 * inheriting its base presentation.
 */
export function appendRenderings(
  existingXml: string | null | undefined,
  deviceId: string,
  renderings: Rendering[],
): string {
  if (renderings.length === 0) return existingXml ?? "";

  const newNodes = renderings.map(toNode);
  let tree: OrderedNode[] = [];
  if (existingXml && existingXml.trim()) {
    try {
      tree = parser.parse(existingXml) as OrderedNode[];
    } catch {
      tree = [];
    }
  }

  let root = findByTag(tree, "r");
  if (!root) {
    root = { r: [], ":@": { ...DELTA_ROOT_ATTRS } };
    tree = [root];
  }

  const deviceNodes = childrenOf(root);
  let device = deviceNodes.find(
    (n) => tagOf(n) === "d" && guidsEqual(attrsOf(n)["@_id"] ?? "", deviceId),
  );
  if (!device) {
    device = { d: [], ":@": { "@_id": normalizeGuid(deviceId) } };
    deviceNodes.push(device);
  }

  childrenOf(device).push(...newNodes);
  return builder.build(tree);
}
