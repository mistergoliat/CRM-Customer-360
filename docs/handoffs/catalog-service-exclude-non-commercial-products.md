# Prompt para MS-pesaschile-catalog-service: excluir productos no comerciales de /v1/products/explore (y revisar /search, /details, /batch)

Status: handoff pendiente. No implementado en este repo. Preparado durante ACS-R1-05.1-T02.6.2 (CRM-Customer-360); la implementacion real corresponde a una tarea y rama separadas dentro de `MS-pesaschile-catalog-service`.

## Contexto

CRM-Customer-360 (Sales Agent, capability `explore_catalog`) consume `POST /v1/products/explore`. En produccion, un ranking real ("muestrame los cinco productos con mas stock") devolvio filas que no son productos vendibles al cliente final:

- `Servicio vendedor Pesas Chile` (reportado por el operador en produccion)
- `Costo logistico` (confirmado por el consumidor via smoke manual: `productId=505`, `price=0`, `currency=CLP`, `stockQuantity=10001`, `stockScope=product`, `availability=available`)
- Posiblemente `Revisión R-10` (`productId=550`, `price=0`, `stockQuantity=0`, `availability=inactive`) - visto solo con `availability=all`, a confirmar si aparece tambien con `availability=available`.

Estos IDs vienen de una sesion de auditoria anterior contra la instancia real; pueden no ser exhaustivos ni estar actualizados - usarlos como punto de partida, no como lista cerrada.

## Causa raiz (evidencia en el codigo del propio repo)

`src/repositories/catalogRepository.ts#search()` (metodo `search`, usado por `GET /v1/products/search`) solo filtra por:

```sql
WHERE p.active = 1 AND (...)
```

No hay ningun filtro por visibilidad de catalogo/tienda ni por si el producto es orderable por el cliente final. Si `/v1/products/explore` reutiliza el mismo patron de query (no esta en el checkout local auditado, pero es el mismo repositorio/equipo), es altamente probable que tenga el mismo gap: `active=1` no distingue un producto real de una linea de servicio/logistica que PrestaShop mantiene activa (`active=1`) para uso interno (ajustes de pedido, comisiones) pero que nunca deberia mostrarse ni rankearse de cara al cliente.

Senales estables candidatas en el propio schema de PrestaShop (no evaluadas aqui porque este checkout no tiene la tabla/columna a la vista, a confirmar contra la base real):

- `ps_product.available_for_order` (0/1)
- `ps_product_shop.visibility` (`both` / `catalog` / `search` / `none`)
- Una categoria o `id_product` reservados explicitamente para lineas de servicio/logistica, si existe tal convencion en este catalogo.

## Regla arquitectonica pedida

La exclusion debe ocurrir **antes** de:
1. ordenar (`ORDER BY`);
2. calcular `totalMatched`;
3. seleccionar el top-N (`LIMIT`);
4. devolver `exhaustiveForScope`.

Es decir, debe ser parte del `WHERE` de la query base, no un post-proceso sobre las filas ya traidas - de lo contrario `totalMatched`/`exhaustiveForScope` seguirian contando filas no comerciales, y un top-N podria devolver menos productos reales de los pedidos porque una fila de servicio ocupo un lugar.

## Cambio propuesto (conceptual, no implementado aqui)

En la query de `/v1/products/explore` (y revisar tambien `/v1/products/search`, `/v1/products/:id`, `/v1/products/batch`, que comparten `active=1` como unico filtro segun el codigo auditado), agregar una condicion estable, por ejemplo:

```sql
WHERE p.active = 1
  AND ps.visibility IN ('both', 'catalog')   -- o el nombre real de columna/tabla vigente
  AND p.available_for_order = 1               -- si esa es la senal real usada en este catalogo
  AND (...)
```

Preferir esta senal sobre cualquier lista de nombres/IDs hardcodeada - los nombres de producto no son una fuente estable (pueden cambiar, traducirse, duplicarse).

## Impacto esperado

- `totalMatched` bajaria en la cantidad de filas no comerciales que existan (desconocida sin acceso a la base real).
- Los rankings por precio/stock/nombre dejarian de exponer estas filas.
- `/v1/products/search` y `/v1/products/batch` probablemente comparten el mismo gap (mismo patron `active=1` visto en `catalogRepository.ts#search()`) - vale la pena aplicar el fix de forma consistente en las cuatro rutas, no solo en `/explore`.

## Fuera de alcance de este prompt

- No se modifico ningun archivo de `MS-pesaschile-catalog-service` para producir este documento.
- No se determino la columna/tabla exacta a usar (requiere acceso a la base real de PrestaShop de este catalogo especifico) - el mantenedor de ese repo debe confirmar cual senal existe realmente antes de implementar.
