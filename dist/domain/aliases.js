import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIAS = /^@[0-9a-f]{8,32}$/i;
const MAX = 20_000;
const SAVE_DELAY_MS = 400;
const LENGTHS = [8, 12, 16, 32];
export const isUuid = (value) => UUID.test(value);
export const isAlias = (value) => ALIAS.test(value);
const hex = (uuid) => uuid.toLowerCase().replaceAll("-", "");
const toUuid = (digits) => `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
class AliasBook {
    byUuid = new Map();
    byAlias = new Map();
    owner = "";
    file = null;
    timer = null;
    loaded = null;
    use(dir, owner) {
        if (this.owner === owner && this.loaded)
            return this.loaded;
        this.reset(owner);
        this.file = dir ? join(dir, "aliases.json") : null;
        this.loaded = this.file ? this.load(this.file, owner) : Promise.resolve();
        return this.loaded;
    }
    alias(uuid) {
        const key = uuid.toLowerCase();
        const known = this.byUuid.get(key);
        if (known)
            return known;
        const digits = hex(key);
        const length = LENGTHS.find((size) => {
            const taken = this.byAlias.get(`@${digits.slice(0, size)}`);
            return !taken || taken === key;
        });
        const alias = `@${digits.slice(0, length ?? 32)}`;
        this.remember(alias, key);
        this.schedule();
        return alias;
    }
    resolve(value) {
        const trimmed = value.trim();
        if (!isAlias(trimmed))
            return trimmed;
        const alias = trimmed.toLowerCase();
        if (alias.length === 33)
            return toUuid(alias.slice(1));
        return this.byAlias.get(alias) ?? null;
    }
    async refresh() {
        if (this.file)
            await this.load(this.file, this.owner);
    }
    async clear() {
        this.reset("");
        this.loaded = null;
        if (this.file)
            await rm(this.file, { force: true }).catch(() => undefined);
    }
    remember(alias, uuid) {
        this.byUuid.set(uuid, alias);
        this.byAlias.set(alias, uuid);
        if (this.byUuid.size <= MAX)
            return;
        let removed = 0;
        for (const [oldUuid, oldAlias] of this.byUuid) {
            if (removed++ >= MAX / 10)
                break;
            this.byUuid.delete(oldUuid);
            this.byAlias.delete(oldAlias);
        }
    }
    reset(owner) {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
        this.byUuid.clear();
        this.byAlias.clear();
        this.owner = owner;
    }
    async read(file, owner) {
        try {
            const stored = JSON.parse(await readFile(file, "utf8"));
            if (stored.owner !== owner || !Array.isArray(stored.entries))
                return [];
            return stored.entries.filter((entry) => Array.isArray(entry) &&
                typeof entry[0] === "string" &&
                typeof entry[1] === "string" &&
                isAlias(entry[0]) &&
                isUuid(entry[1]) &&
                hex(entry[1]).startsWith(entry[0].slice(1).toLowerCase()));
        }
        catch {
            return [];
        }
    }
    async load(file, owner) {
        for (const [alias, uuid] of await this.read(file, owner)) {
            const key = uuid.toLowerCase();
            if (this.byAlias.has(alias.toLowerCase()) || this.byUuid.has(key))
                continue;
            this.remember(alias.toLowerCase(), key);
        }
    }
    schedule() {
        if (!this.file || this.timer)
            return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.save();
        }, SAVE_DELAY_MS);
        this.timer.unref?.();
    }
    async save() {
        const file = this.file;
        if (!file)
            return;
        const merged = new Map(await this.read(file, this.owner));
        const seen = new Set(merged.values());
        for (const [alias, uuid] of this.byAlias)
            if (!merged.has(alias) && !seen.has(uuid))
                merged.set(alias, uuid);
        const entries = [...merged.entries()].slice(-MAX);
        const temp = `${file}.${process.pid}.tmp`;
        try {
            await mkdir(dirname(file), { recursive: true, mode: 0o700 });
            await writeFile(temp, JSON.stringify({ owner: this.owner, entries }), { mode: 0o600 });
            await rename(temp, file);
        }
        catch {
            await rm(temp, { force: true }).catch(() => undefined);
        }
    }
}
export const aliases = new AliasBook();
export function shortenIds(value) {
    if (typeof value === "string")
        return isUuid(value) ? aliases.alias(value) : value;
    if (Array.isArray(value))
        return value.map(shortenIds);
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, item] of Object.entries(value))
            out[key] = shortenIds(item);
        return out;
    }
    return value;
}
