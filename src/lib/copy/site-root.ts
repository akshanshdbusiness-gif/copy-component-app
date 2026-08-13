import type { AuthoringClient } from "../marketplace/authoring";

/** Nothing above this is ever a page. */
const CONTENT_ROOT = "/sitecore/content";

/**
 * Find the site's home item by walking up from the page being edited.
 *
 * `pages.context` reports the current page but not the site's content root,
 * and the depth of a site under /sitecore/content varies (collections, tenant
 * folders). Home is the highest ancestor that still has presentation — its
 * parent, the site node, does not. Scoping the target picker there is what
 * keeps a copy inside the site the author is working on.
 */
export async function findSiteRoot(
  authoring: AuthoringClient,
  pagePath: string,
  language?: string,
): Promise<string> {
  const segments = pagePath.split("/").filter(Boolean);
  let highestPage = pagePath;

  // Walk up one level at a time; stop as soon as an ancestor is not a page.
  for (let depth = segments.length - 1; depth > 0; depth--) {
    const ancestorPath = `/${segments.slice(0, depth).join("/")}`;
    if (!ancestorPath.toLowerCase().startsWith(CONTENT_ROOT)) break;
    if (ancestorPath.toLowerCase() === CONTENT_ROOT) break;

    let ancestorIsPage = false;
    try {
      const children = await authoring.getChildren(
        `/${segments.slice(0, depth - 1).join("/")}` || CONTENT_ROOT,
        language,
      );
      const ancestor = children.find(
        (child) => child.path.toLowerCase() === ancestorPath.toLowerCase(),
      );
      ancestorIsPage = Boolean(ancestor?.hasPresentation);
    } catch {
      break;
    }

    if (!ancestorIsPage) break;
    highestPage = ancestorPath;
  }

  return highestPage;
}
