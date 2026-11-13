/** Ventana deslizante de un minuto. Frena bucles del modelo que escriben sin parar. */
export class WriteLimiter {
    perMinute;
    now;
    stamps = [];
    constructor(perMinute, now = Date.now) {
        this.perMinute = perMinute;
        this.now = now;
    }
    /** Devuelve 0 si puede seguir, o los segundos que debe esperar. */
    take() {
        const current = this.now();
        while (this.stamps.length > 0 && current - this.stamps[0] >= 60_000)
            this.stamps.shift();
        if (this.stamps.length >= this.perMinute)
            return Math.max(1, Math.ceil((60_000 - (current - this.stamps[0])) / 1000));
        this.stamps.push(current);
        return 0;
    }
}
