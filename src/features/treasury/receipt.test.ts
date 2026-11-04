import { describe, it, expect } from 'vitest';
import { parseReceipt, receiptDate, receiptVendor, amountsIn, splitFromTotal, splitFromSubtotal, completeAmounts, guessCategory } from './receipt';
import { parseMoney } from '../../lib/money';

const TODAY = '2026-11-04';

const CANADIAN_TIRE = `
CANADIAN TIRE #0432
1755 boul. Marcel-Laurin
Saint-Laurent, QC H4R 1J5
Tél: 514-336-1234
2026-11-03   14:32
Caisse 04   Trans 5521
CLÉ À CLIQUET 3/8             49,99
DOUILLES 10 PCS               34,99
SOUS-TOTAL                    84,98
TPS 5 %                        4,25
TVQ 9,975 %                    8,48
TOTAL                         97,71
DÉBIT                         97,71
TPS/GST # 103064577 RT0001
TVQ/QST # 1006219854 TQ0001
Retours acceptés jusqu'au 2026-12-03
`;

const LORDCO_EN = `
LORDCO AUTO PARTS
4300 Jean-Talon St W, Montreal QC H4P 1W1
(514) 555-0199
Nov 3, 2026  10:14 AM
Invoice # 554-21009
Brake rotors (2)              $389.98
Ceramic pads                  $129.99
Caliper kit                   $553.79
Subtotal                    $1,073.76
GST 5% #123456789RT0001        $53.69
QST 9.975% #1234567890TQ0001  $107.11
Total                       $1,234.56
VISA ************4421       $1,234.56
`;

const LORDCO_FR = `
Pièces d’auto Lordco
4300 rue Jean-Talon O.
03/11/2026 10:14
SOUS-TOTAL      1 073,76
TPS             53,69
TVQ             107,11
TOTAL           1 234,56 $
`;

const ULTRAMAR = `
Bienvenue chez
ULTRAMAR
2150 boul. Thimens
03 NOV 2026 07:58
POMPE 4 ORDINAIRE
45,123 L @ 1,689 $/L
CARBURANT                     76,21
TOTAL                         76,21
TPS INCLUSE 3,31   TVQ INCLUSE 6,61
TPS: 813457812RT0001
TVQ: 1215678906TQ0001
`;

const DEBIT_SLIP = `
*** COPIE CLIENT ***
NAPA PIECES D'AUTO
3 nov. 2026
ACHAT
INTERAC          45,67 $
APPROUVÉ 00 MERCI
`;

describe('amounts on a receipt line', () => {
  it('keeps the thousands: the old bug read « 1,234.56 » as 234.56', () => {
    expect(amountsIn('Total $1,234.56')).toEqual([123456]);
    expect(amountsIn('TOTAL 1 234,56')).toEqual([123456]);
    expect(amountsIn('TOTAL 1.234,56 $')).toEqual([123456]);
    expect(amountsIn('Total: 1234.56')).toEqual([123456]);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('1 234,56')).toBe(123456);
  });
  it('does not read registration numbers, rates, litres or phone numbers as amounts', () => {
    expect(amountsIn('tps/gst # 103064577 rt0001')).toEqual([]);
    expect(amountsIn('qst 9.975% #1234567890tq0001  $107.11')).toEqual([10711]);
    expect(amountsIn('tvq 9,975 %  8,48')).toEqual([848]);
    expect(amountsIn('tps 5.00 % 4,25')).toEqual([425]);
    expect(amountsIn('45,123 l @ 1,689 $/l')).toEqual([]);
    expect(amountsIn('tel 514.336.1234')).toEqual([]);
  });
  it('a gap between columns never joins two numbers', () => {
    expect(amountsIn('pompe 4  762,10')).toEqual([76210]);
  });
});

