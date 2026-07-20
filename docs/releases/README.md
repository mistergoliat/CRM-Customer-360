---
title: releases
doc_id: release-index
status: active
version: "2.1.0"
owner: product
last_reviewed: 2026-07-19
source_of_truth_for:
  - release index
  - increment registry
depends_on:
  - ../ACTIVE_RELEASE.md
  - ./ACS-R1-04-customer-identity-onboarding.md
  - ./ACS-R1-05-autonomous-follow-up-runtime.md
  - ./ACS-R1-05.1-persistent-commercial-memory-controlled-whatsapp-pilot.md
supersedes: []
tags:
  - release
  - product
---

# Releases

Indice operativo de releases ACS. No duplica la planificacion ni las tareas.

| Release | Estado | Especificacion | Auditoria de aceptacion | SHA de cierre | Notas |
|---|---|---|---|---|---|
| `ACS-R1-01` | `accepted_with_debt` | [ACS-R1-01 evidence](../audits/acs-r1-01-capability-gateway-evidence.md) | pending dedicated acceptance audit | pending | Runtime canonico + Catalog Capability |
| `ACS-R1-02` | `superseded` | none independent | none | n/a | Customer Service planificado, absorbido por `ACS-R1-04` |
| `ACS-R1-03` | `accepted_with_debt` | [ACS-R1-03 spec](ACS-R1-03-customer-360.md) | [ACS-R1-03 acceptance](../audits/acs-r1-03-customer-360-acceptance.md) | pending | Customer 360 read model |
| `ACS-R1-04` | `active_blocked_external` | [ACS-R1-04 spec](ACS-R1-04-customer-identity-onboarding.md) | pending | `0c51419` for T06.1 only | Customer Identity Resolution + Onboarding |
| `ACS-R1-05` | `accepted` | [ACS-R1-05 spec](ACS-R1-05-autonomous-follow-up-runtime.md) | evidencia de cierre en-spec (seccion "Evidencia de cierre - ACS-R1-05-T07"); sin auditoria dedicada separada | `a2754e2` (merge PR #57 into `develop`) | Autonomous Follow-up Runtime (Commercial Runtime) - reasignada desde Address Book, ver Notas |
| `ACS-R1-05.1` | `parallel_in_progress` (`critical_path: true`) | [ACS-R1-05.1 spec](ACS-R1-05.1-persistent-commercial-memory-controlled-whatsapp-pilot.md) | pending (current_task: `ACS-R1-05.1-T01`, current_task_status: `planned`) | n/a | Persistent Commercial Memory + Controlled WhatsApp Pilot (Commercial Runtime) - camino critico al primer vertical conversacional, ver Notas |
| `ACS-R1-06` | `planned` | planned | pending | n/a | Business Policy - planned after controlled pilot |
| `ACS-R1-07` | `planned` | planned | pending | n/a | Quote |
| `ACS-R1-08` | `planned` | planned | pending | n/a | Operator Readiness |
| `ACS-R1-09` | `planned` | planned | pending | n/a | Voice |
| `ACS-R2` | `planned` | planned | pending | n/a | Capabilities transaccionales |

## Notas

- `ACS-R1-02` no se presenta como implementado; su alcance fue absorbido por `ACS-R1-04`.
- `ACS-R1-04` es la unica release activa en el sentido secuencial tradicional (`active_blocked_external`: bloqueada solo por Customer Service externo, `PAUSED_EXTERNAL` en `ROADMAP.md`). Esa dependencia no bloquea el piloto conversacional (`ACS-R1-05.1`).
- `ACS-R1-05` fue reasignada de "Address Book + Address Confirmation" a "Autonomous Follow-up Runtime" (2026-07-14, ver [ACS-R1-05 spec](ACS-R1-05-autonomous-follow-up-runtime.md)). Fue un workstream paralelo autorizado, no una segunda release activa que compitiera por secuencia con `ACS-R1-04` - avanzo porque no depende del Customer Service externo. Cerro `accepted` con `ACS-R1-05-T07` y esta mergeada en `develop` (PR #57, commit `a2754e2`, confirmado con `git log`/`git rev-parse`). La autoridad de aceptacion utilizada es la seccion "Evidencia de cierre - ACS-R1-05-T07" dentro de la propia spec (patron ya usado por otras tareas de esta release, ver "Evidencia de cierre - ACS-R1-05-T0X" en el mismo documento) - no existe un documento de auditoria dedicado y separado como el de `ACS-R1-03` (`../audits/acs-r1-03-customer-360-acceptance.md`); si se decide que `ACS-R1-05` necesita uno, es una decision de alcance documental adicional, no un hecho ya cumplido. Meta WhatsApp, el proveedor LLM y el Catalog Service permanecen `operational: not_verified` para `ACS-R1-05` (ver `CAPABILITY_MATRIX.md`) - esa aceptacion es de runtime/persistencia/concurrencia contra MariaDB real, nunca de las integraciones externas reales, que son exactamente el gate que `ACS-R1-05.1` agrega. Address Book quedo sin release ACS asignada; ver "Deferred capabilities" en `ROADMAP.md`.
- `ACS-R1-05.1` (2026-07-19): `status: parallel_in_progress`, `critical_path: true`, `current_task: ACS-R1-05.1-T01`, `current_task_status: planned` - campos separados, no un status compuesto. Formaliza el camino critico hacia el primer vertical conversacional operativo: convierte las capacidades tecnicas ya aceptadas de `ACS-R1-01`/`ACS-R1-03`/`ACS-R1-05` en un vendedor autonomo persistente, validado con un unico `wa_id` allowlisted. Es, igual que `ACS-R1-05`, un workstream paralelo autorizado que no depende del Customer Service externo - `ACS-R1-04` sigue sin bloquearlo. No reabre ni reescribe `ACS-R1-05`; la extiende. A diferencia de `ACS-R1-05`, su Definition of Done si exige `verified_real` para Meta/LLM/Catalog Service (ver "Release lifecycle vs. Operational evidence levels" en `ROADMAP.md`). Ver "Camino critico al piloto controlado" en `ROADMAP.md`.
- `accepted_with_debt` indica release terminada con deuda explicitada, no trabajo activo. `accepted` (sin `_with_debt`) en esta tabla sigue permitiendo deuda explicita fuera del incremento (ver la spec de cada release, seccion "Deudas fuera del incremento"/"Deuda no cerrada") - ver "Release lifecycle vs. Operational evidence levels" en `ROADMAP.md` para la definicion formal de ambos terminos y su separacion del eje de evidencia operacional (`implemented`/`connected`/`enabled`/`deployed`/`verified_real`).
- Las specs historicas no reemplazan la release activa.
