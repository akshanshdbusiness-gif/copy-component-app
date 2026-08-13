import { describe, expect, it } from "vitest";
import { executeCopy } from "./execute";
import { parseLayoutXml } from "../layout/layout-xml";
import type { AuthoringClient } from "../marketplace/authoring";
import type { CopyRequest, PageSummary, Rendering, RenderingSubtree } from "../types";

const SOURCE_PAGE = "/sitecore/content/Site/Home/About";
const TARGET_PAGE = "/sitecore/content/Site/Home/Contact";
const CONTAINER = "{11111111-1111-1111-1111-111111111111}";
const CHILD = "{22222222-2222-2222-2222-222222222222}";
const LOCAL_DS = "{DDDDDDDD-1111-1111-1111-111111111111}";
const GLOBAL_DS = "{DDDDDDDD-2222-2222-2222-222222222222}";

function rendering(overrides: Partial<Rendering> & { uid: string }): Rendering {
  return {
    renderingItemId: "{AAAAAAAA-0000-0000-0000-000000000000}",
    placeholderKey: "/headless-main",
    dataSource: "",
    parameters: "",
    extraAttributes: {},
    ...overrides,
  };
}

const TARGET: PageSummary = {
  itemId: "{CCCCCCCC-0000-0000-0000-000000000000}",
  name: "Contact",
  displayName: "Contact",
  path: TARGET_PAGE,
  hasChildren: false,
  hasPresentation: true,
};

/**
 * A recording stand-in for the Authoring API. It models only what the executor
 * relies on: item lookups by path, children, the layout field, copies and
 * creates.
 */
class FakeAuthoring {
  writes: Array<{ itemId: string; value: string; language?: string }> = [];
  copies: Array<{ source: string; parent: string; name: string }> = [];
  creates: Array<{ parent: string; name: string; template: string }> = [];
  finalRenderings = "";
  items = new Map<string, { itemId: string; path: string; template?: { templateId: string; name: string } }>();
  children = new Map<string, PageSummary[]>();

  /** Paths resolve here; guids only via resolveItem, mirroring the real schema. */
  async getItem(pathOrId: string) {
    if (/^\{?[0-9a-fA-F-]{32,38}\}?$/.test(pathOrId)) return null;
    return this.items.get(pathOrId.toLowerCase()) ?? null;
  }

  async getItemById(itemId: string) {
    return this.items.get(itemId.toLowerCase()) ?? null;
  }

  async resolveItem(pathOrId: string) {
    const byId = await this.getItemById(pathOrId);
    if (byId) return { item: byId, errors: [] as string[] };
    return { item: await this.getItem(pathOrId), errors: [] as string[] };
  }

  async getChildren(parentId: string) {
    return this.children.get(parentId) ?? [];
  }

  async getFinalRenderings() {
    return this.finalRenderings;
  }

  async setFinalRenderings(itemId: string, value: string, language?: string) {
    this.writes.push({ itemId, value, language });
  }

  async copyItem(source: string, parent: string, name: string) {
    this.copies.push({ source, parent, name });
    const itemId = `{COPIED${this.copies.length}-0000-0000-0000-000000000000}`;
    return { itemId, name, path: `${TARGET_PAGE}/Data/${name}` };
  }

  async createItem(parent: string, name: string, template: string) {
    this.creates.push({ parent, name, template });
    const itemId = `{FOLDER${this.creates.length}-0000-0000-0000-000000000000}`;
    return { itemId, name, path: `${TARGET_PAGE}/${name}` };
  }

  asClient() {
    return this as unknown as AuthoringClient;
  }
}

function request(subtree: RenderingSubtree, placeholder = "/headless-main"): CopyRequest {
  return {
    source: {
      pageItemId: "{BBBBBBBB-0000-0000-0000-000000000000}",
      pagePath: SOURCE_PAGE,
      language: "en",
      subtree,
    },
    targets: [{ page: TARGET, placeholder: { kind: "pick", placeholderKey: placeholder } }],
    language: "en",
  };
}

function fakeWithLocalDataSource() {
  const authoring = new FakeAuthoring();
  authoring.items.set(LOCAL_DS.toLowerCase(), {
    itemId: LOCAL_DS,
    path: `${SOURCE_PAGE}/Data/Promo`,
  });
  authoring.items.set(GLOBAL_DS.toLowerCase(), {
    itemId: GLOBAL_DS,
    path: "/sitecore/content/Site/Data/SharedPromo",
  });
  authoring.items.set(`${SOURCE_PAGE}/Data`.toLowerCase(), {
    itemId: "{SRCDATA0-0000-0000-0000-000000000000}",
    path: `${SOURCE_PAGE}/Data`,
    template: { templateId: "{FOLDERTP-0000-0000-0000-000000000000}", name: "Folder" },
  });
  return authoring;
}

