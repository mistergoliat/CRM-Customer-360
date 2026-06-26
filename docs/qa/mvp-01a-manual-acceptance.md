# MVP-01A Manual Acceptance

## Prerrequisitos

- Aplicacion levantada en local o staging.
- Webhook de Meta apuntando al endpoint del entorno.
- Base MariaDB del entorno vacia o con datos de prueba conocidos.
- Secreto de firma configurado fuera del repositorio.

## URL del HUB

- `http://localhost:3000/conversations`

## Numero de prueba

- Usar el `wa_id` de prueba aprobado por QA para el entorno.
- Si se valida en local, usar el numero de prueba generado por la automatizacion para ese run.

## Mensaje exacto

- Primer mensaje: `Hola, necesito una cotizacion.`
- Segundo mensaje: `Sigo interesado, mandame mas detalles.`

## Como validar la conversacion

1. Abrir `http://localhost:3000/conversations`.
2. Buscar el `wa_id` o el nombre verificado del contacto.
3. Abrir la conversacion.
4. Confirmar que el ultimo mensaje visible coincide exactamente con el texto enviado.
5. Confirmar que el canal sea WhatsApp.
6. Confirmar que exista timestamp para el ultimo mensaje.
7. Confirmar que el estado basico y la resolucion de identidad sean coherentes.

## Como validar reutilizacion

1. Enviar el segundo mensaje desde el mismo `wa_id`.
2. Volver a la lista o refrescar la pagina.
3. Verificar que la misma conversacion sigue siendo la visible.
4. Abrir el detalle y confirmar que aparecen ambos mensajes una sola vez.
5. Confirmar que el ultimo mensaje ahora sea el segundo texto.

## Como detectar duplicados

- En la lista, el `wa_id` debe aparecer una sola vez.
- En el detalle, cada texto debe aparecer una sola vez.
- Si un `providerMessageId` se reenvia, la conversacion no debe duplicarse.
- Si hay duplicados, revisar la base con `conversation_message` y `commercial_event` para confirmar la incidencia.

## Campos a comprobar

- Cliente verificado, cuando exista.
- `wa_id`.
- Canal WhatsApp.
- Ultimo mensaje.
- Timestamp del ultimo mensaje.
- Estado basico.
- Indicador de conflicto, si existe.

## Resultado que indica fallo

- La lista muestra `Sin conversaciones` despues de un inbound valido.
- El detalle no muestra el texto exacto enviado.
- Aparecen dos conversaciones para el mismo `wa_id`.
- Aparecen dos mensajes logicos para el mismo `providerMessageId`.
- La UI muestra error cuando deberia mostrar datos.

## Como registrar el defecto

- Guardar captura de pantalla de la lista y del detalle.
- Anotar `wa_id`, `providerMessageId`, hora del envio y URL del HUB.
- Registrar si el fallo ocurrio en lista, detalle, webhook o persistencia.
- Incluir la secuencia exacta de mensajes enviada y el resultado esperado vs. real.
