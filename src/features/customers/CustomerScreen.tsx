/* A customer's file (#/customer/:id), and the new customer form (#/customer/new).
   The file (CustomerFile.tsx) says who it is and what to know (flags in words), with Appeler, Texter, Itinéraire and
   the one next step: Réserver; then the contact details, the cars, the notes, the appointments, the invoices (what is
   owed stands out) and the estimates. Changes are made in a sheet (EditSheet.tsx). */
import type { ScreenProps } from '../../platform/router';
import { NewCustomer } from './NewCustomer';
import { CustomerFile } from './CustomerFile';
import '../../shared/places/customers.css';

export default function CustomerScreen({ params, query }: ScreenProps) {
  if (params.id === 'new') return <NewCustomer query={query} />;
  return <CustomerFile id={params.id} wanted={query.get('do')} />;
}
