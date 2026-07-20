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

`/api/brain/process-inbound` permanece disponible para esta ruta. Sigue
resolviendo contexto, policy y recomendaciones en cada llamada de n8n.

### Intencion de esta ruta

1. Brain API recibe el evento minimo.
2. Brain devuelve decision, policy y recomendaciones.
3. n8n sigue ejecutando el camino legacy mientras se compara.
4. El producto gana observabilidad sin romper la operacion actual.

### Correccion (ACS-R1-05.1-T01): el rotulo "shadow mode" no era read-only

El texto original de esta seccion (arriba) llamaba "shadow mode" a este
camino y lo describia como observacional. Eso era impreciso: hasta
`ACS-R1-05.1-T01`, `processInbound` (el codigo detras de este endpoint)
ejecutaba sin ningun feature flag el motor legacy `sales-consultative`
(`runSalesConsultativeService`) cada vez que el mensaje traia palabras clave
comerciales (precio, stock, cotizar, etc.) o el contexto resolvia
`primary_service = "sales"`. Ese motor persiste realmente en
`crm_opportunities`, `crm_sales_need_profiles` y `crm_agent_actions`, y puede
despachar un envio real por outbox. No era una comparacion inocua: era una
segunda autoridad de escritura comercial corriendo en paralelo a la autoridad
canonica (`processNativeWhatsAppInbound -> runNativeAutonomousCycle ->
operational-loop -> persistCommercialState`, la unica ruta real de WhatsApp).
Ningun texto de este documento, pasado o futuro, debe volver a describir esta
ruta o su motor legacy como read-only o inocuo solo por el nombre "shadow".

### Flag de autoridad unica: `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED`

Desde `ACS-R1-05.1-T01`, el motor legacy `sales-consultative` esta
deshabilitado por defecto en este endpoint (y en
`native-whatsapp/service.ts::processSalesInbound`, que no tiene caller
productivo hoy) detras de `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED`
(`lib/brain/commercial/config/commercialCycleConfig.ts`, unico lector de esta
variable de entorno).

Semantica fail-closed (identica a `readEnvFlag` en el resto del ciclo
comercial):

| Valor de `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` | Resultado |
|---|---|
| no definido (ausente) | deshabilitado |
| `""` (vacio) | deshabilitado |
| `"false"` | deshabilitado |
| cualquier valor distinto de `"true"` (typo, `"1"`, `"yes"`, etc.) | deshabilitado |
| `"true"` (exacto) | habilitado |

Con el flag deshabilitado (el default):

- `processInbound` sigue resolviendo contexto, policy y recomendaciones sin
  error 500 causado por el gate;
- no se llama a `runSalesConsultativeService`;
- no se escribe en `crm_opportunities`, `crm_sales_need_profiles` ni
  `crm_agent_actions` a traves de este endpoint;
- la respuesta incluye la advertencia estructurada
  `legacy_sales_consultative_disabled`.

`BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED=true` es una habilitacion
excepcional, no un modo productivo recomendado. Habilitarlo reintroduce el
riesgo de doble autoridad de escritura sobre `crm_opportunities`,
`crm_sales_need_profiles` y `crm_agent_actions` (el motor legacy volviendo a
escribir en paralelo a `runNativeAutonomousCycle`). **No debe habilitarse
durante `ACS-R1-05.1`** - el piloto controlado depende de que exista una unica
autoridad de escritura comercial (ver "Camino critico al piloto controlado" en
`docs/ROADMAP.md` y la release spec de `ACS-R1-05.1`).

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
