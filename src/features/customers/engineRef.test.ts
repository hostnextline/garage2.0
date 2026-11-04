import { describe, it, expect } from 'vitest';
import refJson from '../../../public/data/engine-ref.json';
import { parseEngineRef, matchEngine, parseDisplacement, parseCylinders, specFromRow, specKeyOf, makeModel, fuelKind, type EngineRow } from './engineRef';
import { refLine, engineLine } from './vehicleText';

const row = (o: Partial<EngineRow>): EngineRow => ({
  make: 'Honda', model: 'Civic', aliases: [], year_from: 2016, year_to: 2021, displacement: 2.0, cylinders: 4, turbo: false, fuel: 'gas',
  engine: 'K20C2', oil_l: 4.2, oil_visc: '0W-20', oil_filter: '15400-PLM-A02', drain_torque: '40 N·m', coolant: '', trans: '', brake: '', plugs: '', ...o
});
const ROWS: EngineRow[] = [
  row({ aliases: ['Civic Sedan', 'Civic Coupe', 'Civic Hatchback'] }),
  row({ aliases: ['Civic Sedan', 'Civic Coupe', 'Civic Hatchback'], displacement: 1.5, turbo: true, engine: 'L15B7', oil_l: 3.5 }),
  row({ aliases: ['Civic Si'], year_from: 2017, year_to: 2020, displacement: 1.5, turbo: true, engine: 'L15B7', oil_l: 3.5 }),
  row({ aliases: ['Civic Type R'], year_from: 2017, year_to: 2021, displacement: 2.0, turbo: true, engine: 'K20C1', oil_l: 5.4 }),
  row({ aliases: ['Civic Sedan', 'Civic Coupe'], year_from: 2012, year_to: 2015, displacement: 1.8, engine: 'R18Z1', oil_l: 3.7 }),
  row({ make: 'Honda', model: 'CR-V', aliases: ['CRV'], year_from: 2017, year_to: 2022, displacement: 1.5, turbo: true, engine: 'L15BE', oil_l: 3.7 }),
  row({ make: 'Ford', model: 'F-150', aliases: ['F150'], year_from: 2015, year_to: 2017, displacement: 3.5, cylinders: 6, turbo: true, engine: '3.5 EcoBoost', oil_l: 5.7 }),
  row({ make: 'Ford', model: 'F-150', aliases: ['F150'], year_from: 2015, year_to: 2017, displacement: 3.5, cylinders: 6, turbo: false, engine: '3.5 V6 Ti-VCT', oil_l: 5.7 }),
  row({ make: 'Ford', model: 'F-150', aliases: ['F150'], year_from: 2015, year_to: 2017, displacement: 5.0, cylinders: 8, engine: '5.0 V8 (Coyote)', oil_l: 7.6 }),
  row({ make: 'Chevrolet', model: 'Silverado', aliases: ['Silverado 1500', 'Silverado 1500 LD', 'Silverado LD'], year_from: 2014, year_to: 2018, displacement: 5.3, cylinders: 8, engine: '5.3 V8 (L83)', oil_l: 7.6 }),
  row({ make: 'Toyota', model: 'RAV4', aliases: [], year_from: 2019, year_to: 2024, displacement: 2.5, engine: 'A25A-FKS', oil_l: 4.4 }),
  row({ make: 'Toyota', model: 'RAV4', aliases: ['RAV4 Hybrid'], year_from: 2019, year_to: 2024, displacement: 2.5, fuel: 'hybrid', engine: 'A25A-FXS', oil_l: 4.4 }),
  row({ make: 'Mazda', model: 'Mazda3', aliases: [], year_from: 2014, year_to: 2018, displacement: 2.0, engine: 'PE-VPS', oil_l: 4.2 }),
  row({ make: 'RAM', model: '1500', aliases: [], year_from: 2013, year_to: 2018, displacement: 5.7, cylinders: 8, engine: '5.7 HEMI', oil_l: 6.6 })
];
const engines = (m: { best: EngineRow[] }) => m.best.map((r) => `${r.model} ${r.displacement} ${r.engine}`);

