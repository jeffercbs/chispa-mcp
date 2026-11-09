/** Ventana deslizante de un minuto. Frena bucles del modelo que escriben sin parar. */
export class WriteLimiter {
	private readonly stamps: number[] = [];

	constructor(
		private readonly perMinute: number,
		private readonly now: () => number = Date.now
	) {}

	/** Devuelve 0 si puede seguir, o los segundos que debe esperar. */
	take(): number {
		const current = this.now();
		while (this.stamps.length > 0 && current - (this.stamps[0] as number) >= 60_000) this.stamps.shift();
		if (this.stamps.length >= this.perMinute) return Math.max(1, Math.ceil((60_000 - (current - (this.stamps[0] as number))) / 1000));
		this.stamps.push(current);
		return 0;
	}
}
