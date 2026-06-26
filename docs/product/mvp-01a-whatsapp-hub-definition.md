# MVP-01A WhatsApp Inbound Visible en HUB

## Recorrido actual

`app/api/integrations/whatsapp/webhook/route.ts` autentica el webhook de Meta y delega en `processNativeWhatsAppInbound` en [`lib/brain/native-whatsapp/service.ts`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/lib/brain/native-whatsapp/service.ts).

Ese flujo persiste el inbound en las tablas nativas `master_customer`, `customer_external_identity`, `conversation`, `conversation_message` y `commercial_event`.

La interfaz del HUB ya lee el inbox nativo desde [`lib/domains/conversations`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/lib/domains/conversations) y renderiza `/conversations` y `/conversations/[id]`.

## Brecha encontrada

El mensaje ya se persistia, pero la UI todavia no distinguia claramente entre:

- lista vacia real;
- error de carga;
- conflicto de identidad visible en la lista.

Ademas, el contrato del inbox no exponia un estado explicito de error para la lista o el detalle cuando el loader nativo falla.

## Fuente de Verdad

- Webhook Meta autenticado en `app/api/integrations/whatsapp/webhook/route.ts`
- `processNativeWhatsAppInbound`
- `master_customer`
- `customer_external_identity`
- `conversation`
- `conversation_message`
- `commercial_event`
- Read model nativo de `lib/domains/conversations`

## Archivos a modificar

- [`lib/domains/conversations/types.ts`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/lib/domains/conversations/types.ts)
- [`lib/domains/conversations/repository.ts`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/lib/domains/conversations/repository.ts)
- [`app/api/conversations/route.ts`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/app/api/conversations/route.ts)
- [`app/api/conversations/[id]/route.ts`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/app/api/conversations/[id]/route.ts)
- [`app/(hub)/conversations/page.tsx`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/app/(hub)/conversations/page.tsx)
- [`app/(hub)/conversations/[id]/page.tsx`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/app/(hub)/conversations/[id]/page.tsx)
- [`tests/hub/mvp-01a-whatsapp-hub.test.ts`](C:/Users/Goli/Pesas Chile/CRM-Customer-360-mvp-01a-whatsapp-hub/tests/hub/mvp-01a-whatsapp-hub.test.ts)

## Exclusiones

- No cambiar el modelo legacy `lib/chats`.
- No implementar outbound.
- No implementar IA nueva.
- No tocar catalogo, precios ni ventas autonomas.
- No agregar una API paralela solo para tests.

## Criterio de Aceptacion

- Un inbound Meta firmado crea un customer minimo verificable, identidad, conversacion, mensaje y commercial event.
- Un segundo inbound del mismo `wa_id` reutiliza la conversacion.
- El inbox muestra el mensaje exacto en la lista y en el detalle.
- La lista distingue entre `sin conversaciones` y `error al cargar conversaciones`.
- El conflicto de identidad se ve en el contrato del HUB.
- Un `providerMessageId` duplicado no duplica filas ni vistas.
- El mensaje se puede comprobar en la interfaz del HUB sin depender solo de SQL.
