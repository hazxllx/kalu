// backend/src/repositories/index.js
/**
 * Repository driver selector for KALUSAGAP's data-access layer
 * (`route -> authenticate -> authorize -> controller -> service -> repository/Supabase`).
 *
 * Selects the active persistence driver at startup from `env.isSupabaseConfigured`
 * (true when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided):
 *   - Supabase configured -> `supabaseRepository` (PostgreSQL service-role driver, production target)
 *   - otherwise           -> `fileRepository` (local JSON-file store for standalone dev/test runs)
 *
 * Both drivers expose an identical async method contract returning canonical
 * camelCase domain objects so upstream services remain storage-agnostic.
 */
import env from '../config/env.js';
import fileRepository from './fileRepository.js';
import supabaseRepository from './supabaseRepository.js';

/** Active repository singleton bound to either Supabase PostgreSQL or the local JSON file store. */
export const repository = env.isSupabaseConfigured ? supabaseRepository : fileRepository;

/** Returns the active persistence driver identifier (`'supabase'` or `'file'`) for health/status reporting. */
export const currentDriverName = () => repository.driver;

export default repository;
