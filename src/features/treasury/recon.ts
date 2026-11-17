/* The reconciliation's rules moved to src/domain/recon/recon.ts (pure, so the frame can count the open differences
   on the « Plus » tile). This path is kept so nothing that imported it breaks. */
export * from '../../domain/recon/recon';
