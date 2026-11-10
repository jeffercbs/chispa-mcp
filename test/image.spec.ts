import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ToolError } from "../src/domain/errors.js";
import { optimizeImage } from "../src/domain/image.js";
import { isPrivateAddress } from "../src/domain/image-source.js";
import { LIMITS } from "../src/limits.js";

const noisy = (width: number, height: number, format: "png" | "jpeg") => {
	const raw = Buffer.alloc(width * height * 3);
	for (let index = 0; index < raw.length; index++) raw[index] = (index * 7919) % 251;
	return sharp(raw, { raw: { width, height, channels: 3 } })
		[format]()
		.toBuffer();
};

describe("optimizeImage", () => {
	it("convierte a WebP y reduce el lado mayor a 1600 px", async () => {
		const result = await optimizeImage(await noisy(3200, 1800, "png"));
		const meta = await sharp(result.data).metadata();
		expect(meta.format).toBe("webp");
		expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
		expect(result.originalFormat).toBe("png");
	});

	it("no agranda las imágenes pequeñas", async () => {
		const result = await optimizeImage(await noisy(400, 200, "jpeg"));
		expect(result.width).toBe(400);
		expect(result.height).toBe(200);
	});

	it("deja una imagen suave por debajo del peso objetivo", async () => {
		const width = 2400;
		const height = 1350;
		const raw = Buffer.alloc(width * height * 3);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const at = (y * width + x) * 3;
				raw[at] = (x * 255) / width;
				raw[at + 1] = (y * 255) / height;
				raw[at + 2] = 128;
			}
		const png = await sharp(raw, { raw: { width, height, channels: 3 } })
			.png()
			.toBuffer();
		const result = await optimizeImage(png);
		expect(result.bytes).toBeLessThanOrEqual(LIMITS.imageTargetBytes);
		expect(result.bytes).toBeLessThan(result.originalBytes);
	});

	it("rechaza archivos que no son imágenes", async () => {
		await expect(optimizeImage(Buffer.from("no soy una imagen"))).rejects.toBeInstanceOf(ToolError);
	});

	it("rechaza SVG", async () => {
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
		await expect(optimizeImage(svg)).rejects.toBeInstanceOf(ToolError);
	});

	it("el objetivo de peso es razonable", () => {
		expect(LIMITS.imageTargetBytes).toBeLessThan(LIMITS.imageInputBytes);
	});
});

describe("isPrivateAddress", () => {
	it.each([
		"127.0.0.1",
		"10.1.2.3",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"::1",
		"fe80::1",
		"fd00::1",
		"::ffff:10.0.0.1"
	])("bloquea %s", (address) => expect(isPrivateAddress(address)).toBe(true));

	it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"])("permite %s", (address) =>
		expect(isPrivateAddress(address)).toBe(false)
	);
});
