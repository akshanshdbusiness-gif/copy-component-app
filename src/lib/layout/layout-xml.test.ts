import { describe, expect, it } from "vitest";
import {
  appendRenderings,
  parseLayoutXml,
  primaryDeviceId,
  renderingsForDevice,
} from "./layout-xml";
import { DEFAULT_DEVICE_ID, type Rendering } from "../types";

const DEVICE = "{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}";

const SAMPLE = `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${DEVICE}" l="{4A6F1F9C-1B0E-4A2D-8C8F-2B4E0D9A1C3E}"><r uid="{11111111-1111-1111-1111-111111111111}" s:id="{AAAAAAAA-1111-1111-1111-111111111111}" s:ds="{DDDDDDDD-1111-1111-1111-111111111111}" s:par="w=1&amp;h=2" s:ph="headless-main" /><r uid="{22222222-2222-2222-2222-222222222222}" s:id="{AAAAAAAA-2222-2222-2222-222222222222}" s:ph="/headless-main/container-1-{11111111-1111-1111-1111-111111111111}-0" /></d></r>`;

function rendering(overrides: Partial<Rendering> = {}): Rendering {
  return {
    uid: "{99999999-9999-9999-9999-999999999999}",
    renderingItemId: "{AAAAAAAA-9999-9999-9999-999999999999}",
    placeholderKey: "headless-main",
    dataSource: "",
    parameters: "",
    extraAttributes: {},
    ...overrides,
  };
}

describe("parseLayoutXml", () => {
  it("reads renderings with their attributes", () => {
    const parsed = parseLayoutXml(SAMPLE);
    expect(parsed.devices).toHaveLength(1);
    const [first, second] = parsed.devices[0].renderings;
    expect(first.uid).toBe("{11111111-1111-1111-1111-111111111111}");
    expect(first.dataSource).toBe("{DDDDDDDD-1111-1111-1111-111111111111}");
    expect(first.placeholderKey).toBe("headless-main");
    expect(second.placeholderKey).toContain("container-1-");
  });

  it("decodes escaped ampersands in rendering parameters", () => {
    const [first] = parseLayoutXml(SAMPLE).devices[0].renderings;
    expect(first.parameters).toBe("w=1&h=2");
  });

  it("returns nothing for empty or unparseable values", () => {
    expect(parseLayoutXml("").devices).toEqual([]);
    expect(parseLayoutXml(null).devices).toEqual([]);
    expect(parseLayoutXml("not xml at all <<<").devices).toEqual([]);
  });

  it("preserves attributes it does not model", () => {
    const xml = `<r xmlns:s="s"><d id="${DEVICE}"><r uid="{1}" s:id="{2}" s:cac="1" s:vbd="1" /></d></r>`;
    const [only] = parseLayoutXml(xml).devices[0].renderings;
    expect(only.extraAttributes).toEqual({ "@_s:cac": "1", "@_s:vbd": "1" });
  });
});

describe("renderingsForDevice", () => {
  it("matches the requested device regardless of guid formatting", () => {
    const parsed = parseLayoutXml(SAMPLE);
    const bare = DEVICE.replace(/[{}]/g, "").toLowerCase();
    expect(renderingsForDevice(parsed, bare)).toHaveLength(2);
  });

  it("falls back to the first device when the requested one is absent", () => {
    const parsed = parseLayoutXml(SAMPLE);
    expect(renderingsForDevice(parsed, "{00000000-0000-0000-0000-000000000000}")).toHaveLength(2);
  });
});

describe("primaryDeviceId", () => {
  it("prefers a device that actually holds renderings", () => {
    const xml = `<r xmlns:s="s"><d id="{00000000-0000-0000-0000-000000000001}" /><d id="${DEVICE}"><r uid="{1}" /></d></r>`;
    expect(primaryDeviceId(parseLayoutXml(xml))).toBe(DEFAULT_DEVICE_ID);
  });

  it("falls back to the default device for an empty layout", () => {
    expect(primaryDeviceId(parseLayoutXml(""))).toBe(DEFAULT_DEVICE_ID);
  });
});

describe("appendRenderings", () => {
  it("adds to an existing device without disturbing what is there", () => {
    const result = appendRenderings(SAMPLE, DEVICE, [rendering({ placeholderKey: "headless-footer" })]);
    const renderings = parseLayoutXml(result).devices[0].renderings;
    expect(renderings).toHaveLength(3);
    expect(renderings[0].uid).toBe("{11111111-1111-1111-1111-111111111111}");
    expect(renderings[2].placeholderKey).toBe("headless-footer");
  });

  it("keeps the delta marker so the page still inherits its base presentation", () => {
    const result = appendRenderings("", DEVICE, [rendering()]);
    expect(result).toContain('p:p="1"');
    expect(result).toContain('xmlns:p="p"');
    expect(result).toContain('xmlns:s="s"');
  });

  it("creates the device when the existing delta does not have one", () => {
    const existing = `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{00000000-0000-0000-0000-000000000009}"><r uid="{5}" /></d></r>`;
    const parsed = parseLayoutXml(appendRenderings(existing, DEVICE, [rendering()]));
    expect(parsed.devices).toHaveLength(2);
    expect(parsed.devices[1].renderings[0].uid).toBe("{99999999-9999-9999-9999-999999999999}");
  });

  it("re-escapes parameters on the way out", () => {
    const result = appendRenderings("", DEVICE, [rendering({ parameters: "a=1&b=2" })]);
    expect(result).toContain("a=1&amp;b=2");
    expect(parseLayoutXml(result).devices[0].renderings[0].parameters).toBe("a=1&b=2");
  });

  it("round-trips a full document unchanged when nothing is appended", () => {
    expect(appendRenderings(SAMPLE, DEVICE, [])).toBe(SAMPLE);
  });

  // A parameter value that survives the read but not the write would be
  // written back to the CMS as malformed XML, so pin the escaping down.
  it.each([
    ['a quote', 'title=He said "hi"'],
    ["an angle bracket", "html=<b>bold</b>"],
    ["an apostrophe", "name=it's"],
    ["an ampersand and equals", "q=a&b=c%20d"],
  ])("round-trips a parameter containing %s", (_label, parameters) => {
    const result = appendRenderings("", DEVICE, [rendering({ parameters })]);
    expect(parseLayoutXml(result).devices[0].renderings[0].parameters).toBe(parameters);
  });

  it("round-trips a datasource path with an ampersand", () => {
    const dataSource = "/sitecore/content/Site/Data/R&D";
    const result = appendRenderings("", DEVICE, [rendering({ dataSource })]);
    expect(parseLayoutXml(result).devices[0].renderings[0].dataSource).toBe(dataSource);
  });

  it("starts a fresh delta rather than losing the component when the value is corrupt", () => {
    const result = appendRenderings("<<<garbage", DEVICE, [rendering()]);
    expect(parseLayoutXml(result).devices[0].renderings).toHaveLength(1);
  });
});
