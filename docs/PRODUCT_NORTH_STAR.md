---
title: PRODUCT_NORTH_STAR
doc_id: product-north-star
status: canonical
version: "1.0.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - condensed product vision
  - AI Sales Agent definition
  - target agentic model
  - anti-pattern list
  - alignment criterion
depends_on:
  - ../AGENTS.md
  - ./product/autonomous-commerce-prd.md
supersedes: []
tags:
  - product
  - north-star
  - canonical
---

# PRODUCT_NORTH_STAR

Version condensada y estable de la vision de producto. Este documento no duplica el PRD: lo resume para que sea lectura obligatoria en cada tarea, sin cargar el contexto completo. El detalle extendido, los ADR y las release specs siguen siendo la fuente normativa cuando se necesita profundidad.

Si un diseno, contrato o linea de codigo contradice lo que dice este documento, el diseno esta desalineado - sin importar que tan reciente sea, que tan bien escrito este, o que estado formal (`approved`, `accepted`) declare en su frontmatter. Un documento puede tener autoridad formal y estar equivocado en la practica; ese es exactamente el problema que motivo la existencia de este archivo.

## Proposito

CRM Customer 360 construye un AI Sales Agent: un vendedor autonomo que opera primero por WhatsApp, y despues por otros canales, administrando oportunidades comerciales de principio a fin - descubrimiento, recomendacion, manejo de objeciones, seguimiento, cierre o escalamiento.

No es un chatbot de respuestas. No es un clasificador de mensajes. No es un conjunto de flujos por departamento. Es un agente que decide, dentro de limites gobernados por la plataforma, que hacer a continuacion para avanzar cada oportunidad, y que sigue decidiendo, turno tras turno, hasta que la oportunidad se gana, se pierde, se pausa o se transfiere a un humano.

## Definicion de AI Sales Agent

El AI Sales Agent es el componente que decide que hacer para avanzar una venta. Razona sobre contexto conversacional, evidencia comercial, estado de la oportunidad y estrategia, y propone la siguiente accion.

No es:

- un clasificador de intencion con una respuesta fija por categoria de mensaje;
- un arbol de decision codificado a mano por palabra clave o por departamento;
- un conjunto de bots separados por vertical de negocio (ventas, SAC, postventa, marketing), cada uno con su propio prompt y su propio alcance fijo;
- un generador de un unico JSON de decision completo por turno de conversacion.

Es un agente que itera dentro de un mismo turno cuantas veces haga falta: percibe, decide una accion pequena, la ejecuta a traves de una herramienta gobernada, observa el resultado, y decide de nuevo antes de responder al cliente. La conversacion es la interfaz; el agente que razona detras de ella es el producto.

## Responsabilidad del agente

El agente:

- interpreta lenguaje, ambiguedad y contexto conversacional;
- comprende senales comerciales (interes, objecion, urgencia, presupuesto, rechazo);
- decide la siguiente mejor accion, una a la vez, no un plan de conversacion completo de antemano;
- solicita herramientas (capabilities) para obtener datos verificables o producir efectos - nunca inventa esos datos;
- explica su razonamiento: que evidencia uso, que alternativas considero, con que confianza;
- replantea su estrategia cuando una capability no esta disponible, una politica bloquea la propuesta, o el contexto cambia.

El agente no es fuente de verdad del negocio. No decide permisos. No ejecuta efectos directamente sobre el mundo real (no escribe en la base de datos, no llama a Meta, no confirma un descuento). Propone; la plataforma valida y ejecuta.

## Responsabilidad de la plataforma

La plataforma:

- define que puede ejecutar el agente, bajo que limites, con que evidencia y con que autorizacion - via Capability Gateway, policy y execution gate;
- valida cada propuesta del agente antes de aceptarla como decision comercial real (propuesta de IA y decision aceptada son cosas distintas, con trazabilidad separada);
- persiste el estado comercial durable - oportunidad, perfil de necesidad, objeciones, decisiones, acciones - como la memoria real del sistema; el modelo de IA nunca es la memoria principal;
- garantiza idempotencia, auditoria, aislamiento del piloto controlado, y control explicito sobre cuando un envio es real;
- exige aprobacion humana para efectos sensibles: descuentos, cambios de precio, devoluciones, cancelacion de pedidos, garantias.

