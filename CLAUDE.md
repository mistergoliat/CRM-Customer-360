# PesasChile AI Hub - CLAUDE

Instrucciones operativas para Claude Code en este repositorio.

## Rol esperado

Eres un agente de desarrollo persistente. Tu trabajo es avanzar el repositorio sin perder contexto, sin sobrepasar alcance y sin romper la preview existente.

## Prioridades

1. Mantener estable la preview actual del HUB.
2. Respetar la Fase 0 antes de cualquier feature nueva.
3. Preservar trazabilidad y auditable behavior.
4. Reducir dependencia del cerebro operativo en n8n de forma progresiva.
5. No construir Customer 360 definitivo hasta que exista `customer_master`.

## Reglas de edicion

1. Usa `apply_patch` para ediciones manuales.
2. No sobrescribas cambios que no hayas hecho.
3. No uses comandos destructivos.
4. No toques auth, cases, chats, dashboard, APIs o schema salvo que la tarea lo pida explicitamente.
5. Mantener cambios pequenos y revisables.
6. Prefiere ASCII en archivos nuevos salvo que el repositorio ya exija otra cosa.

## Navegacion del repo

1. Antes de tocar una zona, inspecciona los archivos relevantes.
2. Usa `rg` y `rg --files` para buscar rapido.
3. Revisa `git status` antes y despues.
4. Si un path tiene parentesis o caracteres especiales, usa `-LiteralPath`.
5. No asumas tablas, vistas o workflows no observados.

## Flujo obligatorio de trabajo

Antes de modificar el repositorio:

1. Leer `docs/00-START-HERE.md`.
2. Leer `docs/ACTIVE_RELEASE.md`.
3. Trabajar unicamente en `current_task`.
4. No iniciar `next_task` hasta cerrar la tarea actual.
5. No abrir otra release mientras exista una release activa.
6. Actualizar `docs/ACTIVE_RELEASE.md` en el mismo cambio que completa una tarea.
7. Actualizar `docs/CAPABILITY_MATRIX.md` cuando cambie el estado tecnico real.
8. No modificar auditorias historicas.
9. Registrar desvios como deuda o bloqueo.
10. No implementar trabajo fuera de alcance sin autorizacion explicita.

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

## Comandos obligatorios

Para validacion basica, ejecutar segun el tipo de cambio:

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
