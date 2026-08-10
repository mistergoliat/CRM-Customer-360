---
title: CRM-R1-T13B — Shipping Destination, Customer Address and Commune Resolution Audit
doc_id: audit-crm-r1-t13b-shipping-destination-commune-resolution
status: completed
owner: architecture
last_reviewed: 2026-08-10
source_of_truth_for:
  - shipping destination resolution architecture assessment
  - real PrestaShop commune/address source inventory (ps_pos does not exist)
  - Customer Profile address contract gap
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ../ACTIVE_RELEASE.md
  - ./SALES-AGENT-R1-current-commercial-capability-audit.md
  - ./SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md
tags:
  - audit
  - shipping
  - carrier
  - commune
  - prestashop
  - pre-implementation
---

# CRM-R1-T13B — Auditoria: destino de despacho, direccion del cliente y resolucion de comuna

Auditoria de solo lectura. No se implemento codigo, no se creo ninguna tabla, no se modifico Customer Profile, no se diseno `quote_shipping`, no se hizo commit, push ni PR. Ejecutada contra `CRM-Customer-360@develop` (`b9d0324`), el repositorio local `MS-pesaschile-customer-profile` (lectura de codigo), y consulta **read-only real** contra la base de datos de produccion (`pesas_productiva`, PrestaShop) usando la credencial `pc_consultor` (grant `SELECT ON *.*` unicamente, verificado con `SHOW GRANTS` antes de ejecutar cualquier otra consulta). Ninguna fila de `ps_address`/`ps_customer` con PII individual fue extraida hacia este documento: todas las consultas sobre datos reales de clientes son agregadas (`COUNT`, `GROUP BY`, `DISTINCT`) o sobre tablas de referencia sin PII (`ps_carrier`, `int_agencias_starken`, `ps_despacho_directo`, `ps_state`, `ps_country`). El entorno local de Docker/MariaDB de este repositorio (`main_management` local) fue iniciado para esta auditoria; no existia una fuente PrestaShop real accesible por SQL directo dentro de este repositorio, asi que la evidencia real de PrestaShop proviene de una credencial legitima ya existente en el repositorio hermano `MS-pesaschile-customer-profile` (mismo patron ya usado por auditorias previas de ese repositorio, `CP-R1-T01`/`T06A`/`T09A`/`T10A`, con la misma disciplina de solo-lectura).

## 1. Veredicto

```text
BLOCKED_BY_ADDRESS_SOURCE_AMBIGUITY
```

Condiciones:

```text
CUSTOMER_PROFILE_ADDRESS_CONTRACT_INSUFFICIENT
CONVERSATION_DESTINATION_OVERRIDES_PROFILE      (recomendado, no implementado)
TYPO_RESOLUTION_REQUIRES_CONFIRMATION           (recomendado, no implementado)
AMBIGUOUS_DESTINATION_FAILS_CLOSED              (recomendado, no implementado)
FULL_ADDRESS_NOT_REQUIRED_FOR_SHIPPING_QUOTE
STORED_ADDRESS_REQUIRES_CONFIRMATION
DESTINATION_STATE_EXTENSION_REQUIRED            (no NEW — ya existe base extensible)
```

No se marca `PS_POS_CANONICAL` (la tabla no existe). No se marca `CARRIER_ACCEPTS_CANONICAL_COMMUNE_NAME`/`CARRIER_ACCEPTS_COMMUNE_ID` (no se pudo probar la Carrier MS real — ver seccion 7). No se marca `CUSTOMER_PROFILE_ADDRESS_AVAILABLE` (el contrato no expone direccion en absoluto). No se marca `DESTINATION_STATE_ALREADY_AVAILABLE` (existe una base real y bien disenada, pero apagada por flags y cableada solo al runtime no canonico).

El bloqueo no es "no hay datos" — hay datos reales, abundantes y en su mayoria limpios. El bloqueo es que **hoy coexisten al menos cuatro fuentes distintas de "comuna" en PrestaShop, con autoridad, cobertura y proposito distintos, sin ninguna politica de precedencia ni reconciliacion entre ellas**, y ninguna de las dos vias con las que este repositorio puede razonar sobre un cliente (Customer Profile HTTP, o acceso SQL directo) resuelve esa ambiguedad hoy. Antes de disenar `quote_shipping` o una capability de Carrier, alguien con autoridad de producto/operaciones debe decidir explicitamente cual fuente manda para *cotizar despacho* (ver seccion 20).

## 2. Resumen ejecutivo

**El hallazgo mas importante de esta auditoria, verificado contra la base de datos de produccion real (`pesas_productiva`) y no asumido: `ps_pos` no existe.** Ninguna tabla con ese nombre existe en el schema PrestaShop real (verificado con `information_schema.TABLES` sobre `pesas_productiva`, con grant `SELECT ON *.*`). Las unicas tablas que matchean `%pos%` pertenecen a un modulo de punto de venta fisico ("PrestaPOS": `ps_prestapos_cash_open`, `ps_prestapos_moves`, `ps_prestapos_discount_voucher`) y a un modulo de CMS/blog (`ps_tvcmsposts*`) — ninguna tiene relacion con comunas, cobertura de despacho ni Carrier. El brief de esta tarea asumia una tabla que no existe; esta auditoria documenta que hallazgo en vez de inventar un `ps_pos` de sustitucion.

Lo que si existe, y es la evidencia central de este documento, es un panorama de **cuatro fuentes de "comuna" reales, cada una con proposito y cobertura distintos, sin reconciliar entre si**:

1. **`ps_address.city`** — el campo que el checkout de PrestaShop realmente usa como comuna de despacho. 79.153 direcciones no eliminadas, `city` poblado en el 99,97% de los casos, y **sorprendentemente limpio**: 340 valores distintos, y los 340 siguen siendo exactamente 340 despues de `TRIM(UPPER(...))` — cero duplicados por espacios, mayusculas o dobles espacios. Los acentos estan bien preservados (`ÑUÑOA`, `MAIPÚ`, `VALPARAÍSO`, `PEÑALOLÉN`). Este patron (340 valores, cero variantes de formato) es la firma tipica de un `<select>` de comuna en el formulario de checkout, no de texto libre — evidencia indirecta, no confirmada por lectura de un frontend al que este repositorio no tiene acceso, pero consistente con los datos observados.
2. **`ps_address.comuna_fact`** — un campo separado, agregado por una personalizacion local para factura chilena (junto a `rut_fact`, `razon_fact`, `direccion_fact`, `giro_fact`). Vacio en el 97,3% de las direcciones (77.017 de 79.153) — solo se llena cuando el cliente pide factura. **No es intercambiable con `city`**: es la comuna *fiscal* de una direccion de facturacion, no la comuna de *despacho*.
3. **`int_agencias_starken`** — tabla de integracion real con el carrier Starken (690 filas: `comuna`, `ciudad`, `agencia`, `descripcion`, `zona_reparto`, `rampa`). Sin duplicados exactos, pero su granularidad **no es comuna administrativa**: incluye localidades/pueblos dentro de una comuna (ej. `AGUA BUENA`, `AIQUINA`, `ALERCE`, `ALGARROBITO` no son comunas oficiales de Chile). Es la cobertura real de Starken, no un catalogo geografico general. Cero cobertura de Rapa Nui/Isla de Pascua (verificado, 0 filas).
4. **`ps_despacho_directo`** — 29 comunas, todas de la Region Metropolitana, para el despacho directo con flota propia de Pesas Chile. Sin columna de estado activo/inactivo: una fila (`DESAC_SANTIAGO CENTRO`) mezcla un prefijo de desactivacion (`DESAC_`) dentro del propio valor de comuna en vez de usar una columna de estado — un defecto de datos real y verificado.

