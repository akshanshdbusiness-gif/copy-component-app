import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type { PageSummary } from "../types";

/**
 * Every call goes through the Marketplace SDK's Authoring GraphQL passthrough,
 * which requires "Authoring and Management GraphQL API" access on the app's
 * Marketplace configuration. There is no backend and no stored credential —
 * the host mints the token for the signed-in author, so the app can only ever
 * do what that author could do by hand in Pages.
 */
export class AuthoringClient {
  constructor(
    private readonly client: ClientSDK,
    private readonly sitecoreContextId?: string,
    private readonly database = "master",
  ) {}

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await this.client.mutate("xmc.authoring.graphql", {
      params: {
        ...(this.sitecoreContextId ? { query: { sitecoreContextId: this.sitecoreContextId } } : {}),
        body: { query, variables },
      },
    });

    // Failed HTTP calls still resolve with the problem parked in `error`;
    // surfacing it beats reporting a confusing "not found" downstream.
    const transportError = (result as { error?: unknown }).error;
    if (transportError) throw new Error(describeError(transportError));

    const payload = result.data as { data?: T; errors?: Array<{ message?: string }> } | undefined;
    if (payload?.errors?.length) {
      throw new Error(payload.errors.map((e) => e.message ?? "Unknown error").join("; "));
    }
    if (!payload?.data) throw new Error("Authoring API returned no data");
    return payload.data;
  }

  async getItem(pathOrId: string, language?: string): Promise<ItemRecord | null> {
    const data = await this.graphql<{ item: ItemRecord | null }>(
      `query Item($path: String!, $db: String!, $language: String) {
        item(where: { database: $db, path: $path, language: $language }) {
          itemId
          name
          displayName
          path
          hasChildren
          template { templateId name }
        }
      }`,
      { path: pathOrId, db: this.database, language },
    );
    return data.item;
  }

  /**
   * Look an item up by id.
   *
   * Datasources are stored as `{GUID}` in the layout, and `where: { path: }`
   * does not reliably resolve one — which is how local datasources silently
   * failed to copy. Whether `ItemQueryInput` accepts `itemId` is unverified
   * against a live schema, so `resolveItem` treats this as the preferred
   * attempt and falls back rather than betting on it.
   */
  async getItemById(itemId: string, language?: string): Promise<ItemRecord | null> {
    const data = await this.graphql<{ item: ItemRecord | null }>(
      `query ItemById($itemId: String!, $db: String!, $language: String) {
        item(where: { database: $db, itemId: $itemId, language: $language }) {
          itemId
          name
          displayName
          path
          hasChildren
          template { templateId name }
        }
      }`,
      { itemId, db: this.database, language },
    );
    return data.item;
  }

  /**
   * Resolve an item from either form, trying the id query first for guids.
   * Returns the record and which attempt won, so callers can report *why* a
   * lookup failed instead of silently treating it as "not mine".
   */
  async resolveItem(
    pathOrId: string,
    language?: string,
  ): Promise<{ item: ItemRecord | null; errors: string[] }> {
    const errors: string[] = [];
    const attempts: Array<() => Promise<ItemRecord | null>> = looksLikeGuid(pathOrId)
      ? [() => this.getItemById(pathOrId, language), () => this.getItem(pathOrId, language)]
      : [() => this.getItem(pathOrId, language)];

    for (const attempt of attempts) {
      try {
        const item = await attempt();
        if (item) return { item, errors };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { item: null, errors };
  }

  /** Child pages of an item, for the target picker's tree. */
  async getChildren(pathOrId: string, language?: string): Promise<PageSummary[]> {
    const data = await this.graphql<{ item: { children?: { nodes?: ChildRecord[] } } | null }>(
      `query Children($path: String!, $db: String!, $language: String) {
        item(where: { database: $db, path: $path, language: $language }) {
          children(first: 100) {
            nodes {
              itemId
              name
              displayName
              path
              hasChildren
              hasPresentation
            }
          }
        }
      }`,
      { path: pathOrId, db: this.database, language },
    );

    const nodes = data.item?.children?.nodes ?? [];
    return nodes.map((node) => ({
      itemId: node.itemId,
      name: node.name,
      displayName: node.displayName || node.name,
      path: node.path,
      hasChildren: Boolean(node.hasChildren),
      hasPresentation: Boolean(node.hasPresentation),
    }));
  }

  /**
   * Friendly names for a set of item ids, in one round trip.
   *
   * The layout stores only rendering ids, so without this the picker would ask
   * an author to choose between a dozen guids. Aliased into a single query
   * because the panel resolves every rendering on the page at once.
   */
  async getItemNames(itemIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(itemIds.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const fields = unique
      .map((_, index) => `i${index}: item(where: { database: $db, path: $id${index} }) { itemId name displayName }`)
      .join("\n");
    const args = unique.map((_, index) => `$id${index}: String!`).join(", ");
    const variables: Record<string, unknown> = { db: this.database };
    unique.forEach((id, index) => {
      variables[`id${index}`] = id;
    });

    const data = await this.graphql<Record<string, ItemRecord | null>>(
      `query Names($db: String!, ${args}) { ${fields} }`,
      variables,
    );

    const names = new Map<string, string>();
    unique.forEach((id, index) => {
      const item = data[`i${index}`];
      if (item) names.set(id, item.displayName || item.name);
    });
    return names;
  }

  /**
   * Both layout fields for a page, read in one round trip.
   *
   * There is no `presentationDetails` field on `Item` in the Authoring schema —
   * asking for one fails the whole query with "The field `presentationDetails`
   * does not exist on the type `Item`". The layout has to be read as the two
   * raw fields Sitecore actually stores: `__Renderings` is the shared layout
   * (inherited through standard values) and `__Final Renderings` is the
   * versioned delta on top of it.
   */
  async getLayoutFields(pathOrId: string, language?: string): Promise<LayoutFields> {
    const data = await this.graphql<{
      item: { shared?: { value?: string } | null; final?: { value?: string } | null } | null;
    }>(
      `query Layout($path: String!, $db: String!, $language: String) {
        item(where: { database: $db, path: $path, language: $language }) {
          shared: field(name: "__Renderings") { value }
          final: field(name: "__Final Renderings") { value }
        }
      }`,
      { path: pathOrId, db: this.database, language },
    );
    return {
      shared: data.item?.shared?.value ?? "",
      final: data.item?.final?.value ?? "",
    };
  }

  /** The raw `__Final Renderings` delta — what we append to and write back. */
  async getFinalRenderings(pathOrId: string, language?: string): Promise<string> {
    const data = await this.graphql<{ item: { field?: { value?: string } | null } | null }>(
      `query FinalRenderings($path: String!, $db: String!, $language: String) {
        item(where: { database: $db, path: $path, language: $language }) {
          field(name: "__Final Renderings") { value }
        }
      }`,
      { path: pathOrId, db: this.database, language },
    );
    return data.item?.field?.value ?? "";
  }

  async setFinalRenderings(itemId: string, value: string, language?: string): Promise<void> {
    await this.graphql(
      `mutation SetLayout($itemId: ID!, $db: String!, $language: String, $value: String!) {
        updateItem(input: {
          database: $db
          itemId: $itemId
          language: $language
          fields: [{ name: "__Final Renderings", value: $value }]
        }) {
          item { itemId }
        }
      }`,
      { itemId, db: this.database, language, value },
    );
  }

  /** Deep copy — Sitecore's copy takes the whole subtree with it, which is what we want. */
  async copyItem(sourceId: string, targetParentId: string, name: string): Promise<ItemRecord> {
    const data = await this.graphql<{ copyItem: { item: ItemRecord } }>(
      `mutation CopyItem($source: ID!, $target: ID!, $name: String!, $db: String!) {
        copyItem(input: { database: $db, itemId: $source, targetId: $target, name: $name }) {
          item { itemId name displayName path hasChildren template { templateId name } }
        }
      }`,
      { source: sourceId, target: targetParentId, name, db: this.database },
    );
    return data.copyItem.item;
  }

  async createItem(
    parentId: string,
    name: string,
    templateId: string,
    language?: string,
  ): Promise<ItemRecord> {
    const data = await this.graphql<{ createItem: { item: ItemRecord } }>(
      `mutation CreateItem($parent: ID!, $name: String!, $template: ID!, $db: String!, $language: String) {
        createItem(input: {
          database: $db
          parent: $parent
          name: $name
          templateId: $template
          language: $language
        }) {
          item { itemId name displayName path hasChildren template { templateId name } }
        }
      }`,
      { parent: parentId, name, template: templateId, db: this.database, language },
    );
    return data.createItem.item;
  }
}

export interface LayoutFields {
  /** `__Renderings` — the shared layout, inherited through standard values. */
  shared: string;
  /** `__Final Renderings` — the versioned delta applied on top of the shared layout. */
  final: string;
}

export interface ItemRecord {
  itemId: string;
  name: string;
  displayName?: string;
  path: string;
  hasChildren?: boolean;
  template?: { templateId: string; name: string };
}

interface ChildRecord extends ItemRecord {
  hasPresentation?: boolean;
}

function looksLikeGuid(value: string): boolean {
  return /^[0-9a-fA-F]{32}$/.test(value.replace(/[^0-9a-fA-F]/g, ""));
}

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const shaped = error as { detail?: string; title?: string; message?: string };
    return shaped.detail ?? shaped.title ?? shaped.message ?? JSON.stringify(error);
  }
  return String(error);
}
