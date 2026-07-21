---
title: ADR-009 - Persistence Boundary
doc_id: adr-009-persistence-boundary
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for:
  - persistence architecture
  - storage boundary
depends_on:
  - product/autonomous-commerce-prd
supersedes:
  - data/persistence-architecture-decision
tags:
  - adr
---
# ADR-009: Persistence Boundary

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACTIVE_RELEASE](../../ACTIVE_RELEASE.md)
- Implementa: limite de persistencia para el dominio comercial y el runtime Brain
- Evidencia: [CAPABILITY_MATRIX](../../CAPABILITY_MATRIX.md)
- Reemplaza: [Persistence architecture decision](../../data/persistence-architecture-decision.md) (historico, ver banner en ese documento)

## Estado

Accepted

## Contexto

Un documento anterior (`docs/data/persistence-architecture-decision.md`, 2026-07-08) evaluo dos motores para el dominio comercial: mantener MariaDB para todo, o dividir MariaDB (legacy de casos/mensajes) y PostgreSQL/Supabase (dominio "brain": oportunidades, decisiones, acciones, outbox). Eligio formalmente la segunda opcion y quedo `status: approved`.

Esa decision nunca se ejecuto. Las releases `ACS-R1-04`, `ACS-R1-05` y `ACS-R1-05.1` implementaron, endurecieron y verificaron `crm_opportunities`, `crm_agent_decisions`, `crm_agent_actions` y `brain_message_outbox` contra MariaDB real, sin ningun adapter ni migracion hacia PostgreSQL/Supabase. Un documento con `status: approved` que contradice el 100% de la evidencia real es mas peligroso que uno sin decision: aparenta autoridad formal vigente.

## Problema

Sin una decision explicita y vigente:

- un agente futuro puede leer el documento anterior, ver `status: approved`, e intentar completar una migracion que nadie pidio;
- puede proponerse dual-write hacia un motor que no existe en produccion;
- puede cuestionarse por que el codigo real "no sigue la arquitectura aprobada";
- `docs/CAPABILITY_MATRIX.md` (un rastreador de estado tecnico) termina haciendo el trabajo de un registro de decision arquitectonica, que no es su funcion.

## Decision

MariaDB es la unica fuente de verdad operativa actualmente autorizada para el dominio comercial (`crm_opportunities`, `crm_sales_need_profiles`, `crm_agent_decisions`, `crm_agent_actions`, `brain_message_outbox`, `commercial_event`) y para el runtime Brain (`ai_agent_execution`, `ai_agent_decision`, `ai_tool_execution`, `ai_conversation_state`), igual que para las tablas legacy de casos y mensajes. No existe division de motores.

Esto no reabre la comparacion tecnica del documento original (secciones 11-12 de `persistence-architecture-decision.md`, conservadas como evidencia historica) - reconoce que MariaDB, en la practica, ya sostuvo los patrones de idempotencia, claim/lock y append-only que esa comparacion consideraba el punto fuerte de PostgreSQL, verificados end-to-end en `ACS-R1-04`/`ACS-R1-05`/`ACS-R1-05.1` contra bases MariaDB reales (`crm_test`, `main_management`, `mariadb:11.4`).

## Alcance de la decision

- No dual-write: ninguna entidad del dominio comercial escribe en dos motores al mismo tiempo. Un writer canonico por entidad, como ya establecen ADR-003 y la evidencia de `ACS-R1-05-T04`/`ACS-R1-05.1-T01`.
- No PostgreSQL ni Supabase productivo: no existe hoy ningun adapter, pool de conexion ni tabla productiva sobre esos motores para el dominio comercial.
- No migracion activa: no hay trabajo en curso ni planificado hacia otro motor. El adapter de repositorio hacia otro motor mencionado en el documento historico nunca se implemento y no esta en progreso.
- Cualquier motor adicional o migracion futura requiere un ADR nuevo, con su propia comparacion, evidencia y criterio de reversion - nunca la reactivacion del documento superseded ni un cambio silencioso de `CAPABILITY_MATRIX.md`.
- `docs/CAPABILITY_MATRIX.md` es evidencia de que esta decision se cumple (que motor corre realmente, capability por capability), no el registro de la decision misma. Si diverge de este ADR, el ADR manda y la divergencia es un hallazgo a corregir, no una decision tacita nueva.
- Esta decision no afirma que MariaDB sea necesariamente la solucion definitiva para siempre. Es la decision vigente mientras no exista un ADR posterior que la reemplace con evidencia de que un motor distinto resuelve una limitacion real y medida.

## Invariantes

1. Un writer canonico por entidad del dominio comercial.
2. Ninguna tabla productiva del dominio comercial vive fuera de MariaDB sin un ADR nuevo.
3. `CAPABILITY_MATRIX.md` refleja el motor real; una discrepancia es deuda a corregir, no autoridad.
4. El documento historico (`persistence-architecture-decision.md`) no recupera autoridad por estar bien escrito o parecer completo.
5. Un ADR nuevo, no una nota en un documento existente, es requisito para cambiar esta decision.

## Consecuencias

### Positivas

- Elimina la contradiccion entre un documento `approved` y la evidencia real.
- Un unico motor reduce superficie operativa (backups, migraciones, permisos, observabilidad).
- Deja explicito el criterio para reabrir la pregunta, en vez de dejarla ambigua.

### Negativas

- Ninguna deuda tecnica nueva: esta decision documenta lo que ya opera, no cambia comportamiento.

## Criterio de validacion

- `docs/data/persistence-architecture-decision.md` declara `status: superseded` y `superseded_by` apuntando a este ADR.
- `docs/CAPABILITY_MATRIX.md` no lista ninguna capability del dominio comercial con motor distinto de MariaDB.
- Ningun adapter PostgreSQL/Supabase existe en `lib/` para el dominio comercial.
- Un futuro cambio de motor cita este ADR como el documento que reemplaza, no lo edita en el lugar.
