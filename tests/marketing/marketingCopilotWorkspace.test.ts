import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingCopilotWorkspace } from "@/components/marketing/MarketingCopilotWorkspace";

test("marketing copilot workspace renders the controlled customer intelligence demo checklist", () => {
  const html = renderToStaticMarkup(React.createElement(MarketingCopilotWorkspace, { data: { quickReplies: ["Agregar canal"] } }));

  assert.match(html, /Marketing Copilot/);
  assert.match(html, /Checklist demo/);
  assert.match(html, /Cuantos clientes hay en cada cluster\?/);
  assert.match(html, /Cuantos clientes abandonaron carrito ayer\?/);
  assert.match(html, /Provenance/);
  assert.match(html, /Preguntar/);
  assert.doesNotMatch(html, /Agregar canal/);
});
