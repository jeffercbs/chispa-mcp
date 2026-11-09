import { createHash, randomBytes } from "node:crypto";

const b64url = (buffer: Buffer) => buffer.toString("base64url");

export function createVerifier() {
	return b64url(randomBytes(48));
}

export function challengeFor(verifier: string) {
	return b64url(createHash("sha256").update(verifier).digest());
}

export const randomState = () => b64url(randomBytes(24));

export function decodeClaims(token: string): Record<string, unknown> | null {
	const part = token.split(".")[1];
	if (!part) return null;
	try {
		return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}