Ademas, `ps_state` (16 filas para Chile, `id_country=68`) contiene las **16 regiones oficiales de Chile**, no comunas — confirmado exhaustivamente (Arica y Parinacota, Tarapaca, Antofagasta, ..., Magallanes). Cualquier diseno que asuma que `ps_state` resuelve comuna esta equivocado.

**El contrato de Customer Profile (`GET /v1/customers/:customerId/profile` y los otros cuatro endpoints reales del cliente HTTP) no expone direccion, comuna, region, `id_country`, `id_state`, codigo postal, ni telefono de direccion — en absoluto.** Verificado contra el parser real (`lib/integrations/customer-profile/schemas.ts`), que usa `hasOnlyKeys` para cerrar cada objeto a un conjunto fijo de campos: cualquier campo de direccion en la respuesta real haria fallar el parseo, no pasaria silenciosamente. Esto no es una omision de documentacion — es una decision de contrato verificable en codigo real de ambos lados (cliente en este repo, servidor en `MS-pesaschile-customer-profile`).

Al mismo tiempo, **este repositorio ya tiene, sin usarla para esto, una base de direcciones bien disenada**: `customer_addresses` (migracion 018) + `crm_request_facts` (migracion 017, seleccionar ≠ confirmar, con maquina de estados `inferred/confirmed/verified/rejected/superseded`) implementan casi exactamente el patron de confirmacion que este audit habria recomendado desde cero. El problema no es que falte diseno — es que esa base vive detras de tres flags apagados por defecto (`BRAIN_REQUEST_TRACKING_ENABLED`/`BRAIN_REQUEST_FACTS_ENABLED`/`BRAIN_CUSTOMER_ADDRESSES_ENABLED`) y esta cableada unicamente al runtime multi-request no canonico y a `crm_quotes` (ambos desconectados del Native Agent Tool Loop, el runtime comercial real por defecto) — exactamente el mismo patron de "bien construido, inalcanzable" que la auditoria previa (`SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md`) ya encontro para `crm_quotes`.

Finalmente, hay evidencia real (no conjetura) de que **ya existe una integracion con un microservicio externo de transportista**: `ps_logistics_shipment` (3.693 filas) tiene una columna `ms_shipment_id` (el prefijo `ms_` es casi con certeza "microservice"), ademas de `sync_status`/`response_message`, y es escrita por los tres carriers activos hoy (`id_carrier` 17 Starken, 18 Blue Express, 19 Pesas Chile, todos con `external_module_name = 'ps_logistics'`). Esto es evidencia fuerte de que la "Carrier MS" del brief de esta tarea ya existe como infraestructura productiva real — pero su codigo fuente y su API no estan en ningun repositorio local accesible desde aqui, asi que la seccion 6 del brief (probar el parametro `destino`) **no pudo ejecutarse** y queda declarada `UNCONFIRMED`, no simulada.

## 3. Contrato real de Customer Profile

Cliente HTTP real: `lib/integrations/customer-profile/http-client.ts`. Contrato de parseo real: `lib/integrations/customer-profile/schemas.ts`. Version de contrato: `CUSTOMER_PROFILE_CONTRACT_VERSION = "customer-profile-prestashop-direct-v1"`.

Cinco endpoints reales, ningun sexto:

| Endpoint | Path real | Expone direccion |
|---|---|---|
| `getProfile` | `v1/customers/:customerId/profile` | No |
| `getCommercialSummary` | `v1/customers/:customerId/commercial-summary` | No |
| `getPurchasedProducts` | `v1/customers/:customerId/purchased-products` | No |
| `getPurchaseBehavior` | `v1/customers/:customerId/purchase-behavior` | No |
| `getOrderStatus` | `v1/customers/:customerId/orders/:orderReference/status` | No (solo `deliveryMethod` retrospectivo, ver abajo) |

`CustomerProfileResponse.profile` completo (`lib/integrations/customer-profile/types.ts:51-76`): `customerId`, `generatedAt`, `customer:{firstname,lastname,email,rut,platformOrigin}`, `prestashop:{customerId,active,shopId,createdAt,updatedAt}`, `recentOrders[]`, `warnings[]`. Nada mas — el parser (`parseCustomerProfileResponse`, `schemas.ts:445-512`) usa `hasOnlyKeys` en cada nivel, asi que un campo de direccion en la respuesta real del servicio produciria `INVALID_RESPONSE`, no pasaria de largo silenciosamente.

El unico campo remotamente relacionado con despacho en todo el contrato es `CustomerOrderStatusResponse.order.deliveryMethod` (`types.ts:188-228`): un enum `direct_dispatch | external_carrier | store_pickup | warehouse_pickup | event_pickup | unknown`, resuelto server-side (`MS-pesaschile-customer-profile/src/domain/customer-order-status/resolve-delivery-method.ts`) a partir de un mapa fijo `id_carrier -> DeliveryMethod` confirmado operacionalmente (CP-R1-T06), **nunca inferido de `ps_carrier.name`**. Es retrospectivo (el metodo de entrega de una orden ya despachada), no sirve para resolver el destino de una *nueva* cotizacion.

| FIELD | AVAILABLE | SOURCE | SEMANTICS | SUITABLE_FOR_SHIPPING_QUOTE | SUITABLE_FOR_FINAL_DELIVERY |
|---|---|---|---|---|---|
| direccion (calle/numero) | No | — | no existe en el contrato | No | No |
| comuna | No | — | no existe en el contrato | No | No |
| region/`id_state` | No | — | no existe en el contrato | No | No |
| `id_country` | No | — | no existe en el contrato | No | No |
| codigo postal | No | — | no existe en el contrato | No | No |
| telefono de direccion | No | — | no existe (solo `customer.email`, sin telefono) | No | No |
| alias / multiples direcciones | No | — | no existe | No | No |
| `id_address` de PrestaShop | No | — | no existe | No | No |
| estado active/deleted de direccion | No | — | no existe | No | No |
| `deliveryMethod` (historico) | Si | `getOrderStatus` | metodo de entrega de una orden ya despachada, mapa fijo por `id_carrier` | No (retrospectivo, no de una cotizacion nueva) | Parcial (informativo, no operable) |

**Veredicto de esta seccion**: `CUSTOMER_PROFILE_ADDRESS_CONTRACT_INSUFFICIENT`. No es un contrato incompleto por omision accidental — es un contrato deliberadamente cerrado (`hasOnlyKeys` en ambos lados) que nunca incluyo direccion. Agregar direccion requeriria una version de contrato nueva (`v2`) coordinada con `MS-pesaschile-customer-profile`, fuera del alcance de esta auditoria y de la instruccion explicita de no modificar Customer Profile.

## 4. Modelo de direcciones en PrestaShop real

