/**
 * Small build entry used by the Electron runtime smoke test.
 *
 * Keeping this entry in the same main-process build as the application means
 * the smoke evaluates the exact bundled fingerprint builder that production
 * uses, rather than a duplicated test implementation.
 */
export { buildFingerprintScript, createFingerprintProfile } from './fingerprint';
