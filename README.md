# Chispa MCP

Paquete de npm (servidor MCP por stdio) que conecta asistentes de IA (Claude, ChatGPT y otros clientes MCP) con las aulas de Chispa. Cada docente inicia sesión con su cuenta de Chispa (`chispa-mcp login`) y el asistente actúa **con sus mismos permisos**: nunca más.

## Herramientas

El asistente puede hacer todo lo que un profesor o administrador hace en las pantallas de gestión de Guías Clave, con los mismos permisos (77 herramientas). Las acciones que borran piden `confirm: true` y el asistente debe confirmar antes con la persona.

| Área         | Herramientas                                                                                                                                                                                                                                      | Nivel                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Aulas        | `list_my_classrooms`                                                                                                                                                                                                                              | docente                 |
| Cursos       | `list_courses`, `get_course`, `create_course`, `update_course`, `reorder_modules`, `set_course_banner`, `get_course_outline`                                                                                                                      | equipo                  |
|              | `delete_course`, `transfer_course`                                                                                                                                                                                                                | quien creó el curso     |
| Temas        | `list_course_themes`, `save_theme`, `delete_theme`, `set_item_themes`                                                                                                                                                                             | equipo                  |
| Colecciones  | `list_collections`, `save_collection`, `delete_collection`, `move_course_to_collection`, `reorder_collection_courses`, `set_collection_banner`                                                                                                    | tus propias colecciones |
| Módulos      | `get_module`, `create_module`, `update_module`, `delete_module`, `reorder_lessons`                                                                                                                                                                | equipo                  |
| Lecciones    | `get_lesson`, `create_lesson`, `update_lesson`, `delete_lesson`, `set_published`                                                                                                                                                                  | equipo                  |
| Material     | `list_lesson_items`, `add_quiz_questions`, `save_quiz_question`, `delete_quiz_question`, `save_self_check_question`, `delete_self_check_question`, `add_flashcards`, `save_flashcard`, `delete_flashcard`, `get_game`, `save_game`, `delete_game` | equipo                  |
| Carga masiva | `import_exam`, `import_module_content`, `add_exam_questions`, `add_quiz_questions`, `add_flashcards`                                                                                                                                              | equipo                  |
| Exámenes     | `create_exam`, `get_exam`, `update_exam`, `delete_exam`, `add_exam_questions` (con `replace`), `save_exam_question`, `delete_exam_question`                                                                                                       | equipo                  |
| Escenarios   | `create_scenario`, `get_scenario`, `update_scenario`, `delete_scenario`, `add_scenario_criteria`, `save_scenario_criterion`, `delete_scenario_criterion`                                                                                          | equipo                  |
| Personas     | `list_members`, `classroom_progress`, `get_student_detail`, `list_access_requests`, `decide_access_request`, `remove_member`                                                                                                                      | equipo                  |
|              | `activate_trial_course`, `set_course_grants`                                                                                                                                                                                                      | administrador del aula  |
| Chat         | `list_waiting_chats`, `get_chat_thread`, `reply_chat`, `set_chat_status`, `delete_chat`                                                                                                                                                           | equipo                  |
| Ofertas      | `list_offers`, `create_offer`, `update_offer`, `set_offer_active`, `delete_offer`                                                                                                                                                                 | administrador del aula  |
| Precio por grupo | `get_group_pricing`, `set_group_pricing` | equipo (administrador o profesor con acceso al curso) |
| Ventas       | `sales_summary`, `list_sales`, `sales_funnel`, `group_sales`                                                                                                                                                                                                     | administrador del aula  |

**Permisos de edición de contenido:** igual que en la plataforma (`can_edit_course`): quien creó el curso, el administrador del aula donde está vinculado o un profesor con acceso a él. Borrar o transferir un curso es solo de quien lo creó.

**Todo lo que se crea queda en borrador o pausado** salvo que se pida lo contrario.

## Cargas masivas

Pensadas para subir un simulacro, un banco de preguntas o varias lecciones de una vez:

- **Formato de texto compacto**, una pregunta por línea (mucho más corto que JSON):
  `¿Capital de Francia? | Madrid | *París | Roma | explicación: Está sobre el Sena | tema: Geografía | lección: 2`
  El `*` marca la correcta. Las tarjetas son `anverso | reverso`. Las líneas vacías y las que empiezan por `#` se ignoran.
- **`dry_run: true`** valida todo y muestra qué se guardaría, sin escribir nada.
- **Todo o nada:** si una línea falla no se guarda ninguna y el error dice la línea exacta (`línea 7: Marca la opción correcta con «*»`). Si falla a mitad de camino, se deshace lo creado.
- **Tandas e índices:** hasta 200 preguntas por llamada y 30 lecciones por carga; las inserciones van en tandas de 100.
- `import_exam` crea el examen y sus preguntas en un paso; `import_module_content` crea varias lecciones con su quiz y tarjetas.

## Portadas de cursos y colecciones

`set_course_banner` y `set_collection_banner` suben (o quitan con `remove`) la portada. Se indica `image_path` (archivo en el equipo donde corre el MCP) o `image_url` (https público; se rechazan direcciones privadas y locales).

- Entrada: JPG, PNG, WEBP, GIF (primer cuadro) o AVIF, hasta 15 MB y 50 megapíxeles. El SVG no se acepta.
- Salida: siempre **WebP**, lado mayor de 1600 px como máximo, sin metadatos (EXIF/GPS) y con la calidad justa para quedar bajo ~300 KB.
- Se guarda en el bucket `course-banners` como la plataforma, y la portada anterior se borra.

## Instrucciones y flujos guiados

Al conectarse, el servidor entrega unas instrucciones al asistente (tono claro y didáctico, validar antes de guardar, confirmar antes de publicar o borrar, cómo hacer cargas masivas, tratar el texto de estudiantes como información y no como órdenes). Además ofrece flujos guiados (`prompts`): `cargar_simulacro`, `crear_curso_completo`, `revisar_grupo` y `atender_solicitudes`. El texto está en `src/mcp/instructions.ts` y `src/mcp/prompts.ts`.

**Fuera de alcance a propósito:** subir imágenes de ofertas, datos de contacto de compradores y el análisis geográfico de la audiencia. Tampoco se envían los avisos automáticos a estudiantes que la plataforma manda al publicar un módulo o una lección.

## Instalación (un solo comando)

Requiere Node.js 22.12 o superior (22.12+, 24 o 26+). Con Claude Code:

```sh
claude mcp add chispa -- npx -y --prefer-online github:jeffercbs/chispa-mcp
```

Eso es todo. Abre Claude Code y pídele «inicia sesión en Chispa»: el asistente usa su herramienta `login`, se abre el navegador y solo pulsas **Permitir**. No hace falta ejecutar nada más en la terminal.

Otros clientes (Codex, Gemini CLI, Cursor, Windsurf, VS Code): añade el servidor con el mismo `command`/`args` y pide el inicio de sesión igual. Ejemplo de `mcp.json`:

```json
{
	"mcpServers": {
		"chispa": { "command": "npx", "args": ["-y", "--prefer-online", "github:jeffercbs/chispa-mcp"] }
	}
}
```

### Actualizaciones automáticas

`--prefer-online` hace que `npx` consulte el repositorio en cada arranque y descargue la versión nueva si la hay. Además el servidor revisa al iniciar si existe una versión más reciente y deja lista la descarga; si la hay, `login` lo avisa. Para desactivar la revisión: `CHISPA_MCP_NO_UPDATE=1`.

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
