import { describe, expect, it } from "vitest";
import { isSupportedVersion, LATEST_VERSION, negotiate, parseRequest } from "../src/mcp/protocol.js";

describe("protocolo", () => {
	it("valida la forma de las solicitudes", () => {
		expect(parseRequest({ jsonrpc: "2.0", id: 1, method: "ping" })).not.toBeNull();
		expect(parseRequest({ jsonrpc: "1.0", id: 1, method: "ping" })).toBeNull();
		expect(parseRequest({ jsonrpc: "2.0", id: {}, method: "ping" })).toBeNull();
		expect(parseRequest({ jsonrpc: "2.0", method: "x", params: [] })).toBeNull();
		expect(parseRequest([])).toBeNull();
	});

	it("negocia la versión", () => {
		expect(negotiate("2025-06-18")).toBe("2025-06-18");
		expect(negotiate("1999-01-01")).toBe(LATEST_VERSION);
		expect(isSupportedVersion(undefined)).toBe(true);
		expect(isSupportedVersion("1999-01-01")).toBe(false);
	});
});