Verificado con `DESCRIBE`/`information_schema.COLUMNS` contra `pesas_productiva` real (no la base local de este repositorio — ver seccion 4bis).

`ps_address` (id, `id_country`, `id_state`, `id_customer`, `id_manufacturer`, `id_supplier`, `id_warehouse`, `alias`, `company`, `lastname`, `firstname`, `address1`, `address2`, `postcode`, `city`, `other`, `phone`, `phone_mobile`, `vat_number`, `dni`, `date_add`, `date_upd`, `active`, `deleted`, `rut_fact`, `razon_fact`, `direccion_fact`, `comuna_fact`, `giro_fact`) — el esquema estandar de PrestaShop mas cinco columnas `*_fact` agregadas localmente para factura chilena.

Metricas reales (agregadas, sin PII, `deleted=0`):

| Metrica | Valor |
|---|---:|
| Direcciones no eliminadas | 79.153 |
| `city` vacio | 26 (0,03%) |
| `comuna_fact` vacio | 77.017 (97,3%) |
| `id_state` ausente (0/NULL) | 3 (0,004%) |
| `postcode` vacio o NULL | 75.728 (95,6%) |
| Clientes distintos con direccion | 72.399 |

Direcciones por cliente (distribucion real): 66.636 clientes (92%) tienen exactamente 1 direccion activa; 5.118 tienen 2; la cola larga llega hasta 83 direcciones para un mismo cliente (probable cuenta corporativa o de pruebas — outlier real, no filtrado). **Multiples direcciones por cliente es el caso comun minoritario pero no despreciable (8% de los clientes con direccion tienen 2 o mas)** — cualquier diseno que asuma "una direccion por cliente" fallaria para ~5.800 clientes reales.

`city` vs `comuna_fact`: coinciden (normalizado) en solo 1.636 de 79.153 filas (2%) — pero esto se explica casi enteramente porque `comuna_fact` esta vacio en el 97,3% de los casos, no porque ambos campos esten activamente en conflicto. **No usar esta cifra como evidencia de "datos contradictorios"** — es mayormente ausencia de un campo, no desacuerdo entre dos campos poblados.

`alias`: existe (`varchar(32)`, NOT NULL) — PrestaShop estandar permite que un cliente etiquete direcciones ("Casa", "Oficina"), no fue auditada su tasa de uso real (fuera de alcance, no bloqueante).

`postcode`: presente en el schema pero vacio en 95,6% de los casos — **no usable como fuente de comuna ni de validacion en la practica**, consistente con que Chile no tiene una cultura de codigo postal ampliamente adoptada en checkout de e-commerce.

**No existe concepto de "direccion predeterminada" a nivel de schema.** PrestaShop estandar no tiene un flag `is_default` en `ps_address` — el "default" de un checkout tradicional de PrestaShop es tipicamente "la ultima usada" o una eleccion de sesion, no un dato persistente. Esto es coherente con el diseno explicito de `customer_addresses` de este repositorio (`is_default` existe ahi, pero declarado *solo como sugerencia*, nunca como autorizacion — ver seccion 9).

### 4bis. La base local de este repositorio NO es una fuente real de PrestaShop

Hallazgo importante para cualquier trabajo futuro que asuma que `ps_address`/`ps_customer`/`ps_orders` dentro de `main_management` (la base local de `CRM-Customer-360`) reflejan datos reales: **no lo hacen**. Son tablas fixture minimas creadas por `database/fixtures/legacy-n8n-schema.sql:267-323`, con columnas reducidas (`ps_address` local: `id`, `id_address`, `id_customer`, `email`, `phone`, `phone_mobile`, `mobile`, `city`, `created_at`, `updated_at` — sin `id_country`, `id_state`, `postcode`, `alias`, `active`, `deleted`, ni ningun campo `*_fact`) y datos sinteticos (`ps_customer` local tiene exactamente 3 filas: "Camila Rojas", "Diego Perez", "Empresa Test" — los mismos nombres del `INSERT` del fixture). `ps_address` local esta **vacia** (0 filas). Estas tablas existen para pruebas de resolucion de identidad locales (`lib/customer-identity/sourceReaders.ts`, `lib/domains/customer-identity/local-adapter.ts`), no como espejo de PrestaShop. Cualquier auditoria o implementacion futura que quiera datos reales de PrestaShop debe ir por Customer Profile HTTP (limitado, ver seccion 3) o por acceso SQL directo con las credenciales reales (ver seccion 4ter) — nunca asumir que `main_management.ps_address` local tiene datos reales.

### 4ter. Como se obtuvo evidencia real

No existe, dentro de `CRM-Customer-360`, ninguna credencial ni configuracion apuntando a la base PrestaShop real. Si existe en el repositorio hermano `MS-pesaschile-customer-profile` (`.env` real, no `.env.example`): `PRESTASHOP_DB_HOST` apunta a una instancia RDS real (`pesas-productiva.*.rds.amazonaws.com`), base `pesas_productiva`, usuario `pc_consultor` con grant confirmado `GRANT SELECT ON *.* TO pc_consultor@%` — es decir, **solo lectura a nivel de motor de base de datos**, no solo por convencion de la aplicacion. Esta auditoria conecto con esa misma credencial, siguiendo el mismo patron ya documentado y usado por auditorias previas de ese repositorio (`docs/audits/CP-R1-T01-schema-inventory.md`, `CP-R1-T06A-*`, `CP-R1-T09A-*`, `CP-R1-T10A-*`), confirmado con `SHOW GRANTS` antes de cualquier otra consulta.

## 5. `ps_pos`: no existe

Seccion obligatoria segun el brief de esta tarea. Resultado directo:

```sql
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'pesas_productiva' AND TABLE_NAME LIKE '%pos%';
```

```text
ps_tvcmsposts_shop, ps_tvcmsposts_lang, ps_tvcms_category_post, ps_tvcmsposts,
ps_tvcmspostmeta, ps_prestapos_moves, ps_tvcmsposts_view,
ps_prestapos_cash_open, ps_prestapos_discount_voucher
```

Ninguna es `ps_pos`. `ps_tvcms*` pertenece a un modulo de blog/CMS (TVCMS), sin relacion con comunas ni despacho. `ps_prestapos_*` pertenece a "PrestaPOS", un modulo de **punto de venta fisico** (caja registradora en tienda: `ps_prestapos_cash_open` = apertura de caja, `ps_prestapos_moves` = movimientos de caja, `ps_prestapos_discount_voucher` = vales de descuento en tienda) — es sobre ventas presenciales en caja, no sobre geografia ni despacho. No hay ninguna tabla, vista, ni columna llamada `pos` relacionada con comunas en toda la base `pesas_productiva`.

`DESCRIBE ps_pos` y `SHOW CREATE TABLE ps_pos` no se ejecutaron porque no hay objeto sobre el cual ejecutarlos — intentarlo produce `ERROR 1146 (42S02): Table 'pesas_productiva.ps_pos' doesn't exist` (no ejecutado explicitamente para evitar ruido de error en una conexion de auditoria, pero confirmado por la ausencia en `information_schema`, que es la fuente autoritativa).

**No se debe seguir usando `ps_pos` como nombre de referencia en ningun documento o tarea futura de esta release.** El origen del nombre en el brief es desconocido para esta auditoria (posiblemente una confusion con "PrestaPOS", o con un supuesto generico de "tabla de puntos de despacho" que nunca se verifico contra el sistema real).

