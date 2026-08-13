import { describe, expect, it } from "vitest";
import { resolveLayout } from "./merge";

const DEVICE = "{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}";
const A = "{11111111-1111-1111-1111-111111111111}";
const B = "{22222222-2222-2222-2222-222222222222}";

function layout(...renderings: string[]): string {
  return `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${DEVICE}">${renderings.join("")}</d></r>`;
}

const SHARED = layout(
  `<r uid="${A}" s:id="{AAAA0001-0000-0000-0000-000000000000}" s:ds="{DDDD0001-0000-0000-0000-000000000000}" s:par="w=1" s:ph="headless-main" />`,
);

describe("resolveLayout", () => {
  it("returns the shared layout when there is no delta", () => {
    const resolved = resolveLayout(SHARED, "");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].uid).toBe(A);
    expect(resolved[0].dataSource).toBe("{DDDD0001-0000-0000-0000-000000000000}");
  });

  it("returns the delta alone when there is no shared layout", () => {
    const resolved = resolveLayout("", layout(`<r uid="${B}" s:ph="headless-footer" />`));
    expect(resolved.map((r) => r.uid)).toEqual([B]);
  });

  it("treats a delta entry with a new uid as an addition", () => {
    const resolved = resolveLayout(
      SHARED,
      layout(`<r uid="${B}" s:id="{AAAA0002-0000-0000-0000-000000000000}" s:ph="headless-footer" />`),
    );
    expect(resolved.map((r) => r.uid)).toEqual([A, B]);
  });

  // The case that silently breaks a copy: a partial patch must not blank out
  // the datasource the base already carries.
  it("keeps base attributes the patch does not mention", () => {
    const resolved = resolveLayout(SHARED, layout(`<r uid="${A}" s:ph="headless-footer" />`));
    expect(resolved).toHaveLength(1);
    expect(resolved[0].placeholderKey).toBe("headless-footer");
    expect(resolved[0].dataSource).toBe("{DDDD0001-0000-0000-0000-000000000000}");
    expect(resolved[0].parameters).toBe("w=1");
  });

  it("lets the patch override an attribute it does specify", () => {
    const resolved = resolveLayout(
      SHARED,
      layout(`<r uid="${A}" s:ds="{DDDD0002-0000-0000-0000-000000000000}" />`),
    );
    expect(resolved[0].dataSource).toBe("{DDDD0002-0000-0000-0000-000000000000}");
    expect(resolved[0].placeholderKey).toBe("headless-main");
  });

  it("matches uids regardless of formatting", () => {
    const bare = A.replace(/[{}]/g, "").toLowerCase();
    const resolved = resolveLayout(SHARED, layout(`<r uid="${bare}" s:ph="moved" />`));
    expect(resolved).toHaveLength(1);
    expect(resolved[0].placeholderKey).toBe("moved");
  });

  it("merges extra attributes rather than dropping them", () => {
    const resolved = resolveLayout(
      layout(`<r uid="${A}" s:cac="1" s:ph="main" />`),
      layout(`<r uid="${A}" s:vbd="1" />`),
    );
    expect(resolved[0].extraAttributes).toEqual({ "@_s:cac": "1", "@_s:vbd": "1" });
  });

  it("returns nothing when the page has no layout at all", () => {
    expect(resolveLayout("", "")).toEqual([]);
    expect(resolveLayout(null, undefined)).toEqual([]);
  });
});
