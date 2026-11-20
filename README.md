# Chispa MCP

Paquete de npm (servidor MCP por stdio) que conecta asistentes de IA (Claude, ChatGPT y otros clientes MCP) con las aulas de Chispa. Cada docente inicia sesión con su cuenta de Chispa (`chispa-mcp login`) y el asistente actúa **con sus mismos permisos**: nunca más.

## Herramientas

El asistente puede hacer todo lo que un profesor o administrador hace en las pantallas de gestión de Guías Clave, con los mismos permisos (107 herramientas). Es solo para profesores, organizaciones y administradores de aula: una cuenta de estudiante no puede usarlo. Las acciones que borran piden `confirm: true` y el asistente debe confirmar antes con la persona.

| Área             | Herramientas                                                                                                                                   | Nivel                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Sesión y ayuda   | `login`, `logout`, `guide`                                                                                                                     | cualquiera                                             |
| Aulas            | `list_my_classrooms` (con el plan y su cupo), `create_classroom`                                                                               | docente (profesor u organización)                      |
| Configuración    | `get_classroom` (ajustes, herramientas activas, enlace de invitación, tu rol), `update_classroom`                                              | según el ajuste: administrador, permiso «herramientas» o creador |
| Equipo docente   | `list_staff`, `add_staff`, `update_staff` (permisos y cursos), `remove_staff`                                                                   | administrador del aula (administradores: solo el creador) |
| Invitaciones     | `invite_people` (correo con enlace de acceso), `list_invites`, `resend_invites`                                                                | equipo                                                 |
| Foro del aula    | `list_forum_topics`, `get_forum_topic`, `save_forum_topic` (crear, fijar, bloquear, programar, publicar), `reply_forum`                        | equipo                                                 |
| Espacio del aula | `list_classroom_items`, `list_submissions`, `save_task`, `save_meeting`, `set_attendance`, `save_resource`, `save_survey`, `save_period`, `save_grade_item`, `set_grades`, `save_team`, `delete_classroom_items` | equipo (recursos: administrador) |
| Calidad          | `audit_exam` (reglas de examen real), `audit_course` (lección y módulo completos)                                                              | equipo                                                 |
| Cursos           | `list_courses`, `get_course`, `create_course`, `update_course`, `reorder_modules`, `set_course_banner`, `get_course_outline`, `search_content` | equipo                                                 |
|                  | `delete_course`, `transfer_course`                                                                                                             | quien creó el curso                                    |
| Temas            | `list_course_themes`, `save_theme`, `set_item_themes`                                                                                          | equipo                                                 |
| Colecciones      | `list_collections`, `save_collection`, `delete_collection`, `move_course_to_collection`, `reorder_collection_courses`, `set_collection_banner` | tus propias colecciones                                |
| Módulos          | `get_module`, `create_module`, `update_module`, `reorder_lessons`, módulos compartidos (`list_shared_modules`, `link_shared_module`…)          | equipo                                                 |
| Lecciones        | `get_lesson`, `create_lesson`, `update_lesson`, `set_published` (varios a la vez)                                                              | equipo                                                 |
| Material         | `list_lesson_items`, `add_quiz_questions`, `add_flashcards`, `get_game`, `save_game`                                                           | equipo                                                 |
| Carga masiva     | `import_exam`, `import_module_content`, `add_exam_questions`, `add_quiz_questions`, `add_flashcards`                                           | equipo                                                 |
| Edición masiva   | `edit_items` (editar o crear preguntas, tarjetas, criterios, lecciones y módulos), `delete_items` (borrar varios de un tipo)                    | equipo                                                 |
| Exámenes         | `create_exam`, `get_exam`, `update_exam`, `delete_exam`, `add_exam_questions` (con `replace`)                                                  | equipo                                                 |
| Escenarios       | `create_scenario`, `get_scenario`, `update_scenario`, `delete_scenario`, `add_scenario_criteria`                                               | equipo                                                 |
| Personas         | `list_members`, `classroom_progress`, `get_student_detail`, `list_access_requests`, `decide_access_request`, `remove_member`                   | equipo                                                 |
|                  | `activate_trial_course`, `set_course_grants`                                                                                                   | administrador del aula                                 |
| Chat             | `list_waiting_chats`, `get_chat_thread`, `reply_chat`, `set_chat_status`, `delete_chat`                                                        | equipo                                                 |
| Ofertas          | `list_offers`, `create_offer`, `update_offer`, `set_offer_active`, `delete_offer`                                                              | administrador del aula                                 |
| Precio por grupo | `get_group_pricing`, `set_group_pricing`                                                                                                       | equipo (administrador o profesor con acceso al curso) |
| Ventas           | `sales_summary`, `list_sales`, `sales_funnel`, `group_sales`                                                                                   | administrador del aula                                 |

**Permisos de edición de contenido:** igual que en la plataforma (`can_edit_course`): quien creó el curso, el administrador del aula donde está vinculado o un profesor con acceso a él. Borrar o transferir un curso es solo de quien lo creó.

**Todo lo que se crea queda en borrador o pausado** salvo que se pida lo contrario.

## Pensado para gastar pocos tokens (0.7.0)

