---
title: Customer creation, linking and interest authority contract
doc_id: data-customer-creation-linking-authority-contract
status: approved
version: "2.0.0"
owner: product
last_reviewed: 2026-07-13
source_of_truth_for:
  - CreateCustomerInput / CreateCustomerResult
  - LinkExternalIdentityInput / LinkExternalIdentityResult
  - RecordCustomerInterestInput
  - separation of resolve_customer / create_customer / link_external_identity / record_customer_interest
  - CustomerCapabilityGovernance
depends_on:
  - ../architecture/adr/ADR-008-customer-360-boundary
  - ./customer-onboarding-identity-contract
  - ./customer-lifecycle-event-contract
  - ../product/autonomous-commerce-prd
supersedes: []
tags:
  - data-contract
  - identity
  - authority
  - governance
---
# Customer creation, linking and interest authority contract

## Contract name

`CreateCustomerInput` / `CreateCustomerResult` / `LinkExternalIdentityInput` / `LinkExternalIdentityResult` / `RecordCustomerInterestInput` / `CustomerCapabilityGovernance`

## Schema version

`1.0.2`

## Principio central

El ciclo debe funcionar asi:

```text
evento
→ IA comprende intencion y contexto
→ IA propone next best action
→ policy evalua autoridad y precondiciones
→ capability valida y ejecuta
→ outcome
→ IA replantea
```

La IA decide:

- si seguir explorando;
- si hacer una pregunta;
- si recomendar;
- si proponer una cotizacion;
- si intentar resolver identidad;
- si proponer crear una cuenta;
- si registrar un interes;
- si sugerir seguimiento;
- cuando retomar onboarding.

La IA no decide:

- si puede acceder a datos privados sin validacion;
- si puede crear duplicados;
- si puede vincular identidades sin consentimiento;
- si puede tratar una caida tecnica como `no_match`;
- si puede escribir directamente en sistemas fuente;
- si puede ejecutar una accion sin los datos minimos;
- si puede contactar proactivamente sin autorizacion.

## 1. Separacion de operaciones

```text
resolve_customer
!= create_customer
!= link_external_identity
!= record_customer_interest
```

### `resolve_customer`

- solo busca y clasifica;
- consulta Customer Service;
- no crea customers;
- no vincula identidades;
- no registra consentimiento;
- no escribe en PrestaShop, SAP, POS ni `master_customer`;
- devuelve `resolved`, `no_match`, `conflict`, `invalid_input` o `temporarily_unavailable`.

### `create_customer`

- es una capability con efecto secundario;
- solo puede ser propuesta por la IA cuando existe una razon comercial;
- la policy decide si las precondiciones estan completas;
- Customer Service ejecuta la creacion;
- ACS nunca escribe directamente en las fuentes maestras.

### `link_external_identity`

- vincula el `wa_id` actual con un `customerId`;
- requiere consentimiento explicito;
- requiere ausencia de conflicto;
- es idempotente;
- no debe ocurrir silenciosamente como efecto lateral de `resolve_customer`.

### `record_customer_interest`

- registra una senal comercial en ACS;
- no escribe el interes dentro de `master_customer`;
- puede asociarse a un `customerId` o a una identidad/oportunidad provisional;
- registrar interes no equivale automaticamente a autorizar follow-up.

## 1.1. `customerMasterId` (v2.0.0, ACS-R1-04-T08.1)

Todo resultado exitoso de `resolve_customer`/`create_customer`/`link_external_identity` retorna `customerMasterId`, nunca el `customerId` ambiguo de versiones anteriores del contrato.

```text
customerMasterId
=
identificador canonico compatible con master_customer.id
```

Customer Service sigue siendo la unica autoridad de creacion y vinculacion (seccion 2). ACS no inserta ni actualiza `master_customer`. Antes de completar onboarding con un `customerMasterId` que provino de Customer Service, ACS verifica que exista una fila local `master_customer.id = customerMasterId` (`CustomerMasterProjectionReader`, solo lectura - [customer-service-http-contract](../integrations/customer-service-http-contract.md)). Si Customer Service reporta exito pero la proyeccion local aun no existe, ACS:

- no completa onboarding con ese id;
- no fabrica una fila `master_customer`;
- no provoca una violacion de foreign key;
- lleva el onboarding a `temporarily_unavailable`;
- registra el warning estructurado `customer_master_projection_unavailable`;
- conserva el `businessOutcome` original de la capability (`created`/`resolved`/`linked`) - la capability si tuvo exito en Customer Service, solo la proyeccion local esta pendiente.

