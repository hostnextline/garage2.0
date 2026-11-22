import { describe, it, expect } from 'vitest';
import { isFrench, sentences, recognition, heard } from './speech';

class FakeRec {}
const win = (o: Record<string, unknown>) => o as unknown as Window & typeof globalThis;

describe('Hermes: the voice', () => {
  it('tells French from English to pick the voice', () => {
    expect(isFrench('Vérifie les plaquettes avant pour le client, puis la pression des pneus dans le camion.')).toBe(true);
    expect(isFrench('Check the front pads first, then the tire pressure.')).toBe(false);
  });
  it('reads one sentence at a time, without the formatting marks', () => {
    expect(sentences('**Oui.** Fais ça!\n# Puis ça')).toEqual(['Oui.', 'Fais ça!', 'Puis ça']);
  });
  it('the mic button only where dictation can work: the browser has it and the site allows the microphone (comms-guide-04)', () => {
    expect(recognition(win({}))).toBeNull();
    expect(recognition(win({ webkitSpeechRecognition: FakeRec }))).toBe(FakeRec);
    expect(recognition(win({ SpeechRecognition: FakeRec, document: { permissionsPolicy: { allowsFeature: (f: string) => f !== 'microphone' } } }))).toBeNull();
    expect(recognition(win({ SpeechRecognition: FakeRec, document: { featurePolicy: { allowsFeature: () => true } } }))).toBe(FakeRec);
  });
  it('what is heard goes after what was typed', () => {
    expect(heard('Bruit ', [[{ transcript: 'au freinage' }]])).toBe('Bruit au freinage');
    expect(heard('', [[{ transcript: 'Bon' }], [{ transcript: 'jour' }]])).toBe('Bonjour');
  });
});
