# PesasChile AI Hub - CLAUDE

Instrucciones operativas para Claude Code en este repositorio.

## Autoridad

`AGENTS.md` es la autoridad canonica. Este archivo solo agrega instrucciones especificas para Claude Code y no duplica reglas generales.

## Rol esperado

Eres un agente de desarrollo persistente. Tu trabajo es avanzar el repositorio sin perder contexto, sin sobrepasar alcance y sin romper la preview existente.

## Orden de lectura

Sigue la jerarquia condicional de `AGENTS.md` ("Jerarquia canonica"): siempre `AGENTS.md` + `docs/PRODUCT_NORTH_STAR.md` + `docs/ACTIVE_RELEASE.md`; el resto (release spec, ROADMAP, ADR, contratos, CAPABILITY_MATRIX, MVP_EXECUTION_MAP, PRD) solo cuando la tarea lo requiera. No la vuelvas a duplicar aqui - si `AGENTS.md` cambia, este archivo no debe quedar desincronizado.

## Reglas especificas

1. Mantener estable la preview actual del HUB.
2. Respetar la Fase 0 antes de cualquier feature nueva.
3. Preservar trazabilidad y comportamiento auditable.
4. Reducir dependencia del cerebro operativo en n8n de forma progresiva.
5. No construir Customer 360 definitivo hasta que exista `customer_master`.
6. No tocar auth, cases, chats, dashboard, APIs o schema salvo que la tarea lo pida explicitamente.
7. Mantener cambios pequenos y revisables.
8. Prefiere ASCII en archivos nuevos salvo que el repositorio ya exija otra cosa.

## Navegacion del repo

1. Antes de tocar una zona, inspecciona los archivos relevantes.
2. Usa `rg` y `rg --files` para buscar rapido.
3. Revisa `git status` antes y despues.
4. Si un path tiene parentesis o caracteres especiales, usa `-LiteralPath`.
5. No asumas tablas, vistas o workflows no observados.

## Flujo obligatorio de trabajo

1. Leer la jerarquia canonica en el orden establecido por `AGENTS.md`.
2. Trabajar unicamente en la tarea activa, salvo autorizacion explicita para una tarea documental transversal.
3. No iniciar la siguiente tarea de producto hasta cerrar la tarea actual.
4. No abrir otra release mientras exista una release activa.
5. Actualizar `docs/ACTIVE_RELEASE.md` en el mismo cambio que completa una tarea.
6. Actualizar `docs/CAPABILITY_MATRIX.md` cuando cambie el estado tecnico real.
7. No modificar auditorias historicas.
8. Registrar desvios como deuda o bloqueo.
9. No implementar trabajo fuera de alcance sin autorizacion explicita.

## Modo de trabajo

1. Empieza por entender el estado actual.
2. Si la tarea es documental, no expandas a refactors funcionales.
3. Si la tarea es funcional, implementa el minimo necesario para cumplirla.
4. No cambies el alcance a mitad de trabajo sin justificarlo.
5. Si detectas deuda tecnica, registrala y sigue con el objetivo principal.

## n8n

1. Tratar n8n como capa transitoria de integracion y orquestacion.
2. No mover toda la logica de golpe.
3. No usar n8n como repositorio final de reglas de negocio.
4. Migrar primero decisiones core, estados y persistencia auditable.
5. Dejar n8n para conectores, ingestiones y jobs temporales.

## Customer 360 provisional

1. No construir la version definitiva mientras no exista `customer_master`.
2. Usar solo identidad provisional por `wa_id`, `phone_number_id`, `id_customer`, `id_order`, `invoice_number`, `email` o `contact_id` si existen.
3. No inventar un `customer_key` final.
4. Preparar los cambios para una futura migracion.

## Comandos de validacion

Ejecutar segun el tipo de cambio:

```powershell
npm run build
npm run typecheck
```

Si el lint ya fue migrado a ESLint CLI, ejecutarlo tambien. Si el script sigue dependiendo de `next lint`, no bloquearte en el prompt: reporta la deuda tecnica.

## Estilo de implementacion

1. Contratos explicitos.
2. Logs en acciones relevantes.
3. DTOs estructurados para outputs IA.
4. Menos magia, mas trazabilidad.
5. No duplicar paneles o vistas si existe una fuente clara.

## Politica de alcance

1. No agregues features adjuntas que no sean necesarias para la tarea.
2. No construyas infraestructura futura por anticipado si no habilita el siguiente paso inmediato.
3. No conviertas una mejora local en una remodelacion total.
4. Si necesitas mas contexto, leelo en los docs de fase antes de editar.

## Criterio de salida

Antes de cerrar una tarea, deja claro:

1. Que archivos cambiaste.
2. Que validaste.
3. Si la entrega fue solo documental o funcional.
4. Si hay riesgos o deuda tecnica pendiente.
