import { describe, expect, it } from "vitest";
import { MAX_URL_PAYLOAD, firstParam, isPayloadTooLong, parseEnum, parseStrictInt } from "./url";

describe("parseStrictInt", () => {
  it("accepte un entier dans les bornes", () => {
    expect(parseStrictInt("68", 0, 1000)).toBe(68);
    expect(parseStrictInt("0", 0, 1000)).toBe(0);
  });

  it.each(["1e3", "12.0", "-4", "0x10", "12abc", " 12", "", "NaN", "Infinity", "１２"])(
    "refuse %j",
    (raw) => {
      expect(parseStrictInt(raw, 0, 100_000)).toBeNull();
    },
  );

  it("refuse hors bornes, null et undefined", () => {
    expect(parseStrictInt("1001", 0, 1000)).toBeNull();
    expect(parseStrictInt(null, 0, 1)).toBeNull();
    expect(parseStrictInt(undefined, 0, 1)).toBeNull();
    expect(parseStrictInt("9".repeat(16), 0, Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});

describe("parseEnum", () => {
  const tariffs = ["A", "B", "C"] as const;

  it("accepte une valeur de la liste", () => {
    expect(parseEnum("B", tariffs)).toBe("B");
  });

  it("refuse le reste, y compris la casse différente", () => {
    expect(parseEnum("b", tariffs)).toBeNull();
    expect(parseEnum("__proto__", tariffs)).toBeNull();
    expect(parseEnum(null, tariffs)).toBeNull();
  });
});

describe("firstParam", () => {
  it("garde le premier doublon", () => {
    expect(firstParam(new URLSearchParams("t=A&t=C"), "t")).toBe("A");
  });
});

describe("isPayloadTooLong", () => {
  it("borne à MAX_URL_PAYLOAD", () => {
    expect(isPayloadTooLong("x".repeat(MAX_URL_PAYLOAD))).toBe(false);
    expect(isPayloadTooLong("x".repeat(MAX_URL_PAYLOAD + 1))).toBe(true);
  });
});