Una resolucion local que ya proviene de `master_customer` (via `customer_external_identity`, T02/T02.1) no requiere esta verificacion - ya esta garantizada por la FK existente de esa tabla.

## 2. Customer Service externo

Customer Service es la autoridad que conecta y unifica fuentes vivas:

```text
PrestaShop ─┐
SAP ────────┤
POS ────────┼→ Customer Service → master_customer
otras fuentes┘
```

ACS no consulta estas fuentes directamente.

Customer Service debe ser responsable de:

- busqueda cross-source;
- normalizacion;
- deduplicacion;
- resolucion de identidad;
- creacion canonica;
- vinculacion de identidades externas;
- proteccion contra condiciones de carrera;
- retorno de un `customerId` estable.

## 3. Autonomia de la IA

No debe existir una regla rigida como:

```text
intencion de compra → onboarding inmediato obligatorio
```

La IA puede continuar explorando cuando la conversacion aun no requiere una operacion concreta.

Ejemplo:

```text
"Estoy mirando una jaula para entrenar en casa"
→ recomendar
→ preguntar restricciones
→ comparar opciones
```

Sin onboarding obligatorio.

Cuando la IA propone una accion que requiere identidad:

```text
prepare_quote
create_checkout
create_customer
get_order_status
open_complaint
```

la policy puede responder:

```text
allowed
missing_information
denied
requires_approval
temporarily_blocked
```

La IA utiliza ese outcome para decidir como continuar.

## 4. Politica de `create_customer`

La IA puede proponer `create_customer`.

```text
create_customer
→ crea o resuelve un customer canonico mediante Customer Service
→ devuelve customerId
→ no vincula identidades externas como efecto secundario
```

La ejecucion solo se permite cuando:

```text
proposito comercial valido
+
resolve_customer = no_match
+
datos minimos disponibles
+
sin conflicto
+
Customer Service disponible
+
consentimiento cuando corresponda
```

Propositos validos iniciales:

- `quote`;
- `purchase`;
- `checkout`;
- `account_request`.

No son propositos validos para crear un customer:

- consulta general;
- busqueda de catalogo;
- recomendacion;
- guardar interes pasivo;
- consultar orden historica;
- reclamo;
- garantia;
- devolucion asociada a una compra previa.

Para operaciones historicas debe existir un customer anterior.

### Entrada conceptual

```ts
interface CreateCustomerInput {
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber: string;

  origin: {
    channel: "whatsapp";
    externalId: string;
  };

  commercialPurpose:
    | "quote"
    | "purchase"
    | "checkout"
    | "account_request";

  consent: {
    createCustomer: true;
    messageId: string;
    capturedAt: string;
  };

  idempotencyKey: string;
}
```

`origin` es trazabilidad: registra el canal y la identidad externa que originaron la solicitud de creacion. No autoriza ni ejecuta una vinculacion - vincular ese `wa_id` al `customerId` resultante requiere una llamada posterior y separada a `link_external_identity` (seccion 5), con su propio consentimiento.

### Resultado conceptual

```ts
type CreateCustomerResult =
  | {
      status: "created";
      customerMasterId: string;
    }
  | {
      status: "matched_existing";
      customerMasterId: string;
    }
  | {
      status: "missing_information";
      requiredFields: string[];
    }
  | {
      status: "conflict";
      conflictCode: string;
    }
  | {
      status: "denied";
      reason: string;
    }
  | {
      status: "invalid_input";
      fields: string[];
    }
  | {
      status: "temporarily_unavailable";
      retryable: boolean;
    }
  | {
      status: "failed";
      code: string;
      retryable: boolean;
    };
```

`matched_existing` es obligatorio para manejar condiciones de carrera entre resolucion y creacion.

`invalid_input` y `failed` distinguen, respectivamente, un request estructuralmente invalido y una falla de Customer Service que no encaja en ninguno de los otros outcomes (seccion 8). `code` en `failed` es un identificador estable y no sensible - nunca un mensaje SQL, stack trace ni una respuesta interna cruda.

Customer Service debe volver a verificar duplicados durante la creacion.

## 5. Politica de `link_external_identity`

La IA puede proponer vincular el WhatsApp cuando hacerlo facilite futuras interacciones.

La ejecucion requiere:

```text
customerId resuelto o creado
+
control del wa_id actual
+
consentimiento explicito
+
sin conflicto
+
idempotency key
```

### Entrada conceptual

