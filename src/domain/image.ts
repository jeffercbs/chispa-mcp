import sharp from "sharp";
import { LIMITS } from "../limits.js";
import { ToolError } from "./errors.js";

/** Formatos de entrada aceptados (el SVG se rechaza a propósito: puede llevar scripts). */
const ACCEPTED = new Set(["jpeg", "png", "webp", "gif", "avif"]);

/** Cada intento reduce el tamaño máximo y la calidad hasta entrar en el peso objetivo. */
const STEPS = [
	{ side: 1600, quality: 82 },
	{ side: 1400, quality: 74 },
	{ side: 1200, quality: 66 },
	{ side: 1000, quality: 58 },
	{ side: 800, quality: 50 }
] as const;

export type OptimizedImage = {
	data: Buffer;
	width: number;
	height: number;
	bytes: number;
	originalBytes: number;
	originalFormat: string;
};

/**
 * Convierte cualquier imagen aceptada a WebP liviano: corrige la orientación, quita metadatos (EXIF, GPS),
 * limita el lado mayor y baja la calidad solo lo necesario para quedar bajo `imageTargetBytes`.
 * Los GIF animados se quedan con el primer cuadro.
 */
export async function optimizeImage(input: Buffer): Promise<OptimizedImage> {
	const open = () => sharp(input, { limitInputPixels: LIMITS.imagePixels, failOn: "error" });
	let format: string | undefined;
	try {
		format = (await open().metadata()).format;
	} catch {
		throw new ToolError("No pudimos leer la imagen.", "Usa un archivo JPG, PNG, WEBP, GIF o AVIF que no esté dañado ni sea gigantesco.");
	}
	if (!format || !ACCEPTED.has(format)) {
		throw new ToolError("Ese tipo de archivo no es una imagen admitida.", "Usa JPG, PNG, WEBP, GIF o AVIF.");
	}

	let last: { data: Buffer; info: sharp.OutputInfo } | undefined;
	for (const { side, quality } of STEPS) {
		try {
			last = await open()
				.rotate()
				.resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
				.webp({ quality, effort: 5, smartSubsample: true })
				.toBuffer({ resolveWithObject: true });
		} catch {
			throw new ToolError("No pudimos convertir la imagen a WebP.", "Prueba con otra imagen.");
		}
		if (last.data.length <= LIMITS.imageTargetBytes) break;
	}
	if (!last) throw new ToolError("No pudimos convertir la imagen a WebP.");
	return {
		data: last.data,
		width: last.info.width,
		height: last.info.height,
		bytes: last.data.length,
		originalBytes: input.length,
		originalFormat: format
	};
}
