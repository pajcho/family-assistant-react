import { describe, expect, it } from "vitest";

import {
  convertToRsd,
  currencyOptions,
  currencySymbol,
  formatOriginalAmount,
  formatRateInput,
  normalizeEnabledCurrencies,
  parseDecimal,
  sanitizeDecimalInput,
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
  it("shows the currency code itself, matching how RSD is displayed", () => {
    expect(currencySymbol("EUR")).toBe("EUR");
    expect(currencySymbol("USD")).toBe("USD");
    expect(currencySymbol("CHF")).toBe("CHF");
  });

  it("formats with sr-Latn locale and at most 2 decimals", () => {
    expect(formatOriginalAmount(50, "EUR")).toBe("50 EUR");
    expect(formatOriginalAmount(50.5, "EUR")).toBe("50,5 EUR");
    expect(formatOriginalAmount(1234.56, "EUR")).toBe("1.234,56 EUR");
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

describe("sanitizeDecimalInput", () => {
  it("drops letters and symbols as they are typed", () => {
    expect(sanitizeDecimalInput("q2asd")).toBe("2");
    expect(sanitizeDecimalInput("1 200 RSD")).toBe("1200");
    expect(sanitizeDecimalInput("-50")).toBe("50");
  });

  it("keeps one separator and either flavour of it", () => {
    expect(sanitizeDecimalInput("12,50")).toBe("12,50");
    expect(sanitizeDecimalInput("12.50")).toBe("12.50");
    expect(sanitizeDecimalInput("1.2.3")).toBe("1.23");
    expect(sanitizeDecimalInput("1,2,3")).toBe("1,23");
  });

  it("leaves partial input alone so typing is not fought", () => {
    expect(sanitizeDecimalInput("")).toBe("");
    expect(sanitizeDecimalInput("12,")).toBe("12,");
    expect(sanitizeDecimalInput(",5")).toBe(",5");
  });

  it("stays parseable by parseDecimal", () => {
    expect(parseDecimal(sanitizeDecimalInput("1a2,5b0"))).toBe(12.5);
  });
});
