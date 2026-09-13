'use client'

import { useActionState } from 'react'
import { importLoads, type ImportState } from './actions'
import { Button, Card, ErrorBanner, SuccessBanner } from '@/components/ui'

const initialState: ImportState = { status: 'idle' }

export function LoadsImportForm() {
  const [state, formAction, pending] = useActionState(importLoads, initialState)

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Import Amazon Relay trip history</h2>
      <p className="mt-1 text-sm text-slate-500">
        Upload a Trip History CSV export to create or update loads.
      </p>
      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".csv"
          required
          className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Importing…' : 'Import CSV'}
        </Button>
      </form>

      {state.status === 'error' && (
        <div className="mt-4">
          <ErrorBanner>{state.message}</ErrorBanner>
        </div>
      )}

      {state.status === 'done' && (
        <div className="mt-4 space-y-3">
          <SuccessBanner>
            Created {state.created}, updated {state.updated}, skipped {state.skippedCancelled}{' '}
            cancelled (no pay).
          </SuccessBanner>
          {state.needsReview.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="mb-1.5 font-medium">Needs driver review ({state.needsReview.length})</p>
              <ul className="space-y-0.5">
                {state.needsReview.map((r) => (
                  <li key={r.externalLoadId}>
                    {r.externalLoadId} — {r.driverName}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.failed.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <p className="mb-1.5 font-medium">Failed rows ({state.failed.length})</p>
              <ul className="space-y-0.5">
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
    </Card>
  )
}
