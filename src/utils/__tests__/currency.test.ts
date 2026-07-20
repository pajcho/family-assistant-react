import { describe, expect, it } from "vitest";

import {
  convertToRsd,
  currencySymbol,
  formatOriginalAmount,
  formatRateInput,
  parseDecimal,
} from "@/utils/currency";

describe("parseDecimal", () => {
  it("parses dot and comma decimal separators", () => {
    expect(parseDecimal("117.3751")).toBe(117.3751);
    expect(parseDecimal("117,3751")).toBe(117.3751);
    expect(parseDecimal(" 50 ")).toBe(50);
  });

  it("returns NaN for empty or junk input", () => {
    expect(parseDecimal("")).toBeNaN();
    expect(parseDecimal("   ")).toBeNaN();
    expect(parseDecimal("abc")).toBeNaN();
  });
});

describe("convertToRsd", () => {
  it("converts and rounds to 2 decimals", () => {
    // 50 × 117.3751 = 5868.755 → half-up to 5868.76 (the float artifact case
    // EPSILON exists for: 5868.755 is stored slightly below .755).
    expect(convertToRsd(50, 117.3751)).toBe(5868.76);
    expect(convertToRsd(1, 117.3751)).toBe(117.38);
    expect(convertToRsd(100, 117.3751)).toBe(11737.51);
  });

  it("keeps exact products exact", () => {
    expect(convertToRsd(10, 117.5)).toBe(1175);
    expect(convertToRsd(2.5, 100)).toBe(250);
  });
});

describe("currencySymbol / formatOriginalAmount", () => {
  it("maps EUR to € and passes unknown codes through", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("CHF")).toBe("CHF");
  });

  it("formats with sr-Latn locale and at most 2 decimals", () => {
    expect(formatOriginalAmount(50, "EUR")).toBe("50 €");
    expect(formatOriginalAmount(50.5, "EUR")).toBe("50,5 €");
    expect(formatOriginalAmount(1234.56, "EUR")).toBe("1.234,56 €");
  });
});

describe("formatRateInput", () => {
  it("round-trips through parseDecimal", () => {
    expect(formatRateInput(117.3751)).toBe("117,3751");
    expect(parseDecimal(formatRateInput(117.3751))).toBe(117.3751);
    expect(formatRateInput(117)).toBe("117");
  });
});
