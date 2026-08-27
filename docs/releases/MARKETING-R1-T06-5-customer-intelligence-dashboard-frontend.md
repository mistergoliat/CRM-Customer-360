# MARKETING-R1-T06.5 — Customer Intelligence Dashboard Frontend

## Estado

Implementado en CRM como superficie read-only bajo `/marketing/customer-intelligence`.

## Alcance

Esta tarea agrega el primer workspace usable para Customer Intelligence en el CRM:

- overview comercial y cobertura de poblacion desde `GET /v1/customer-intelligence/dashboard/overview`;
- distribucion RFM desde `GET /v1/customer-intelligence/dashboard/rfm`;
- distribucion de clusters y cross-section RFM desde `GET /v1/customer-intelligence/dashboard/clusters`;
- seleccion activa de poblacion mediante el arbol de filtros T03;
- resolucion de intersecciones via `POST /v1/customer-intelligence/dashboard/intersections`;
- conexion del `uiContext.intersection` al Customer Intelligence Copilot multi-turn existente.

## Frontera de integracion

React no llama al microservicio `MS-pesaschile-customer-profile` directamente. La UI usa route handlers del CRM en:

- `/api/marketing/customer-intelligence/dashboard/context`;
- `/api/marketing/customer-intelligence/dashboard/overview`;
- `/api/marketing/customer-intelligence/dashboard/rfm`;
- `/api/marketing/customer-intelligence/dashboard/clusters`;
- `/api/marketing/customer-intelligence/dashboard/intersections`;
- `/api/marketing/copilot/sessions/:sessionId/messages`.

Los handlers reutilizan la configuracion server-side ya existente para Marketing Copilot (`MARKETING_COPILOT_ENABLED`, `MARKETING_COPILOT_BACKEND_BASE_URL`, `MARKETING_COPILOT_INTERNAL_TOKEN`, `MARKETING_COPILOT_TIMEOUT_MS`) y no exponen el token al navegador.

## Filtros

La UI mantiene una unica representacion canonica compatible con T03:

```json
{
  "and": [
    { "field": "rfm.segmentCode", "operator": "eq", "value": "CHAMPION" },
    { "field": "cluster.clusterId", "operator": "eq", "value": 3 }
  ]
}
```

Los controles iniciales cubren:

- `rfm.segmentCode eq`;
- `cluster.clusterId eq`;
- `commercial.daysSinceLastOrder gte/lte`;
- `commercial.totalSpentTaxIncl gte/lte`;
- `commercial.averageOrderValueTaxIncl gte/lte`;
- `commercial.validOrders gte/lte`.

No se implementa un builder general de filtros.

## Copilot uiContext

Cuando existe una seleccion activa, el mensaje al Copilot incluye solo:

```json
{
  "uiContext": {
    "intersection": {
      "contractVersion": "customer-intelligence-copilot-ui-context-v1",
      "filters": {}
    }
  }
}
```

No se envia `matchingPopulation` como autoridad, labels, payloads completos del dashboard, chart internals, SQL ni estado no relacionado. Si no hay filtros, `uiContext` se omite completamente.

## Limites

- No se reimplementa RFM, clustering ni calculos de interseccion en React.
- No se crea ni persiste una Audience.
- La UI usa el texto "Selected population" para evitar prometer persistencia o activacion.
- Commercial Affinity queda fuera de alcance de este slice.
- El cambio no agrega cache framework ni side effects de marketing automation.
- URL state para compartir/restaurar filtros queda diferido: la seleccion vive solo en estado de UI y el contrato canonico se muestra en pantalla.

## Validacion esperada

- `npm run typecheck`
- `npm run test -- tests/marketing/customerIntelligenceDashboard.test.ts tests/marketing/marketingCopilotApi.test.ts tests/marketing/marketingCopilotWorkspace.test.ts`
- `npm run lint`
- `npm run build`
