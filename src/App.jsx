import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import Auth from './components/Auth'
import CRM from './components/CRM'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F59E0B', fontFamily: 'monospace', fontSize: 18 }}>
      ⚡ Chargement...
    </div>
  )

  if (!session) return <Auth />

  return <CRM user={session.user} onSignOut={handleSignOut} />
}
