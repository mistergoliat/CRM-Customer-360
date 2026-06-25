# AI SDR Local Simulator

El HUB tiene un simulador local para probar el loop operacional de AI SDR sobre MariaDB.

## Qué hace

- crea o reutiliza conversaciones locales en la tabla `conversation`;
- registra mensajes inbound y outbound en `conversation_message`;
- persiste estado operacional en `ai_conversation_state`;
- registra ejecuciones, decisiones y tools en `ai_agent_execution`, `ai_agent_decision` y `ai_tool_execution`;
- usa `master_customer` como fuente de clientes reales.

## Cómo usarlo

1. Levanta MariaDB local.
2. Aplica migraciones y seeds.
3. Abre `/dev/ai-sdr-simulator`.
4. Escribe un mensaje inbound.
5. El panel ejecuta el loop y refresca el estado de la conversación.

## Datos de prueba

- `local-sim-linked`
- `local-sim-email-requested`
- `local-sim-creation-offered`

## Comandos útiles

```powershell
npm run db:up
npm run db:wait
npm run db:migrate -- --database=dev
npm run db:seed -- --database=dev
npm run dev
```
