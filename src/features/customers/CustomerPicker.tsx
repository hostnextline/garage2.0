/* STUB (owner: customers) — pick a customer by name, phone or address, or create one on the spot. */
export interface CustomerPickerProps {
  value: string | null;
  onPick: (customerId: string | null) => void;
  /** offer « Nouveau client » (a short form in a sheet) when the search finds nobody */
  allowCreate?: boolean;
  autoFocus?: boolean;
}
export function CustomerPicker(_p: CustomerPickerProps) { return null; }
