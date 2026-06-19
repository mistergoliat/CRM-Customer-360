# AI SDR Autonomy Sandbox

## Objetivo

Este contrato define una evaluacion pura y read-only para responder una sola pregunta:

`this action can run automatically in sandbox?`

No ejecuta mensajes. No escribe outbox. No llama Meta. No muta Case. No crea scheduler.

## Por que existe la whitelist

La whitelist es una barrera exclusiva de sandbox.

Sirve para limitar las pruebas automatizadas a identidades autorizadas mientras el execution gate futuro aun no existe.

Esto evita que una configuracion temporal de laboratorio se convierta en una regla permanente del producto.

## Sandbox vs produccion futura

Sandbox autonomy:

- requiere whitelist exacta;
- requiere flags apagados por defecto;
- solo permite acciones de bajo riesgo;
- solo produce preview de elegibilidad;
- nunca ejecuta.

Future production autonomy:

- no depende de whitelist;
- depende de policy, risk, action type, rollout and operational control;
- requiere execution gate separado;
- requiere audit y observability completas.

## Configuracion

Variables documentadas en `.env.example`:

```env
BRAIN_AUTONOMOUS_SANDBOX_ENABLED=false
BRAIN_AUTONOMOUS_REPLY_ENABLED=false
BRAIN_AUTONOMOUS_TEST_WA_IDS=
```

Opcionales:

```env
BRAIN_AUTONOMOUS_ALLOWED_ACTION_TYPES=send_whatsapp_reply,request_more_context
BRAIN_AUTONOMOUS_MAX_RISK_LEVEL=low
```

Los defaults siguen apagados o vacios.

## Exact match

La lista de prueba se parsea con separacion por coma, trim y normalizacion a digitos.

Reglas:

- no hay wildcard;
- no hay match parcial;
- no hay prefijos parciales;
- la comparacion es exacta;
- los duplicados se eliminan.

## Masking

Los numeros nunca deben mostrarse completos en UI, logs o diagnosticos.

Ejemplo:

```ts
maskWaId("56912345678") -> "569*****678"
```

## Eligibility

La evaluacion reporta:

- `eligible`
- `blocked`
- `disabled`
- `invalid`
- `expired`
- `requires_review`

`executionPreview.canExecute` siempre queda en `false`.

## Block reasons

Los motivos soportados son:

- `sandbox_disabled`
- `autonomous_reply_disabled`
- `recipient_not_whitelisted`
- `missing_recipient`
- `unsupported_channel`
- `unsupported_action_type`
- `risk_too_high`
- `approval_required`
- `human_owner_active`
- `ai_blocked`
- `case_closed`
- `action_expired`
- `missing_idempotency_key`
- `unsafe_payload`
- `unsafe_message`
- `duplicate_or_conflicting_action`
- `action_not_ready`
- `policy_blocked`

## Action types permitidos

Solo se permiten conceptualmente:

- `send_whatsapp_reply`
- `request_more_context`

Todavia no se permiten:

- `schedule_followup`
- `prepare_quote_draft`
- `take_over_case`
- `create_internal_task`
- `mark_lost_candidate`
- `pause_ai`

## Riesgo

Solo se permite:

- `low`

Se bloquea:

- `medium`
- `high`
- `critical`
- `unknown`

Si la configuracion no es compatible con `low`, la evaluacion falla cerrado.

## Approval

Solo puede seguir si `approvalRequirement = none`.

Se bloquea o se degrada a review si el estado exige:

- `operator_review`
- `manager_review`
- `blocked`

## Seguridad de mensaje

La validacion pura bloquea:

- texto vacio;
- longitud excesiva;
- placeholders sin resolver;
- credenciales o tokens;
- JSON o payload crudo;
- promesas comerciales no verificadas;
- reclamos o garantias que deben ir a humano.

## Relacion con Action Queue

La cola durable puede transportar la evaluacion como preview read-only.

P1K-012C no agrega ejecucion, no cambia status a `executing` y no escribe outbox.

## Relacion futura con Execution Gate

P1K-012C solo define elegibilidad.

P1K-012D debera introducir:

- execution gate;
- bridge a outbox;
- operational controls;
- audit completo de aprobacion y envio.

## Criterios para pruebas live

Antes de cualquier live test hace falta:

- execution gate separado;
- observabilidad de acciones;
- auditoria persistente;
- policy y approval estables;
- whitelist vacia en produccion;
- rollout controlado.

## Criterios para retirar la whitelist en produccion

La whitelist puede retirarse solo cuando:

- el sandbox ya no sea la via de validacion;
- el execution gate productivo exista;
- la policy y el rollout controlen la autonomia;
- la trazabilidad este completa;
- la aprobacion humana y el fallback esten probados.

