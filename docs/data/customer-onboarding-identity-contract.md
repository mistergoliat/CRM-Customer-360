---
title: Customer onboarding and identity contract
doc_id: data-customer-onboarding-identity-contract
status: approved
version: "1.1.0"
owner: product
last_reviewed: 2026-07-13
source_of_truth_for:
  - CustomerSessionIdentityStatus
  - CustomerOnboardingState
  - customer identity resolution order
  - onboarding activation matrix
depends_on:
  - ../architecture/adr/ADR-008-customer-360-boundary
  - ./customer-360-contract
  - ./customer-lifecycle-event-contract
  - ../product/autonomous-commerce-prd
supersedes: []
tags:
  - data-contract
  - identity
  - onboarding
---
# Customer onboarding and identity contract

## Contract name

`CustomerOnboardingState` / `CustomerSessionIdentityStatus`

## Schema version

`1.0.0`

## 1. Principio general

Cualquier persona puede escribir al WhatsApp y realizar consultas publicas sin estar identificada.

No se debe iniciar onboarding obligatorio para:

- preguntas generales;
- busqueda de productos;
- precios publicos;
- disponibilidad;
- recomendaciones;
- caracteristicas tecnicas.

La identificacion se activa cuando la conversacion necesita establecer una relacion comercial o acceder a una entidad privada.

## 2. Matriz de activacion

| Proposito | Identificacion requerida | Validacion adicional |
| --- | ---: | ---: |
| Consulta general | No | No |
| Catalogo, precio o disponibilidad | No | No |
| Recomendacion de producto | No | No |
| Cotizacion formal | Si | No inicialmente |
| Intencion concreta de compra | Si | No inicialmente |
| Crear cuenta o checkout | Si | Segun operacion |
| Consultar pedido | Si | Referencia entregada por el cliente |
| Reclamo | Si | Referencia entregada por el cliente |
| Garantia | Si | Referencia entregada por el cliente |
| Cambio o devolucion | Si | Referencia y politica aplicable |
| Cambiar direccion de orden activa | Si | Verificacion reforzada u operador |
| Devolucion monetaria | Si | Verificacion reforzada u operador |
| Cambiar email principal | Si | Verificacion reforzada u operador |

## 3. Modelo de identidad

El identificador canonico es `customer_id`.

El modelo conceptual es:

```text
customer_id
+-- email principal
+-- telefonos
+-- identidades externas de WhatsApp
+-- direcciones
+-- cotizaciones
+-- ordenes
+-- reclamos
+-- conversaciones
```

El email representa la cuenta principal del cliente.

El telefono y `wa_id` representan la identidad del canal WhatsApp.

Conocer un email no demuestra por si solo ser dueno de la cuenta.

## 4. Estados de sesion

```ts
type CustomerSessionIdentityStatus =
  | "anonymous"
  | "identification_required"
  | "identified"
  | "conflict"
  | "temporarily_unavailable";
```

### `anonymous`

Puede consultar informacion publica y usar catalogo.

No puede acceder a Customer 360 privado.

### `identification_required`

Existe una intencion que requiere conocer al customer.

El sistema debe recopilar unicamente los datos necesarios para el proposito actual.

### `identified`

Existe un `customerId` unico y una resolucion consistente.

Puede utilizarse contexto comercial dentro del alcance autorizado.

### `conflict`

Existen senales contradictorias o multiples customers candidatos.

No se debe elegir automaticamente un candidato ni cargar informacion privada.

### `temporarily_unavailable`

La resolucion no pudo ejecutarse por un fallo tecnico.

No debe tratarse como cliente nuevo.

## 5. Resolucion de customer

Orden deterministico:

```text
1. identidad externa exacta: provider + wa_id
2. telefono normalizado
3. email declarado por el usuario
4. referencia de orden, cuando el proposito la requiere
```

Reglas:

- una coincidencia unica y consistente puede resolver el customer;
- multiples coincidencias producen `conflict`;
- `wa_id` asociado a customer A y email asociado a customer B produce `conflict`;
- ninguna coincidencia produce identidad provisional o necesidad de onboarding;
- una caida tecnica produce `temporarily_unavailable`;
- nunca se selecciona la primera fila;
- nunca se resuelve por similitud de nombre;
- el LLM no decide conflictos de identidad.

## 6. Separacion de operaciones

```text
resolve_customer
!= create_customer
!= link_external_identity
```

### `resolve_customer`

Solo busca y clasifica.

No crea customers.

No vincula identidades.

### `create_customer`

Solo puede ejecutarse para una nueva relacion comercial cuando:

- existe intencion de cotizacion, compra o creacion de cuenta;
- se recopilaron los datos minimos;
- no existe customer compatible;
- no existe conflicto;
- los servicios requeridos estan disponibles.

Nunca se crea un customer nuevo para justificar una orden, reclamo, garantia o devolucion historica.

### `link_external_identity`

Vincula WhatsApp a un customer existente.

Requiere:

- customer resuelto;
- control del `wa_id` demostrado por el inbound;
- ausencia de conflictos;
- idempotency key;
- consentimiento explicito del cliente.

El vinculo no se crea silenciosamente.

## 7. Onboarding progresivo

El onboarding depende del proposito.

### Cotizacion o compra nueva

Datos minimos:

- nombre;
- apellido cuando sea necesario;
- email;
- telefono obtenido desde WhatsApp;
- datos comerciales requeridos para la operacion.

### Pedido, reclamo o garantia

Datos minimos:

- email de la cuenta cuando WhatsApp no este vinculado;
- nota de venta o referencia entregada por el cliente.

No se crea un customer nuevo si no se encuentra la compra.

### Consulta general

