const encoder = new TextEncoder();
const keys = new Map();
function hmacKey(secret) {
    let key = keys.get(secret);
    if (!key) {
        key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        keys.set(secret, key);
    }
    return key;
}
export async function pseudonym(secret, value) {
    const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(value));
    return [...new Uint8Array(signature).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function audit(secret, entry) {
    const record = {
        tool: entry.tool,
        user: await pseudonym(secret, entry.userId),
        classroom: entry.classroomId ? await pseudonym(secret, entry.classroomId) : null,
        client: entry.client,
        outcome: entry.outcome,
        ms: entry.ms
    };
    console.error(JSON.stringify({ event: "mcp.tool", ...record }));
}
