# AI SDR Real CRM Smoke Test

## Propósito

Validar contra `main_management` que el operational loop usa las tablas físicas reales `crm_opportunities` y `crm_agent_decisions`, sin outbound, sin tools, sin follow-up scheduler y sin mutar Case.

## Precondiciones

* Existen `crm_opportunities` y `crm_agent_decisions`.
* El código apunta a `crm_*` y no a `commercial_*`.
* `DATABASE_URL` está disponible en el entorno local.
* Los defaults seguros siguen apagados.

## Flags

### Loop deshabilitado

```env
BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED=false
BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED=false
```

### Loop habilitado sin persistencia

```env
BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED=true
BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED=false
```

### Loop habilitado con persistencia

```env
BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED=true
BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED=true
```

## Payload de smoke

Se usa el mismo inbound para persistencia e idempotencia:

```json
{
  "channel": "whatsapp",
  "source": "manual_test",
  "waId": "56900000001",
  "phoneNumberId": "1030337916832905",
  "messageId": "smoke-ai-sdr-001",
  "messageText": "Hola, quiero cotizar una banca para entrenar en casa",
  "conversationCaseId": 99000001,
  "options": {
    "dryRun": true,
    "executeActions": false,
    "returnInstructionsForN8n": false,
    "debug": true,
    "runAgentDryRun": true,
    "buildExecutionPlanDryRun": false
  }
}
```

## Script manual

```bash
npx tsx scripts/manual-test/ai-sdr-operational-loop-smoke.ts --mode=precheck
npx tsx scripts/manual-test/ai-sdr-operational-loop-smoke.ts --mode=dry-run
npx tsx scripts/manual-test/ai-sdr-operational-loop-smoke.ts --mode=persist --confirm-persist=YES
npx tsx scripts/manual-test/ai-sdr-operational-loop-smoke.ts --mode=idempotency --confirm-persist=YES
```

## Queries de precheck

```sql
USE main_management;

SHOW TABLES LIKE 'crm_%';
DESCRIBE crm_opportunities;
DESCRIBE crm_agent_decisions;
```

## Queries de verificación

```sql
SELECT COUNT(*) AS opportunities_count
FROM crm_opportunities;

SELECT COUNT(*) AS decisions_count
FROM crm_agent_decisions;

SELECT id, opportunity_key, wa_id, conversation_case_id, primary_intent,
       status, stage, temperature, priority, next_action_type,
       last_customer_message_id, last_agent_decision_id,
       version, created_at, updated_at, last_activity_at
FROM crm_opportunities
ORDER BY id DESC
LIMIT 10;

SELECT id, decision_id, opportunity_id, message_id, previous_status,
       next_status, previous_stage, next_stage, policy_status,
       risk_level, approval_requirement, decision_status,
       created_at
FROM crm_agent_decisions
ORDER BY id DESC
LIMIT 10;

SELECT decision_id,
       detected_signals_json,
       state_changes_json,
       missing_information_json,
       next_action_json,
       rationale,
       warnings_json
FROM crm_agent_decisions
ORDER BY id DESC
LIMIT 3;
```

## Criterios de éxito

* `commercial_operational_result.status` es `skipped` cuando el loop está deshabilitado.
* `commercial_operational_result.status` es `completed` o equivalente dry-run cuando el loop está habilitado sin persistencia.
* `persistenceResult.status` es `persisted`, `duplicate` o `skipped` según el modo.
* `next_action_json.executable = false`.
* `continueLegacyFlow = true`.
* No hay outbound.
* No hay tools.
* No hay mutación de Case.
* No aparecen filas nuevas en `brain_message_outbox` por este flujo.

## Criterios de falla

* SQL activo apunta a `commercial_*`.
* No existen las tablas físicas `crm_*`.
* Se crean filas en `brain_message_outbox`.
* Se ejecutan tools o outbound.
* `continueLegacyFlow` deja de ser `true`.
* El retry duplica `opportunity_key` o `decision_id`.

## Limpieza opcional

Solo si el usuario autoriza una limpieza manual:

```sql
DELETE d
FROM crm_agent_decisions d
JOIN crm_opportunities o ON o.id = d.opportunity_id
WHERE o.opportunity_key LIKE '%smoke%'
   OR d.message_id LIKE 'smoke-ai-sdr-%';

DELETE FROM crm_opportunities
WHERE opportunity_key LIKE '%smoke%'
   OR last_customer_message_id LIKE 'smoke-ai-sdr-%';
```

No se ejecuta automáticamente.

## Riesgos

* Dejar filas smoke en la base.
* Reutilizar una oportunidad existente en vez de crear una nueva.
* Confundir `skipped` con error si el loop está apagado.
* Activar persistencia sin confirmación.

## Resultado

Ejecución real parcial:

* `precheck`: OK
* `dry-run`: OK
* `persist`: falló por permisos de escritura en `crm_opportunities`
* `idempotency`: no ejecutado porque la persistencia no pudo completarse

Detalle observado:

* `crm_opportunities` y `crm_agent_decisions` existen y su `DESCRIBE` es compatible.
* `commercial_operational_result.status` fue `completed` en dry-run.
* `continueLegacyFlow = true`.
* `next_action_json.executable = false`.
* No hubo outbound, tools, follow-up, ni mutación de Case.
* `brain_message_outbox` no existe en este entorno, por eso la verificación queda como `null` y no se usa como dependencia.

Motivo de bloqueo de persistencia:

* `INSERT command denied to user 'pc_consultor'@'138.84.34.175' for table main_management.crm_opportunities`

Conclusión:

* El smoke test quedó documentado y parcialmente validado contra DB real, pero el flujo persistente no puede cerrarse hasta disponer de credenciales de escritura o un usuario con permisos INSERT/UPDATE sobre `crm_*`.