describe('engine list: matching a car', () => {
  it('needs the year inside the range of the line', () => {
    expect(engines(matchEngine({ year: 2014, make: 'Honda', model: 'Civic' }, ROWS))).toEqual(['Civic 1.8 R18Z1']);
    expect(matchEngine({ year: 2011, make: 'Honda', model: 'Civic' }, ROWS).best).toEqual([]);
    expect(matchEngine({ year: null, make: 'Honda', model: 'Civic' }, ROWS).best).toEqual([]);
  });
  it('the displacement picks the engine', () => {
    expect(engines(matchEngine({ year: 2019, make: 'Honda', model: 'Civic', displacement: 2.0 }, ROWS))).toEqual(['Civic 2 K20C2']);
    // the displacement written in the engine text counts too
    expect(engines(matchEngine({ year: 2019, make: 'Honda', model: 'Civic', engine: '1.5 L 4 cyl. turbo' }, ROWS))).toEqual(['Civic 1.5 L15B7']);
  });
  it('without the displacement: the usual engines, the sport versions after', () => {
    const m = matchEngine({ year: 2019, make: 'Honda', model: 'Civic' }, ROWS);
    expect(engines(m)).toEqual(['Civic 1.5 L15B7', 'Civic 2 K20C2']);
    expect(m.others.map((r) => r.engine).sort()).toEqual(['K20C1', 'L15B7']);
  });
  it('a version named in the trim wins (Si, Type R)', () => {
    expect(engines(matchEngine({ year: 2019, make: 'Honda', model: 'Civic', trim: 'Si' }, ROWS))).toEqual(['Civic 1.5 L15B7']);
    expect(matchEngine({ year: 2019, make: 'Honda', model: 'Civic', trim: 'Si' }, ROWS).best[0].aliases).toEqual(['Civic Si']);
    expect(engines(matchEngine({ year: 2019, make: 'Honda', model: 'Civic Type R' }, ROWS))).toEqual(['Civic 2 K20C1']);
  });
  it('reads the other names of a model (CRV, F150, Silverado 1500, Mazda 3, Dodge Ram)', () => {
    expect(engines(matchEngine({ year: 2018, make: 'honda', model: 'CRV' }, ROWS))).toEqual(['CR-V 1.5 L15BE']);
    expect(matchEngine({ year: 2016, make: 'Ford', model: 'F150', displacement: 5.0 }, ROWS).best[0].engine).toBe('5.0 V8 (Coyote)');
    expect(matchEngine({ year: 2016, make: 'Chevy', model: 'Silverado 1500', engine: '5.3 L V8' }, ROWS).best[0].engine).toBe('5.3 V8 (L83)');
    expect(matchEngine({ year: 2016, make: 'Mazda', model: '3' }, ROWS).best[0].model).toBe('Mazda3');
    expect(matchEngine({ year: 2016, make: 'Mazda', model: 'Mazda 3' }, ROWS).best[0].model).toBe('Mazda3');
    expect(matchEngine({ year: 2015, make: 'Dodge', model: 'Ram 1500' }, ROWS).best[0].engine).toBe('5.7 HEMI');
  });
  it('turbo and fuel words sort the engines of the same size', () => {
    expect(matchEngine({ year: 2017, make: 'Ford', model: 'F-150', engine: '3.5 L V6 EcoBoost' }, ROWS).best.map((r) => r.engine)).toEqual(['3.5 EcoBoost']);
    expect(matchEngine({ year: 2021, make: 'Toyota', model: 'RAV4', fuel: 'hybride' }, ROWS).best.map((r) => r.engine)).toEqual(['A25A-FXS']);
    expect(matchEngine({ year: 2021, make: 'Toyota', model: 'RAV4', fuel: 'essence' }, ROWS).best.map((r) => r.engine)).toEqual(['A25A-FKS']);
  });
  it('an unknown model or make finds nothing', () => {
    expect(matchEngine({ year: 2022, make: 'Ford', model: 'Transit' }, ROWS).best).toEqual([]);
    expect(matchEngine({ year: 2019, make: 'BMW', model: 'Civic' }, ROWS).best).toEqual([]);
  });
});

