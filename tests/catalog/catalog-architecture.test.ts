import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

test("commercial catalog code does not reference PrestaShop tables directly", () => {
  const files = [
    "lib/brain/commercial/sales-consultative/catalogRepository.ts",
    "lib/brain/commercial/sales-consultative/service.ts",
    "lib/brain/processInbound.ts",
    "lib/brain/native-whatsapp/service.ts"
  ];
  const forbidden = /ps_(product|product_attribute|stock_available|specific_price|shop_url|category_lang|product_lang|attribute|attribute_group)/i;
  const dbImport = /@\/lib\/db/;

  for (const file of files) {
    const source = read(file);
    assert.equal(forbidden.test(source), false, `${file} should not reference PrestaShop tables directly`);
    if (file === "lib/brain/commercial/sales-consultative/catalogRepository.ts") {
      assert.equal(dbImport.test(source), false, `${file} should not import db helpers directly`);
    }
  }
});

test("catalog adapter stays read only", () => {
  const source = read("lib/catalog/prestashopCatalogAdapter.ts");
  const forbidden = /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\b/;
  assert.equal(forbidden.test(source), false, "Prestashop adapter should not contain write verbs");
});
