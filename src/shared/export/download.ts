/* Handing a file made on the phone to the person: a download, or the phone's « share » sheet (to send the Excel file
   to the accountant by e-mail or text). One implementation for the treasury and the Coffre. */
import { XLSX_MIME } from './xlsx';

export const CSV_MIME = 'text/csv;charset=utf-8';

/** saves the bytes (or text) as a file named `name` */
export function saveFile(data: Uint8Array | string, name: string, type: string): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // the download has started by then; the URL only holds the bytes in memory
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** whether this device can hand an Excel file to another app (phones; most computers cannot) */
export function canShareFiles(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof File === 'function'
      && navigator.canShare({ files: [new File([''], 'x.xlsx', { type: XLSX_MIME })] });
  } catch {
    // an old browser throws instead of answering false: it cannot share files
    return false;
  }
}

/** the share sheet with an Excel file; when sharing fails (not when the person closes it), a plain download */
export async function shareOrSave(data: Uint8Array, name: string): Promise<void> {
  try {
    await navigator.share({ files: [new File([new Uint8Array(data)], name, { type: XLSX_MIME })], title: name });
  } catch (e) {
    if ((e as { name?: string }).name !== 'AbortError') saveFile(data, name, XLSX_MIME);
  }
}
