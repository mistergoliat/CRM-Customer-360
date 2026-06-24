# CRM UI Existing State Audit

Audit del estado visual existente antes de P1M.

## Fuentes

- `docs/product/ui-reference/current/`
- `docs/product/ui-reference/p1m-concepts/`

## Hallazgos

- El shell visual existente ya establecía marca, sidebar amplio y topbar con buscador.
- `Cases` ya tenía una composición propia con chat, contexto y copiloto.
- Varias pantallas de producto estaban solo como preview o placeholders.
- No existía un índice formal del orden de navegación P1M.

## Continuidad preservada

- Branding: `PesasChile HUB` y `AI Operations`.
- Dominio `Cases` separado de `Conversations`.
- Capa de lectura y preview sin side effects.

## Diferencia con P1M

- P1M agrega navegación completa del CRM.
- P1M separa `Customers`, `Opportunities`, `Actions`, `Marketing`, `Knowledge`, `Analytics`, `Integrations` y `Settings`.
- P1M usa fixtures tipados para exploración visual end-to-end.
