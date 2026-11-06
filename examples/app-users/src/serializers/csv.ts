import type { Serializer } from "sashiko";

// Serializador CSV mínimo (F-31): o Sashiko só traz JSON e texto; outros formatos são plugáveis.
// Em produção, prefira uma biblioteca (csv-stringify, papaparse…), como faria com YAML ou msgpack.
export const csvSerializer: Serializer = (data) => {
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [data as Record<string, unknown>];
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]!);
  const escapeCell = (v: unknown) => {
    const text = String(v ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => escapeCell(r[c])).join(','))].join('\n') + '\n';
};
