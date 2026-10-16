import ExcelJS from 'exceljs';
import type { Readable } from 'node:stream';

import { validateRow } from './validator.js';
import type { RowValidationResult } from './types.js';
import { buildColumnIndex, extractRowFields } from './columnMap.js';


export async function parseAndValidate(fileStream: Readable): Promise<RowValidationResult[]> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(fileStream, {});
  const results: RowValidationResult[] = [];

  for await (const worksheetReader of workbookReader) {
    let columnIndex: Map<number, string> | null = null;

    for await (const row of worksheetReader) {
      const values = row.values as unknown[];

      if (row.number === 1) {
        columnIndex = buildColumnIndex(values);
        continue;
      }
      if (!columnIndex) continue;

      const hasAnyValue = values.some((v) => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasAnyValue) continue;

      const fields = extractRowFields(values, columnIndex);
      results.push(validateRow(fields, row.number));
    }

    break;
  }

  return results;
}
