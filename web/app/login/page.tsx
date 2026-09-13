import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signIn } from './actions'
import { Button, ErrorBanner, Input, Label } from '@/components/ui'

const errorMessages: Record<string, string> = {
  invalid: 'Invalid email or password.',
  invalid_link: 'That link is invalid or has expired.',
  unconfirmed: 'Please confirm your email before signing in.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  const { error } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-white">
            D
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">DJRJC Logistics</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to the dispatch dashboard</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <form action={signIn} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <a
                  href="/forgot-password"
                  className="text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  Forgot password?
                </a>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            {error && <ErrorBanner>{errorMessages[error] ?? 'Something went wrong.'}</ErrorBanner>}

            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </main>
  )
}
