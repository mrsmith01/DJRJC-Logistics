import { requestPasswordReset } from './actions'
import { Button, ErrorBanner, Input, Label, SuccessBanner } from '@/components/ui'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  const { sent, error } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">
            D
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            We&apos;ll email you a link to set a new password.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {sent ? (
            <SuccessBanner>
              If an account exists for that email, a reset link is on its way. Check your inbox.
            </SuccessBanner>
          ) : (
            <form action={requestPasswordReset} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              {error && <ErrorBanner>Please enter a valid email.</ErrorBanner>}
              <Button type="submit" className="w-full">
                Send reset link
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-slate-500">
            <a href="/login" className="font-medium text-slate-700 hover:text-slate-900">
              Back to sign in
            </a>
          </p>
        </div>
      </div>
    </main>
  )
}
