# MARKETING-R1-T04 - Marketing Copilot Conversational Workspace

## Objetivo

Transformar `/marketing/copilot` desde una consola de prueba a un workspace conversacional interno conectado a las sesiones reales de Customer Intelligence Copilot en Customer Profile.

## Arquitectura

CRM Customer 360 actua como frontend y backend-for-frontend. El navegador solo llama a rutas Next.js bajo `/api/marketing/copilot/*`. Esas rutas llaman server-side a Customer Profile usando `MARKETING_COPILOT_BACKEND_BASE_URL` y agregan `x-internal-copilot-token` desde `MARKETING_COPILOT_INTERNAL_TOKEN`.

El browser no recibe el token interno, no conoce API keys de modelos, no llama a DeepSeek u otro proveedor LLM y no ejecuta SQL.

## Endpoints Usados

- `POST /v1/customer-intelligence/copilot/sessions`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/messages`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/refresh`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/reset`
- `DELETE /v1/customer-intelligence/copilot/sessions/:sessionId`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/export`

## Seguridad

- `MARKETING_COPILOT_INTERNAL_TOKEN` permanece server-side.
- No se exponen credenciales de Analytics DB ni API keys del modelo.
- La UI no reconstruye planes analiticos ni SQL.
- Export XLSX se transmite desde Customer Profile; el frontend no fabrica archivos desde filas locales.
- Los errores enviados al navegador son controlados y no incluyen secretos.

## Ciclo De Sesion

Primer turno:

1. La UI crea una sesion backend.
2. Guarda `sessionId` en estado cliente.
3. Envia la pregunta a `/sessions/:sessionId/messages`.
4. Agrega el turno del usuario y la respuesta del Copilot al historial visible.

Turnos siguientes reutilizan el mismo `sessionId`.

`Nuevo chat` elimina la sesion anterior best-effort y limpia estado local. La siguiente pregunta crea una sesion nueva.

`Actualizar datos` llama a refresh de sesion, toma contexto analitico nuevo y limpia historial local porque el backend tambien resetea turns/resultados.

## Export XLSX

El boton aparece solo cuando una respuesta trae `queryIds` o `sourceQueryIds`. La UI llama al proxy Next.js de export con `{ queryId, format: "xlsx" }`, recibe bytes y descarga el archivo respetando `Content-Disposition`. Si no existe filename, usa `customer-intelligence-export.xlsx`.

Customer Profile reejecuta la query validada contra snapshots pinned.

## Provenance

La pantalla muestra feature snapshot, RFM, clustering, poblacion, cobertura y queries reportadas por el backend. El detalle tecnico queda colapsado por defecto e incluye read model, versiones, query plan hash y turn id cuando existen.

## UI

La pantalla queda organizada como workspace conversacional:

- header con Nuevo chat y Exportar XLSX contextual;
- historial multi-turn;
- estado de carga inline;
- input inferior con Enter para enviar y Shift+Enter para salto de linea;
- chips de preguntas sugeridas;
- panel lateral de provenance en desktop y debajo del chat en pantallas menores.

## Estados

La UI distingue:

- `answered`
- `answered_from_context`
- `clarification_required`
- `unsupported_data`
- `unsupported_operation`
- `planner_invalid`
- `analytics_unavailable`
- `analytics_timeout`
- `answer_generation_failed`
- feature disabled / provider unavailable desde proxy

## Tests

Cobertura agregada o actualizada para:

- proxy cerrado por feature flag;
- validacion de payload publico;
- token interno agregado server-side;
- creacion de sesion;
- envio de mensajes con `sessionId`;
- export XLSX con bytes, `Content-Type` y `Content-Disposition`;
- token no reflejado al browser;
- render inicial del workspace conversacional;
- provenance y estados semanticos renderizables.

## Limitaciones

- Las sesiones siguen siendo efimeras e instance-local en Customer Profile.
- Un restart del backend pierde conversaciones y referencias exportables.
- La UI no tiene historial durable.
- No hay Redis ni persistencia durable de chats.
- No hay visualizacion 3D, scatter 2D ni dashboard avanzado de clusters.
- No se agregan endpoints nuevos en Customer Profile.

## Deuda Posterior

- MARKETING-R1-T05 debe cubrir visualizacion analitica avanzada de clusters/RFM.
- Historial durable de conversaciones requiere almacenamiento explicito y politica de retencion.
- Para despliegues multi-instancia, las sesiones backend efimeras requieren sticky sessions o store compartido.
