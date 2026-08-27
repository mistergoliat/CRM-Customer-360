# MARKETING-R1-T05 - UI Response Contract Hotfix

Status: implemented locally; EC2 live validation not run.

## Defecto en vivo

Un turno del Customer Intelligence Copilot con `status: "responded_directly"`
(ej. pregunta "peso o euro?") se renderizaba en el CRM como una tarjeta
"RESPONDIDO"/"RESPONDIDO DIRECTAMENTE" valida pero sin texto visible, aunque
el backend registraba la respuesta como exitosa (`queryCount=0`,
`responseCharCount` no nulo, ~56ms).

## Causa raiz

El backend (`MS-pesaschile-customer-profile`,
`src/domain/customer-intelligence-copilot/contracts.ts`) agrego el status
`responded_directly` en T05.8.8 para el fast path deterministico de
moneda/unidad: un estado exitoso de primera clase con la prosa en `answer` y
un `finalResponseState: "success"` a nivel raiz.

El tipo local del CRM (`lib/marketing/customerIntelligenceCopilot.ts`) nunca
declaro esa variante, y el componente de render
(`components/marketing/MarketingCopilotWorkspace.tsx`) resolvia texto, tono y
titulo con cuatro switches independientes sobre el string de status crudo
(`ResponseBody`, `assistantContent`, `toneForCopilotStatus`, `stateTitle`).
`responded_directly` no calzaba en ninguno, caia a la rama generica de
estados terminales, que lee `response.message` -campo que esta forma no
tiene- y `stateTitle` devolvia "Respondido" por default.

El proxy del CRM (`app/api/marketing/copilot/sessions/[sessionId]/messages/route.ts`)
reenvia el JSON del backend sin tocarlo, asi que el payload en si era
correcto: el defecto era enteramente un gap de mapeo en el CRM, no un bug de
formato de wire.

## Contrato del backend (verificado)

Verificado directamente contra `contracts.ts` en el checkout hermano
`MS-pesaschile-customer-profile`:

- `answered` / `degraded_success`: prosa en `answer`, `finalResponseState`
  `"success"` o `"degraded_success"`.
- `answered_from_context`: prosa en `answer`, `finalResponseState`
  `"success"`.
- `responded_directly`: prosa en `answer`, `finalResponseState` `"success"`
  (sin `queryCount` ni el resto de campos de analysis que comparte
  `answered`).
- `clarification_required` / `unsupported_data` / `unsupported_operation`:
  prosa en `message`, `finalResponseState` `"success"`.
- `planner_invalid` / `orchestrator_invalid`: `errors[]`,
  `finalResponseState` `"failure"`.
- Todos los `provider_*` / `analytics_*` / `answer_generation_failed`: prosa
  en `message`, `finalResponseState` `"failure"`.

## Fix

- Se extendio el tipo del contrato en el CRM para reflejar la union real del
  backend: variante `responded_directly`, status `orchestrator_invalid`,
  todos los status `provider_*`, y `finalResponseState` opcional en cada
  variante.
- Se agrego `normalizeCopilotTurn()` en el mismo archivo de contrato: el
  unico lugar que sabe que campo (`answer`/`message`/`errors`) trae la prosa
  segun el status, y devuelve `{ text, finalResponseState, interactionType,
  contractError }`.
- Se recablearon `ResponseBody`, `assistantContent`, el tono del chip y el
  titulo de estado para consumir esa forma normalizada en vez de re-derivarla
  por status en cada funcion. El tono exito/fallo ahora sigue el
  `finalResponseState` que ya manda el backend, asi que un status no
  fatal futuro y todavia no visto se renderiza correctamente por default sin
  requerir un cambio de codigo en el CRM sincronizado con el backend.
- Se agrego un guard fail-closed: un status no fatal con texto vacio o solo
  espacios se trata como error de contrato de integracion
  (`contractError: true`) y se renderiza como una tarjeta de error visible
  con diagnostico via `console.error`, nunca como una tarjeta "exitosa"
  vacia y silenciosa.
- Se corrigio un bug latente de estrechamiento de tipos en
  `buildProvenanceItems` (acceso a `resultRowCount`) que la nueva variante
  `responded_directly` habria roto de otro modo.

No se toco razonamiento del Copilot, prompts, analitica, semantica de sesion
ni el runtime de Customer Intelligence: el contrato del backend era
internamente consistente, solo el espejo desactualizado del CRM necesitaba
el fix.

## Archivos modificados

- `lib/marketing/customerIntelligenceCopilot.ts`
- `components/marketing/MarketingCopilotWorkspace.tsx`
- `tests/marketing/marketingCopilotWorkspace.test.ts`

## Tests

Extendido `tests/marketing/marketingCopilotWorkspace.test.ts` (8/8 pass):

1. `normalizeCopilotTurn` extrae texto para `answered`, `answered_from_context`,
   `responded_directly`, `clarification_required` y `degraded_success`.
2. Un payload exitoso vacio se trata como error de contrato
   (`contractError: true`, `finalResponseState: "failure"`), nunca como
   exito silencioso.
3. `responded_directly` renderiza el texto de la respuesta de moneda
   ("pesos chilenos / CLP") - test de regresion exacto del defecto en vivo.
4. `answered_from_context` y `degraded_success` renderizan texto visible.
5. Un payload exitoso vacio nunca produce una tarjeta de asistente vacia -
   se muestra el estado de error en su lugar.
6. Suite previa sin cambios y en verde: render inicial del workspace,
   estado `answered` con provenance/InfoGrid, y los estados
   `clarification_required` / `unsupported_data` / `answer_generation_failed`.

## Validacion

- `npm run typecheck`: PASS.
- Tests enfocados (`tsx --test tests/marketing/marketingCopilotWorkspace.test.ts`):
  PASS, 8/8.
- `npm run lint`: PASS (0 errores; 39 warnings preexistentes no relacionados).
- `npm run build`: PASS.

Live validation: NOT_RUN.

## Deuda / riesgos no bloqueantes

- Este hotfix es solo del lado CRM (tipos + render). No se audito si otros
  consumidores del contrato de Copilot en el CRM (fuera de
  `MarketingCopilotWorkspace.tsx`) tienen el mismo patron de switch fragil
  sobre `status`.
- No se agrego un test de regresion de persistencia de sesion/historial a
  nivel de fetch mockeado; la cobertura de "no regression" se apoya en que
  el test preexistente de render inicial del workspace sigue en verde sin
  cambios. Un flujo E2E de sesion completo (crear -> multi-turno -> refresh)
  no existe en este archivo de tests y queda fuera de alcance de este
  hotfix puntual.