describe("executeCopy", () => {
  it("copies a local datasource under the target page and repoints the copy at it", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: LOCAL_DS }),
      descendants: [],
    };

    const [result] = await executeCopy(authoring.asClient(), request(subtree));

    expect(result.ok).toBe(true);
    expect(authoring.copies).toHaveLength(1);
    expect(authoring.copies[0].source).toBe(LOCAL_DS);
    expect(authoring.copies[0].name).toBe("Promo");

    const written = parseLayoutXml(authoring.writes[0].value).devices[0].renderings;
    expect(written[0].dataSource).toBe("{COPIED1-0000-0000-0000-000000000000}");
  });

  it("leaves a global datasource pointing at the original", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: GLOBAL_DS }),
      descendants: [],
    };

    await executeCopy(authoring.asClient(), request(subtree));

    expect(authoring.copies).toHaveLength(0);
    const written = parseLayoutXml(authoring.writes[0].value).devices[0].renderings;
    expect(written[0].dataSource).toBe(GLOBAL_DS);
  });

  it("creates the Data folder when the target page has none, using the source folder's template", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: LOCAL_DS }),
      descendants: [],
    };

    await executeCopy(authoring.asClient(), request(subtree));

    expect(authoring.creates).toEqual([
      {
        parent: TARGET.itemId,
        name: "Data",
        template: "{FOLDERTP-0000-0000-0000-000000000000}",
      },
    ]);
  });

  it("reuses an existing Data folder instead of making a second one", async () => {
    const authoring = fakeWithLocalDataSource();
    authoring.items.set(`${TARGET_PAGE}/Data`.toLowerCase(), {
      itemId: "{TGTDATA0-0000-0000-0000-000000000000}",
      path: `${TARGET_PAGE}/Data`,
    });
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: LOCAL_DS }),
      descendants: [],
    };

    await executeCopy(authoring.asClient(), request(subtree));

    expect(authoring.creates).toHaveLength(0);
    expect(authoring.copies[0].parent).toBe("{TGTDATA0-0000-0000-0000-000000000000}");
  });

  it("suffixes rather than overwriting when the target already holds that datasource name", async () => {
    const authoring = fakeWithLocalDataSource();
    authoring.items.set(`${TARGET_PAGE}/Data`.toLowerCase(), {
      itemId: "{TGTDATA0-0000-0000-0000-000000000000}",
      path: `${TARGET_PAGE}/Data`,
    });
    authoring.children.set("{TGTDATA0-0000-0000-0000-000000000000}", [
      { ...TARGET, name: "Promo", displayName: "Promo", path: `${TARGET_PAGE}/Data/Promo` },
    ]);
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: LOCAL_DS }),
      descendants: [],
    };

    await executeCopy(authoring.asClient(), request(subtree));

    expect(authoring.copies[0].name).toBe("Promo-1");
  });

  it("copies a shared datasource once when two renderings point at it", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: LOCAL_DS }),
      descendants: [
        rendering({
          uid: CHILD,
          dataSource: LOCAL_DS,
          placeholderKey: `/headless-main/container-1-${CONTAINER}-0`,
        }),
      ],
    };

    await executeCopy(authoring.asClient(), request(subtree));

    expect(authoring.copies).toHaveLength(1);
    const written = parseLayoutXml(authoring.writes[0].value).devices[0].renderings;
    expect(written[0].dataSource).toBe(written[1].dataSource);
  });

  it("writes the nested children with keys pointing at the new container uid", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER }),
      descendants: [
        rendering({ uid: CHILD, placeholderKey: `/headless-main/container-1-${CONTAINER}-0` }),
      ],
    };

    await executeCopy(authoring.asClient(), request(subtree, "/headless-footer"));

    const written = parseLayoutXml(authoring.writes[0].value).devices[0].renderings;
    expect(written[0].placeholderKey).toBe("/headless-footer");
    expect(written[1].placeholderKey).toBe(
      `/headless-footer/container-1-${written[0].uid}-0`,
    );
    expect(written[0].uid).not.toBe(CONTAINER);
  });

  it("appends to the target's existing layout instead of replacing it", async () => {
    const authoring = fakeWithLocalDataSource();
    authoring.finalRenderings = `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}"><r uid="{EEEEEEEE-0000-0000-0000-000000000000}" s:ph="/headless-main" /></d></r>`;

    await executeCopy(
      authoring.asClient(),
      request({ root: rendering({ uid: CONTAINER }), descendants: [] }),
    );

    const written = parseLayoutXml(authoring.writes[0].value).devices[0].renderings;
    expect(written).toHaveLength(2);
    expect(written[0].uid).toBe("{EEEEEEEE-0000-0000-0000-000000000000}");
  });

  it("honours the same-placeholder choice", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, placeholderKey: "/headless-main" }),
      descendants: [],
    };
    const req = request(subtree);
    req.targets[0].placeholder = { kind: "same" };

    await executeCopy(authoring.asClient(), req);

    const written = parseLayoutXml(authoring.writes[0].value).devices[0].renderings;
    expect(written[0].placeholderKey).toBe("/headless-main");
  });

  it("reports a failed target without stopping the others", async () => {
    const authoring = fakeWithLocalDataSource();
    const secondTarget: PageSummary = { ...TARGET, itemId: "{DDDD0000-0000-0000-0000-000000000000}", path: "/sitecore/content/Site/Home/News" };
    let call = 0;
    authoring.setFinalRenderings = async (itemId: string, value: string) => {
      call += 1;
      if (call === 1) throw new Error("item is locked");
      authoring.writes.push({ itemId, value });
    };

    const req = request({ root: rendering({ uid: CONTAINER }), descendants: [] });
    req.targets.push({ page: secondTarget, placeholder: { kind: "same" } });

    const results = await executeCopy(authoring.asClient(), req);

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("locked");
    expect(results[1].ok).toBe(true);
    expect(authoring.writes).toHaveLength(1);
  });

  // The regression that made a copy look successful while landing empty.
  it("resolves a guid datasource by id, not by path", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: LOCAL_DS }),
      descendants: [],
    };

    const [result] = await executeCopy(authoring.asClient(), request(subtree));

    expect(authoring.copies).toHaveLength(1);
    expect(result.steps.some((s) => s.kind === "copy-datasource")).toBe(true);
  });

  it("reports an unresolvable datasource instead of skipping it silently", async () => {
    const authoring = new FakeAuthoring(); // knows nothing about LOCAL_DS
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: LOCAL_DS }),
      descendants: [],
    };

    const [result] = await executeCopy(authoring.asClient(), request(subtree));

    expect(result.ok).toBe(true);
    const skip = result.steps.find((s) => s.kind === "skip-datasource");
    expect(skip?.warn).toBe(true);
    expect(skip?.detail).toContain(LOCAL_DS);
  });

  it("says why a shared datasource was left alone, naming the page it compared against", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: GLOBAL_DS }),
      descendants: [],
    };

    const [result] = await executeCopy(authoring.asClient(), request(subtree));

    const skip = result.steps.find((s) => s.kind === "skip-datasource");
    expect(skip?.warn).toBeUndefined();
    expect(skip?.detail).toContain(SOURCE_PAGE);
    expect(skip?.detail).toContain("/sitecore/content/Site/Data/SharedPromo");
  });

  it("reports a dynamic datasource as deliberately left as-is", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: "query:./Data/*" }),
      descendants: [],
    };

    const [result] = await executeCopy(authoring.asClient(), request(subtree));

    const skip = result.steps.find((s) => s.kind === "skip-datasource");
    expect(skip?.label).toContain("Dynamic");
    expect(authoring.copies).toHaveLength(0);
  });

  it("reports each distinct datasource once, not once per rendering", async () => {
    const authoring = fakeWithLocalDataSource();
    const subtree: RenderingSubtree = {
      root: rendering({ uid: CONTAINER, dataSource: GLOBAL_DS }),
      descendants: [
        rendering({
          uid: CHILD,
          dataSource: GLOBAL_DS,
          placeholderKey: `/headless-main/container-1-${CONTAINER}-0`,
        }),
      ],
    };

    const [result] = await executeCopy(authoring.asClient(), request(subtree));

    expect(result.steps.filter((s) => s.kind === "skip-datasource")).toHaveLength(1);
  });

  it("writes against the language the author is editing", async () => {
    const authoring = fakeWithLocalDataSource();
    const req = request({ root: rendering({ uid: CONTAINER }), descendants: [] });
    req.language = "de-DE";

    await executeCopy(authoring.asClient(), req);

    expect(authoring.writes[0].language).toBe("de-DE");
  });
});
