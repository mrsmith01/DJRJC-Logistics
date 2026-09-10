import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signIn } from './actions'

const errorMessages: Record<string, string> = {
  invalid: 'Invalid email or password.',
  invalid_link: 'That link is invalid or has expired.',
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
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 400 }}>
      <h1>DJRJC Logistics</h1>
      <form action={signIn}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="email">Email</label>
          <br />
          <input id="email" name="email" type="email" required style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="password">Password</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            required
            style={{ width: '100%' }}
          />
        </div>
        {error && (
          <p style={{ color: 'red' }}>{errorMessages[error] ?? 'Something went wrong.'}</p>
        )}
        <button type="submit">Sign in</button>
      </form>
    </main>
  )
}
