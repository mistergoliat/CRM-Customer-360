# MVP Roadmap

Este roadmap refleja la direccion actual del producto despues del cierre de P1K.

## Secuencia actual

1. `P1K` quedo `ACCEPTED AND CLOSED`.
2. `P1L` se enfoca en `Production Foundation`.
3. `P1M` se enfoca en `CRM Product Experience`.
4. `P2` sigue como `AI Marketing`.
5. `P3` sigue como `Voice/Call Tool`.

## Definicion de fase

| Phase | Focus | Result |
|---|---|---|
| `P1K` | Brain MVP and Demonstration | Brain comercial demostrable, gobernado y simulado. |
| `P1L` | Production Foundation | Persistencia real, scheduler, outbox, transport y reconciliacion. |
| `P1M` | CRM Product Experience | CRM visual, read-only-first, discovery de gaps y contratos faltantes. |
| `P2` | AI Marketing | Propuestas y drafts de marketing con approval. |
| `P3` | Voice/Call Tool | Capacidad de voz aislada por riesgo y gobernanza. |

## P1L

P1L concentra la base de produccion:

- adapters PostgreSQL/Supabase;
- persistencia real del Brain;
- scheduler real;
- outbox worker productivo;
- transporte HTTP real;
- delivery reconciliation;
- pilot controlado.

P1L no debe convertirse en una nueva capa de discovery visual. Su foco es operacion y durabilidad.

## P1M

P1M es la fase activa de experiencia de producto.

La estrategia es:

`UI-first -> read models -> identification of gaps -> missing contracts -> later logic and persistence`

P1M puede construir superficies visuales antes de que toda la persistencia o integracion este terminada, siempre que:

- la superficie sea read-only;
- los mocks y fixtures esten identificados;
- la degradacion sea segura;
- lo provisional no se presente como real;
- la UI no habilite side effects;
- Customer Candidate no se presente como Customer Master;
- Case y Work Queue no se conviertan en el centro del dominio.

P1M debe usar la UI para descubrir:

- datos faltantes;
- contratos de lectura faltantes;
- estados ambiguos;
- acciones requeridas;
- dependencias entre modulos;
- necesidades de integracion;
- gaps de logica comercial y operacional.

## Navigation target for P1M

La navegacion inicial que P1M debe validar es:

1. Inicio
2. Clientes
3. Conversaciones
4. Oportunidades
5. Casos
6. Acciones
7. Campanas
8. Analitica
9. Configuracion

Campanas y Analitica productiva siguen fuera de alcance inmediato. La navegacion es una hipotesis de arquitectura de informacion que debe ser validada por la experiencia visual.

## Why this split

- P1K ya provee el brain demostrable.
- P1L asegura la foundation de produccion.
- P1M usa la interfaz para descubrir y fijar el CRM real.
- La UI es ahora una herramienta de modelado del producto, no solo el ultimo paso de implementacion.
