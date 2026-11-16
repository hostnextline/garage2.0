/* A job in a word or two. */
import type { Job } from '../../data/types';
import { customer as customerRow, customerName } from '../../data/select';

export function jobPerson(j: Pick<Job, 'customer_id'>): string {
  const c = customerRow(j.customer_id);
  return c ? (c.first_name || c.company || customerName(c)) : '';
}
