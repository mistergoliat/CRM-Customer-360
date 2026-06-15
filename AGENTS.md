# PesasChile AI Hub - AGENTS

Documento rector para Codex, Claude y cualquier agente futuro que trabaje en este repositorio.

## Vision

PesasChile AI Hub es la plataforma propia de atencion comercial, gestion de casos, seguimiento comercial, marketing automation e inteligencia operacional basada en IA.

La meta estrategica es:

1. Reemplazar progresivamente Zenvia como plataforma principal de atencion por WhatsApp.
2. Reemplazar progresivamente Brevo como motor de marketing automation.
3. Mover la logica core desde n8n hacia un backend propio versionado, auditable y testeable.

## Estado actual

1. Existe una preview funcional del HUB.
2. La UI ya es propia.
3. La fuente de verdad operativa sigue viviendo en tablas y vistas `n8n_*`.
4. n8n hoy actua como productor y poseedor del modelo de datos.
5. El HUB lee casos, mensajes, salud y auditoria desde MySQL/MariaDB.
6. Hay acciones operativas server-side para respuestas manuales, cierre, reapertura, cambio de prioridad y bloqueo de IA.
7. La seccion Customer 360 definitiva no existe todavia y no debe construirse en esta fase.

## Fase 0

Fase 0 significa estabilizacion, documentacion rectora y preparacion de la transicion.

Objetivos de Fase 0:

1. Dejar claro que existe y que no existe.
2. Evitar que futuros agentes inventen arquitectura o entidades.
3. Proteger la preview actual del HUB.
4. Preparar la migracion progresiva desde n8n sin reescritura total.
5. Establecer contratos para outputs IA, logging y trazabilidad.

## Modulos objetivo del producto

1. Inbox / Conversational Hub
2. Case Management
3. AI Routing & Agents
4. Commercial Follow-up Engine
5. Customer 360 provisional
6. Marketing Automation futura
7. Agent Control Center
8. Intelligence & Dashboards

## Reglas no negociables

1. No construir Customer 360 definitivo mientras `customer_master` no exista.
2. No crear features aisladas que no mapeen a modulo, entidad o KPI.
3. No duplicar vistas innecesarias.
4. No mover todo de n8n de golpe.
5. No romper la preview actual del HUB.
6. Toda logica core nueva debe ser versionable, auditable y testeable.
7. Todo output de agente debe ser estructurado.
8. Toda accion relevante debe dejar log.
9. No tocar schema DB salvo que la tarea lo pida de forma explicita en una fase posterior.
10. No mezclar documentacion rectora con refactors funcionales en la misma entrega salvo que la tarea lo autorice.

## Que esta permitido en esta fase

1. Crear o actualizar documentacion rectora.
2. Crear contratos conceptuales para entidades futuras.
3. Definir roadmap y backlog.
4. Preparar DTOs y reglas de salida a nivel documental.
5. Alinear nomenclatura entre HUB, n8n y futuro backend.
6. Aclarar limites entre identidad provisional y Customer Master futuro.

## Que esta prohibido en esta fase

1. Implementar Customer 360 definitivo.
2. Crear tablas nuevas de produccion.
3. Reescribir workflows n8n de forma masiva.
4. Cambiar auth, routing, cases, chats, dashboard o APIs en esta tarea documental.
5. Introducir marketing automation funcional.
6. Inventar fuentes de datos no observadas en el repo.

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

## Roadmap por fases

### P0 - Estabilizacion

1. Blindar auth y variables criticas.
2. Alinear documentacion y contratos.
3. Validar preview, build y typecheck.
4. Reducir ambiguedad sobre fuentes de verdad.

### P1 - Refactor minimo

1. Unificar paneles duplicados.
2. Normalizar DTOs de caso, chat y auditoria.
3. Consolidar logs y acciones operativas.
4. Reducir polling y consultas innecesarias.

### P2 - Migracion desde n8n

1. Sacar del workflow lo que sea decision, estado o persistencia core.
2. Mantener n8n solo como integracion donde aporte valor.
3. Versionar contratos de entrada y salida.
4. Preparar follow-up comercial y routing estructurado.

## Comandos de validacion

Ejecutar segun el alcance de la tarea:

```powershell
npm run build
npm run typecheck
```

Para lint, usar el mecanismo disponible en el repo en ese momento. Si el script aun usa `next lint`, no forzar interaccion; registrar el problema como deuda tecnica y validar con la migracion a ESLint CLI antes de confiar en ese comando.

Si una tarea toca front o API, validar adicionalmente que la preview sigue funcionando en local o en Docker.

## Criterios de aceptacion

1. No hay cambios funcionales accidentales cuando la tarea es documental.
2. Las restricciones de Fase 0 quedan explicitas.
3. La estrategia n8n -> backend queda clara.
4. La identidad provisional queda claramente separada del Customer Master futuro.
5. Las dependencias y riesgos quedan documentados sin inventar features.

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
