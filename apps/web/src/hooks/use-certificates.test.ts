import { describe, expect, it } from "vitest";
import {
  formatCertificateAltNamesInput,
  parseCertificateAltNamesInput,
} from "./use-certificates";

describe("certificate SAN helpers", () => {
  it("formats SAN entries as a newline-separated textarea value", () => {
    expect(
      formatCertificateAltNamesInput(["www.example.com", "api.example.com"]),
    ).toBe("www.example.com\napi.example.com");
  });

  it("parses, trims, and deduplicates SAN entries while excluding the primary domain", () => {
    expect(
      parseCertificateAltNamesInput(
        " www.example.com,\napi.example.com\nexample.com\nWWW.EXAMPLE.COM ",
        "example.com",
      ),
    ).toEqual(["www.example.com", "api.example.com"]);
  });
});
