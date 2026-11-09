# Arquitectura

```
src/
  cli.ts            comandos: serve (stdio), login, whoami, logout
  stdio.ts          transporte stdio: un mensaje JSON-RPC por línea; stdout solo protocolo
  config.ts         URL/clave publicable de Supabase y rutas locales
  auth/             login OAuth con PKCE (loopback), almacén de credenciales 0600, renovación
  mcp/              protocolo JSON-RPC, definición de herramientas, despachador
  domain/           cliente Supabase con el token del usuario, roles del aula, auditoría, sanitizado
  tools/            una herramienta por caso de uso, agrupadas por dominio
  limits.ts         límites, roles y valores de formulario en un solo sitio
  domain/bulk.ts    lector del formato compacto de cargas masivas
  mcp/instructions.ts, mcp/prompts.ts   manual de estilo y flujos guiados para el asistente
test/               pruebas de PKCE, almacén, protocolo, permisos, sanitizado y despachador
```

## Flujo de una llamada

1. `stdio` lee una línea, valida la forma JSON-RPC y, en `tools/call`, obtiene la sesión (renovando el token si vence en menos de 60 s).
2. Se valida la forma JSON-RPC y la versión del protocolo.
3. `tools/call`: el esquema zod de la herramienta valida y sanea los argumentos.
4. `resolveActor`: exige cuenta de docente y, según el nivel, rol en el aula (perfil y aula se consultan en paralelo y el resultado se recuerda unos segundos).
   Las escrituras pasan antes por el limitador por minuto.
5. La herramienta ejecuta con un cliente de Supabase que lleva el token del usuario (RLS aplica).
6. Se registra la auditoría seudonimizada (stderr) y se devuelve `structuredContent`.

## Niveles

| Nivel     | Quién                                                                   |
| --------- | ----------------------------------------------------------------------- |
| `none`    | cualquier docente (profesor o admin del sistema)                        |
| `team`    | administrador o profesor del aula                                       |
| `manager` | administrador del aula (dueño o `classroom_staff.role = administrador`) |

Este reparto debe coincidir con la tabla de permisos de «Conectar con IA» en Guías Clave.

## Añadir una herramienta

```ts
export const miHerramienta = defineTool({
	name: "mi_herramienta",
	title: "Título visible",
	description: "Qué hace y cuándo pedir confirmación.",
	level: "team",
	readOnly: true,
	input: z.object({ classroom_id: id("Aula"), ... }),
	async run({ db, actor }, input) {
		return { ... };
	}
});
```

- Toda herramienta con nivel distinto de `none` **debe** recibir `classroom_id` (`defineTool` lo exige).
- Todo ID recibido se comprueba contra el aula antes de usarlo. Para contenido usa `ownedCourse`, `ownedModule` u `ownedSession` de `tools/ownership.ts`: comprueban que el curso esté en el aula y que lo haya creado quien llama.
- Lo que se crea queda en borrador o pausado por defecto.
- Usa `text`, `optionalText`, `markdown` e `id` de `domain/sanitize.ts`; nunca `z.string()` sin límite.
- Los fallos esperables se lanzan como `ToolError` con un mensaje en español; el resto se registra y llega como mensaje genérico.
- Regístrala en `tools/index.ts` y añade su prueba.

## Por qué no depende de `chispa-kit`

Este paquete es público y el kit es privado. Replica las reglas que necesita (roles del aula, dueño del curso) y se apoya en RLS, que es la misma para todas las plataformas.

## Por qué JSON-RPC propio y no el SDK

El transporte es pequeño (initialize, ping, tools/list, tools/call) y sin estado. Escribirlo directamente evita dependencias, mantiene el control de lo que sale por stdout y permite validar con zod 4 y exportar los esquemas con `z.toJSONSchema`.

## Rendimiento

- Lección → módulo → curso se resuelve en **una** consulta con relaciones embebidas; la pertenencia al aula y `can_edit_course` se lanzan en paralelo.
- Pertenencia de un curso al aula: consulta puntual, no se descarga la lista completa.
- Listados con `limit`/`offset`; el administrador del aula no necesita una consulta por curso para saber qué puede editar.
- Cargas masivas: una consulta por tanda de 100 filas, no una por fila.

## Sin valores fijos

Límites y política en `limits.ts`; ajustes operativos (moneda, caché de roles, tope de escrituras, espera del login) por variables de entorno validadas en `config.ts`. Los textos para el asistente viven en `mcp/`.
