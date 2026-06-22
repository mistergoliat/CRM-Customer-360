"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.withConnection = withConnection;
exports.queryRows = queryRows;
exports.safeQueryRows = safeQueryRows;
exports.safeScalar = safeScalar;
exports.getColumns = getColumns;
exports.hasTable = hasTable;
exports.pickExistingColumns = pickExistingColumns;
exports.hasColumn = hasColumn;
exports.chileNowSql = chileNowSql;
exports.updateExistingColumns = updateExistingColumns;
exports.insertExistingColumns = insertExistingColumns;
exports.sanitizeDbError = sanitizeDbError;
const promise_1 = __importDefault(require("mysql2/promise"));
let pool = null;
const columnCache = new Map();
function getPool() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL no configurado");
    }
    if (!pool) {
        pool = promise_1.default.createPool(process.env.DATABASE_URL);
    }
    return pool;
}
async function withConnection(fn) {
    const connection = await getPool().getConnection();
    try {
        return await fn(connection);
    }
    finally {
        connection.release();
    }
}
async function queryRows(sql, params = []) {
    const [rows] = await getPool().execute(sql, params);
    return rows;
}
async function safeQueryRows(sql, params = []) {
    try {
        const rows = await queryRows(sql, params);
        return { ok: true, rows };
    }
    catch (error) {
        return { ok: false, rows: [], error: sanitizeDbError(error) };
    }
}
async function safeScalar(sql, params = []) {
    const result = await safeQueryRows(sql, params);
    if (!result.ok)
        return { ok: false, value: 0, error: result.error };
    const first = result.rows[0] ?? {};
    const value = Object.values(first)[0] ?? 0;
    return { ok: true, value };
}
async function getColumns(tableName) {
    if (columnCache.has(tableName))
        return columnCache.get(tableName);
    try {
        const rows = await queryRows(`DESCRIBE \`${tableName}\``);
        const columns = rows.map((row) => row.Field);
        columnCache.set(tableName, columns);
        return columns;
    }
    catch {
        columnCache.set(tableName, []);
        return [];
    }
}
async function hasTable(tableName) {
    const columns = await getColumns(tableName);
    return columns.length > 0;
}
async function pickExistingColumns(tableName, candidates) {
    const columns = await getColumns(tableName);
    const set = new Set(columns);
    return candidates.filter((candidate) => set.has(candidate));
}
function hasColumn(columns, candidate) {
    return columns.includes(candidate);
}
function chileNowSql() {
    return "CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00')";
}
async function updateExistingColumns(tableName, whereColumnCandidates, whereValue, values) {
    const columns = await getColumns(tableName);
    const whereColumn = whereColumnCandidates.find((candidate) => columns.includes(candidate));
    if (!whereColumn)
        return { ok: false, warning: `Sin columna WHERE compatible en ${tableName}` };
    const assignments = [];
    const params = [];
    for (const [column, value] of Object.entries(values)) {
        if (!columns.includes(column))
            continue;
        if (value === "__CHILE_NOW__") {
            assignments.push(`\`${column}\` = ${chileNowSql()}`);
        }
        else {
            assignments.push(`\`${column}\` = ?`);
            params.push(value);
        }
    }
    if (assignments.length === 0) {
        return { ok: false, warning: `Sin columnas actualizables en ${tableName}` };
    }
    params.push(whereValue);
    await queryRows(`UPDATE \`${tableName}\` SET ${assignments.join(", ")} WHERE \`${whereColumn}\` = ?`, params);
    return { ok: true, updatedColumns: assignments.length };
}
async function insertExistingColumns(tableName, values, requiredAny = []) {
    const columns = await getColumns(tableName);
    if (columns.length === 0)
        return { ok: false, warning: `Tabla ${tableName} no disponible` };
    if (requiredAny.length > 0 && !requiredAny.some((column) => columns.includes(column))) {
        return { ok: false, warning: `Tabla ${tableName} no contiene columnas mínimas requeridas` };
    }
    const insertColumns = [];
    const placeholders = [];
    const params = [];
    for (const [column, value] of Object.entries(values)) {
        if (!columns.includes(column))
            continue;
        insertColumns.push(`\`${column}\``);
        if (value === "__CHILE_NOW__") {
            placeholders.push(chileNowSql());
        }
        else {
            placeholders.push("?");
            params.push(value);
        }
    }
    if (insertColumns.length === 0) {
        return { ok: false, warning: `Sin columnas insertables en ${tableName}` };
    }
    await queryRows(`INSERT INTO \`${tableName}\` (${insertColumns.join(", ")}) VALUES (${placeholders.join(", ")})`, params);
    return { ok: true, insertedColumns: insertColumns.length };
}
function sanitizeDbError(error) {
    const raw = error instanceof Error ? error.message : String(error);
    return raw
        .replace(/mysql:\/\/[^@\s]+@/gi, "mysql://<redacted>@")
        .replace(/password=[^&\s]+/gi, "password=<redacted>");
}
