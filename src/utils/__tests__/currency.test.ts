import { describe, expect, it } from "vitest";

import {
  convertToRsd,
  currencyOptions,
  currencySymbol,
  formatOriginalAmount,
  formatRateInput,
  normalizeEnabledCurrencies,
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
  it("maps EUR to €, USD to $, passes unknown codes through", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("CHF")).toBe("CHF");
  });

  it("formats with sr-Latn locale and at most 2 decimals", () => {
    expect(formatOriginalAmount(50, "EUR")).toBe("50 €");
    expect(formatOriginalAmount(50.5, "EUR")).toBe("50,5 €");
    expect(formatOriginalAmount(1234.56, "EUR")).toBe("1.234,56 €");
  });
});

describe("normalizeEnabledCurrencies", () => {
  it("forces RSD in and normalizes order to ALL_CURRENCIES", () => {
    expect(normalizeEnabledCurrencies(["USD", "EUR"])).toEqual(["RSD", "EUR", "USD"]);
    expect(normalizeEnabledCurrencies(["EUR"])).toEqual(["RSD", "EUR"]);
    expect(normalizeEnabledCurrencies([])).toEqual(["RSD"]);
  });

  it("drops unknown codes and falls back to the default for missing data", () => {
    expect(normalizeEnabledCurrencies(["RSD", "XYZ"])).toEqual(["RSD"]);
    expect(normalizeEnabledCurrencies(null)).toEqual(["RSD", "EUR"]);
    expect(normalizeEnabledCurrencies(undefined)).toEqual(["RSD", "EUR"]);
  });
});

describe("currencyOptions", () => {
  it("returns the enabled list when there's no edited entity", () => {
    expect(currencyOptions(["RSD", "EUR"], null)).toEqual(["RSD", "EUR"]);
    expect(currencyOptions(["RSD"], undefined)).toEqual(["RSD"]);
  });

  it("keeps a since-disabled currency visible while editing a row saved in it", () => {
    // EUR was disabled, but this expense is still in EUR → it must stay
    // selectable so the edit doesn't corrupt; once saved as RSD it disappears.
    expect(currencyOptions(["RSD"], "EUR")).toEqual(["RSD", "EUR"]);
    expect(currencyOptions(["RSD", "EUR"], "USD")).toEqual(["RSD", "EUR", "USD"]);
    expect(currencyOptions(["RSD", "EUR"], "RSD")).toEqual(["RSD", "EUR"]);
  });
});

describe("formatRateInput", () => {
  it("round-trips through parseDecimal", () => {
    expect(formatRateInput(117.3751)).toBe("117,3751");
    expect(parseDecimal(formatRateInput(117.3751))).toBe(117.3751);
    expect(formatRateInput(117)).toBe("117");
  });
});
