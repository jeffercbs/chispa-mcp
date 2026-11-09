import { describe, expect, it } from "vitest";
import { WriteLimiter } from "../src/domain/rate.js";

describe("límite de escrituras", () => {
	it("deja pasar hasta el máximo y luego pide esperar", () => {
		let now = 0;
		const limiter = new WriteLimiter(3, () => now);
		expect([limiter.take(), limiter.take(), limiter.take()]).toEqual([0, 0, 0]);
		now = 10_000;
		expect(limiter.take()).toBe(50);
	});

	it("vuelve a permitir pasado el minuto", () => {
		let now = 0;
		const limiter = new WriteLimiter(1, () => now);
		limiter.take();
		now = 60_001;
		expect(limiter.take()).toBe(0);
	});
});
