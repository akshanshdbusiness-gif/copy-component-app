import { normalizeGuid } from "../guid";
import type { AuthoringClient } from "../marketplace/authoring";

/**
 * Map every content item living under a page to its path, keyed by id.
 *
 * Deciding whether a datasource is "local" means knowing whether its item sits
 * under the page. The obvious way — look the guid up and compare paths — needs
 * an id-based item query, and repeated guesses at how this schema spells that
 * have all been wrong.
 *
 * This walks *down* from the page instead, using `children { nodes }`, which is
 * proven to work against the live tenant. Membership is then an id lookup in a
 * map, with no id-to-path query anywhere.
 *
 * Child *pages* are skipped: their own datasources belong to them, not to this
 * page, and descending into them would walk the whole site.
 */
export async function mapLocalItems(
  authoring: AuthoringClient,
  pagePath: string,
  language?: string,
  maxDepth = 3,
): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  let frontier = [pagePath];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];

    for (const parentPath of frontier) {
      let children;
      try {
        children = await authoring.getChildren(parentPath, language);
      } catch {
        // A branch we cannot read simply contributes nothing; the datasource
        // then classifies as shared, which leaves the original intact.
        continue;
      }

      for (const child of children) {
        if (child.hasPresentation) continue;
        byId.set(normalizeGuid(child.itemId), child.path);
        if (child.hasChildren) next.push(child.path);
      }
    }

    frontier = next;
  }

  return byId;
}
