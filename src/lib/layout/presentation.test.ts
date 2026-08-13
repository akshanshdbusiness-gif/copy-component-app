import { describe, expect, it } from "vitest";
import { collectSubtree, parsePresentationDetails } from "./presentation";
import type { Rendering } from "../types";

const DEVICE = "{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}";
const CONTAINER = "{11111111-1111-1111-1111-111111111111}";
const CHILD = "{22222222-2222-2222-2222-222222222222}";
const GRANDCHILD = "{33333333-3333-3333-3333-333333333333}";
const SIBLING = "{44444444-4444-4444-4444-444444444444}";

function rendering(uid: string, placeholderKey: string): Rendering {
  return {
    uid,
    renderingItemId: "{AAAAAAAA-0000-0000-0000-000000000000}",
    placeholderKey,
    dataSource: "",
    parameters: "",
    extraAttributes: {},
  };
}

describe("parsePresentationDetails", () => {
  it("reads the JSON form Pages hands back", () => {
    const json = JSON.stringify({
      devices: [
        {
          id: DEVICE,
          renderings: [
            {
              instanceId: CONTAINER,
              id: "{AAAAAAAA-1111-1111-1111-111111111111}",
              placeholderKey: "headless-main",
              dataSource: "{DDDDDDDD-0000-0000-0000-000000000000}",
              parameters: "w=1&h=2",
            },
          ],
        },
      ],
    });

    const [only] = parsePresentationDetails(json);
    expect(only.uid).toBe(CONTAINER);
    expect(only.renderingItemId).toBe("{AAAAAAAA-1111-1111-1111-111111111111}");
    expect(only.placeholderKey).toBe("headless-main");
    expect(only.dataSource).toBe("{DDDDDDDD-0000-0000-0000-000000000000}");
    expect(only.parameters).toBe("w=1&h=2");
  });

  it("reads the XML form too", () => {
    const xml = `<r xmlns:s="s"><d id="${DEVICE}"><r uid="${CONTAINER}" s:id="{A}" s:ph="headless-main" /></d></r>`;
    const [only] = parsePresentationDetails(xml);
    expect(only.uid).toBe(CONTAINER);
    expect(only.placeholderKey).toBe("headless-main");
  });

  it("accepts an already-parsed object", () => {
    const parsed = parsePresentationDetails({
      devices: [{ id: DEVICE, renderings: [{ instanceId: CONTAINER, placeholderKey: "main" }] }],
    });
    expect(parsed).toHaveLength(1);
  });

  it("prefers the device that has renderings", () => {
    const json = JSON.stringify({
      devices: [
        { id: "{00000000-0000-0000-0000-000000000001}", renderings: [] },
        { id: DEVICE, renderings: [{ instanceId: CONTAINER, placeholderKey: "main" }] },
      ],
    });
    expect(parsePresentationDetails(json)).toHaveLength(1);
  });

  it("returns nothing for empty input", () => {
    expect(parsePresentationDetails("")).toEqual([]);
    expect(parsePresentationDetails(null)).toEqual([]);
    expect(parsePresentationDetails(undefined)).toEqual([]);
  });
});

describe("collectSubtree", () => {
  const page = [
    rendering(CONTAINER, "/headless-main"),
    rendering(CHILD, `/headless-main/container-1-${CONTAINER}-0`),
    rendering(GRANDCHILD, `/headless-main/container-1-${CONTAINER}-0/inner-${CHILD}-0`),
    rendering(SIBLING, "/headless-main"),
  ];

  it("takes the whole nest, not just the direct children", () => {
    const subtree = collectSubtree(page, CONTAINER);
    expect(subtree?.root.uid).toBe(CONTAINER);
    expect(subtree?.descendants.map((d) => d.uid)).toEqual([CHILD, GRANDCHILD]);
  });

  it("leaves siblings in the same placeholder out of it", () => {
    const subtree = collectSubtree(page, CONTAINER);
    expect(subtree?.descendants.map((d) => d.uid)).not.toContain(SIBLING);
  });

  it("returns just the rendering when nothing is nested inside it", () => {
    const subtree = collectSubtree(page, SIBLING);
    expect(subtree?.descendants).toEqual([]);
  });

  it("keeps descendants in document order", () => {
    const shuffled = [page[0], page[2], page[1], page[3]];
    const subtree = collectSubtree(shuffled, CONTAINER);
    expect(subtree?.descendants.map((d) => d.uid)).toEqual([GRANDCHILD, CHILD]);
  });

  it("matches uids regardless of formatting", () => {
    expect(collectSubtree(page, CONTAINER.replace(/[{}]/g, "").toLowerCase())).not.toBeNull();
  });

  it("returns null when the rendering is not on the page", () => {
    expect(collectSubtree(page, "{DEADBEEF-0000-0000-0000-000000000000}")).toBeNull();
  });
});
