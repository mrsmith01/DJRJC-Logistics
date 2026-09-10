import { setPassword } from './actions'

const errorMessages: Record<string, string> = {
  missing_fields: 'Please fill in both fields.',
  too_short: 'Password must be at least 8 characters.',
  mismatch: 'Passwords do not match.',
  update_failed: 'Could not update your password. Please try again.',
}

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <div style={{ maxWidth: 400 }}>
      <h1>Set your password</h1>
      <form action={setPassword}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="password">New password</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="confirm">Confirm password</label>
          <br />
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            style={{ width: '100%' }}
          />
        </div>
        {error && (
          <p style={{ color: 'red' }}>
            {errorMessages[error] ?? 'Something went wrong.'}
          </p>
        )}
        <button type="submit">Set password</button>
      </form>
    </div>
  )
}