describe('dates on a receipt', () => {
  it.each([
    ['2026-11-03', '2026-11-03'],
    ['03/11/2026', '2026-11-03'],
    ['Nov 3, 2026', '2026-11-03'],
    ['3 nov. 2026', '2026-11-03'],
    ['03 NOV 2026 07:58', '2026-11-03'],
    ['November 3rd 2026', '2026-11-03'],
    ['1er novembre 2026', '2026-11-01'],
    ['11/03/2026', '2026-11-03'],          // a US-made terminal: the reading closest to today
    ['03-11-26', '2026-11-03'],
    ['2026/11/03 14:32:05', '2026-11-03']
  ])('%s → %s', (text, day) => expect(receiptDate(`Date ${text}`, TODAY)).toBe(day));
  it('ignores a future date (returns until…) and keeps the purchase date', () => {
    expect(receiptDate(CANADIAN_TIRE, TODAY)).toBe('2026-11-03');
  });
  it('takes the latest past date when there are several (member since…)', () => {
    expect(receiptDate('Membre depuis 2024-04-01\nDate: 2026-10-28', TODAY)).toBe('2026-10-28');
  });
  it('no date: null', () => expect(receiptDate('TOTAL 12,00', TODAY)).toBeNull());
});

describe('the vendor from the first lines', () => {
  it.each([
    [CANADIAN_TIRE, 'Canadian Tire'],
    [LORDCO_EN, 'Lordco Auto Parts'],
    [LORDCO_FR, 'Pièces d’auto Lordco'],
    [ULTRAMAR, 'Ultramar'],
    [DEBIT_SLIP, "Napa Pieces d'auto"],
    ['Bienvenue chez MÉTRO\n1250 rue Graham\nTOTAL 12,00', 'Métro'],
    ['PETRO-CANADA\n5600 av. Royalmount', 'Petro-Canada'],
    ['514-555-1234\nwww.example.com\n12,00', null]
  ])('%#', (text, vendor) => expect(receiptVendor(text)).toBe(vendor));
});

describe('a whole receipt', () => {
  it('Canadian Tire (French): every amount, the registration numbers ignored', () => {
    const r = parseReceipt(CANADIAN_TIRE, TODAY);
    expect(r).toMatchObject({ vendor: 'Canadian Tire', day: '2026-11-03', subtotal: 8498, tps: 425, tvq: 848, total: 9771, consistent: true });
  });
  it('Lordco (English): « Total $1,234.56 » with GST/QST numbers on the tax lines', () => {
    const r = parseReceipt(LORDCO_EN, TODAY);
    expect(r).toMatchObject({ vendor: 'Lordco Auto Parts', day: '2026-11-03', subtotal: 107376, tps: 5369, tvq: 10711, total: 123456, consistent: true });
  });
  it('Lordco (French): « TOTAL 1 234,56 »', () => {
    const r = parseReceipt(LORDCO_FR, TODAY);
    expect(r).toMatchObject({ day: '2026-11-03', subtotal: 107376, tps: 5369, tvq: 10711, total: 123456, consistent: true });
  });
  it('gas station: taxes included on one line, the subtotal is worked out', () => {
    const r = parseReceipt(ULTRAMAR, TODAY);
    expect(r).toMatchObject({ vendor: 'Ultramar', day: '2026-11-03', total: 7621, tps: 331, tvq: 661, subtotal: 6629, consistent: true });
  });
  it('a debit slip with no TOTAL line: the amount paid', () => {
    const r = parseReceipt(DEBIT_SLIP, TODAY);
    expect(r.total).toBe(4567);
    expect(r.day).toBe('2026-11-03');
  });
  it('an amount read on the next line (a receipt read column by column)', () => {
    const r = parseReceipt('SOUS-TOTAL\n84,98\nTPS 5 %\n4,25\nTVQ 9,975 %\n8,48\nTOTAL\n97,71', TODAY);
    expect(r).toMatchObject({ subtotal: 8498, tps: 425, tvq: 848, total: 9771, consistent: true });
  });
  it('totals that are not the amount paid are left out (savings, taxes, items)', () => {
    const r = parseReceipt('SOUS-TOTAL 50,00\nTOTAL DES ÉCONOMIES 80,00\nTOTAL TPS 2,50\nTOTAL TVQ 4,99\nNB ARTICLES 3\nTOTAL 57,49\nMONNAIE 2,51', TODAY);
    expect(r).toMatchObject({ subtotal: 5000, tps: 250, tvq: 499, total: 5749, consistent: true });
  });
  it('« avant TPS » is a subtotal, not a tax', () => {
    const r = parseReceipt('MONTANT AVANT TPS 84,98\nTPS 4,25\nTVQ 8,48\nTOTAL 97,71', TODAY);
    expect(r).toMatchObject({ subtotal: 8498, tps: 425, tvq: 848, total: 9771 });
  });
  it('an insurance bill without TPS/TVQ', () => {
    const r = parseReceipt('Intact Assurance\nPrime mensuelle\nTOTAL 212,40', TODAY);
    expect(r.total).toBe(21240);
    expect(r.subtotal).toBeNull();
  });
  it('nothing readable: all null, never a throw', () => {
    expect(parseReceipt('', TODAY)).toMatchObject({ vendor: null, day: null, subtotal: null, tps: null, tvq: null, total: null, consistent: false });
    expect(parseReceipt('@@@ ### ///', TODAY).total).toBeNull();
  });
});