describe('engine list: the real file', () => {
  const rows = parseEngineRef(refJson);
  it('is read whole', () => {
    expect(rows.length).toBe((refJson as { rows: unknown[] }).rows.length);
    expect(rows.every((r) => r.year_from <= r.year_to && r.displacement > 0)).toBe(true);
  });
  it('a 2019 Civic 2.0 is a K20C2 with 4.2 L of 0W-20', () => {
    const m = matchEngine({ year: 2019, make: 'Honda', model: 'Civic', engine: '2.0 L 4 cyl.' }, rows);
    expect(m.best).toHaveLength(1);
    expect(m.best[0].engine).toBe('K20C2');
    expect(specFromRow(m.best[0])).toMatchObject({ oil_l: 4.2, oil_visc: '0W-20', oil_filter: '15400-PLM-A02' });
  });
  it('a 2014 Silverado 5.3 is found through its aliases', () => {
    const m = matchEngine({ year: 2014, make: 'Chevrolet', model: 'Silverado 1500', engine: '5.3 L V8' }, rows);
    expect(m.best.length).toBeGreaterThan(0);
    expect(m.best.every((r) => r.displacement === 5.3 && r.cylinders === 8)).toBe(true);
  });
  it('a 2016 CX-5 2.5 is found', () => {
    const m = matchEngine({ year: 2016, make: 'Mazda', model: 'CX-5', engine: '2.5 L 4 cyl.' }, rows);
    expect(m.best.length).toBeGreaterThan(0);
    expect(m.best.every((r) => r.displacement === 2.5)).toBe(true);
  });
});

describe('reading engine words', () => {
  it('displacement and cylinders', () => {
    expect(parseDisplacement('2.0 L 4 cyl.')).toBe(2);
    expect(parseDisplacement('3,5 L V6')).toBe(3.5);
    expect(parseDisplacement('1.5T')).toBe(1.5);
    expect(parseDisplacement('2 L')).toBe(2);
    expect(parseDisplacement('K20C2')).toBeNull();
    expect(parseCylinders('3.5 L V6 EcoBoost')).toBe(6);
    expect(parseCylinders('2.0 L 4 cyl.')).toBe(4);
    expect(parseCylinders('L15B7')).toBeNull();
  });
  it('make, fuel', () => {
    expect(makeModel('VW', 'Jetta')).toEqual({ make: 'volkswagen', model: 'Jetta' });
    expect(fuelKind('Hybride')).toBe('hybrid');
    expect(fuelKind('essence')).toBe('gas');
    expect(fuelKind('')).toBeNull();
  });
  it('the key of a sheet', () => {
    expect(specKeyOf({ year: 2019, make: 'Honda', model: 'Civic', engine: '2.0 L 4 cyl.' })).toBe('honda|civic|2019|2.0');
    expect(specKeyOf({ year: 2021, make: 'Toyota', model: 'RAV 4', displacement: 2.5 })).toBe('toyota|rav4|2021|2.5');
    expect(specKeyOf({ year: 2022, make: 'Ford', model: 'Transit' })).toBe('ford|transit|2022');
    expect(specKeyOf({ year: null, make: 'Ford', model: 'Transit' })).toBeNull();
  });
  it('the engine line', () => {
    expect(refLine(row({}))).toBe('2.0 L 4 cyl. (K20C2)');
    expect(refLine(row({ displacement: 3.6, cylinders: 6, engine: '3.6 V6 (LFX)' }))).toBe('3.6 L 6 cyl. (LFX)');
    expect(refLine(row({ displacement: 1.5, turbo: true, engine: '' }))).toBe('1.5 L 4 cyl. turbo');
    expect(engineLine({ displacement: 2, cylinders: 4, code: 'In-Line' })).toBe('2.0 L 4 cyl.');
  });
});
