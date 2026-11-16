/* The car pieces other screens import from here: the VIN box and its scanner, « Ajouter un véhicule » and its rules.
   Each lives in its own file now (VinField, VinScanSheet, CarForm; the rules in domain/vehicles); this file keeps the
   names where the screens look for them. */
export { VinField } from './VinField';
export { VinScanSheet } from './VinScanSheet';
export { CarForm, LastOilField, VehicleAddSheet } from './CarForm';
export { readVin } from '../../domain/vehicles/readVin';
export { vinSavable } from '../../domain/vehicles/vin';
export { yearOk, EMPTY_CAR, carIsEmpty, carErrors, carRow, type AddDraft, type AddMode, type CarFields } from '../../domain/vehicles/carDraft';

/** can this phone scan? Always: the live camera when there is one, else a photo (« Prendre une photo du NIV ») */
export const canScan = () => true;
