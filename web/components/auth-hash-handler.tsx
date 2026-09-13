'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// Supabase's password-recovery and invite emails link to Supabase's own
// /auth/v1/verify endpoint, which verifies the token server-side and then
// redirects the browser to our site with the session in a URL *fragment*
// (`#access_token=...`) — the implicit flow. Fragments are never sent to
// the server, so no server component or middleware can see them; only
// client-side JS can read window.location.hash. This component is mounted
// once in the root layout so it runs no matter which page the fragment
// ends up on after the server-side auth redirects settle.
export function AuthHashHandler() {
  useEffect(() => {
    if (!window.location.hash.includes('access_token')) {
      return
    }

    const supabase = createClient()
    let handled = false

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (handled || !session) {
        return
      }
      handled = true
      window.location.replace('/dashboard/set-password')
    })

    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true
        window.location.replace('/login?error=invalid_link')
      }
    }, 4000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  return null
}
