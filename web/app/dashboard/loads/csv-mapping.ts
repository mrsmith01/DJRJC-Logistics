// Exact header strings from a real Amazon Relay Trip History export. Note
// the two-space quirk: "Stop 1  Actual Arrival Date/Time" and
// "Stop 2  Actual Arrival Date/Time" have TWO spaces after the stop number
// (unlike "Stop 1 Planned Arrival Date", which has one). This is not a typo.
export const REQUIRED_COLUMNS = [
  'Load ID',
  'Load Execution Status',
  'Driver Name',
  'Estimate Distance',
  'Estimated Cost',
  'Stop 1',
  'Stop 2',
  'Stop 1 UTC Offset',
  'Stop 2 UTC Offset',
  'Stop 1  Actual Arrival Date',
  'Stop 1  Actual Arrival Time',
  'Stop 2  Actual Arrival Date',
  'Stop 2  Actual Arrival Time',
] as const

const STATUS_MAP: Record<string, 'booked' | 'delivered'> = {
  'Not Started': 'booked',
  Completed: 'delivered',
}

function parseRelayDatetime(
  dateStr: string | undefined,
  timeStr: string | undefined,
  offsetStr: string | undefined
): string | null {
  if (!dateStr || !timeStr || !offsetStr) return null

  const [month, day, year] = dateStr.split('/')
  if (!month || !day || !year) return null

  const offsetHours = Number(offsetStr)
  if (Number.isNaN(offsetHours)) return null

  const sign = offsetHours < 0 ? '-' : '+'
  const absHours = Math.abs(offsetHours)
  const offH = String(Math.trunc(absHours)).padStart(2, '0')
  const offM = String(Math.round((absHours % 1) * 60)).padStart(2, '0')

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timeStr}:00${sign}${offH}:${offM}`
}

export type MappedLoad = {
  external_load_id: string
  status: 'booked' | 'delivered' | 'cancelled'
  pickup_facility_code: string | null
  pickup_datetime: string | null
  delivery_facility_code: string | null
  delivery_datetime: string | null
  distance_miles: number | null
  rate_total: number | null
  rate_per_mile: number | null
  assigned_driver_name: string | null
  driver_id: string | null
}

export type RowOutcome =
  | { kind: 'mapped'; load: MappedLoad; needsReview: boolean }
  | { kind: 'skipped_cancelled' }
  | { kind: 'failed'; reason: string }

export function mapRelayRow(
  row: Record<string, string>,
  driverIdByName: Map<string, string>
): RowOutcome {
  const externalLoadId = row['Load ID']?.trim()
  if (!externalLoadId) {
    return { kind: 'failed', reason: 'missing Load ID' }
  }

  const rawStatus = row['Load Execution Status']?.trim()
  const rateTotalRaw = row['Estimated Cost']?.trim()
  const rateTotal = rateTotalRaw ? Number(rateTotalRaw) : null

  let status: MappedLoad['status']
  if (rawStatus === 'Cancelled') {
    if (!rateTotal || rateTotal <= 0) {
      return { kind: 'skipped_cancelled' }
    }
    status = 'cancelled'
  } else if (rawStatus === 'Not Started' || rawStatus === 'Completed') {
    status = STATUS_MAP[rawStatus]
  } else {
    return { kind: 'failed', reason: `unrecognized status "${rawStatus}"` }
  }

  const driverNameRaw = row['Driver Name']?.trim() ?? ''
  const driverId = driverNameRaw
    ? (driverIdByName.get(driverNameRaw.toLowerCase()) ?? null)
    : null

  const distanceRaw = row['Estimate Distance']?.trim()
  const distanceMiles = distanceRaw ? Number(distanceRaw) : null

  const ratePerMile =
    rateTotal && distanceMiles && distanceMiles > 0
      ? rateTotal / distanceMiles
      : null

  const pickupDatetime = parseRelayDatetime(
    row['Stop 1  Actual Arrival Date'],
    row['Stop 1  Actual Arrival Time'],
    row['Stop 1 UTC Offset']
  )
  const deliveryDatetime = parseRelayDatetime(
    row['Stop 2  Actual Arrival Date'],
    row['Stop 2  Actual Arrival Time'],
    row['Stop 2 UTC Offset']
  )

  return {
    kind: 'mapped',
    needsReview: !driverId,
    load: {
      external_load_id: externalLoadId,
      status,
      pickup_facility_code: row['Stop 1']?.trim() || null,
      pickup_datetime: pickupDatetime,
      delivery_facility_code: row['Stop 2']?.trim() || null,
      delivery_datetime: deliveryDatetime,
      distance_miles: distanceMiles,
      rate_total: rateTotal,
      rate_per_mile: ratePerMile,
      assigned_driver_name: driverNameRaw || null,
      driver_id: driverId,
    },
  }
}
