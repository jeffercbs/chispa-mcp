import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { LIMITS } from "../limits.js";
import { ToolError } from "./errors.js";
const TOO_BIG = `La imagen pesa demasiado (máximo ${Math.round(LIMITS.imageInputBytes / 1024 / 1024)} MB).`;
/** True si la dirección es privada, local o reservada: nunca se descarga desde ahí. */
export function isPrivateAddress(address) {
    const version = isIP(address);
    if (version === 4) {
        const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
        return (a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 192 && b === 0 && c === 0) ||
            (a === 198 && (b === 18 || b === 19)));
    }
    if (version === 6) {
        const value = address.toLowerCase();
        const mapped = value.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped?.[1])
            return isPrivateAddress(mapped[1]);
        return value === "::" || value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith("ff");
    }
    return true;
}
async function assertPublicHost(url) {
    if (url.protocol !== "https:")
        throw new ToolError("El enlace de la imagen debe empezar por https://.");
    if (url.username || url.password)
        throw new ToolError("El enlace de la imagen no puede llevar usuario ni contraseña.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses;
    try {
        addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    }
    catch {
        throw new ToolError("No pudimos encontrar ese enlace de imagen.");
    }
    if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
        throw new ToolError("Ese enlace apunta a una dirección no permitida.", "Usa un enlace público de internet.");
    }
}
async function readCapped(response) {
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > LIMITS.imageInputBytes)
        throw new ToolError(TOO_BIG);
    if (!response.body)
        throw new ToolError("La respuesta no trae imagen.");
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
        total += chunk.length;
        if (total > LIMITS.imageInputBytes)
            throw new ToolError(TOO_BIG);
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
async function downloadImage(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new ToolError("El enlace de la imagen no es válido.");
    }
    for (let hop = 0; hop <= LIMITS.imageRedirects; hop++) {
        await assertPublicHost(url);
        let response;
        try {
            response = await fetch(url, {
                redirect: "manual",
                signal: AbortSignal.timeout(LIMITS.networkMs * 2),
                headers: { accept: "image/*" }
            });
        }
        catch {
            throw new ToolError("No pudimos descargar la imagen.", "Revisa que el enlace abra en el navegador.");
        }
        if (response.status >= 300 && response.status < 400) {
            const next = response.headers.get("location");
            if (!next)
                throw new ToolError("No pudimos descargar la imagen.");
            url = new URL(next, url);
            continue;
        }
        if (!response.ok)
            throw new ToolError(`No pudimos descargar la imagen (respuesta ${response.status}).`);
        return readCapped(response);
    }
    throw new ToolError("El enlace de la imagen redirige demasiadas veces.");
}
async function readLocalImage(raw) {
    const path = resolve(raw.startsWith("~/") ? resolve(homedir(), raw.slice(2)) : raw);
    let info;
    try {
        info = await stat(path);
    }
    catch {
        throw new ToolError("No encontramos ese archivo en este equipo.", "Revisa la ruta completa de la imagen.");
    }
    if (!info.isFile())
        throw new ToolError("Esa ruta no es un archivo.");
    if (info.size > LIMITS.imageInputBytes)
        throw new ToolError(TOO_BIG);
    try {
        return await readFile(path);
    }
    catch {
        throw new ToolError("No pudimos leer ese archivo.");
    }
}
/** Trae los bytes de la imagen desde un archivo local o un enlace https público. */
export function loadImage(source) {
    return "path" in source ? readLocalImage(source.path) : downloadImage(source.url);
}