describe('Québec taxes in an expense', () => {
  it('from the total paid', () => {
    expect(splitFromTotal(9771)).toEqual({ subtotal: 8498, tps: 425, tvq: 848, total: 9771 });
    expect(splitFromTotal(123456)).toEqual({ subtotal: 107376, tps: 5369, tvq: 10711, total: 123456 });
    expect(splitFromTotal(22994)).toEqual({ subtotal: 19999, tps: 1000, tvq: 1995, total: 22994 });
    expect(splitFromTotal(0)).toEqual({ subtotal: 0, tps: 0, tvq: 0, total: 0 });
  });
  it('from the price before taxes (same rounding as an invoice)', () => {
    expect(splitFromSubtotal(8498)).toEqual({ subtotal: 8498, tps: 425, tvq: 848, total: 9771 });
    expect(splitFromSubtotal(20000)).toEqual({ subtotal: 20000, tps: 1000, tvq: 1995, total: 22995 });
  });
  it('round trip for every subtotal up to 300 $, and the parts always add up to the total', () => {
    for (let s = 1; s <= 30000; s++) {
      const a = splitFromSubtotal(s);
      const b = splitFromTotal(a.total);
      expect(b.subtotal).toBe(s);
      expect(b.tps).toBe(a.tps);
      expect(b.tvq).toBe(a.tvq);
    }
    for (let t = 1; t <= 30000; t += 7) {
      const b = splitFromTotal(t);
      expect(b.subtotal + b.tps + b.tvq).toBe(t);
    }
  });
  it('fills what the receipt did not show', () => {
    expect(completeAmounts({ subtotal: 8498, tps: null, tvq: null, total: 9771 })).toMatchObject({ tps: 425, tvq: 848, consistent: true });
    expect(completeAmounts({ subtotal: 8498, tps: 425, tvq: 848, total: null })).toMatchObject({ total: 9771, consistent: true });
    expect(completeAmounts({ subtotal: null, tps: 425, tvq: null, total: 9771 })).toMatchObject({ subtotal: 8498, tvq: 848, consistent: true });
    expect(completeAmounts({ subtotal: 5000, tps: null, tvq: null, total: 5000 })).toMatchObject({ tps: 0, tvq: 0, consistent: true });
    // a subtotal larger than the total was misread: dropped
    expect(completeAmounts({ subtotal: 99999, tps: null, tvq: null, total: 9771 }).subtotal).toBeNull();
  });
});

describe('the category proposed for a vendor', () => {
  const cats = ['Pièces', 'Huile et liquides', 'Carburant', 'Outils et équipement', 'Téléphone et internet', 'Repas', 'Autre'];
  it('the one used last time with the same vendor', () => {
    expect(guessCategory('Canadian Tire', cats, [{ vendor: 'CANADIAN TIRE', category: 'Outils et équipement' }])).toBe('Outils et équipement');
  });
  it('a known kind of store', () => {
    expect(guessCategory('Petro-Canada', cats)).toBe('Carburant');
    expect(guessCategory('Lordco Auto Parts', cats)).toBe('Pièces');
    expect(guessCategory('Vidéotron', cats)).toBe('Téléphone et internet');
  });
  it('only a category of the garage’s own list', () => {
    expect(guessCategory('Petro-Canada', ['Autre'])).toBeNull();
    expect(guessCategory('', cats)).toBeNull();
  });
});
