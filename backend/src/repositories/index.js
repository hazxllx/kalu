/**
 * Repository selection. Returns the active driver based on server config:
 *
 *   - Supabase configured -> PostgreSQL driver (production target)
 *   - otherwise           -> local JSON-file driver (dev workflow)
 *
 * Both drivers expose the same async contract so the service layer never knows
 * which backend is in use.
 */
import env from '../config/env.js';
import fileRepository from './fileRepository.js';
import supabaseRepository from './supabaseRepository.js';

export const repository = env.isSupabaseConfigured ? supabaseRepository : fileRepository;

export const currentDriverName = () => repository.driver;

export default repository;
