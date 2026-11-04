/* STUB (owner: customers) — the customer's cars as chips, plus « Ajouter un véhicule » (year, make, model, or VIN). */
export interface VehiclePickerProps {
  customerId: string | null;
  value: string | null;
  onPick: (vehicleId: string | null) => void;
}
export function VehiclePicker(_p: VehiclePickerProps) { return null; }
