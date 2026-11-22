import 'fake-indexeddb/auto';
import { tapPausesForTests } from './ui/tapGuard';

// a test clicks faster than a person: the kit buttons' pauses against double taps are off, except in the guard's own
// tests (tapGuard.test.ts, kit.test.tsx turn them back on). The lock while an action is pending still holds.
tapPausesForTests(false);
