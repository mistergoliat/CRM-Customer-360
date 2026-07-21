---
title: n8n Brain Integration
doc_id: n8n-brain-integration
status: active
version: "1.2.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for:
  - role boundary between n8n, Brain API, and the HUB
depends_on:
  - ./ACTIVE_RELEASE.md
  - ./audits/acs-r1-05-1-t01-keyword-routing-authority-incident.md
supersedes: []
tags:
  - architecture
---

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

## Integracion actual del webhook de WhatsApp

Ruta real: `WA_00_Webhook_Master -> HTTP Request /api/brain/process-inbound`.

`/api/brain/process-inbound` resuelve contexto, policy y recomendaciones en cada llamada de n8n y devuelve una decision estructurada. No ejecuta el motor comercial legacy por defecto.

### Flag de autoridad unica: `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED`

El motor legacy `sales-consultative` esta deshabilitado por defecto (fail-closed) en `process-inbound` y en `native-whatsapp/service.ts::processSalesInbound`, detras de `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` (default `false`; unico lector `lib/brain/commercial/config/commercialCycleConfig.ts`). Habilitarlo reintroduce una segunda autoridad de escritura comercial en paralelo a `runNativeAutonomousCycle` - **no debe habilitarse durante `ACS-R1-05.1`**.

Este flag existe por un incidente real: ver [keyword-routing dual-authority incident](audits/acs-r1-05-1-t01-keyword-routing-authority-incident.md) para el historial completo. La evidencia de cierre y verificacion vive en `docs/ACTIVE_RELEASE.md` ("Evidencia de cierre - ACS-R1-05.1-T01"), no duplicada aqui.

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

Este documento complementa `docs/ACTIVE_RELEASE.md` (evidencia real de integracion) y `docs/audits/acs-r1-05-1-t01-keyword-routing-authority-incident.md` (historial del flag de autoridad unica). `docs/legacy/ai-orchestration-contract.md`, `docs/legacy/n8n-shadow-mode-integration.md`, `docs/legacy/brain-api-foundation.md` y `docs/legacy/brain-action-policy.md` describian una generacion anterior de esta integracion y estan marcados `status: superseded` - no son referencia vigente.

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
