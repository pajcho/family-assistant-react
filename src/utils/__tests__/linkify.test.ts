import { describe, expect, it } from "vitest";

import { linkifyParts } from "../linkify";

describe("linkifyParts", () => {
  it("returns a single text part when there is no URL", () => {
    expect(linkifyParts("Haworth stolica")).toEqual([{ type: "text", value: "Haworth stolica" }]);
  });

  it("detects a bare https URL", () => {
    expect(linkifyParts("https://t.co/QJjXFR04gf")).toEqual([
      { type: "link", value: "https://t.co/QJjXFR04gf", href: "https://t.co/QJjXFR04gf" },
    ]);
  });

  it("keeps a trailing ' (Title)' out of the link", () => {
    const parts = linkifyParts(
      "https://www.twelvesouth.com/product/plugbug-duo (PlugBug Duo - Supercharge your MacBook charger.)",
    );
    expect(parts).toEqual([
      {
        type: "link",
        value: "https://www.twelvesouth.com/product/plugbug-duo",
        href: "https://www.twelvesouth.com/product/plugbug-duo",
      },
      { type: "text", value: " (PlugBug Duo - Supercharge your MacBook charger.)" },
    ]);
  });

  it("peels trailing sentence punctuation off the link", () => {
    expect(linkifyParts("Pogledaj https://example.com.")).toEqual([
      { type: "text", value: "Pogledaj " },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("prefixes www. links with https://", () => {
    expect(linkifyParts("www.suunto.com")).toEqual([
      { type: "link", value: "www.suunto.com", href: "https://www.suunto.com" },
    ]);
  });

  it("keeps balanced parentheses inside the URL", () => {
    const url = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(linkifyParts(url)).toEqual([{ type: "link", value: url, href: url }]);
  });

  it("does not linkify plain dotted words", () => {
    expect(linkifyParts("node.js is great")).toEqual([{ type: "text", value: "node.js is great" }]);
  });

  it("ignores a bare 'www.' with no host", () => {
    expect(linkifyParts("www.")).toEqual([{ type: "text", value: "www." }]);
  });

  it("ignores schemeless hosts without a dotted TLD", () => {
    expect(linkifyParts("see http://localhost:3000 now")).toEqual([
      { type: "text", value: "see http://localhost:3000 now" },
    ]);
  });

  it("handles two URLs in one title", () => {
    expect(linkifyParts("a https://one.com b http://two.com c")).toEqual([
      { type: "text", value: "a " },
      { type: "link", value: "https://one.com", href: "https://one.com" },
      { type: "text", value: " b " },
      { type: "link", value: "http://two.com", href: "http://two.com" },
      { type: "text", value: " c" },
    ]);
  });
});
