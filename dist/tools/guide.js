import { z } from "zod";
import { LIMITS } from "../limits.js";
import { rawText } from "../mcp/encode.js";
import { defineTool } from "../mcp/tool.js";
import { GAME_FORMS } from "./games.js";
export const GUIDES = {
    simulacros: `SIMULACROS Y BANCOS (rigor de la prueba real CNSC/MEN)
Un simulacro mide si se descartan errores plausibles, no si se reconoce una frase.
FORMATO (no negociable)
- 30-40 preguntas por simulacro de módulo. Los quizzes de lección no se tocan salvo petición.
- Caso de 70-100 palabras con datos concretos (cargos, fechas, plazos) que obliga a decidir; cierre tipo «Tomando en consideración la normatividad vigente en [eje], el funcionario debe:».
- 3 opciones en SENA 4; 4 solo donde ya se usan. Nunca mezclar dentro de un examen.
- Cada pregunta es autónoma (el modo práctica las sortea): nada de «según la pregunta anterior».
- Explicación: por qué la correcta lo es (norma y artículo) y por qué falla cada distractor.
- correct es desde 1. Verifica la clave contra la posición real.
DISTRACTORES: primero la tabla, después el texto
- Correcta = la regla bien aplicada. Distractor A = norma o plazo cercano equivocado. Distractor B = verdad parcial o sujeto equivocado. Opcional: norma derogada o de otro régimen.
- Un buen distractor sería correcto en otro caso y usa el mismo vocabulario y estructura. Prohibidos: absurdos, jocosos, cortos, «ninguna/todas las anteriores», dobles negaciones.
- Exigir enfoque: dato decisivo escondido en el caso (y 1-2 irrelevantes), excepciones, dos normas que parecen aplicar, cálculos cortos verificados, orden o jerarquía. Varía «debe / no debe / es incorrecto que»; si es negativa, en negrita.
SESGOS A EVITAR (audit_exam los mide)
- Correcta más larga: meta 15-40 % de preguntas. Iguala longitudes con detalles propios de la pregunta; PROHIBIDO alargar con cláusulas de plantilla repetidas.
- Ninguna posición de la correcta por encima del 40 %. Correctas que empiezan igual. Absolutos solo en distractores. Correcta que repite palabras del caso. Dos correctas defendibles. Explicación sin norma.
PROCESO
1. Lee las lecciones del módulo (get_lesson fields=content) y las fuentes. Cada pregunta cita norma y artículo; lo no verificado se marca «sin verificar» y no se publica como oficial. Normas de memoria no son fuente.
2. Matriz de 30-40 filas antes de redactar: tema | norma/art. | error A | error B | dificultad (30 % fácil, 50 % media, 20 % difícil). Máximo 3 preguntas por artículo.
3. Redacta caso → opciones → explicación; reparte la correcta entre posiciones.
4. import_exam o add_exam_questions con dry_run=true: revisa el bloque quality y corrige antes de guardar.
5. Tras guardar, audit_exam. Para corregir: get_exam view=lineas fields=[prompt,options,explanation,topic] → edit_items solo con las líneas cambiadas, con el enunciado completo.
6. Reporta (no corrijas en silencio) claves mal puestas, normas derogadas o plazos dudosos: los cambios en la correcta los aprueba la persona. Casi duplicados: señálalos; borrar un examen borra intentos de estudiantes.
- No afirmar que las preguntas son oficiales ni sugerir afiliación con la entidad. SENA 4: Instructor, Profesional y Técnico (Docentes/Directivos solo si se pide).`,
    cursos: `CURSOS: DISEÑO Y LECCIÓN COMPLETA
REGLAS
- Cada pregunta cita norma y artículo vigentes; lo no verificado se marca «sin verificar» y no se publica. No inventar número de preguntas, duración ni pesos de la prueba oficial. No sugerir afiliación con la entidad. Contenido propio, nunca copiado. Cada módulo con fecha de actualización y versión de la norma.
MÉTODO (evidencia de aprendizaje en línea)
- Práctica con preguntas después de cada tema; espaciado (repetir falladas a 1, 3, 7 y 21 días); intercalado en simulacros (mezclar ejes); retroalimentación que explica y cita norma; ejemplos resueltos al inicio; segmentos de una sola idea con 2-3 preguntas; diagnóstico, meta y avance visible.
LECCIÓN DE LECTURA COMPLETA
- title descriptivo; summary de 1-2 frases; 3-4 objectives con verbo observable; key_idea de una frase.
- content Markdown de 500+ palabras: «Por qué importa en [convocatoria]», tabla o lista de artículos clave, desarrollo por secciones, «Errores frecuentes», regla para recordar; norma y artículo citados.
- Quiz de 8+ preguntas (referencia 12) con explicación; 4+ tarjetas; 1+ juego. Publicar solo tras pasar la auditoría.
PRESENTACIÓN: 6-15 diapositivas con portada, «para recordar», «dato clave», autoevaluación y cierre; guion de voz con líneas >; summary obligatorio; sin quiz propio. Una «Presentación del módulo» por módulo (guide topic=presentaciones).
MÓDULO COMPLETO: 2+ lecturas + presentación + simulacro de 30-40 preguntas (guide topic=simulacros).
FLUJO
1. Inventario barato: get_course_outline depth=modulos → audit_course (devuelve solo lo incompleto). No leas lección por lección.
2. Muestra la tabla de huecos ordenada por impacto (publicadas incompletas primero) y el plan; confirma antes de publicar, borrar o reemplazar. Si falta una fuente, pregúntala.
3. Completa partiendo de lo existente (nunca reduzcas contenido): update_lesson o edit_items kind=lesson; add_quiz_questions / add_flashcards / save_game con dry_run; import_module_content para varias lecciones (máximo 30).
4. Verifica releyendo: audit_course del módulo y audit_exam. No declares terminado con huecos.
5. Publica con set_published item_ids=[…] por módulo, con confirmación.
6. Cierre: qué se completó, huecos que quedan y por qué, normas pendientes de revisión humana, lo que no se tocó.
- Texto de plantilla repetido entre lecciones es un defecto. Módulos compartidos se editan una vez (guide topic=modulos_compartidos).`,
    aula: `GESTIÓN DEL AULA
- get_classroom: ajustes, herramientas activas para estudiantes, enlace de invitación, cifras, tu rol y permisos, y qué oculta la plataforma (en Guías Clave no se ven foro, tableros, encuestas, recursos, clases, compañeros ni reseñas: avisa antes de crear algo ahí).
- update_classroom: nombre, descripción y chat (administrador); student_tools (permiso «herramientas»); listado público, inscripción abierta, lecciones de prueba y cursos del aula (solo quien la creó). create_classroom crea otra aula si el plan lo permite (list_my_classrooms muestra el cupo).
- Equipo: list_staff, add_staff (por correo; administradores solo los nombra quien creó el aula, máximo 3), update_staff (permisos: accesos, activacion, alumnos, soporte, contenido, herramientas, comercio; y cursos que puede editar), remove_staff.
- Estudiantes: invite_people (correos, uno por línea; les llega un enlace de acceso), list_invites, resend_invites; solicitudes con list_access_requests / decide_access_request; list_members, classroom_progress, get_student_detail.
- Foro del aula (módulo Foro, no lecciones): list_forum_topics, get_forum_topic, save_forum_topic (crear, fijar, bloquear, programar apertura/cierre, publicar), reply_forum.
- Actividades para entregar: save_task, list_classroom_items kind=tasks, list_submissions. Clases en vivo: save_meeting y set_attendance. Recursos (enlaces): save_resource. Encuestas: save_survey. Notas: save_period, save_grade_item, set_grades (en bloque). Equipos: save_team.
- Borrar cualquiera de esos elementos: delete_classroom_items kind=… ids=[…] confirm=true.
- Todo nace en borrador: confirma antes de publicar, invitar, responder o borrar. Los correos de las personas no se muestran completos.`,
    carga_masiva: `CARGA MASIVA
- Prefiere import_exam (examen + preguntas), add_exam_questions, add_quiz_questions, add_flashcards e import_module_content (varias lecciones con quiz y tarjetas). Evita crear de una en una.
- Texto compacto, una pregunta por línea: «enunciado | opción | *opción correcta | opción | explicación: … | tema: … | lección: 2». Tarjetas: «anverso | reverso». Un salto de línea dentro de un campo se escribe \\n.
- Primero dry_run=true; si todo está bien, repite sin dry_run. Las cargas son todo o nada y los errores indican la línea.
- Máximo ${LIMITS.bulkQuestions} preguntas por llamada y ${LIMITS.bulkLessons} lecciones por carga: divide lo demás y avisa del avance.

EDICIÓN MASIVA
- Para corregir: get_exam view=lineas (o list_lesson_items view=lineas) → cambia solo las líneas necesarias → edit_items con esas líneas (el ID delante; sin ID se crea en parent_id). Lo que no aparezca en la línea no cambia.
- Cambios puntuales de campos: edit_items items=[{id, campo: valor}]. Publicar varios: set_published item_ids=[…]. Borrar varios: delete_items ids=[…] confirm=true.`,
    presentaciones: `PRESENTACIONES (lecciones con format="presentacion" en create_lesson, update_lesson e import_module_content)
- Markdown dividido en diapositivas por una línea que solo diga ---. Las líneas que empiezan con > son el guion que narra la voz (no se ven); sin ellas se lee el texto. Guion en frases cortas, sin símbolos ni fórmulas.
- Diapositiva con solo un título (# o ##) y una frase = portada o sección. Máximo ~5 viñetas cortas por diapositiva.
- Fórmulas: $E=mc^2$ en línea y $$…$$ en bloque (LaTeX). La voz no las lee: explícalas en el guion.
- Gráficas: bloque \`\`\`chart con «type: bar|hbar|line|area|pie|donut», «title:», «unit:», «series: A, B» (solo si hay varias) y un dato por línea «Etiqueta: 12» o «Etiqueta: 12, 14». En pie y donut, un valor por línea.
- Ilustraciones: bloque \`\`\`svg con <svg viewBox="…"> propio (formas simples, colores sólidos, sin scripts ni enlaces; animaciones CSS permitidas) o ![descripción](https://…). Diagramas: \`\`\`mermaid.
- Dos columnas: una línea ||| entre ambas partes. Para cambiar una diapositiva: primera línea «@slide tema=sol|oceano|bosque|noche|papel alinear=izquierda|centro».
- Quien estudia elige velocidad de voz, tema, tamaño y animación. Empieza con portada, termina con resumen, 6-15 diapositivas.
- Para revisar una presentación larga usa get_lesson slides="3-5" en vez de traer todo el contenido.`,
    juegos: `JUEGOS (save_game)
- Tipos y config: ${GAME_FORMS}.
- tabla_periodica: la tabla completa ya viene en la plataforma; lista los elementos y qué se pregunta de cada uno (ubicar, simbolo, nombre, numero o categoria). Mezcla tipos. Cada elemento es una ronda.
- formula: en «text» usa {a}, {b}… para números que se sortean y $LaTeX$ para fórmulas; «vars» da el rango ({"a":{"min":2,"max":9}}, step opcional); «answer» admite + - * / ^ ( ) y sqrt, abs, round, sin, cos, tan, ln, log, min, max, pi. mode "elegir" u "escribir"; fija decimals, unit y why (puede usar {answer}). Evita divisiones por cero y resultados con muchos decimales.
- Se crean en borrador: confirma antes de publicar.`,
    modulos_compartidos: `MÓDULOS COMPARTIDOS
- Un módulo compartido se escribe una vez (en una biblioteca o en un curso) y se usa en varios cursos sin copiarlo: si se edita, cambia en todos. Una biblioteca es un curso interno que no aparece en el catálogo.
- Empieza con list_shared_modules. link_shared_module lo añade a un curso (al final salvo posición); move_shared_module cambia su posición en ese curso; unlink_shared_module lo quita de ese curso sin borrarlo (pide confirmación).
- Para editar su contenido usa las herramientas normales sobre el módulo original y avisa en qué cursos se verá el cambio.
- set_course_library convierte un curso en biblioteca o lo devuelve a normal; confirma antes porque cambia lo que ve el público.`,
    imagenes: `IMÁGENES (portadas)
- set_course_banner y set_collection_banner reciben image_path (archivo local) o image_url (https público); remove quita la portada. Se convierten solas a WebP liviano.
- Si ya hay portada, avisa que se reemplazará y pide confirmación.`,
    precios: `PRECIOS, OFERTAS Y GRUPOS
- Un curso de pago se puede comprar para hasta 5 personas (quien compra + 4). Cada persona adicional paga el precio vigente con un descuento que crece con el grupo (por defecto 30, 35, 40 y 45 % para 2, 3, 4 y 5). Quien compra asigna los correos desde «Mis cuentas».
- get_group_pricing muestra los descuentos con ejemplos; set_group_pricing los cambia (defecto, personalizado o desactivado). Los porcentajes no pueden bajar al sumar personas. Confirma antes.
- group_sales y list_sales muestran lo vendido (sin correos).
- Ofertas (create_offer) y rebajas no se acumulan: se aplica la que deja el precio más bajo y el descuento por grupo se calcula sobre ese precio. Términos en /terms/ofertas.`
};
export const guide = defineTool({
    name: "guide",
    title: "Guía de uso",
    description: `Guía detallada de un tema. Consúltala antes de trabajar en él: ${Object.keys(GUIDES).join(", ")}.`,
    level: "none",
    readOnly: true,
    public: true,
    input: z.object({ topic: z.enum(Object.keys(GUIDES)) }),
    async run(_context, input) {
        return rawText(GUIDES[input.topic]);
    }
});
