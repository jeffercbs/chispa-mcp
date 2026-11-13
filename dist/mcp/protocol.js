import { VERSION } from "../version.js";
export const SERVER_INFO = { name: "chispa-mcp", title: "Chispa · aulas", version: VERSION };
export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const LATEST_VERSION = SUPPORTED_VERSIONS[0];
export const RPC = {
    parseError: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internal: -32603
};
export function parseRequest(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const message = value;
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || message.method.length > 100)
        return null;
    if (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number")
        return null;
    if (message.params !== undefined && (typeof message.params !== "object" || message.params === null || Array.isArray(message.params)))
        return null;
    return message;
}
export const success = (id, result) => ({ jsonrpc: "2.0", id, result });
export const failure = (id, code, message) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message }
});
export function negotiate(requested) {
    return typeof requested === "string" && SUPPORTED_VERSIONS.includes(requested) ? requested : LATEST_VERSION;
}
export const isSupportedVersion = (value) => !value || SUPPORTED_VERSIONS.includes(value);