```ts
interface LinkExternalIdentityInput {
  customerId: string;

  externalIdentity: {
    provider: "whatsapp";
    externalId: string;
    normalizedPhone: string;
  };

  consent: {
    granted: true;
    messageId: string;
    capturedAt: string;
  };

  idempotencyKey: string;
}
```

### Resultado conceptual

```ts
type LinkExternalIdentityResult =
  | {
      status: "completed";
      customerMasterId: string;
      externalIdentityId: string;
    }
  | {
      status: "already_linked";
      customerMasterId: string;
      externalIdentityId: string;
    }
  | {
      status: "conflict";
      conflictCode: string;
    }
  | {
      status: "denied";
      reason: string;
    }
  | {
      status: "invalid_input";
      fields: string[];
    }
  | {
      status: "temporarily_unavailable";
      retryable: boolean;
    }
  | {
      status: "failed";
      code: string;
      retryable: boolean;
    };
```

Reglas:

- vincular de nuevo al mismo customer es idempotente;
- vincular un `wa_id` ya asociado a otro customer produce `conflict`;
- nunca mover automaticamente una identidad entre customers;
- nunca resolver el conflicto mediante LLM;
- no vincular por coincidencia de nombre.

## 6. Persistencia de interes comercial

La IA puede inferir senales comerciales durante la conversacion:

- producto;
- categoria;
- necesidad;
- objecion;
- presupuesto;
- preferencia;
- intencion temporal.

Debe distinguirse:

### Contexto comercial de la conversacion

Puede registrarse dentro de la oportunidad o need profile para mantener continuidad.

No requiere crear un customer.

### Interes persistente asociado a customer

Puede asociarse cuando existe `customerId` resuelto.

Debe permanecer dentro de ACS, no dentro de Customer Master.

### Follow-up proactivo

Requiere autorizacion explicita para contacto futuro.

Guardar interes y autorizar follow-up son decisiones distintas.

### Entrada conceptual

```ts
interface RecordCustomerInterestInput {
  customerId: string | null;
  provisionalIdentityId: string | null;
  conversationId: string;
  opportunityId: string | null;

  subject: {
    productId?: string;
    category?: string;
    searchTerm?: string;
    need?: string;
  };

  consent: {
    storeInterest: boolean;
    allowFollowUp: boolean;
    messageId: string | null;
    capturedAt: string | null;
  };

  observedAt: string;
}
```

Reglas:

- sin consentimiento de almacenamiento persistente, mantenerlo solo en el contexto operacional necesario;
- sin consentimiento de follow-up, no programar mensajes proactivos;
- `no_match` no provoca creacion de customer;
- `conflict` no permite asociar el interes a candidatos;
- el interes provisional puede permanecer asociado a conversacion u oportunidad;
- un opt-out posterior debe cancelar follow-ups pendientes.

## 7. Operaciones historicas

Para:

- pedido;
- reclamo;
- garantia;
- devolucion;
- postventa;

la IA puede proponer resolver identidad y solicitar datos.

La policy debe exigir:

```text
customer existente
+
referencia entregada por el cliente
+
entidad perteneciente al customer
```

Nunca ejecutar `create_customer` para justificar una orden o reclamo historico no encontrado.

## 8. Fallos del Customer Service

Distinguir:

```text
no_match
conflict
invalid_input
temporarily_unavailable
failed
```

Reglas:

- `temporarily_unavailable` nunca equivale a cliente nuevo;
- un timeout nunca autoriza `create_customer`;
- un conflicto nunca se resuelve seleccionando el primer resultado;
- los errores no deben exponer fuentes internas ni candidatos;
- los side effects deben fallar de forma segura.

Desde la version `1.0.2`, `invalid_input` y `failed` son variantes explicitas de `CreateCustomerResult` y `LinkExternalIdentityResult` (secciones 4 y 5), no solo categorias descriptivas de esta seccion. `resolve_customer` mantiene su conjunto original de cinco outcomes (`resolved`/`no_match`/`conflict`/`invalid_input`/`temporarily_unavailable`, seccion 1) sin `failed`: la implementacion (`ACS-R1-04-T04.1`) pliega cualquier fallo de transporte no clasificado hacia `temporarily_unavailable` en ese caso, en vez de inventar un sexto status.

## 9. Gobernanza

Metadata conceptual:

```ts
interface CustomerCapabilityGovernance {
  sideEffect: "read_only" | "mutating";
  authority:
    | "autonomous"
    | "policy"
    | "requires_consent"
    | "requires_human";
  riskClass: "low" | "medium" | "high";
}
```

Estado esperado:

| Capability | Side effect | Authority | Risk |
| --- | --- | --- | --- |
| `resolve_customer` | read_only | autonomous | low |
| `create_customer` | mutating | policy | medium |
| `link_external_identity` | mutating | requires_consent | medium |
| `record_customer_interest` provisional | mutating | autonomous/policy | low |
| `record_customer_interest` con follow-up | mutating | requires_consent | medium |

La metadata definitiva debe alinearse con el Capability Gateway existente al implementarse.

## 10. Invariantes

```text
la IA decide estrategia, no autoridad
resolve_customer nunca crea
resolve_customer nunca vincula
create_customer requiere no_match real
create_customer vuelve a deduplicar en ejecucion
create_customer no ejecuta link_external_identity
create_customer no crea automaticamente una cuenta de login en PrestaShop
create_customer no propaga automaticamente el customer hacia SAP, POS u otras fuentes
origin.externalId solo registra el canal que origino la creacion
la vinculacion de WhatsApp requiere una ejecucion posterior y separada de link_external_identity
una caida tecnica no equivale a no_match
una operacion historica nunca crea customer
link_external_identity requiere consentimiento
un wa_id nunca se mueve automaticamente entre customers
el interes comercial pertenece a ACS
guardar interes no equivale a autorizar follow-up
conflict nunca se resuelve mediante LLM
ACS no escribe directamente en PrestaShop, SAP, POS ni master_customer
```

## 11. Definition of Done de T04

T04 queda terminada cuando:

1. existe contrato canonico de autoridad;
2. autonomia de la IA y autoridad de policy estan separadas;
3. `resolve_customer`, `create_customer` y `link_external_identity` tienen responsabilidades distintas;
4. estan definidos inputs y outcomes;
5. estan definidos datos minimos;
6. esta definida idempotencia;
7. esta definida prevencion de duplicados;
8. esta definido consentimiento;
9. esta definido el manejo de conflictos;
10. esta definido el comportamiento ante servicio caido;
11. esta definida la persistencia de interes;
12. esta prohibida la escritura directa en fuentes maestras;
13. operaciones historicas no pueden crear customers;
14. no se agrego codigo productivo.

## Notes

- Este contrato define autoridad y contratos conceptuales de datos para `create_customer`, `link_external_identity` y `record_customer_interest`. No implementa codigo: la implementacion (Customer Service Port, policy real, capabilities) se aborda en `ACS-R1-04-T04.1` y tareas posteriores.
- `ACS-R1-04-T04.1` implemento el `CustomerServicePort` (`lib/domains/customer-service`), las tres policies puras (`authority-policy.ts`) y el adapter HTTP fail-closed (`lib/integrations/customer-service/http-adapter.ts`, contrato en [customer-service-http-contract](../integrations/customer-service-http-contract.md)). Bump a `1.0.2` con `invalid_input`/`failed` explicitos en `CreateCustomerResult`/`LinkExternalIdentityResult` (seccion 3 de la tarea, secciones 4-5-8 de este documento). No se conecto al inbound, al LLM, al Capability Gateway, a Customer 360 ni se persistio ningun interes - eso sigue en `ACS-R1-04-T05`/`T06`.
- No reemplaza ni modifica [customer-onboarding-identity-contract](./customer-onboarding-identity-contract.md); lo extiende en el punto donde ese contrato declara la separacion `resolve_customer != create_customer != link_external_identity` (seccion 6) y agrega `record_customer_interest` como una cuarta operacion distinta.
- `master_customer` sigue sin ser escrito directamente por ACS; toda creacion y vinculacion pasa por Customer Service (ver seccion 2), consistente con [ADR-009](../architecture/adr/ADR-009-persistence-boundary.md) y ADR-008.
- `ACS-R1-04-T08.1` (v2.0.0, breaking): renombro `customerId` a `customerMasterId` en los tres resultados exitosos (seccion 1.1) y agrego el gate de proyeccion local obligatorio antes de `completeOnboarding`. No cambia la autoridad de `create_customer`/`link_external_identity`, el consentimiento, ni la separacion `resolve_customer != create_customer != link_external_identity`. Ver [customer-service-http-contract](../integrations/customer-service-http-contract.md) v2.0.0 y `docs/releases/ACS-R1-04-customer-identity-onboarding.md` para la evidencia de cierre.
- Este contrato no agrega reglas deterministicas sobre como debe conversar la IA: la seccion 3 documenta la separacion entre autonomia estrategica (que explorar, preguntar o proponer) y autoridad operacional (que capability puede ejecutarse y bajo que precondiciones), no un guion de conversacion.