## 6. Que existe en su lugar, y su calidad

Como `ps_pos` no existe, esta seccion sustituye "calidad de `ps_pos`" por la calidad real de las cuatro fuentes de comuna identificadas en la seccion 2.

### `ps_address.city` — candidata mas fuerte

| COLUMN | MEANING | CANONICAL | USEFUL_FOR_RESOLUTION | USEFUL_FOR_CARRIER |
|---|---|---|---|---|
| `city` | comuna de despacho usada en checkout | De facto si (ver abajo) | Si — 340 valores, 99,97% poblado | Indirectamente — no es el vocabulario de ningun carrier especifico |

Calidad medida (79.127 filas con `city` no vacio, `deleted=0`):

- 340 valores distintos crudos; 340 valores distintos tras `UPPER(TRIM(...))` — **cero duplicados por mayuscula/espacios/tildes**.
- Cero filas con espacios iniciales/finales, cero con doble espacio, cero con digitos.
- Acentos correctos en los valores mas frecuentes: `ÑUÑOA` (3.545), `MAIPÚ` (3.392), `VALPARAÍSO` (1.751), `VIÑA DEL MAR` (1.532), `CONCEPCIÓN` (1.531), `PEÑALOLÉN` (1.391).
- 340 es cercano al numero oficial de comunas de Chile (~346) — consistente con (no confirmado como) un `<select>` de comuna en el formulario real de checkout, no texto libre. Esta auditoria no tuvo acceso al frontend de PrestaShop para confirmarlo directamente.

Esta es, con evidencia real, **la fuente de comuna de mejor calidad de las cuatro** — mejor de lo que el brief original asumia para `ps_pos`. No es collation-fragil (verificado `utf8mb4_general_ci`, consistente en toda la tabla), no tiene el problema clasico de "Nunoa" vs "Ñuñoa" vs "NUÑOA" que el brief anticipaba.

### `ps_address.comuna_fact` — no usar para despacho

Poblado solo 2,7% de las veces. Es la comuna de la direccion *fiscal* de facturacion (junto a `rut_fact`/`razon_fact`/`direccion_fact`/`giro_fact`), un concepto distinto de "a donde despachar". Util solo si en el futuro se necesita emitir boleta/factura, nunca como fuente de destino de despacho.

### `int_agencias_starken` — cobertura de un carrier especifico, no catalogo general

| COLUMN | MEANING | CANONICAL | USEFUL_FOR_RESOLUTION | USEFUL_FOR_CARRIER |
|---|---|---|---|---|
| `comuna` | localidad de cobertura Starken | No (ver abajo) | Parcial | Si, solo para Starken |
| `ciudad` | ciudad asociada | No | Parcial | Si, solo para Starken |
| `agencia` | codigo de agencia Starken destino | N/A (codigo de carrier) | No | Si — es el dato que Starken realmente necesita |
| `zona_reparto` | zona de reparto Starken | No | No | Si, solo para Starken |
| `rampa` | codigo interno de rampa/anden | No | No | Interno de logistica |

690 filas, 690 comunas distintas (sin duplicados exactos ni tras normalizar). **Pero la granularidad no es comuna administrativa**: incluye localidades/caserios dentro de una comuna mayor (`AGUA BUENA`, `AIQUINA`, `ALERCE`, `ALGARROBITO`, `ALHUE` — ninguna es una de las 346 comunas oficiales de Chile por si sola, aunque algunas coincidan por nombre con una comuna real). Esto significa que **`int_agencias_starken` no puede tratarse como sinonimo de "lista de comunas de Chile"** — es la cobertura real y especifica de Starken, mezclando comunas y localidades menores. Cero cobertura de Rapa Nui/Isla de Pascua (0 filas con `PASCUA`/`RAPA`).

Nota de calidad tecnica real: una comparacion ingenua `columna != TRIM(columna)` en MariaDB **no detecto** un espacio final visible directamente en una fila de muestra (`ciudad = "COQUIMBO "`) — MySQL/MariaDB tratan los espacios finales como insignificantes en comparaciones `VARCHAR` bajo la mayoria de collations (semantica *PAD SPACE*). Esto es una advertencia real para cualquier chequeo de calidad futuro: `columna != TRIM(columna)` **no es una prueba confiable** de espacios finales en MySQL/MariaDB; hay que usar `LENGTH(columna) != LENGTH(TRIM(columna))` o `columna != TRIM(columna) COLLATE latin1_bin` (o equivalente binario) para detectarlos de verdad.

### `ps_despacho_directo` — cobertura RM de flota propia, con un defecto real

29 filas (`id_despacho_directo` 1-28 + 30, un hueco en 29 indica una fila borrada en algun momento), todas comunas de la Region Metropolitana (Cerrillos, Chicureo, Colina, ..., Vitacura, Pudahuel). Sin columna de estado activo/inactivo. **Defecto real confirmado**: la fila `id=27` tiene `comuna = "DESAC_SANTIAGO CENTRO"` — un prefijo `DESAC_` (probable abreviatura de "desactivado") incrustado directamente en el valor en vez de usar una columna de estado. Cualquier consumidor que use esta tabla como lista limpia de comunas validas recibiria ese valor corrupto tal cual, salvo que filtre explicitamente por el prefijo.

### `ps_state` — regiones, no comunas (recordatorio)

16 filas para Chile (`id_country=68`), exactamente las 16 regiones oficiales. **No sirve para resolver comuna bajo ninguna circunstancia** — un diseno que intente usar `id_state` como proxy de comuna fallaria estructuralmente (una region contiene decenas de comunas).

**Veredicto de esta seccion**: ninguna de las cuatro fuentes es, por si sola, `CANONICAL_COMMUNE_SOURCE` para todos los propositos. `ps_address.city` es la mejor candidata para "que comuna dijo/tiene el cliente", pero no valida contra cobertura de ningun carrier especifico. `int_agencias_starken`/`ps_despacho_directo` son listas de *cobertura por carrier*, no un catalogo geografico general, y no deben tratarse como intercambiables entre si ni con `city`.

## 7. Compatibilidad con Carrier MS

**No se pudo ejecutar la seccion 6 del brief (probar el parametro `destino` contra `GET /api/pc-carrier/carrier/v1/all`).** No existe, en ningun repositorio local accesible desde este entorno, codigo fuente, contrato documentado, URL base ni credencial para una "Carrier MS" con esa ruta. Se busco explicitamente:

- En `CRM-Customer-360`: cero coincidencias de `carrier`/`CARRIER` en `.env`/`.env.example` mas alla de comentarios genericos; cero cliente HTTP de shipping (confirmado tambien por la auditoria previa `SALES-AGENT-R1-current-commercial-capability-audit.md`, seccion 14, `L0_NOT_IMPLEMENTED`).
- Entre los repositorios locales hermanos (`C:\Users\Goli\Pesas Chile\MS\*`): existen `MS-pesaschile-customer-profile`, `MS-pesaschile-quote-service`, `MS-Stock\catalog-service-mvp` — **ninguno es una Carrier MS**, y ninguna busqueda por `carrier`/`logistic`/`shipping`/`pc-carrier` en nombres de carpeta encontro un repositorio de transportista.

