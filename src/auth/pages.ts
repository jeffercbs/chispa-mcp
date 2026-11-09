/**
 * Páginas que ve la persona en el navegador al volver del inicio de sesión.
 * Sin scripts, sin recursos externos, colores sólidos y modo oscuro automático.
 */
export type PageKind =
	| "success"
	| "cancelled"
	| "provider_error"
	| "invalid_state"
	| "missing_code"
	| "invalid_host"
	| "not_found"
	| "method_not_allowed"
	| "server_error";

type Page = { status: number; title: string; body: string; next: string; tone: "ok" | "warn" | "error" };

const PAGES: Record<PageKind, Page> = {
	success: {
		status: 200,
		tone: "ok",
		title: "Listo, ya estás conectado",
		body: "Chispa MCP quedó autorizado con tu cuenta.",
		next: "Puedes cerrar esta pestaña y volver a tu herramienta de IA."
	},
	cancelled: {
		status: 400,
		tone: "warn",
		title: "Cancelaste el acceso",
		body: "No se compartió nada con la herramienta de IA.",
		next: "Si fue un error, vuelve a la terminal y ejecuta «chispa-mcp login» otra vez."
	},
	provider_error: {
		status: 400,
		tone: "error",
		title: "No pudimos completar el acceso",
		body: "El servidor de cuentas rechazó la solicitud.",
		next: "Ejecuta «chispa-mcp login» de nuevo. Si se repite, avisa a quien administra tu aula."
	},
	invalid_state: {
		status: 400,
		tone: "error",
		title: "Esta solicitud no coincide",
		body: "Por seguridad descartamos el acceso: la respuesta no corresponde al inicio de sesión que abriste.",
		next: "Cierra esta pestaña y ejecuta «chispa-mcp login» otra vez. No uses enlaces de otras personas."
	},
	missing_code: {
		status: 400,
		tone: "error",
		title: "Faltó la autorización",
		body: "La respuesta llegó incompleta.",
		next: "Vuelve a la terminal y ejecuta «chispa-mcp login» otra vez."
	},
	invalid_host: {
		status: 421,
		tone: "error",
		title: "Dirección no permitida",
		body: "Esta página solo responde en tu propio equipo.",
		next: "Si no iniciaste sesión tú, cierra esta pestaña."
	},
	not_found: {
		status: 404,
		tone: "warn",
		title: "No encontramos esta página",
		body: "Aquí solo se completa el inicio de sesión de Chispa MCP.",
		next: "Puedes cerrar esta pestaña."
	},
	method_not_allowed: {
		status: 405,
		tone: "warn",
		title: "Acción no permitida",
		body: "Esta página solo se abre desde el navegador.",
		next: "Puedes cerrar esta pestaña."
	},
	server_error: {
		status: 500,
		tone: "error",
		title: "Algo salió mal en tu equipo",
		body: "No pudimos terminar de guardar tu sesión.",
		next: "Vuelve a la terminal para ver el detalle y ejecuta «chispa-mcp login» otra vez."
	}
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function renderPage(kind: PageKind, detail?: string) {
	const page = PAGES[kind];
	// El código del proveedor solo se muestra si es un identificador corto y seguro.
	const code = detail && /^[a-z_]{1,40}$/.test(detail) ? `<p class="code">Código: ${escapeHtml(detail)}</p>` : "";
	const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(page.title)} · Chispa MCP</title><style>
:root{--bg:#f6f5f1;--card:#fff;--ink:#1d1d1b;--muted:#585856;--ok:#1d7a46;--warn:#9a5b00;--error:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--card:#232321;--ink:#f1f0ec;--muted:#b4b3ad;--ok:#58c985;--warn:#e8a547;--error:#ff8a80}}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--ink);display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem;box-sizing:border-box}
main{max-width:30rem;width:100%;padding:2rem;background:var(--card);border-radius:1.5rem}
.dot{display:inline-block;width:.75rem;height:.75rem;border-radius:50%;background:var(--${page.tone});margin-bottom:.75rem}
h1{font-size:1.4rem;margin:0 0 .5rem}p{margin:.5rem 0 0;color:var(--muted);line-height:1.5}.code{font-family:ui-monospace,monospace;font-size:.85rem}
</style></head><body><main role="${page.tone === "ok" ? "status" : "alert"}"><span class="dot" aria-hidden="true"></span><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.body)}</p><p>${escapeHtml(page.next)}</p>${code}</main></body></html>`;
	return { status: page.status, html };
}

export const PAGE_HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"cache-control": "no-store",
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
	"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
} as const;
