import { describe, expect, it } from "vitest";
import { challengeFor, createVerifier, decodeClaims } from "../src/auth/pkce.js";

describe("pkce", () => {
	it("calcula el challenge S256 de RFC 7636", () => {
		expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
	});
	it("genera verificadores largos y distintos", () => {
		const a = createVerifier();
		expect(a.length).toBeGreaterThanOrEqual(43);
		expect(a).not.toBe(createVerifier());
	});
	it("decodifica claims y rechaza basura", () => {
		const payload = Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url");
		expect(decodeClaims(`a.${payload}.c`)).toEqual({ sub: "x" });
		expect(decodeClaims("nope")).toBeNull();
	});
});
