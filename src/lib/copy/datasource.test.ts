import { describe, expect, it } from "vitest";
import {
  buildLocalDataSource,
  classifyDataSource,
  localSchemeRelativePath,
  needsPathResolution,
  relativeUnder,
  splitRelativePath,
  uniqueName,
} from "./datasource";

const PAGE = "/sitecore/content/Site/Home/About";

describe("classifyDataSource", () => {
  it("treats an item under the page as local", () => {
    const result = classifyDataSource(`${PAGE}/Data/Promo`, PAGE);
    expect(result).toEqual({ scope: "local", relativePath: "Data/Promo" });
  });

  it("treats a shared item elsewhere in the tree as global", () => {
    expect(classifyDataSource("/sitecore/content/Site/Data/Promo", PAGE).scope).toBe("global");
  });

  it("resolves an id-form datasource through the supplied path", () => {
    const id = "{DDDDDDDD-0000-0000-0000-000000000000}";
    expect(classifyDataSource(id, PAGE, `${PAGE}/Data/Promo`)).toEqual({
      scope: "local",
      relativePath: "Data/Promo",
    });
  });

  it("falls back to global when an id cannot be resolved", () => {
    expect(classifyDataSource("{DDDDDDDD-0000-0000-0000-000000000000}", PAGE).scope).toBe("global");
  });

  // XM Cloud writes page-relative datasources with a `local:` prefix. Treating
  // one as shared skipped the most local kind of datasource there is.
  it("treats a local: datasource as local without needing a lookup", () => {
    expect(classifyDataSource("local:/Data/Promo", PAGE)).toEqual({
      scope: "local",
      relativePath: "Data/Promo",
    });
  });

  it("accepts the local: prefix with or without the slash, and any casing", () => {
    expect(classifyDataSource("local:Data/Promo", PAGE).relativePath).toBe("Data/Promo");
    expect(classifyDataSource("LOCAL:/Data/Promo", PAGE).relativePath).toBe("Data/Promo");
  });

  it("handles a local: datasource nested below the Data folder", () => {
    expect(classifyDataSource("local:/Data/Cards/One", PAGE).relativePath).toBe("Data/Cards/One");
  });

  it("does not treat an empty local: value as local", () => {
    expect(classifyDataSource("local:/", PAGE).scope).toBe("global");
  });

  it("never copies query or token datasources", () => {
    expect(classifyDataSource("query:./Data/*", PAGE).scope).toBe("global");
    expect(classifyDataSource("$site/Data/Promo", PAGE).scope).toBe("global");
  });

  it("reports no datasource for an empty value", () => {
    expect(classifyDataSource("", PAGE).scope).toBe("none");
    expect(classifyDataSource("   ", PAGE).scope).toBe("none");
  });

  it("does not treat the page itself as its own local datasource", () => {
    expect(classifyDataSource(PAGE, PAGE).scope).toBe("global");
  });

  it("does not mistake a sibling page with a shared prefix for a child", () => {
    expect(classifyDataSource("/sitecore/content/Site/Home/AboutUs/Data/X", PAGE).scope).toBe(
      "global",
    );
  });

  it("compares paths case-insensitively, as Sitecore does", () => {
    expect(classifyDataSource(`${PAGE.toUpperCase()}/Data/Promo`, PAGE).scope).toBe("local");
  });
});

describe("localSchemeRelativePath / buildLocalDataSource", () => {
  it("round-trips a page-relative value", () => {
    const relative = localSchemeRelativePath("local:/Data/Promo");
    expect(relative).toBe("Data/Promo");
    expect(buildLocalDataSource(["Data"], "Promo")).toBe("local:/Data/Promo");
  });

  it("returns null for values that are not page-relative", () => {
    expect(localSchemeRelativePath("/sitecore/content/x")).toBeNull();
    expect(localSchemeRelativePath("{DDDDDDDD-0000-0000-0000-000000000000}")).toBeNull();
    expect(localSchemeRelativePath("")).toBeNull();
  });

  it("rebuilds a nested path", () => {
    expect(buildLocalDataSource(["Data", "Cards"], "One")).toBe("local:/Data/Cards/One");
  });
});

describe("relativeUnder", () => {
  it("returns the remainder below the ancestor", () => {
    expect(relativeUnder("/a/b/c", "/a")).toBe("b/c");
  });

  it("ignores a trailing slash on either side", () => {
    expect(relativeUnder("/a/b/", "/a/")).toBe("b");
  });

  it("returns null when the paths are unrelated or equal", () => {
    expect(relativeUnder("/a/b", "/x")).toBeNull();
    expect(relativeUnder("/a", "/a")).toBeNull();
  });
});

describe("splitRelativePath", () => {
  it("splits folders from the leaf name", () => {
    expect(splitRelativePath("Data/Promo")).toEqual({ folders: ["Data"], name: "Promo" });
  });

  it("handles a leaf sitting directly under the page", () => {
    expect(splitRelativePath("Promo")).toEqual({ folders: [], name: "Promo" });
  });

  it("handles nested folders", () => {
    expect(splitRelativePath("Data/Cards/Promo")).toEqual({
      folders: ["Data", "Cards"],
      name: "Promo",
    });
  });
});

describe("uniqueName", () => {
  it("keeps the name when nothing collides", () => {
    expect(uniqueName("Promo", ["Other"])).toBe("Promo");
  });

  it("suffixes rather than overwriting an existing sibling", () => {
    expect(uniqueName("Promo", ["Promo"])).toBe("Promo-1");
    expect(uniqueName("Promo", ["Promo", "Promo-1"])).toBe("Promo-2");
  });

  it("compares names case-insensitively", () => {
    expect(uniqueName("Promo", ["promo"])).toBe("Promo-1");
  });
});

describe("needsPathResolution", () => {
  it("is true only for id-form datasources", () => {
    expect(needsPathResolution("{DDDDDDDD-0000-0000-0000-000000000000}")).toBe(true);
    expect(needsPathResolution("/sitecore/content/x")).toBe(false);
    expect(needsPathResolution("query:./x")).toBe(false);
    expect(needsPathResolution("")).toBe(false);
  });
});