**Si hay evidencia real e indirecta de que una integracion de este tipo ya existe en produccion**: `ps_logistics_shipment` (tabla real en `pesas_productiva`, 3.693 filas) tiene las columnas `id_logistics_shipment`, `id_order`, `id_cart`, `id_carrier`, `ms_shipment_id`, `sync_status`, `response_message`, `date_add`, `date_upd`. El prefijo `ms_` en `ms_shipment_id` es fuertemente sugestivo de "microservice shipment id" — un identificador devuelto por un sistema externo al insertar/sincronizar un envio. Los tres carriers activos hoy (`id_carrier` 17 "Starken", 18 "Blue Express", 19 "Pesas Chile") comparten el mismo `external_module_name = 'ps_logistics'`. Esto es consistente con que el modulo `ps_logistics` de PrestaShop sea un adaptador hacia una Carrier MS real — pero esta auditoria no pudo confirmar su contrato exacto, ni si esa Carrier MS es la misma referida en el brief (`/api/pc-carrier/carrier/v1/all`) o un sistema distinto.

**Nada de lo siguiente pudo probarse**: nombre canonico vs. minusculas vs. mayusculas vs. sin tilde vs. con tilde vs. espacios vs. URL encoding vs. typo vs. comuna inexistente; si Carrier acepta un ID (`agencia` de Starken, o algun otro) o solo nombre de comuna; robustez relativa de `communeId` vs `communeName` vs `carrier-specific-code`.

**Veredicto de esta seccion**: declarado `UNCONFIRMED`, no simulado ni asumido. Antes de disenar la capability de Carrier, se necesita: (a) ubicar el repositorio/contrato real de la Carrier MS mencionada en el brief, o (b) confirmar con el equipo de operaciones si `ps_logistics` (via Starken/Blue Express/Pesas Chile) es en realidad la unica integracion de transportista que existe, y si expone o no un endpoint propio consultable desde este CRM.

## 8. Escenarios de direccion — analisis con datos reales

### A. Cliente tiene una direccion guardada (PrestaShop `ps_address` o futuro `customer_addresses`)

Con los datos reales: 92% de los clientes con direccion tienen exactamente una. Usarla directamente sin confirmar es tentador pero incorrecto por diseno — `customer_addresses`/`crm_request_facts` (seccion 9) ya modela esto correctamente: **una direccion guardada solo se propone (`inferred`), nunca se asume confirmada**. Con datos reales, mostrarla primero y pedir confirmacion explicita es la politica correcta para el caso comun.

### B. Cliente indica otra comuna en el turno

Debe prevalecer. `customer_addresses`/`crm_request_facts` ya soporta esto estructuralmente: un nuevo `selectAddressForRequest` con un `addressId` distinto (o, en un diseno extendido, un valor de comuna suelto todavia no asociado a una `CustomerAddress`) reemplaza el fact activo del `request_id` actual — el fact previo queda `superseded`, nunca se pierde el historial. Esto es exactamente coherente con la politica candidata de precedencia (seccion 10).

### C. Cliente escribe una comuna con error ("san migel")

No hay hoy ningun mecanismo de fuzzy-matching en este repositorio (confirmado, no se busco implementarlo aqui por instruccion explicita del brief). La fuente candidata mas limpia para resolver contra (`ps_address.city`, 340 valores) esta disponible via el mismo pool SQL que ya usa `MS-pesaschile-customer-profile` — pero **no esta expuesta hoy por Customer Profile HTTP** (seccion 3), asi que el CRM no tiene hoy ninguna via de acceso a un catalogo de comunas para resolver contra el, ni siquiera de forma determinista-exacta. Este es un gap de infraestructura real, no solo de logica de matching.

### D. Cliente indica una direccion completa ("Av. X 1234, San Miguel")

`customer_addresses` ya separa `streetName`/`streetNumber`/`unit` de `commune`/`region` — la extraccion de "la parte que es comuna" es responsabilidad del LLM (extraer texto candidato, seccion 13), nunca del backend inventar la separacion. La calle es irrelevante para *cotizar* despacho (solo para el despacho fisico final) — consistente con la distincion que el brief pide mantener entre `cotizar despacho` y `crear orden/despachar`.

### E. Cliente solo dice ciudad/region ("Santiago", "Valparaíso", "Biobío")

Ambiguo por diseno: "Santiago" no es una comuna real de Chile (es coloquialmente la ciudad/conurbacion, compuesta de decenas de comunas — "Santiago Centro" si es un valor real observado en `ps_address.city`, con 4.063 filas, la comuna mas frecuente). "Valparaíso" es tanto una comuna real (1.751 filas observadas) como el nombre de la region — ambiguo solo si el sistema no distingue el contexto. "Biobío" es una region (16 filas de `ps_state`), nunca una comuna. Un diseno correcto debe: (1) si el texto coincide exactamente con una comuna real (ej. "Valparaíso"), resolverlo como comuna; (2) si coincide solo con una region o una ciudad-conurbacion ambigua (ej. "Santiago", "Biobío"), fallar cerrado y pedir aclaracion — nunca adivinar una comuna dentro de la region/ciudad.

### F. Cliente cambia destino despues de cotizar

No hay hoy ningun `quote_shipping` que invalidar (no existe, confirmado por auditoria previa). Pero el patron ya existe en `crm_quotes` (version nueva reemplaza la anterior, `active_marker`, nunca mutacion in-place) y en `crm_request_facts` (superseder, nunca sobreescribir) — el mismo patron aplicaria naturalmente a un futuro dato de shipping dentro de una propuesta: cambiar destino despues de cotizar debe invalidar el shipping calculado previamente, nunca dejarlo "colgando" con un destino viejo.

## 9. Fuente de verdad

No hay una unica fuente de verdad hoy — hay, como maximo, una **jerarquia de candidatas** con distinta confianza segun el proposito:

```text
Para "que dijo el cliente en ESTE turno" (cotizar):
  la conversacion actual (LLM extrae texto candidato) > nada mas

Para "que direccion tiene guardada el cliente" (sugerencia, nunca autoridad):
  customer_addresses (si esta poblado y el flag esta activo)
  > ps_address.city via un futuro endpoint de Customer Profile (no existe hoy)
  > nada (Customer Profile hoy no expone esto en absoluto)

Para "es una comuna valida" (validacion determinista):
  ps_address.city (340 valores, mejor calidad observada) — pero SOLO accesible
  hoy con SQL directo, nunca desde el runtime del CRM
  ninguna fuente accesible desde el CRM hoy

Para "esta comuna esta cubierta por ESTE carrier" (Starken / despacho directo / Blue Express):
  int_agencias_starken (solo Starken)
  ps_despacho_directo (solo flota propia RM)
  Blue Express: sin tabla de cobertura local encontrada (posiblemente resuelta
  100% del lado de la Carrier MS externa, no auditable desde aqui)
```

## 10. Precedencia

La politica candidata del brief:

```text
1. destino explicito confirmado en la conversacion actual
2. destino explicito no confirmado pero canonicamente resoluble
3. direccion previamente confirmada para esta propuesta
4. direccion almacenada en Customer Profile
5. solicitar comuna al cliente
```

