export class ToolError extends Error {
	/** Siguiente paso sugerido para la persona, en lenguaje claro. */
	readonly hint?: string;

	constructor(message: string, hint?: string) {
		super(message);
		this.name = "ToolError";
		this.hint = hint;
	}
}

export const GENERIC_FAILURE = "No pudimos completar la acción. Inténtalo de nuevo.";
export const NOT_FOUND = "No encontramos ese elemento o no tienes acceso a él.";