No requiere datos personales obligatorios.

## 8. Consulta de pedidos y reclamos

El cliente debe entregar la referencia.

El bot no debe:

- enumerar pedidos;
- indicar cuantos pedidos existen;
- sugerir codigos;
- mostrar referencias parciales;
- revelar si un email existe;
- revelar que dato de validacion fallo.

Validacion minima:

```text
customer resuelto
+
orderReference entregada por la persona
+
order.customer_id === customer.id
```

La validacion habilita unicamente la orden confirmada.

No habilita acceso general al historial ni a otras ordenes.

## 9. Respuesta ante fallo de validacion

Debe utilizarse una respuesta neutral equivalente a:

> No pude validar la informacion con los datos entregados. Revisa el correo y la nota de venta o solicita atencion de un operador.

No indicar:

- que el email si existe;
- que la nota pertenece a otra cuenta;
- que uno de los datos era correcto;
- informacion de customers candidatos.

Despues de tres intentos fallidos consecutivos:

```text
temporarily_blocked
-> handoff o espera definida por politica
```

## 10. Customer 360

Customer 360 no resuelve identidad.

Solo puede consumirse despues de obtener un `customerId` valido.

El contexto disponible debe depender del proposito.

### Consulta publica

No se carga Customer 360 privado.

### Relacion comercial nueva

Puede utilizarse contexto comercial minimo cuando la identidad ya esta resuelta.

### Pedido, reclamo o garantia

Solo se utiliza informacion correspondiente a la entidad validada.

No se debe inyectar el snapshot completo al modelo si la operacion no lo necesita.

## 11. Estado persistente de onboarding

Debe existir un estado persistente equivalente a:

```ts
interface CustomerOnboardingState {
  conversationId: string;
  opportunityId: string | null;

  status:
    | "not_required"
    | "required"
    | "collecting"
    | "resolving"
    | "completed"
    | "conflict"
    | "temporarily_blocked"
    | "temporarily_unavailable";

  purpose:
    | "quote"
    | "purchase"
    | "order_inquiry"
    | "complaint"
    | "warranty"
    | "return"
    | "account_update";

  collected: {
    firstName?: string;
    lastName?: string;
    email?: string;
    orderReference?: string;
  };

  pendingFields: string[];
  customerId: string | null;
  failedVerificationAttempts: number;
  updatedAt: string;
}
```

El estado no puede depender exclusivamente del prompt o del historial textual.

## 12. Privacidad

El bot nunca debe revelar antes de validar:

- cantidad de ordenes;
- referencias;
- direcciones;
- email registrado;
- productos comprados;
- importes;
- informacion de otros customers;
- candidatos encontrados durante la resolucion.

Los errores deben ser neutrales y no permitir enumeracion.

## 13. Fallos tecnicos

Distinguir:

```text
no_match
service_unavailable
conflict
invalid_input
temporarily_blocked
```

Una falla tecnica nunca se convierte en:

```text
cliente nuevo
```

## 14. Invariantes

```text
las consultas publicas no requieren onboarding
la intencion comercial activa identificacion progresiva
las operaciones historicas requieren customer existente
la referencia de orden siempre la entrega la persona
el bot nunca enumera entidades privadas
resolve_customer nunca crea customers
resolve_customer nunca vincula identidades
link_external_identity requiere consentimiento
ningun conflicto se resuelve mediante LLM
ninguna coincidencia se decide por nombre
una falla tecnica no crea customers
una orden validada habilita solo esa orden
Customer 360 no es Customer Master
```

## 15. Definition of Done de ACS-R1-04

1. Una persona consulta catalogo sin onboarding.
2. Una intencion de cotizacion activa onboarding.
3. Un cliente existente se resuelve sin duplicarse.
4. Un cliente nuevo se crea solo por una relacion comercial nueva.
5. WhatsApp no se vincula silenciosamente.
6. El onboarding continua entre mensajes.
7. Una consulta de pedido exige una referencia entregada por el usuario.
8. La orden debe pertenecer al customer resuelto.
9. El bot no enumera ordenes ni filtra datos privados.
10. Una validacion habilita solo la entidad confirmada.
11. Los conflictos no se resuelven heuristicamente.
12. Una caida de servicio no crea customers.
13. Las operaciones sensibles escalan o requieren verificacion reforzada.
14. Las decisiones, ejecuciones y outcomes quedan auditados.
15. Customer 360 se consume solo dentro del alcance autorizado.

## Notes

- Este contrato define identidad y onboarding provisionales. No reemplaza un futuro `customer_master`; ver [persistence-architecture-decision](./persistence-architecture-decision.md) y ADR-008 para la frontera de Customer 360.
- `Customer360Snapshot` (ver [customer-360-contract](./customer-360-contract.md)) solo se consume una vez que `CustomerSessionIdentityStatus` es `identified`.
- La implementacion de `resolve_customer`, `create_customer` y `link_external_identity` se aborda en tareas posteriores de ACS-R1-04 (T02-T04), no en este contrato.
- `ACS-R1-04-T08.1` (v1.1.0): un `customerId` que llega desde Customer Service (seccion 5, resolucion externa) nunca se trata como `identified` hasta que ACS verifica que corresponde a una fila real en la proyeccion local `master_customer` - ver [customer-creation-linking-authority-contract](./customer-creation-linking-authority-contract.md) seccion 1.1 para el detalle del gate (`customerMasterId`, `CustomerMasterProjectionReader`). Mientras la proyeccion no exista, la identidad permanece `temporarily_unavailable` (nunca `identified` con un id no verificado) - esto no cambia el orden de resolucion de la seccion 5 ni introduce una quinta fuente.