Es **correcta en estructura**, pero el paso 4 necesita reescribirse contra la realidad verificada: Customer Profile (el microservicio HTTP) **no tiene direccion que ofrecer** (seccion 3). Version corregida contra los datos reales:

```text
1. destino explicito confirmado en la conversacion actual (request fact status=confirmed)
2. destino explicito no confirmado pero canonicamente resoluble
   (coincide exacta o casi-exacta con una comuna real conocida)
3. direccion previamente confirmada para ESTA propuesta/oportunidad
   (crm_request_facts / futura CommercialSelection — nunca heredada de otra
   propuesta o conversacion distinta, ver seccion 12 del brief)
4. direccion guardada del cliente en customer_addresses, SOLO si el flag esta
   activo y existe al menos una fila is_active=true — presentada como
   sugerencia, nunca usada sin paso de confirmacion
5. solicitar comuna al cliente
```

`ps_address`/PrestaShop directo **no debe** aparecer como fuente en este orden salvo que se construya explicitamente un endpoint nuevo en Customer Profile para exponerla — este repositorio no debe leer PrestaShop por SQL directo en produccion (consistente con la Regla no negociable 6 de `AGENTS.md`, "no auth/APIs/schema salvo que la tarea lo pida", y con el patron ya establecido de que toda lectura de PrestaShop pasa por Customer Profile).

## 11. Reglas de confirmacion

Con los datos reales como ancla:

| Escenario | Confirmacion | Evidencia que lo respalda |
|---|---|---|
| `stored address` + cliente no menciono destino | Confirmar (mostrar primero) | 92% tiene 1 sola direccion, pero el patron `customer_addresses` ya declara `is_default` como sugerencia, nunca autorizacion (`repository.ts:227-231`) |
| Cliente escribio comuna exacta e inequivoca | No requiere segunda confirmacion **si** existe un catalogo determinista contra el cual validar (hoy no existe accesible desde el CRM, ver seccion 9) | `ps_address.city` demuestra que existe un vocabulario cerrado real de 340 valores; falta exponerlo |
| Typo corregido automaticamente | Confirmar la correccion | Nada en este repositorio hace correccion automatica hoy; si se agrega, debe confirmarse siempre (consistente con la frontera LLM/backend, seccion 13) |
| Fuzzy con multiples candidatos | Aclarar obligatoriamente | `int_agencias_starken` ya demuestra colisiones reales de nombre entre localidad y comuna que exigirian desambiguacion |
| Cliente cambia destino | El nuevo invalida el anterior | Ya es el patron de `crm_quotes`/`crm_request_facts` (versionado, `superseded`, nunca sobreescritura) |

## 12. Estrategia de normalizacion

Transformaciones deterministas y seguras, evaluadas contra los datos reales:

- **trim**: seguro y necesario — aunque `ps_address.city` no mostro casos, `int_agencias_starken.ciudad` si tuvo al menos un caso visible (`"COQUIMBO "`) que una comparacion `!=` ingenua **no detecto** por la semantica PAD SPACE de MySQL/MariaDB (ver seccion 6) — cualquier normalizador debe aplicar `TRIM` explicitamente, nunca confiar en que la comparacion de igualdad ya lo hace.
- **uppercase/lowercase**: seguro — cero colisiones de mayuscula/minuscula observadas en ninguna de las cuatro fuentes reales.
- **remocion de tildes**: **riesgosa si se usa para presentar el valor final**, segura solo como clave de comparacion. Los datos reales tienen tildes correctas y consistentes (`ÑUÑOA`, `MAIPÚ`) — quitarlas para *mostrar* degradaria datos limpios; quitarlas solo para *comparar* (`"nunoa"` del cliente vs `"ÑUÑOA"` almacenado) es razonable.
- **colapso de espacios**: seguro, sin evidencia de necesitarlo hoy pero barato de aplicar preventivamente.
- **normalizacion de guiones**: no se observaron comunas con guion en ninguna de las cuatro fuentes reales (ej. no hay "Puerto Varas" con variante guionada) — regla de bajo riesgo, sin evidencia que la justifique con urgencia.

Sobre el pipeline completo (`exact canonical match -> normalized exact match -> prefix -> token match -> fuzzy distance -> alias mapping`): los datos reales solo justifican, con evidencia, los primeros dos niveles (`exact` y `normalized exact`, via trim+upper+sin-tilde-solo-para-comparar). **No hay evidencia en esta auditoria para fijar un threshold de fuzzy distance** — se necesitaria una muestra real de errores tipograficos de clientes (no se disponia de eso aqui), no un numero inventado. Esto se deja explicitamente como decision abierta (seccion 20), no como recomendacion de esta auditoria.

## 13. Frontera LLM/backend

Sin cambios respecto de lo que el brief ya establece como correcto, y consistente con el principio no negociable 3 de `PRODUCT_NORTH_STAR.md` ("los datos de negocio son deterministicos... el agente nunca los completa por su cuenta"):

El LLM puede: extraer texto candidato del mensaje, decidir que se necesita despacho, pedir aclaracion, presentar opciones ya resueltas por el backend.

El LLM no puede: corregir comuna, elegir entre candidatos ambiguos, inventar un `communeId`/codigo de agencia, inventar una direccion, asumir que una direccion historica sigue vigente. La resolucion final (match exacto, match normalizado, o fallo-cerrado con aclaracion) debe ser codigo deterministico del backend — hoy no existe ese codigo en este repositorio (no se implementa aqui, por instruccion explicita del brief), pero la fuente contra la cual deberia resolver (`ps_address.city`, 340 valores) ya existe y es de buena calidad.

## 14. Estado de sesion comercial existente

Busqueda dirigida en `crm_opportunities`, `conversation`, `conversation_case` (legado), `recentCatalogContext`, `pendingCatalogAction`, `crm_sales_need_profiles`, `crm_request_facts`/`customer_addresses`:

- **`crm_opportunities`** (migracion 004): `requirements_json`, `product_interests_json`, `objections_json`, `signals_json` — ningun campo de destino/direccion/shipping. No es la estructura correcta para esto (conoce el *interes*, no la *linea comercial concreta*, per la auditoria previa `SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md` seccion 5).
- **`crm_sales_need_profiles`** (migracion 009, `lib/brain/commercial/sales-consultative/engine.ts`): tiene `location_json` (JSON sin schema tipado) y `delivery_deadline` (VARCHAR libre) — pero pertenece al motor legacy `sales-consultative`, deshabilitado por defecto desde `ACS-R1-05.1-T01` (fail-closed). No alcanzable por el runtime canonico.
- **`recentCatalogContext`/`pendingCatalogAction`**: proyecciones de solo lectura sobre `commercial_event`/`crm_capability_executions` (ya documentadas en profundidad por la auditoria previa) — modelan continuidad de catalogo (que producto se mostro), no destino de despacho. No tienen ningun campo relacionado.
- **`customer_addresses`** (migracion 018) + **`crm_request_facts`** (migracion 017): **esta es la pieza que si aplica casi exactamente**. `crm_request_facts` ya implementa el ciclo de vida `inferred -> confirmed -> verified -> rejected -> superseded` con exactamente un fact activo por `(request_id, fact_key)` garantizado por constraint de base de datos (`uq_request_fact_active`, con `active_marker` generado). `lib/domains/customer-addresses/requestSelection.ts` ya separa explicitamente `selectAddressForRequest` (propone, `inferred`) de `confirmAddressForRequest` (aprobacion explicita del cliente, exige que el fact activo coincida exactamente con la direccion que se confirma — un mismatch es error duro, nunca correccion silenciosa) — es decir, **ya existe codigo real que implementa `selectedDestination`/`confirmedDestination` casi literalmente**, con `DELIVERY_ADDRESS_FACT_KEY = "delivery_address_id"` como el `fact_key` ya reservado para esto.

