import { describe, expect, it } from "vitest";

import {
  convertToRsd,
  currencyOptions,
  currencySymbol,
  editAmountInput,
  formatAmountInput,
  formatOriginalAmount,
  formatRateInput,
  normalizeEnabledCurrencies,
  normalizePastedAmount,
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

describe("formatAmountInput", () => {
  it("groups thousands with dots and keeps the decimal comma", () => {
    expect(formatAmountInput("1234567,5")).toBe("1.234.567,5");
    expect(formatAmountInput("1000")).toBe("1.000");
    expect(formatAmountInput("999")).toBe("999");
    expect(formatAmountInput("12,")).toBe("12,");
    expect(formatAmountInput("")).toBe("");
  });

  it("reads a seeded String(number) dot as the decimal point", () => {
    expect(formatAmountInput("1234.5")).toBe("1.234,5");
  });
});

describe("normalizePastedAmount", () => {
  it("treats the last of two different separators as the decimal point", () => {
    expect(normalizePastedAmount("1.234,56")).toBe("1234,56");
    expect(normalizePastedAmount("1,234.56")).toBe("1234,56");
  });

  it("treats a repeated separator as grouping", () => {
    expect(normalizePastedAmount("1,234,567")).toBe("1234567");
    expect(normalizePastedAmount("1.234.567")).toBe("1234567");
  });

  it("reads a lone dot as grouping only when it groups thousands", () => {
    expect(normalizePastedAmount("12.500")).toBe("12500");
    expect(normalizePastedAmount("12.50")).toBe("12,50");
    expect(normalizePastedAmount("0.500")).toBe("0,500");
  });

  it("keeps a lone comma as the decimal comma and drops text around the number", () => {
    expect(normalizePastedAmount("12,500")).toBe("12,500");
    expect(normalizePastedAmount("RSD 1 234,00")).toBe("1234,00");
  });
});

describe("editAmountInput", () => {
  it("adds a grouping dot as the fourth digit is typed and keeps the caret at the end", () => {
    expect(editAmountInput("123", 3, 3, "4")).toEqual({
      value: "1234",
      display: "1.234",
      caret: 5,
    });
  });

  it("keeps the caret next to the same digits when a group shifts", () => {
    // "12.3|45" Backspace removes the 3; the caret stays before "45".
    expect(editAmountInput("12.345", 3, 4, "", "deleteContentBackward")).toEqual({
      value: "1245",
      display: "1.245",
      caret: 3,
    });
  });

  it("deletes the digit beside a grouping dot instead of the dot", () => {
    expect(editAmountInput("1.234", 1, 2, "", "deleteContentBackward")).toEqual({
      value: "234",
      display: "234",
      caret: 0,
    });
    expect(editAmountInput("1.234", 1, 2, "", "deleteContentForward")).toEqual({
      value: "134",
      display: "134",
      caret: 1,
    });
  });

  it("turns a typed dot into the one decimal comma", () => {
    expect(editAmountInput("1.234", 5, 5, ".").value).toBe("1234,");
    expect(editAmountInput("12,5", 4, 4, ",").value).toBe("12,5");
    expect(editAmountInput("", 0, 0, ",")).toEqual({ value: "0,", display: "0,", caret: 2 });
  });

  it("drops letters and leading zeros", () => {
    expect(editAmountInput("12", 2, 2, "a")).toEqual({ value: "12", display: "12", caret: 2 });
    expect(editAmountInput("0", 1, 1, "5").value).toBe("5");
  });

  it("formats a paste over the selection", () => {
    expect(editAmountInput("999", 0, 3, "1.234,56")).toEqual({
      value: "1234,56",
      display: "1.234,56",
      caret: 8,
    });
  });
});
