import { parseExport } from './core'
import type { Op } from './core'
import type { OpStore } from './store'

export type ExportDocument = { version: 1; ops: Op[] }

/**
 * Whole-document export: nothing but the op log, because the op log IS the document --
 * the folded state is derivable and would only invite divergence if shipped alongside.
 */
export async function exportDocument(store: OpStore): Promise<ExportDocument> {
  return { version: 1, ops: await store.loadAll() }
}

/**
 * Validate then append everything. Deliberately no pre-filtering or deduplication here:
 * `put`-by-op-id absorbs exact duplicates and the fold's LWW resolves ordering, so
 * filtering would only re-implement (and risk contradicting) those semantics.
 * Returns the number of ops the document carried.
 */
export async function importDocument(store: OpStore, json: unknown): Promise<number> {
  const doc = parseExport(json)
  await store.appendMany(doc.ops)
  return doc.ops.length
}
