import { describe, expect, it } from "vitest";
import { mapLocalItems } from "./local-items";
import type { AuthoringClient } from "../marketplace/authoring";
import type { PageSummary } from "../types";

const PAGE = "/sitecore/content/Site/Home/About";

function node(overrides: Partial<PageSummary> & { itemId: string; path: string }): PageSummary {
  const name = overrides.path.split("/").pop() ?? "";
  return {
    name,
    displayName: name,
    hasChildren: false,
    hasPresentation: false,
    ...overrides,
  };
}

class FakeAuthoring {
  calls: string[] = [];
  constructor(private readonly tree: Record<string, PageSummary[]>) {}

  async getChildren(parentPath: string) {
    this.calls.push(parentPath);
    const children = this.tree[parentPath];
    if (children === undefined) throw new Error(`cannot read ${parentPath}`);
    return children;
  }

  asClient() {
    return this as unknown as AuthoringClient;
  }
}

describe("mapLocalItems", () => {
  it("maps a datasource sitting under the page's Data folder", async () => {
    const authoring = new FakeAuthoring({
      [PAGE]: [node({ itemId: "{DATA0000-0000-0000-0000-000000000000}", path: `${PAGE}/Data`, hasChildren: true })],
      [`${PAGE}/Data`]: [node({ itemId: "{PROMO000-0000-0000-0000-000000000000}", path: `${PAGE}/Data/Promo` })],
    });

    const map = await mapLocalItems(authoring.asClient(), PAGE);

    expect(map.get("{PROMO000-0000-0000-0000-000000000000}")).toBe(`${PAGE}/Data/Promo`);
  });

  // Sitecore returns ids braced and upper-case, but the layout's `s:ds` has
  // been seen bare and lower-case, so the two must still meet.
  it("matches ids regardless of formatting", async () => {
    const authoring = new FakeAuthoring({
      [PAGE]: [node({ itemId: "abcdef01-2345-6789-abcd-ef0123456789", path: `${PAGE}/Promo` })],
    });

    const map = await mapLocalItems(authoring.asClient(), PAGE);

    expect(map.get("{ABCDEF01-2345-6789-ABCD-EF0123456789}")).toBe(`${PAGE}/Promo`);
  });

  it("does not descend into child pages", async () => {
    const authoring = new FakeAuthoring({
      [PAGE]: [
        node({
          itemId: "{CHILD000-0000-0000-0000-000000000000}",
          path: `${PAGE}/Sub`,
          hasChildren: true,
          hasPresentation: true,
        }),
      ],
    });

    const map = await mapLocalItems(authoring.asClient(), PAGE);

    expect(map.size).toBe(0);
    expect(authoring.calls).toEqual([PAGE]);
  });

  it("reaches datasources nested below the Data folder", async () => {
    const authoring = new FakeAuthoring({
      [PAGE]: [node({ itemId: "{D0000000-0000-0000-0000-000000000000}", path: `${PAGE}/Data`, hasChildren: true })],
      [`${PAGE}/Data`]: [
        node({ itemId: "{C0000000-0000-0000-0000-000000000000}", path: `${PAGE}/Data/Cards`, hasChildren: true }),
      ],
      [`${PAGE}/Data/Cards`]: [
        node({ itemId: "{L0000000-0000-0000-0000-000000000000}", path: `${PAGE}/Data/Cards/One` }),
      ],
    });

    const map = await mapLocalItems(authoring.asClient(), PAGE);

    expect(map.get("{L0000000-0000-0000-0000-000000000000}")).toBe(`${PAGE}/Data/Cards/One`);
  });

  it("stops at the depth limit rather than walking forever", async () => {
    const authoring = new FakeAuthoring({
      [PAGE]: [node({ itemId: "{A0000000-0000-0000-0000-000000000000}", path: `${PAGE}/a`, hasChildren: true })],
      [`${PAGE}/a`]: [node({ itemId: "{B0000000-0000-0000-0000-000000000000}", path: `${PAGE}/a/b`, hasChildren: true })],
      [`${PAGE}/a/b`]: [node({ itemId: "{C0000000-0000-0000-0000-000000000000}", path: `${PAGE}/a/b/c` })],
    });

    const map = await mapLocalItems(authoring.asClient(), PAGE, undefined, 2);

    expect(map.has("{B0000000-0000-0000-0000-000000000000}")).toBe(true);
    expect(map.has("{C0000000-0000-0000-0000-000000000000}")).toBe(false);
  });

  it("keeps going when one branch cannot be read", async () => {
    const authoring = new FakeAuthoring({
      [PAGE]: [
        node({ itemId: "{BAD00000-0000-0000-0000-000000000000}", path: `${PAGE}/Locked`, hasChildren: true }),
        node({ itemId: "{OK000000-0000-0000-0000-000000000000}", path: `${PAGE}/Data`, hasChildren: true }),
      ],
      [`${PAGE}/Data`]: [node({ itemId: "{PROMO000-0000-0000-0000-000000000000}", path: `${PAGE}/Data/Promo` })],
      // `${PAGE}/Locked` deliberately absent -> getChildren throws
    });

    const map = await mapLocalItems(authoring.asClient(), PAGE);

    expect(map.get("{PROMO000-0000-0000-0000-000000000000}")).toBe(`${PAGE}/Data/Promo`);
  });

  it("returns an empty map when the page itself cannot be read", async () => {
    const authoring = new FakeAuthoring({});
    await expect(mapLocalItems(authoring.asClient(), PAGE)).resolves.toEqual(new Map());
  });
});