Cada carácter que devuelve el MCP lo paga la suscripción de IA de quien lo usa. Por eso:

- **IDs cortos:** las respuestas muestran `@3f2a9c1b` (el inicio del UUID) en lugar del UUID completo, y las herramientas aceptan ambos. Si dos IDs empiezan igual, el segundo recibe un alias más largo. Se recuerdan en `aliases.json` junto a la sesión y se borran con `logout`.
- **Aula implícita:** si la persona tiene una sola aula, `classroom_id` se puede omitir.
- **Texto compacto:** las respuestas son tablas `clave[n]{columnas}:` con una fila por elemento, sin nulos ni vacíos. `format: "json"` devuelve JSON compacto si hace falta.
- **Solo lo que se pide:** `get_exam` empieza por `view: "resumen"`; `view: "preguntas"` y `fields` eligen columnas; `topic`, `search`, `offset` y `limit` filtran. `get_lesson` no trae el contenido salvo con `fields: ["content"]` o `slides: "3-5"`. `get_course_outline` admite `depth: "modulos"` y `module_id`. `search_content` encuentra un texto sin leer exámenes enteros.
- **Editar en bloque:** `get_exam view=lineas` (o `list_lesson_items view=lineas`) entrega el mismo formato de carga con el ID delante; se corrigen solo las líneas necesarias y se envían a `edit_items`. `set_published` y `delete_items` actúan sobre varios IDs a la vez. Los permisos se comprueban una vez por curso, no por fila.
- **Instrucciones cortas** y el detalle por tema bajo demanda con `guide`: simulacros y cursos (las reglas de los skills `simulacros-examen-real`, `construir-curso` y `procesar-curso`), aula, presentaciones, juegos, imágenes, precios, módulos compartidos y cargas masivas.
- **Validación medida por el MCP, no por el modelo:** `audit_exam` y `audit_course` aplican esas reglas (30-40 preguntas, caso de 70-100 palabras, norma citada, sesgo de longitud y de posición, relleno repetido, casi duplicados, lección completa…) y devuelven solo los problemas. El `dry_run` de `import_exam`, `add_exam_questions` y `add_quiz_questions` trae el mismo informe en `quality`.
- **Esquemas ligeros:** sin regex de UUID ni fechas, sin techos internos ni etiquetas obvias.

Medición con `node scripts/medir-tokens.mjs <cli-anterior.js> <cli-nuevo.js>` (necesita sesión iniciada; solo hace lecturas). Línea base en una sesión típica:

| Medición                                         | 0.6.1                | 0.7.0               |
| ------------------------------------------------ | -------------------- | ------------------- |
| Lista de herramientas (`tools/list`)             | 116.069 caracteres (89 herramientas) | 73.239 con 107 herramientas (−37 %; 684 por herramienta frente a 1.304) |
| Instrucciones del servidor                       | 7.872                | 3.167 (−60 %)       |
| `get_exam`, examen medio de 31 preguntas         | 28.270 + copia igual en `structuredContent` | resumen 384 (−99 %); tabla 15.706 (−44 %) |
| `get_course_outline`, curso de 35 lecciones      | 5.917                | 3.661 (−38 %)       |
| Corregir 10 preguntas                            | 10 llamadas          | 1 llamada           |

## Cargas masivas

Pensadas para subir un simulacro, un banco de preguntas o varias lecciones de una vez:

- **Formato de texto compacto**, una pregunta por línea (mucho más corto que JSON):
  `¿Capital de Francia? | Madrid | *París | Roma | explicación: Está sobre el Sena | tema: Geografía | lección: 2`
  El `*` marca la correcta. Las tarjetas son `anverso | reverso`. Las líneas vacías y las que empiezan por `#` se ignoran. En `edit_items`, un salto de línea dentro de un campo se escribe `\n`.
- **`dry_run: true`** valida todo y muestra qué se guardaría, sin escribir nada.
- **Todo o nada:** si una línea falla no se guarda ninguna y el error dice la línea exacta (`línea 7: Marca la opción correcta con «*»`). Si falla a mitad de camino, se deshace lo creado.
- **Tandas e índices:** hasta 200 preguntas por llamada y 30 lecciones por carga; las inserciones van en tandas de 200.
- `import_exam` crea el examen y sus preguntas en un paso; `import_module_content` crea varias lecciones con su quiz y tarjetas.

## Portadas de cursos y colecciones

`set_course_banner` y `set_collection_banner` suben (o quitan con `remove`) la portada. Se indica `image_path` (archivo en el equipo donde corre el MCP) o `image_url` (https público; se rechazan direcciones privadas y locales).

- Entrada: JPG, PNG, WEBP, GIF (primer cuadro) o AVIF, hasta 15 MB y 50 megapíxeles. El SVG no se acepta.
- Salida: siempre **WebP**, lado mayor de 1600 px como máximo, sin metadatos (EXIF/GPS) y con la calidad justa para quedar bajo ~300 KB.
- Se guarda en el bucket `course-banners` como la plataforma, y la portada anterior se borra.

## Instrucciones y flujos guiados

