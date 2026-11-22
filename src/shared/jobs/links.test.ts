import { describe, it, expect } from 'vitest';
import { linkIn } from './links';

const A = 'https://app.example/client.html#t=AAA111', B = 'https://app.example/client.html#t=BBB222&l=en';
describe('the customer’s page link (jobs-a-22)', () => {
  it('the newest text that carries one', () => {
    expect(linkIn([{ body: `Bonjour, voici : ${B}`, customer_id: 'c1' }, { body: `Vieux ${A}`, customer_id: 'c1' }], 'c1')).toBe(B);
    expect(linkIn([{ body: 'Rien', customer_id: 'c1' }], 'c1')).toBeNull();
  });
  it('never a text sent to another customer (after « Changer de client » its link is revoked)', () => {
    expect(linkIn([{ body: `Pour le mauvais client ${B}`, customer_id: 'wrong' }, { body: `Pour lui ${A}`, customer_id: 'c1' }], 'c1')).toBe(A);
    expect(linkIn([{ body: `Pour le mauvais client ${B}`, customer_id: 'wrong' }], 'c1')).toBeNull();
  });
  it('a text that names no customer is kept', () => {
    expect(linkIn([{ body: A, customer_id: null }], 'c1')).toBe(A);
  });
});
