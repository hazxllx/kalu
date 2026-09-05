import env from '../config/env.js';
import store from '../repositories/fileStore.js';
import onboarding from '../services/municipalityOnboarding.service.js';

const SAMPLE = {
  municipalityName: 'Municipality of Pili',
  province: 'Camarines Sur',
  municipalityAddress: 'Poblacion, Pili, Camarines Sur',
  municipalHealthOffice: 'Pili Municipal Health Office',
  rhuName: 'Pili Rural Health Unit',
  rhuAddress: 'Poblacion, Pili, Camarines Sur',
  rhuContact: '0900 000 0000',
  barangayCount: 4,
  registeredBarangays: ['San Jose', 'San Isidro', 'Cadlan', 'Talisay'],
  authorizedRepresentative: 'Alex Rivera',
  representativePosition: 'Municipal Representative',
  representativeContact: '0900 000 0001',
  representativeEmail: 'representative-pili-dev@kalusagap.test',
  officialMunicipalEmail: 'pili-dev@kalusagap.test',
  mhoName: 'Dr. Maria Santos',
  mhoEmail: 'mho-pili-dev@kalusagap.test',
  phnName: 'Ana Reyes, RN',
  phnEmail: 'phn-pili-dev@kalusagap.test',
};

if (env.isProduction || env.isSupabaseConfigured) {
  throw new Error('This seed is local development only. Do not run it with production or Supabase configuration.');
}

const reset = process.argv.includes('--reset');
const clear = process.argv.includes('--clear');
if (reset || clear) {
  await store.mutate((data) => {
    data.municipalityOnboarding = [];
    data.municipalityOnboardingAudit = [];
    data.counters.onboarding = 0;
  });
}

if (clear) {
  console.log('Development onboarding records cleared. Existing tenant and health data were preserved.');
  process.exit(0);
}

const registration = await onboarding.submit(SAMPLE);
console.log(JSON.stringify({
  message: reset ? 'Development onboarding reset and sample seeded.' : 'Development sample seeded.',
  registration,
  mhoLogin: { email: 'mho-pili-dev@kalusagap.test', password: 'PiliMhoDev-2026!' },
  phnLogin: { email: 'phn-pili-dev@kalusagap.test', password: 'PiliPhnDev-2026!' },
}, null, 2));
