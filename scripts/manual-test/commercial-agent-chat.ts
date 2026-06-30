import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import readline from "node:readline";

const DEFAULT_WA_ID = "56900000099";

function loadEnvFile(relativePath: string) {
  const fullPath = resolve(process.cwd(), relativePath);
  if (!existsSync(fullPath)) return;

  const contents = readFileSync(fullPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadEnv() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
}

async function main() {
  loadEnv();

  if (process.env.BRAIN_COMMERCIAL_AGENT_ENABLED?.trim().toLowerCase() !== "true") {
    console.error("BRAIN_COMMERCIAL_AGENT_ENABLED no esta en 'true' en .env -- el agente no correria. Aborta.");
    process.exitCode = 1;
    return;
  }

  const { processNativeWhatsAppInbound } = await import("../../lib/brain/native-whatsapp/service");
  const { queryRows, getPool } = await import("../../lib/db");

  const waIdArg = process.argv.find((arg) => arg.startsWith("--wa-id="));
  const waId = waIdArg ? waIdArg.slice("--wa-id=".length) : DEFAULT_WA_ID;
  const phoneNumberId = process.env.DEFAULT_PHONE_NUMBER_ID ?? "1030337916832905";
  const messageArg = process.argv.find((arg) => arg.startsWith("--message="));

  async function sendOne(text: string) {
    const providerMessageId = `manual-test:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const result = await processNativeWhatsAppInbound({
      providerMessageId,
      phoneNumberId,
      externalSenderId: waId,
      senderPhone: waId,
      senderName: "Manual Test",
      messageType: "text",
      text,
      occurredAt: new Date().toISOString(),
      rawPayload: { manualTest: true }
    });

    const turns = await queryRows<{ response_text: string | null; final_decision: string; model_name: string | null; iterations: number }>(
      "SELECT response_text, final_decision, model_name, iterations FROM crm_agent_turn WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
      [result.conversationId]
    );
    const turn = turns[0] ?? null;

    if (!turn) {
      console.log("\n(el agente no produjo un turno -- revisa BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY y los logs)\n");
    } else {
      console.log(`\nagente [${turn.final_decision}, ${turn.iterations} it., modelo=${turn.model_name ?? "?"}]:`);
      console.log(`${turn.response_text ?? "(sin texto de respuesta)"}\n`);
    }
  }

  if (messageArg) {
    console.log(`Mensaje unico (sin WhatsApp/HTTPS, llama processNativeWhatsAppInbound directo). wa_id=${waId}\n`);
    try {
      await sendOne(messageArg.slice("--message=".length));
    } catch (error) {
      console.error("error:", error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    await getPool().end();
    return;
  }

  console.log(`Chat manual con el commercial agent (sin WhatsApp/HTTPS, llama processNativeWhatsAppInbound directo).`);
  console.log(`wa_id=${waId}  phoneNumberId=${phoneNumberId}`);
  console.log(`Escribe un mensaje y Enter. Ctrl+C para salir.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question("tu> ", async (text) => {
      const trimmed = text.trim();
      if (!trimmed) {
        ask();
        return;
      }

      try {
        await sendOne(trimmed);
      } catch (error) {
        console.error("error:", error instanceof Error ? error.message : String(error));
      }

      ask();
    });
  };

  rl.on("close", async () => {
    try {
      await getPool().end();
    } catch {
      // ignore shutdown errors in manual test tooling
    }
    process.exit(0);
  });

  ask();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
