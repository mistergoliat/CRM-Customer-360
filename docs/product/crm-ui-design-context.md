# CRM UI Design Context

Contexto de diseño para la implementación P1M del CRM.

## Objetivo

Construir una experiencia visual navegable de extremo a extremo para el CRM, con continuidad sobre el shell actual y con separación estricta entre visualización y ejecución.

## Jerarquía de autoridad

1. `AGENTS.md`
2. Contratos de producto y governance
3. Alcance de la tarea
4. Capturas reales en `current/`
5. Imágenes canónicas en `p1m-concepts/`
6. Decisiones locales de implementación

## Principios de diseño

- `PesasChile HUB` no cambia de identidad.
- `AI Operations` sigue como subtítulo.
- `Cases` permanece como dominio propio.
- `Conversations` es entrada separada para el chat.
- `Customer Candidate` no se presenta como `Customer Master`.
- Los controles no respaldados por backend quedan deshabilitados o en preview.

## Sistema visual

- Sidebar oscuro con grupos de navegación.
- Topbar clara con buscador y estado de entorno.
- Cards blancas con bordes suaves.
- Densidad operacional desktop-first.
- Fixtures identificados como datos de demostración.

## Resultado esperado

La webapp debe permitir recorrer el CRM sin depender de endpoints productivos nuevos, dejando claro qué es real, qué es preview y qué será conectado después.
