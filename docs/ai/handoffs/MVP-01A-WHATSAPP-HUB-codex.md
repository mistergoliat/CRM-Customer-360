# MVP-01A WhatsApp Inbound Visible en HUB - Handoff

## Branch and worktree

- Branch: `ai/codex/mvp-01a-whatsapp-hub`
- Worktree: `C:\Users\Goli\Pesas Chile\CRM-Customer-360-mvp-01a-whatsapp-hub`

## Commits

- Commit base original: `24a87645b373f2ad7b062a02e10f41ade9ff03d8`
- Commit code: pending final commit capture in this worktree
- Commit final: pending final commit capture in this worktree

## Recorrido anterior

- El webhook Meta ya persistia el inbound en MariaDB nativa.
- El HUB leía conversaciones nativas, pero no distinguia bien entre estado vacio y error de carga.
- El conflicto de identidad no se mostraba de forma explicita en el inbox.

## Recorrido nuevo

- Webhook autenticado -> `processNativeWhatsAppInbound`.
- Persistencia nativa en `master_customer`, `customer_external_identity`, `conversation`, `conversation_message` y `commercial_event`.
- `/conversations` y `/conversations/[id]` leen el read model nativo.
- La lista distingue `sin conversaciones` de `error al cargar conversaciones`.
- El conflicto de identidad se muestra como indicador de revision.
- El detalle muestra el texto exacto del mensaje y conserva un estado de error explicito cuando la lectura falla.

## Brecha identificada

- Faltaba una diferencia visible entre vacio, error y conflicto dentro del inbox del HUB.
- Faltaba un contrato de error explicito para la lista y el detalle cuando el loader nativo fallaba.

## Tablas utilizadas

- `master_customer`
- `customer_external_identity`
- `conversation`
- `conversation_message`
- `commercial_event`

## APIs utilizadas

- `app/api/integrations/whatsapp/webhook/route.ts`
- `app/api/conversations/route.ts`
- `app/api/conversations/[id]/route.ts`
- `lib/domains/conversations`

## Archivos modificados

- `app/(hub)/conversations/page.tsx`
- `app/(hub)/conversations/[id]/page.tsx`
- `app/api/conversations/route.ts`
- `app/api/conversations/[id]/route.ts`
- `components/ui/PageHeader.tsx`
- `components/ui/StatCard.tsx`
- `components/ui/DataTable.tsx`
- `components/ui/Icon.tsx`
- `components/p1m/SectionCard.tsx`
- `components/p1m/InfoGrid.tsx`
- `components/p1m/SurfaceBadge.tsx`
- `lib/brain/native-whatsapp/service.ts`
- `lib/domains/conversations/types.ts`
- `lib/domains/conversations/repository.ts`
- `tests/domains/conversations.test.ts`
- `tests/hub/mvp-01a-whatsapp-hub.test.ts`
- `docs/product/mvp-01a-whatsapp-hub-definition.md`
- `docs/qa/mvp-01a-manual-acceptance.md`

## Contratos probados

- Inbound nuevo crea y muestra una conversacion visible.
- Segundo inbound del mismo numero reutiliza la misma conversacion.
- Dos numeros distintos crean conversaciones separadas.
- `providerMessageId` duplicado no duplica filas ni vista.
- El conflicto de identidad se muestra como indicador de revision.
- La lista del HUB distingue vacio de error.

## Comandos ejecutados

- `git fetch --all --prune`
- `git branch --show-current`
- `git status --short`
- `git rev-parse --show-toplevel`
- `git rev-parse HEAD`
- `git log -5 --oneline`
- `npm install`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npx tsx --test tests/hub/mvp-01a-whatsapp-hub.test.ts`
- `npx tsx --test tests/native/whatsapp-webhook-auth.test.ts tests/native/native-whatsapp.test.ts tests/native/identity-conflict.test.ts tests/domains/conversations.test.ts tests/hub/mvp-01a-whatsapp-hub.test.ts`
- `npx tsx --test <suite completa del repo>`

## Resultados exactos

- `npm run typecheck` -> exit code `0`
- `npm run lint` -> exit code `0`, `35` warnings preexistentes, `0` errors
- `npm run build` -> exit code `0`, build exitoso, mismos warnings preexistentes
- `npx tsx --test tests/hub/mvp-01a-whatsapp-hub.test.ts` -> `6/6` passing
- Bateria focal -> `36/36` passing
- Suite completa -> `589/589` passing, `0` failures, `0` skipped

## Limitaciones

- No se ejecuto una prueba operativa con telefono real de WhatsApp.
- No se valido un entorno de staging externo con webhook publico.
- `npm run qa:autonomous-commerce` no existe en esta base de rama.

## Riesgos

- La validacion operativa real sigue dependiendo de un ambiente externo de WhatsApp/Meta.
- El inbox renderizado en Node requiere imports explicitos de `React` en componentes compartidos para la prueba server-side.

## Estados

- Technical implementation: `passed`
- Integrated behavior: `passed`
- Operational acceptance: `blocked`

## Instrucciones para integracion

- Integrar solo los cambios de lectura del HUB nativo y sus pruebas.
- No reintroducir dependencias en `lib/chats` para el inbox principal.
- Si existe un staging con WhatsApp real, repetir la prueba manual con un numero autorizado y registrar evidencia.

## Declaracion de limites respetados

- No se tocaron `crm_agent_actions`, `crm_agent_decisions`, Next Best Action, planning, outcomes, escalation ni catalogo.
- No se modifico la rama congelada de quality gate.
- No se versionaron secretos ni credenciales.
- No se introdujeron side effects de envio, compra, inventario o pagos.
