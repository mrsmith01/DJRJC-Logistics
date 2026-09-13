'use client'

import { useActionState } from 'react'
import { importLoads, type ImportState } from './actions'

const initialState: ImportState = { status: 'idle' }

export function LoadsImportForm() {
  const [state, formAction, pending] = useActionState(importLoads, initialState)

  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2>Import Amazon Relay Trip History</h2>
      <form action={formAction}>
        <input type="file" name="file" accept=".csv" required />
        <button type="submit" disabled={pending}>
          {pending ? 'Importing…' : 'Import CSV'}
        </button>
      </form>

      {state.status === 'error' && <p style={{ color: 'red' }}>{state.message}</p>}

      {state.status === 'done' && (
        <div>
          <p>
            Created {state.created}, updated {state.updated}, skipped{' '}
            {state.skippedCancelled} cancelled (no pay).
          </p>
          {state.needsReview.length > 0 && (
            <div>
              <strong>Needs driver review ({state.needsReview.length}):</strong>
              <ul>
                {state.needsReview.map((r) => (
                  <li key={r.externalLoadId}>
                    {r.externalLoadId} — {r.driverName}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.failed.length > 0 && (
            <div>
              <strong>Failed rows ({state.failed.length}):</strong>
              <ul>
                {state.failed.map((f) => (
                  <li key={f.row}>
                    Row {f.row}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