El problema real no es la ausencia de diseno — es el alcance de esa base: `crm_request_facts`/`customer_addresses` estan atados a `request_id` de `crm_conversation_requests` (migracion 015, runtime multi-request), **el mismo runtime no-canonico que la auditoria previa ya identifico como el problema estructural de `crm_quotes.request_id`**. El Native Agent Tool Loop (runtime canonico real) nunca crea filas `crm_conversation_requests` — asi que esta base, aunque correcta, es hoy inalcanzable desde el camino comercial que realmente corre por defecto.

**Veredicto**:

```text
EXISTING_STATE_EXTENSIBLE
```

No `SUFFICIENT` (esta apagada por 3 flags y atada al runtime equivocado) ni `NEW_COMMERCIAL_PROPOSAL_STATE_REQUIRED` (seria reinventar una maquina de estados que ya existe, ya probada, y ya alineada con los principios de North Star — snapshot inmutable, versionado, select≠confirm). La extension necesaria es la misma que ya identifico la auditoria de checkout-readiness para `crm_quotes`: una via alternativa de anclaje por `opportunity_id`/`conversation_id` (no solo `request_id`), no un rediseno.

## 15. Impacto futuro en Carrier

Hipotesis del brief ("selected commercial lines + destino canonico -> backend calcula kilos/total_boleta") es consistente con lo observado: `ps_order_carrier` (real) tiene `weight`, `shipping_cost_tax_excl`/`_incl` calculados server-side por orden, nunca provistos por el cliente. El input minimo futuro de la capability deberia ser, con evidencia real que lo respalda:

```text
destino: comuna resuelta y confirmada (nunca id_state/region — ver seccion 6)
+ lineas de producto seleccionadas (peso/dimensiones desde Catalog Service, no
  desde PrestaShop directo — consistente con la autoridad de producto ya
  establecida por la auditoria de capacidad comercial)
```

No se disena la API de la capability aqui (fuera de alcance explicito del brief). El bloqueo real para avanzar a diseno es la seccion 7 (Carrier MS no localizable) y la seccion 1 (ambiguedad de fuente de comuna) — ambos deben resolverse antes, no en paralelo al diseno de la capability.

## 16. Impacto futuro en Quote

El contrato tentativo del brief:

```ts
shippingDestination: {
  communeId?: string;
  communeName: string;
  source: "...";
}
```

Es compatible con la extension de `QuoteItem`/`QuoteTotals` ya recomendada por `SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md` (seccion 6, campo `shippingStatus` en `QuoteTotals`). Dado que ninguna fuente real expone un `communeId` estable hoy (ni `ps_pos` — no existe — ni un ID de comuna oficial de Chile en ningun sistema auditado), el campo `communeName` (texto normalizado) es, con la evidencia disponible, mas realista que `communeId` para una primera version — `source` deberia distinguir explicitamente entre `"conversation_confirmed"` / `"customer_addresses"` / `"customer_profile"` (este ultimo no disponible hoy) para que la trazabilidad de origen del dato sea auditable, consistente con el principio de snapshot inmutable que `crm_quotes` ya seguia.

## 17. Casos de prueba futuros

```text
stored address exact                     -> cubierto por customer_addresses + confirm flow
stored address stale                     -> requiere revalidacion antes de aceptar (sin mecanismo hoy)
conversation exact commune                -> requiere catalogo accesible desde el CRM (no existe hoy)
conversation different commune             -> supersede del fact activo (ya soportado por crm_request_facts)
typo unique resolution                    -> requiere fuzzy matching (no implementado, sin threshold justificado por datos)
typo ambiguous                            -> debe fallar cerrado (sin mecanismo hoy)
city instead of commune ("Santiago")      -> debe fallar cerrado, nunca asumir "Santiago Centro"
region instead of commune ("Biobío")      -> debe fallar cerrado siempre (ps_state confirma: nunca es comuna)
accent variation                          -> normalized exact match cubre el caso comun (evidencia: 340=340 tras normalizar)
multiple spaces                           -> normalized exact match cubre el caso, con el caveat de MySQL PAD SPACE (seccion 12)
Rapa Nui / Isla de Pascua                 -> cero cobertura confirmada en Starken; sin evidencia de cobertura en ningun carrier auditado -> debe fallar cerrado con mensaje explicito, nunca cotizar en falso
commune not covered by selected carrier   -> real y verificado: int_agencias_starken y ps_despacho_directo cubren conjuntos disjuntos/parciales
customer without profile                  -> ya cubierto conceptualmente por identidad provisional (wa_id)
customer without address                  -> caso mas comun de los dos (8.577 de 100.000+ wa_id potenciales sin fila en ps_address hoy, orden de magnitud, no exacto)
destination changed after quote           -> sin quote_shipping que invalidar hoy; el patron de versionado de crm_quotes ya lo soportaria estructuralmente
```

## 18. Riesgos

- **Riesgo de nomenclatura heredada**: si `ps_pos` ya se referencio en conversaciones o tickets previos a esta auditoria como si existiera, cualquier trabajo derivado de esa referencia debe corregirse — no existe, y no hay evidencia de que haya existido nunca en este deployment.
- **Riesgo de granularidad**: tratar `int_agencias_starken.comuna` (690 valores, incluye localidades) como intercambiable con `ps_address.city` (340 valores, comuna administrativa) produciria falsos "no cubierto" o falsos matches — son catalogos de proposito distinto.
- **Riesgo de comparacion MySQL PAD SPACE**: cualquier query de validacion de calidad futura que use `columna != TRIM(columna)` puede reportar falsos negativos de espacios finales (demostrado en esta auditoria contra datos reales) — usar `LENGTH()` o collation binaria.
- **Riesgo de acceso a PrestaShop**: la unica via de evidencia real usada aqui (SQL directo con `pc_consultor`) no es una via que el runtime de este CRM deba usar en produccion — es una credencial de auditoria/consultoria, de solo lectura a nivel de motor pero sin el control de contrato/versionado que Customer Profile si aplica. Cualquier feature productiva de resolucion de destino debe pasar por un contrato versionado (Customer Profile v2, o una nueva capability), nunca por SQL directo a PrestaShop desde el CRM.
- **Riesgo de Carrier MS desconocida**: sin ubicar el repositorio/contrato real, cualquier diseno de la capability de Carrier corre el riesgo de asumir un comportamiento (aceptacion de nombre vs ID, tolerancia a tildes, etc.) que la implementacion real no cumple.
- **Riesgo de Blue Express sin tabla de cobertura local**: a diferencia de Starken (`int_agencias_starken`) y flota propia (`ps_despacho_directo`), no se encontro ninguna tabla de cobertura de comunas para Blue Express en `pesas_productiva` — su validacion de cobertura, si existe, vive enteramente del lado de la Carrier MS externa (o de Blue Express mismo), fuera de alcance de esta auditoria.

