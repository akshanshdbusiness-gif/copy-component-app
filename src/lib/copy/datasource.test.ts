import { describe, expect, it } from "vitest";
import {
  classifyDataSource,
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
