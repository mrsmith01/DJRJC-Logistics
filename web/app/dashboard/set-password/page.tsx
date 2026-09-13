import { setPassword } from './actions'
import { Button, ErrorBanner, Input, Label } from '@/components/ui'

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
    <div className="mx-auto max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Set your password</h1>
      <p className="mt-1 text-sm text-slate-500">
        Choose a password to finish securing your account.
      </p>

      <form
        action={setPassword}
        className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div>
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {error && <ErrorBanner>{errorMessages[error] ?? 'Something went wrong.'}</ErrorBanner>}
        <Button type="submit" className="w-full">
          Set password
        </Button>
      </form>
    </div>
  )
}
