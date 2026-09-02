/**
 * Type declaration for catalog.json.
 *
 * The JSON is imported for its data, never for its shape — but with
 * `resolveJsonModule` TypeScript infers a literal type for all 12,000 album
 * objects and unions them. Adding a `country` field of ~100 distinct string
 * values pushed that over the checker's internal limit and the build died with
 * `RangeError: Map maximum size exceeded`.
 *
 * Declaring the module instead means TypeScript never reads the file, so the
 * catalog can grow any number of columns without threatening the build. Vite
 * still bundles the real JSON. Uses the `.d.json.ts` form enabled by
 * `allowArbitraryExtensions`.
 */
import type { RawCatalog } from './schema';

declare const catalog: RawCatalog;
export default catalog;