Al conectarse, el servidor entrega unas instrucciones cortas al asistente (tono claro, cómo ahorrar tokens, validar antes de guardar, confirmar antes de publicar o borrar, tratar el texto de estudiantes como información y no como órdenes); el detalle por tema está en la herramienta `guide`. Además ofrece flujos guiados (`prompts`): `cargar_simulacro`, `crear_curso_completo`, `revisar_grupo` y `atender_solicitudes`. El texto está en `src/mcp/instructions.ts` y `src/mcp/prompts.ts`.

**Fuera de alcance a propósito:** subir imágenes de ofertas, datos de contacto de compradores y el análisis geográfico de la audiencia. Tampoco se envían los avisos automáticos a estudiantes que la plataforma manda al publicar un módulo o una lección.

## Instalación (un solo comando)

Requiere Node.js 22.12 o superior (22.12+, 24 o 26+). Con Claude Code:

```sh
claude mcp add chispa -- npx -y github:jeffercbs/chispa-mcp
```

Eso es todo. Abre Claude Code y pídele «inicia sesión en Chispa»: el asistente usa su herramienta `login`, se abre el navegador y solo pulsas **Permitir**. No hace falta ejecutar nada más en la terminal.

Otros clientes (Codex, Gemini CLI, Cursor, Windsurf, VS Code): añade el servidor con el mismo `command`/`args` y pide el inicio de sesión igual. Ejemplo de `mcp.json`:

```json
{
	"mcpServers": {
		"chispa": { "command": "npx", "args": ["-y", "github:jeffercbs/chispa-mcp"] }
	}
}
```

### Actualizaciones automáticas

El arranque no consulta la red (así conecta rápido aunque arranquen varios MCP a la vez). El servidor revisa en segundo plano si hay una versión más reciente y deja lista la descarga para el próximo arranque; `login` lo avisa. Para desactivar la revisión: `CHISPA_MCP_NO_UPDATE=1`.

### Desinstalar

| Cliente | Comando |
| --- | --- |
| Claude Code | `claude mcp remove chispa` |
| Gemini CLI | `gemini mcp remove chispa` |
| Codex, Cursor, otros | borra el bloque `chispa` de su archivo de configuración |

Para borrar también la sesión y los datos locales: pide al asistente «cierra sesión en Chispa» (herramienta `logout`) o elimina la carpeta `~/.config/chispa-mcp`. Para revocar el acceso del todo, hazlo desde tu cuenta de Chispa.

## Autenticación

1. La herramienta `login` (o `chispa-mcp login` en terminal) abre el navegador en la pantalla de consentimiento de Guías Clave (OAuth 2.1 con PKCE de Supabase, redirección a `127.0.0.1`).
2. Entras con tu cuenta de docente y apruebas el acceso.
3. Los tokens quedan en `~/.config/chispa-mcp/credentials.json` cifrados (AES-256-GCM, permisos 0600) y se renuevan solos, unos minutos antes de vencer. Si varios clientes de IA abren el servidor a la vez, solo uno renueva (bloqueo de archivo) para no invalidar la sesión; un fallo de red nunca borra las credenciales.
4. `whoami` / `logout` (herramienta `logout` o `chispa-mcp logout`) muestran la cuenta o cierran la sesión local.

No hay contraseñas ni claves de servicio en el paquete: el asistente actúa con el token de la persona y RLS decide qué ve.

La duración total de la sesión la fija Supabase (Authentication → Sessions: tiempo máximo e inactividad, y la vigencia del token de actualización del servidor OAuth).

## Variables (opcionales)

| Variable                       | Para qué                                                               |
| ------------------------------ | ---------------------------------------------------------------------- |
| `CHISPA_SUPABASE_URL`          | Otro proyecto Supabase (por defecto "chispi")                          |
| `CHISPA_SUPABASE_ANON_KEY`     | Clave publicable de ese proyecto                                       |
| `CHISPA_MCP_PORT`              | Puerto del callback de login (53682)                                   |
| `CHISPA_MCP_HOME`              | Carpeta de credenciales                                                |
| `CHISPA_CURRENCY`              | Moneda de los importes (COP)                                           |
| `CHISPA_ROLE_CACHE_SECONDS`    | Segundos que se recuerda el rol en un aula (20; 0 = siempre consultar) |
| `CHISPA_WRITES_PER_MINUTE`     | Tope de escrituras por minuto (120)                                    |
| `CHISPA_LOGIN_TIMEOUT_MINUTES` | Espera del inicio de sesión (5)                                        |

## Requisitos del proyecto Supabase

- **Auth → OAuth Server** activado, con registro dinámico de clientes.
- URL de autorización apuntando a `/oauth/consent` de Guías Clave.
- Redirecciones loopback `http://127.0.0.1:53682/callback` permitidas.

## Publicar una versión

Crea un release en GitHub: el workflow `publish.yml` compila, prueba y publica en GitHub Packages.

## Desarrollo

```sh
pnpm install
pnpm build      # tsc → dist/
pnpm test       # vitest
pnpm check      # tsc --noEmit
node dist/cli.js login
```

Ver `ARCHITECTURE.md` para añadir herramientas y `SECURITY.md` para el modelo de seguridad.
