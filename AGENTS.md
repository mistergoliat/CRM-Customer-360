# PesasChile AI Hub - AGENTS

Documento rector para Codex, Claude y cualquier agente futuro que trabaje en este repositorio.

## Vision

PesasChile AI Hub es la plataforma propia de atencion comercial, gestion de casos, seguimiento comercial, marketing automation e inteligencia operacional basada en IA.

La meta estrategica es:

1. Reemplazar progresivamente Zenvia como plataforma principal de atencion por WhatsApp.
2. Reemplazar progresivamente Brevo como motor de marketing automation.
3. Mover la logica core desde n8n hacia un backend propio versionado, auditable y testeable.

## Jerarquia canonica

Orden obligatorio de lectura antes de modificar el repositorio:

1. `AGENTS.md`.
2. `docs/00-START-HERE.md`.
3. `docs/product/autonomous-commerce-prd.md`.
4. `docs/ROADMAP.md`.
5. `docs/ACTIVE_RELEASE.md`.
6. La especificacion de la release activa.
7. `docs/product/MVP_EXECUTION_MAP.md`.
8. Los ADR citados por la release o tarea.
9. Los contratos citados por la tarea.
10. `docs/CAPABILITY_MATRIX.md`.

No hace falta leer todo el vault documental. Lee solo lo que gobierna la tarea actual.

## Estado actual

1. `P1`, `P1K`, `P1L`, `P1M`, `P2` y `P3` son nomenclatura historica.
2. `ACS` es la unica unidad activa de planificacion e integracion.
3. Las releases ACS son la unica secuencia activa de trabajo.
4. Los workstreams gobiernan ownership y paralelizacion, no roadmaps alternativos.
5. MariaDB/n8n siguen coexistiendo como legado operativo.
6. El Brain productivo aun no esta completo.
7. La identidad continua siendo provisional mientras no exista `customer_master`.

## Flujo obligatorio de trabajo

Antes de modificar el repositorio:

1. Confirmar el estado real con `git status --short`, `git branch -vv` y `git log --oneline --decorate -15` cuando la tarea lo requiera.
2. Leer los documentos de la jerarquia canonica en el orden indicado.
3. Trabajar unicamente en la tarea activa del release, salvo que el usuario autorice explicitamente una intervencion documental transversal.
4. No iniciar la siguiente tarea de producto hasta cerrar la actual.
5. No abrir otra release mientras exista una release activa.
6. Actualizar `docs/ACTIVE_RELEASE.md` en el mismo cambio que completa una tarea.
7. Actualizar `docs/CAPABILITY_MATRIX.md` cuando cambie el estado tecnico real.
8. No modificar auditorias historicas.
9. Registrar desvíos como deuda o bloqueo.
10. No implementar trabajo fuera de alcance sin autorizacion explicita.

## Reglas no negociables

1. Customer es el centro del modelo.
2. Opportunity es separada de Case y Conversation.
3. No side effects no autorizados.
4. No Customer Master inventado.
5. No datos ficticios presentados como reales.
6. No logica sensible dentro de componentes UI.
7. No decisiones de permisos delegadas al LLM.
8. No refactors masivos sin auditoria previa.
9. No convertir Case o Work Queue en el centro del dominio.
10. No presentar Customer Candidate como Customer Master definitivo.
11. Un workstream no puede crear un roadmap paralelo.
12. Un documento historico no recupera autoridad activa.

## Estrategia UI-first

P1M y la experiencia visual del CRM pueden construir superficies antes de que toda la logica productiva, persistencia o integracion este terminada.

Esto esta permitido cuando:

1. la superficie es read-only;
2. no inventa datos como si fueran reales;
3. degrada claramente cuando falta informacion;
4. distingue mock, fixture, read model real y dato no disponible;
5. no habilita side effects;
6. no acopla la arquitectura futura a una solucion visual temporal;
7. revela gaps de producto y genera tareas posteriores;
8. mantiene estable la frontera entre visualizacion y ejecucion.

## Que esta permitido

1. Crear o actualizar documentacion rectora.
2. Crear contratos conceptuales para entidades futuras.
3. Definir roadmap y backlog.
4. Preparar DTOs y reglas de salida a nivel documental.
5. Alinear nomenclatura entre HUB, n8n y futuro backend.
6. Aclarar limites entre identidad provisional y Customer Master futuro.
7. Diseñar superficies read-only que usen read models, fixtures o mocks identificados.

## Que esta prohibido

1. Implementar Customer Master definitivo.
2. Crear tablas nuevas de produccion sin tarea explicita.
3. Reescribir workflows n8n de forma masiva.
4. Cambiar auth, routing, cases, chats, dashboard o APIs en una tarea documental.
5. Introducir marketing automation funcional.
6. Inventar fuentes de datos no observadas en el repo.
7. Presentar un mock como si fuera dato real.
8. Delegar permisos o aprobaciones al LLM.

## Como trabajar con n8n durante la transicion

1. Tratar n8n como capa transitoria de integracion, orquestacion y jobs.
2. No asumir que n8n sera el cerebro final del producto.
3. No acoplar nuevas capacidades a workflows largos si pueden vivir versionadas en el backend.
4. Mantener n8n para ingestiones, conectores externos, fan-out y tareas que todavia no convenga migrar.
5. Migrar primero las decisiones y estados criticos, despues el resto.

## Customer 360 mientras no exista `customer_master`

1. La identidad es provisional.
2. La referencia principal es `wa_id`.
3. Si existe, complementar con `phone_number_id`, `id_customer`, `id_order`, `invoice_number`, `email` o `contact_id`.
4. No convertir esa identidad provisional en un Customer 360 definitivo.
5. Preparar todo para migrar luego a `customer_key` y `customer_master`.

## Comandos de validacion

Ejecutar segun el alcance de la tarea:

```powershell
npm run build
npm run typecheck
```

Para tareas solo documentales, no es obligatorio ejecutar build o typecheck.

Si una tarea toca front o API, validar adicionalmente que la preview sigue funcionando en local o en Docker.

## Criterios de aceptacion

1. No hay cambios funcionales accidentales cuando la tarea es documental.
2. ACS mantiene una unica secuencia activa de releases.
3. Workstreams y roadmap no compiten como autoridades.
4. La estrategia UI-first queda autorizada y limitada.
5. La identidad provisional queda claramente separada del Customer Master futuro.
6. Las dependencias y riesgos quedan documentados sin inventar features.

## Como reportar cambios

1. Indicar archivos creados o modificados.
2. Resumir el proposito de cada archivo.
3. Explicar si la entrega es solo documental o si toca codigo.
4. Enumerar validaciones ejecutadas.
5. Senalar cualquier deuda tecnica detectada.

## Trabajo por PRs

1. Un PR debe tener un unico proposito.
2. Documentacion rectora, refactor funcional y migracion n8n no deben mezclarse si se pueden separar.
3. Los cambios pequenos y revisables son preferibles a paquetes grandes.
4. Cada PR debe indicar que parte del roadmap mueve.
5. Si una tarea abre una brecha arquitectonica, documentarla antes de implementarla.

## Regla final

Si una decision no cabe en este documento, o en `CLAUDE.md`, o en los briefs de fase, el agente debe detenerse y documentar primero antes de implementar.
