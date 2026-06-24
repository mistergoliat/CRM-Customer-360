# PesasChile AI Hub - AGENTS

Documento rector para Codex, Claude y cualquier agente futuro que trabaje en este repositorio.

## Vision

PesasChile AI Hub es la plataforma propia de atencion comercial, gestion de casos, seguimiento comercial, marketing automation e inteligencia operacional basada en IA.

La meta estrategica es:

1. Reemplazar progresivamente Zenvia como plataforma principal de atencion por WhatsApp.
2. Reemplazar progresivamente Brevo como motor de marketing automation.
3. Mover la logica core desde n8n hacia un backend propio versionado, auditable y testeable.

## Estado actual

1. `P1K` esta `ACCEPTED AND CLOSED`.
2. `P1L` es la fase de `Production Foundation`.
3. `P1M` es la fase activa de `CRM Product Experience`.
4. MariaDB/n8n siguen coexistiendo como legado operativo.
5. El Brain productivo aun no esta completo.
6. La experiencia visual del CRM es ahora el foco activo de discovery y validacion.
7. La identidad continua siendo provisional mientras no exista `customer_master`.

## Fases activas

### P1K - Brain MVP y demostracion

P1K ya quedo cerrado. Incluye razonamiento comercial, governance, simulacion de ejecucion, follow-up, outbox, transporte simulado, auditoria y scenario simulator.

No debe reabrirse salvo correccion critica demostrada.

### P1L - Production Foundation

P1L concentra la base de produccion:

1. adapters PostgreSQL/Supabase;
2. persistencia real del Brain;
3. scheduler;
4. outbox worker productivo;
5. transporte HTTP real;
6. reconciliacion de delivery;
7. piloto controlado.

### P1M - CRM Product Experience

P1M concentra la experiencia visual y operativa del CRM:

1. CRM shell y navegacion;
2. Cases inbox y chat-first workspace;
3. Customer 360 provisional;
4. Opportunity workspace;
5. AI SDR Copilot;
6. Action Queue;
7. analitica visual;
8. settings visual;
9. operator controls y estados visuales.

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

## Estrategia UI-first

P1M puede construir superficies visuales antes de que toda la logica productiva, persistencia o integracion este terminada.

Esto esta permitido cuando:

1. la superficie es read-only;
2. no inventa datos como si fueran reales;
3. degrada claramente cuando falta informacion;
4. distingue mock, fixture, read model real y dato no disponible;
5. no habilita side effects;
6. no acopla la arquitectura futura a una solucion visual temporal;
7. revela gaps de producto y genera tareas posteriores;
8. mantiene estable la frontera entre visualizacion y ejecucion.

La UI en P1M es una herramienta de modelamiento y validacion del producto, no solo una capa final.

## Que esta permitido en esta fase

1. Crear o actualizar documentacion rectora.
2. Crear contratos conceptuales para entidades futuras.
3. Definir roadmap y backlog.
4. Preparar DTOs y reglas de salida a nivel documental.
5. Alinear nomenclatura entre HUB, n8n y futuro backend.
6. Aclarar limites entre identidad provisional y Customer Master futuro.
7. Diseñar superficies read-only que usen read models, fixtures o mocks identificados.

## Que esta prohibido en esta fase

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

## Roadmap por fases

### P0 - Stabilization

1. Blindar auth y variables criticas.
2. Alinear documentacion y contratos.
3. Validar preview, build y typecheck.
4. Reducir ambiguedad sobre fuentes de verdad.

### P1 - CRM foundation

1. Cerrar el brain MVP demostrable.
2. Separar la foundation de produccion de la experiencia visual.
3. Usar la UI como herramienta para descubrir gaps y fijar contratos de lectura.

### P1L - Production Foundation

1. Persistencia real.
2. Scheduler real.
3. Outbox worker real.
4. Transporte real.
5. Reconciliacion real.

### P1M - CRM Product Experience

1. Shell de CRM.
2. Navegacion y superficies visuales.
3. Read models y fixtures identificados.
4. Customer 360 provisional.
5. Opportunity workspace.
6. Action Queue y Copilot visuales.

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
2. P1K queda tratado como cerrado y no reabierto salvo correccion critica.
3. P1L y P1M quedan separados con responsabilidades claras.
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