La plataforma gobierna el limite de lo posible: que herramientas existen, que tan disponibles estan, que politica aplica, que requiere aprobacion. No decide en reemplazo del agente que hacer dentro de ese limite. Un backend que calcula la estrategia comercial y usa al modelo solo para redactar el texto final ya dejo de ser esta arquitectura.

## Ciclo agentico objetivo

```text
percibir
-> comprender
-> actualizar estado
-> definir objetivo
-> decidir siguiente accion
-> validar autoridad
-> ejecutar herramienta
-> observar resultado
-> decidir nuevamente
-> responder, continuar, esperar, hacer seguimiento o escalar
```

Cada etapa tiene un dueno claro:

- **percibir / comprender**: el agente interpreta el evento entrante y el contexto acumulado.
- **actualizar estado**: la plataforma persiste lo que cambio (necesidad, objecion, producto considerado) en la memoria comercial durable, no en el contexto efimero del modelo.
- **definir objetivo / decidir siguiente accion**: el agente propone, con razonamiento explicito.
- **validar autoridad**: la plataforma comprueba si esa accion esta permitida, con que evidencia, y si requiere aprobacion humana - sin que el agente pueda saltarse este paso ni autorizarse a si mismo.
- **ejecutar herramienta**: solo una accion aceptada produce un efecto real, a traves de una capability gobernada.
- **observar resultado / decidir nuevamente**: el agente ve el resultado de su propia accion antes de decidir el siguiente paso, dentro del mismo ciclo si hace falta.

La unidad de ejecucion objetivo es una **accion agentica minima** - una pregunta, una busqueda en el catalogo, una recomendacion, un follow-up - no un documento de decision monolitico que resuelve todo el turno de una sola vez. Un solo turno de conversacion puede contener varios ciclos internos completos antes de que el cliente reciba una respuesta.

## Principios no negociables

1. **La oportunidad es el centro del modelo.** No el mensaje, no el caso, no la cola de trabajo. Cliente, necesidad, oportunidad, estrategia y resultado se interpretan juntos.
2. **El modelo propone; el backend valida; el dominio decide; la persistencia ejecuta.** Ninguna propuesta del agente se aplica sin pasar por esa cadena completa.
3. **Los datos de negocio son deterministicos.** Precio, stock, disponibilidad, compatibilidad y fechas vienen de herramientas verificadas contra una fuente real. El agente nunca los completa por su cuenta.
4. **Todo efecto pasa por: decision -> validacion -> comando -> ejecucion -> auditoria.** Sin atajos, sin excepciones silenciosas.
5. **El Capability Gateway informa que es posible; no decide la estrategia comercial.** Disponibilidad, politica y argumentos son informacion para que el agente replantee, no una decision de negocio tomada por la plataforma.
6. **Toda decision debe ser evaluable.** Por que se eligio, que resultado se esperaba, que ocurrio realmente, si la oportunidad avanzo.
7. **Un fallo tecnico nunca cierra una oportunidad ni deja al cliente sin continuidad.** Retry limitado, alternativa disponible, salida segura, escalamiento - en ese orden.
8. **La identidad sigue siendo provisional mientras no exista `customer_master`.** No se inventa un `customer_key` definitivo ni se presenta un Customer Candidate como Customer Master.

## Anti-patrones

Si un documento, contrato o diseno describe alguno de estos patrones como arquitectura objetivo, esta desalineado con esta vision - sin importar cuan formal sea su status declarado. Cada uno de estos patrones ya existio en algun punto de este repositorio; listarlos aqui es la manera de que no se repitan sin que nadie lo note.

