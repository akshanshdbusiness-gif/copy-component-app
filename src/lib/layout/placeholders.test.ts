import { describe, expect, it } from "vitest";
import {
  isDescendantKey,
  keysEqual,
  rebasePrefix,
  relocateSubtree,
  remapUidsInKey,
  usedPlaceholderKeys,
} from "./placeholders";
import type { Rendering, RenderingSubtree } from "../types";

const CONTAINER_UID = "{11111111-1111-1111-1111-111111111111}";
const CHILD_UID = "{22222222-2222-2222-2222-222222222222}";
const GRANDCHILD_UID = "{33333333-3333-3333-3333-333333333333}";

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

/** A container in headless-main, holding a child, holding a grandchild. */
function nestedSubtree(): RenderingSubtree {
  return {
    root: rendering(CONTAINER_UID, "/headless-main"),
    descendants: [
      rendering(CHILD_UID, `/headless-main/container-1-${CONTAINER_UID}-0`),
      rendering(
        GRANDCHILD_UID,
        `/headless-main/container-1-${CONTAINER_UID}-0/inner-${CHILD_UID}-0`,
      ),
    ],
  };
}

/** Deterministic uids keep the assertions readable. */
function sequentialMinter() {
  let n = 0;
  return () => {
    n += 1;
    return `{AAAA${String(n).padStart(4, "0")}-0000-0000-0000-000000000000}`;
  };
}

describe("key comparison", () => {
  it("ignores leading slashes and casing", () => {
    expect(keysEqual("/Headless-Main", "headless-main")).toBe(true);
  });

  it("does not treat a sibling with a shared prefix as nested", () => {
    expect(isDescendantKey("/headless-main-hero", "/headless-main")).toBe(false);
    expect(isDescendantKey("/headless-main/inner", "/headless-main")).toBe(true);
  });

  it("does not treat a key as its own descendant", () => {
    expect(isDescendantKey("/headless-main", "/headless-main")).toBe(false);
  });
});

describe("rebasePrefix", () => {
  it("swaps the root path and keeps the nested remainder", () => {
    expect(rebasePrefix("/headless-main/inner-1-0", "/headless-main", "/headless-footer")).toBe(
      "/headless-footer/inner-1-0",
    );
  });

  it("returns the target when the key is the root itself", () => {
    expect(rebasePrefix("/headless-main", "/headless-main", "/headless-footer")).toBe(
      "/headless-footer",
    );
  });

  it("leaves unrelated keys alone", () => {
    expect(rebasePrefix("/other/inner", "/headless-main", "/headless-footer")).toBe("/other/inner");
  });

  it("tolerates the two sides disagreeing about the leading slash", () => {
    expect(rebasePrefix("/headless-main/inner", "headless-main", "/new")).toBe("/new/inner");
  });
});

describe("remapUidsInKey", () => {
  it("rewrites mapped uids and preserves the braced form", () => {
    const map = new Map([[CONTAINER_UID, "{99999999-9999-9999-9999-999999999999}"]]);
    expect(remapUidsInKey(`/main/container-1-${CONTAINER_UID}-0`, map)).toBe(
      "/main/container-1-{99999999-9999-9999-9999-999999999999}-0",
    );
  });

  it("preserves the bare form when the key had no braces", () => {
    const bare = CONTAINER_UID.replace(/[{}]/g, "");
    const map = new Map([[CONTAINER_UID, "{99999999-9999-9999-9999-999999999999}"]]);
    expect(remapUidsInKey(`/main/container-1-${bare}-0`, map)).toBe(
      "/main/container-1-99999999-9999-9999-9999-999999999999-0",
    );
  });

  it("leaves uids outside the subtree untouched", () => {
    const foreign = "{DEADBEEF-0000-0000-0000-000000000000}";
    expect(remapUidsInKey(`/main/container-1-${foreign}-0`, new Map())).toContain(foreign);
  });
});

describe("relocateSubtree", () => {
  it("gives every instance a fresh uid", () => {
    const relocated = relocateSubtree(nestedSubtree(), "/headless-footer", sequentialMinter());
    const uids = [relocated.root.uid, ...relocated.descendants.map((d) => d.uid)];
    expect(new Set(uids).size).toBe(3);
    expect(uids).not.toContain(CONTAINER_UID);
  });

  it("moves the root to the chosen placeholder", () => {
    const relocated = relocateSubtree(nestedSubtree(), "/headless-footer", sequentialMinter());
    expect(relocated.root.placeholderKey).toBe("/headless-footer");
  });

  it("rebases nested keys onto the new root and repoints them at the new uids", () => {
    const relocated = relocateSubtree(nestedSubtree(), "/headless-footer", sequentialMinter());
    const [child, grandchild] = relocated.descendants;

    expect(child.placeholderKey).toBe(
      `/headless-footer/container-1-${relocated.root.uid}-0`,
    );
    expect(grandchild.placeholderKey).toBe(
      `/headless-footer/container-1-${relocated.root.uid}-0/inner-${child.uid}-0`,
    );
  });

  it("still renews uids when the placeholder is unchanged", () => {
    const relocated = relocateSubtree(nestedSubtree(), "/headless-main", sequentialMinter());
    expect(relocated.root.uid).not.toBe(CONTAINER_UID);
    expect(relocated.descendants[0].placeholderKey).toBe(
      `/headless-main/container-1-${relocated.root.uid}-0`,
    );
  });

  it("carries datasource and parameters across untouched", () => {
    const subtree: RenderingSubtree = {
      root: { ...rendering(CONTAINER_UID, "/main"), dataSource: "{D}", parameters: "a=1&b=2" },
      descendants: [],
    };
    const relocated = relocateSubtree(subtree, "/footer", sequentialMinter());
    expect(relocated.root.dataSource).toBe("{D}");
    expect(relocated.root.parameters).toBe("a=1&b=2");
  });
});

describe("usedPlaceholderKeys", () => {
  it("dedupes, keeps the original spelling, and puts shallow keys first", () => {
    const keys = usedPlaceholderKeys([
      rendering("{1}", "/headless-main/inner-1-0"),
      rendering("{2}", "/headless-main"),
      rendering("{3}", "/Headless-Main"),
      rendering("{4}", "/headless-footer"),
    ]);
    expect(keys).toEqual(["/headless-footer", "/headless-main", "/headless-main/inner-1-0"]);
  });

  it("skips renderings with no placeholder", () => {
    expect(usedPlaceholderKeys([rendering("{1}", "")])).toEqual([]);
  });
});
