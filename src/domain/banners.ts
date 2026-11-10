import { randomUUID } from "node:crypto";
import { ToolError } from "./errors.js";
import { optimizeImage } from "./image.js";
import { loadImage } from "./image-source.js";
import type { Db } from "./supabase.js";

/** Mismo bucket y ruta que usa la plataforma para las portadas de cursos y colecciones. */
export const BANNER_BUCKET = "course-banners";

export type BannerSource = { path: string } | { url: string };

export type StoredBanner = {
	path: string;
	url: string;
	width: number;
	height: number;
	bytes: number;
	original_bytes: number;
	original_format: string;
};

/** Lee, optimiza a WebP y sube la imagen a `<usuario>/<uuid>.webp`. */
export async function storeBanner(db: Db, userId: string, source: BannerSource): Promise<StoredBanner> {
	const image = await optimizeImage(await loadImage(source));
	const path = `${userId}/${randomUUID()}.webp`;
	const { error } = await db.storage.from(BANNER_BUCKET).upload(path, image.data, { contentType: "image/webp", cacheControl: "31536000" });
	if (error) throw new ToolError("No pudimos subir la imagen.");
	return {
		path,
		url: db.storage.from(BANNER_BUCKET).getPublicUrl(path).data.publicUrl,
		width: image.width,
		height: image.height,
		bytes: image.bytes,
		original_bytes: image.originalBytes,
		original_format: image.originalFormat
	};
}

/** Borra un archivo de portada; si falla no se interrumpe nada (queda huérfano, no roto). */
export async function dropBanner(db: Db, path: string | null | undefined) {
	if (!path) return;
	try {
		await db.storage.from(BANNER_BUCKET).remove([path]);
	} catch {
		// Sin efecto: el archivo viejo ya no está enlazado.
	}
}