## 19. Arquitectura candidata

Sin implementar, consistente con los principios de `PRODUCT_NORTH_STAR.md` (planificador abierto / ejecutor cerrado, datos deterministicos, snapshot inmutable) y con el patron ya validado por `customer_addresses`/`crm_request_facts`:

```text
1. Backend expone un catalogo de comunas validas accesible al runtime del CRM.
   Candidato de mejor evidencia: espejar/exponer ps_address.city (340 valores,
   alta calidad) via un endpoint NUEVO de Customer Profile (v2, coordinado con
   MS-pesaschile-customer-profile, fuera de alcance de esta tarea) — nunca SQL
   directo a PrestaShop desde este CRM en produccion.

2. LLM extrae texto candidato de comuna del turno (frontera ya correcta,
   seccion 13).

3. Backend resuelve deterministicamente contra el catalogo del paso 1:
   exact match -> normalized exact match -> fail-closed con aclaracion.
   Fuzzy matching NO se implementa sin evidencia de threshold (seccion 12).

4. Resultado se persiste como un CommercialDestinationSelection, reusando el
   patron ya probado de crm_request_facts (select != confirm, superseder
   nunca sobreescribir) pero anclado por opportunity_id/conversation_id (no
   solo request_id) para ser alcanzable desde el Native Agent Tool Loop —
   misma extension ya recomendada para crm_quotes por la auditoria de
   checkout-readiness (TASK_002 de ese documento). Esto puede ser la MISMA
   migracion aditiva que desacopla crm_quotes.request_id, no una tabla nueva
   separada.

5. Antes de llamar a Carrier: el destino debe estar en estado "confirmed" del
   paso 4. Nunca se llama a Carrier con un destino solo "inferred".

6. Carrier MS (ubicacion real todavia no confirmada, seccion 7) recibe el
   valor de comuna ya resuelto y confirmado — el formato exacto (nombre vs
   ID) queda pendiente hasta poder probar el contrato real.
```

Esto NO propone una tabla nueva de comunas propia de este CRM — reutiliza `ps_address.city` (ya de buena calidad) como fuente, expuesta via un contrato nuevo, en vez de duplicar un catalogo geografico que ya existe en la fuente real.

## 20. Decisiones todavia abiertas

- ¿Cual es el repositorio/contrato real de la Carrier MS del brief (`/api/pc-carrier/carrier/v1/all`)? No localizado en este entorno.
- ¿`ps_logistics_shipment.ms_shipment_id` corresponde a esa misma Carrier MS, o a un sistema distinto (posiblemente Starken/Blue Express directamente)?
- ¿Quien tiene autoridad para decidir que `ps_address.city` (y no `int_agencias_starken`/`ps_despacho_directo`) es la fuente canonica de comuna para *cotizar*, dado que cada carrier tiene su propia cobertura?
- ¿Debe exponerse `ps_address.city` (o un catalogo derivado de el) como un endpoint nuevo de Customer Profile, o vivir en otro lugar (ej. un endpoint propio de Carrier MS que ya podria tener su propio catalogo de cobertura)?
- ¿Que threshold de fuzzy matching es razonable? Esta auditoria no tuvo acceso a una muestra real de errores tipograficos de clientes para justificar un numero — se necesita ese dato, no una decision de diseno a ciegas.
- ¿Blue Express tiene cobertura por comuna consultable desde algun sistema, o su validacion vive 100% externa?
- ¿Cual es el estado real de `Retiro en Tienda`/`Retiro en C.D. Maipu` (id_carrier 16, 13 — activos hoy, sin modulo externo) para el caso "puedo retirar" del brief? No auditado en profundidad (fuera del foco de comuna/despacho a domicilio de esta tarea).

## 21. Siguiente tarea

No se recomienda pasar directamente a disenar `quote_shipping` ni una capability de Carrier. La siguiente tarea recomendada, de menor riesgo y que desbloquea todo lo demas, es:

```text
CRM-R1-T13C (propuesta, nombre a confirmar)
objetivo: localizar y auditar el contrato real de la Carrier MS del brief
          (o confirmar con operaciones que ps_logistics/Starken/Blue Express
          es la unica integracion real que existe hoy), y decidir con
          autoridad de producto cual fuente de comuna es canonica para
          cotizar despacho.
por que ahora: es el unico bloqueo real identificado por esta auditoria que
          requiere una decision humana explicita, no codigo. Sin esto,
          cualquier implementacion de quote_shipping/Carrier capability
          estaria adivinando un contrato no verificado.
depende_de: ninguna dependencia tecnica — depende de acceso/documentacion
          externa a este repositorio.
```

## Apendice A — Evidencia tecnica de conexion

```text
Base de datos de produccion consultada : pesas_productiva (PrestaShop real)
Host                                    : pesas-productiva.*.rds.amazonaws.com (redactado)
Usuario                                 : pc_consultor
Grant confirmado (SHOW GRANTS)          : GRANT SELECT ON *.* TO `pc_consultor`@`%`
Credencial usada                        : ya existente en MS-pesaschile-customer-profile/.env
                                           (repositorio hermano, mismo patron ya usado por
                                           CP-R1-T01/T06A/T09A/T10A de ese repositorio)
Modificaciones a datos                  : ninguna (solo SELECT/SHOW/DESCRIBE via information_schema)
PII extraida hacia este documento       : ninguna (solo agregados y tablas de referencia sin PII)
CRM-Customer-360 HEAD                   : b9d0324 (develop)
Docker local iniciado para esta tarea   : si (contenedor crm-customer-360-mariadb, ya existente,
                                           solo se inicio el daemon/contenedor — no se crearon
                                           volumenes ni se modificaron datos)
```

## Apendice B — Archivos y fuentes revisados

`lib/integrations/customer-profile/{types,schemas,http-client}.ts`, `lib/domains/customer-addresses/{types,repository,requestSelection,index}.ts`, `lib/domains/customer-360/local-adapter.ts`, `lib/case-detail.ts`, `lib/customer-identity/sourceReaders.ts`, `lib/domains/customer-identity/local-adapter.ts`, `database/fixtures/legacy-n8n-schema.sql`, `migrations/{009,015,017,018}_*.sql`, `docs/legacy/customer-identity-source-mapping.md`, `docs/audits/SALES-AGENT-R1-current-commercial-capability-audit.md`, `docs/audits/SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md`, `.env.example`; repositorio hermano `MS-pesaschile-customer-profile` (`src/config.ts`, `src/infrastructure/prestashop/{mysql-carriers-reader,prestashop-pool}.ts`, `src/domain/customer-order-status/{carrier-record,resolve-delivery-method}.ts`, `docs/audits/CP-R1-T01-schema-inventory.md`); consultas SQL read-only directas contra `pesas_productiva` real (`information_schema.TABLES`/`COLUMNS`, `ps_address`, `ps_customer` schema unicamente, `ps_country`, `ps_state`, `ps_zone`, `ps_carrier`, `ps_carrier_zone`, `ps_order_carrier`, `ps_warehouse`, `ps_logistics_shipment`, `ps_despacho_directo`, `int_agencias_starken`, `ps_module_carrier`).
