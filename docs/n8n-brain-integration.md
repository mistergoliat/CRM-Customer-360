# n8n Brain Integration

## Principio

n8n queda como integrador y executor de jobs deterministicos simples.

Brain API gobierna:

- decisiones,
- agentes,
- permisos,
- acciones,
- estado operacional,
- trazabilidad.

## Que hace n8n

n8n puede seguir sirviendo para:

- webhooks de entrada,
- jobs pequenos,
- notificaciones,
- integraciones simples,
- fan-out tecnico,
- conectores externos,
- tareas que todavia no conviene migrar.

## Que no debe hacer n8n

n8n no debe usarse para:

- decisiones comerciales criticas futuras,
- permisos de agentes,
- follow-up inteligente,
- gobernanza de acciones,
- policy central de aprobacion,
- motor de Customer 360,
- definicion de autonomy level.

## Integracion inmediata recomendada

Ruta recomendada para el webhook de WhatsApp:

`WA_00_Webhook_Master -> HTTP Request /api/brain/process-inbound -> shadow mode -> legacy continues`

### Intencion de esta ruta

1. Brain API recibe el evento minimo.
2. Brain devuelve decision, policy y recomendaciones.
3. n8n sigue ejecutando el camino legacy mientras se compara.
4. El producto gana observabilidad sin romper la operacion actual.

## Roles de cada capa

### n8n

- integra sistemas,
- mueve datos,
- ejecuta jobs simples,
- mantiene compatibilidad temporal.

### Brain API

- resuelve contexto,
- define acciones,
- aplica governance,
- emite instrucciones estructuradas,
- prepara el futuro backend versionado.

### HUB

- muestra decisiones,
- muestra approvals,
- permite supervisar y aprobar,
- sirve como Operator Copilot para humanos.

## Reglas de transicion

1. No usar n8n para permisos de agente.
2. No usar n8n para follow-up inteligente.
3. No usar n8n para decisiones comerciales criticas.
4. No usar n8n para representar el modelo de Customer como verdad final.
5. Mantener n8n para integracion, no para el cerebro del producto.

## Relacion con documentos existentes

Este documento complementa:

- `docs/ai-orchestration-contract.md`
- `docs/n8n-shadow-mode-integration.md`
- `docs/brain-api-foundation.md`
- `docs/brain-action-policy.md`

## Migration guidance

La migracion correcta no es reescribir todo n8n.

El orden recomendado es:

1. decisiones,
2. policy,
3. acciones sensibles,
4. approvals,
5. state operational,
6. legacy cleanup.

## Non-goals

- No reemplazar todo n8n de golpe.
- No delegar permisos a workflows.
- No usar n8n como runtime final de agentes.
- No convertir shadow mode en produccion silenciosa sin revision.