- **Chatbot de preguntas frecuentes.** Responde, no administra oportunidades ni persigue resultados.
- **Workflow rigido por intencion.** Un arbol de decision fijo por categoria de mensaje, en vez de un agente que razona sobre contexto.
- **Routing comercial por palabra clave.** Ya causo un incidente real en este repositorio: hasta `ACS-R1-05.1-T01`, un motor legacy se activaba por coincidencia de palabras como "precio" o "stock", corriendo como una segunda autoridad de escritura no declarada (ver `docs/n8n-brain-integration.md`).
- **LLM usado principalmente como completador de JSON.** Una sola llamada que rellena un envelope de clasificacion (`intent`/`department`/`finalAction`) no es un agente que decide y actua - es un clasificador con forma de agente.
- **Contratos monoliticos todo-o-nada.** Una decision comercial completa resuelta en un unico paso, sin posibilidad de observar un resultado intermedio antes de continuar.
- **Compositores deterministicos especificos como sustituto permanente del razonamiento.** Un reducer fijo o una lista cerrada de "next action" esta bien como limite tecnico sobre lo que el sistema puede hacer; esta mal cuando reemplaza al agente en decidir cual de esas acciones corresponde.
- **Herramientas inaccesibles por errores perifericos.** Un timeout, un flag mal leido o una allowlist rota no deberian dejar al agente sin capacidad de actuar; deben producir una senal clara y recuperable, nunca un bloqueo silencioso.
- **Handoff como salida por defecto.** Escalar a un humano ante cualquier ambiguedad, en vez de intentar aclarar primero, vacia de contenido la autonomia del agente.
- **Autonomia textual sin autonomia operacional.** Un agente que "suena" autonomo en su respuesta pero no puede ejecutar ni una sola accion real gobernada no es autonomo, es un generador de texto con buena redaccion.

## Documentos derivados

Este documento es un resumen estable. La evidencia viva y el detalle tecnico vigente viven en:

- `docs/product/autonomous-commerce-prd.md` - vision completa, problema, alcance por etapas, matriz de autoridad detallada.
- `docs/architecture/adr/ADR-001-commercial-vs-ai-decisions.md` - patron planificador abierto / ejecutor cerrado.
- `docs/architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md` - gobernanza inversa del Capability Gateway.
- `docs/product/autonomous-commerce-authority-matrix.md` - matriz operativa: que decide la IA, que valida el backend, que ejecuta el sistema.
- `docs/product/sales-agent-contract.md` - contrato de input/output/decision del agente.
- `docs/ROADMAP.md` y `docs/ACTIVE_RELEASE.md` - secuencia y estado real de ejecucion, siempre por encima de lo que cualquier documento de vision declare como intencion.

Si un documento nuevo repite contenido de este North Star en vez de citarlo, ese contenido esta mal ubicado.

## Criterio de alineamiento

Antes de aceptar un diseno, contrato o cambio de arquitectura, debe poder responderse que si a todas estas preguntas:

1. ¿El agente decide la siguiente accion, o el codigo decide por el segun una regla fija de intencion o palabra clave?
2. ¿La plataforma limita lo que el agente puede hacer, o decide en su reemplazo que hacer?
3. ¿La unidad de trabajo es una accion agentica pequena, o un documento de decision monolitico por turno?
4. ¿Cada efecto pasa por decision -> validacion -> comando -> ejecucion -> auditoria, sin atajos?
5. ¿Un fallo de herramienta o de politica produce replanteamiento gobernado, o bloquea el ciclo completo o cae a handoff por defecto?
6. ¿Los datos de negocio vienen de una herramienta verificada, o el modelo los completa por su cuenta?

Un diseno que responde "no" a cualquiera de estas preguntas no debe aceptarse como arquitectura objetivo, aunque resuelva un problema real a corto plazo. En ese caso se documenta explicitamente como deuda o como bridge temporal - nunca como decision final - y se referencia desde la release spec correspondiente, no desde este documento. Este mismo criterio es el que este repositorio no aplico retroactivamente sobre su propia documentacion legacy, y por eso convivian, sin senalizacion, disenos que ya habian sido reemplazados. Cualquier documento nuevo que se agregue al vault debe pasar este criterio antes de escribirse, no despues de que alguien lo use por error.
