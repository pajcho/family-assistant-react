import { describe, expect, it } from "vitest";

import {
  KID_PIN_ERROR_TEXT,
  deviceCountLabel,
  inviteValidityLabel,
  isWeakKidPin,
  pluralSr,
  validateKidPin,
} from "@/components/family/KidAccessCopy";

describe("pluralSr", () => {
  it("picks the singular for 1 and 21, but not for 11", () => {
    expect(pluralSr(1, "minut", "minuta", "minuta")).toBe("minut");
    expect(pluralSr(21, "minut", "minuta", "minuta")).toBe("minut");
    expect(pluralSr(11, "minut", "minuta", "minuta")).toBe("minuta");
  });

  it("picks the 2-4 form outside the teens", () => {
    expect(pluralSr(3, "sekunda", "sekunde", "sekundi")).toBe("sekunde");
    expect(pluralSr(22, "sekunda", "sekunde", "sekundi")).toBe("sekunde");
    expect(pluralSr(13, "sekunda", "sekunde", "sekundi")).toBe("sekundi");
  });

  it("falls back to the many form", () => {
    expect(pluralSr(0, "sekunda", "sekunde", "sekundi")).toBe("sekundi");
    expect(pluralSr(7, "sekunda", "sekunde", "sekundi")).toBe("sekundi");
  });
});

describe("deviceCountLabel", () => {
  it("agrees with the number", () => {
    expect(deviceCountLabel(1)).toBe("1 uređaj");
    expect(deviceCountLabel(2)).toBe("2 uređaja");
    expect(deviceCountLabel(5)).toBe("5 uređaja");
  });
});

describe("inviteValidityLabel", () => {
  it("counts minutes while there is more than one left", () => {
    expect(inviteValidityLabel(900)).toBe("Važi još 15 minuta");
    expect(inviteValidityLabel(120)).toBe("Važi još 2 minuta");
    expect(inviteValidityLabel(60)).toBe("Važi još 1 minut");
  });

  it("switches to seconds in the last minute", () => {
    expect(inviteValidityLabel(45)).toBe("Važi još 45 sekundi");
    expect(inviteValidityLabel(2)).toBe("Važi još 2 sekunde");
    expect(inviteValidityLabel(1)).toBe("Važi još 1 sekundu");
  });

  it("says so once the link is dead", () => {
    expect(inviteValidityLabel(0)).toBe("Link je istekao");
    expect(inviteValidityLabel(-5)).toBe("Link je istekao");
  });
});

describe("isWeakKidPin", () => {
  it("rejects repeated digits and straight runs", () => {
    expect(isWeakKidPin("0000")).toBe(true);
    expect(isWeakKidPin("1111")).toBe(true);
    expect(isWeakKidPin("777777")).toBe(true);
    expect(isWeakKidPin("1234")).toBe(true);
    expect(isWeakKidPin("123456")).toBe(true);
  });

  it("accepts an ordinary PIN", () => {
    expect(isWeakKidPin("2580")).toBe(false);
    expect(isWeakKidPin("918273")).toBe(false);
  });
});

describe("validateKidPin", () => {
  it("reports the length problem first", () => {
    expect(validateKidPin("123", "123")).toBe("format");
    expect(validateKidPin("12345", "12345")).toBe("format");
    expect(validateKidPin("", "")).toBe("format");
  });

  it("reports a guessable PIN before comparing the repeat", () => {
    expect(validateKidPin("1234", "9999")).toBe("weak");
  });

  it("reports a mismatch last", () => {
    expect(validateKidPin("2580", "2581")).toBe("mismatch");
  });

  it("passes a valid, matching PIN", () => {
    expect(validateKidPin("2580", "2580")).toBeNull();
    expect(validateKidPin("918273", "918273")).toBeNull();
  });

  it("has copy for every failure it can report", () => {
    expect(KID_PIN_ERROR_TEXT.format).toContain("4 ili 6");
    expect(KID_PIN_ERROR_TEXT.weak).toBeTruthy();
    expect(KID_PIN_ERROR_TEXT.mismatch).toBeTruthy();
  });
});
