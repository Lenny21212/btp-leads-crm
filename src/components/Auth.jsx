import { useState } from 'react'
import { supabase } from '../supabase'

export default function Auth() {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handle = async () => {
    setError('')
    setSuccess('')
    if (!email || !password) { setError('Email et mot de passe requis'); return }
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setSuccess('Compte créé ! Vérifie ta boîte mail pour confirmer, puis connecte-toi.')
        setMode('login')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input { font-family: 'IBM Plex Mono', monospace; }
        input::placeholder { color: #374151; }
      `}</style>

      <div style={s.card}>
        <div style={s.logo}>⚡ BTP LEADS</div>
        <div style={s.subtitle}>CRM Prospection Artisans</div>

        <div style={s.tabs}>
          {['login','register'].map(m => (
            <button key={m} style={{ ...s.tab, ...(mode === m ? s.tabActive : {}) }}
              onClick={() => { setMode(m); setError(''); setSuccess('') }}>
              {m === 'login' ? 'Connexion' : 'Créer un compte'}
            </button>
          ))}
        </div>

        <div style={s.form}>
          <div style={s.field}>
            <label style={s.label}>EMAIL</label>
            <input style={s.input} type="email" placeholder="prenom@email.com"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handle()} />
          </div>
          <div style={s.field}>
            <label style={s.label}>MOT DE PASSE</label>
            <input style={s.input} type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handle()} />
          </div>

          {error && <div style={s.error}>{error}</div>}
          {success && <div style={s.successMsg}>{success}</div>}

          <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} onClick={handle} disabled={loading}>
            {loading ? '⏳ ...' : mode === 'login' ? '→ Se connecter' : '→ Créer le compte'}
          </button>
        </div>

        <div style={s.footer}>
          Accès réservé à l'équipe · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  )
}

const s = {
  root: {
    minHeight: '100vh', background: '#0A0A0A',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  card: {
    width: 400, background: '#111', border: '1px solid #1F2937',
    borderRadius: 16, padding: '40px 36px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
  },
  logo: {
    fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800,
    color: '#F59E0B', letterSpacing: 2, textAlign: 'center',
  },
  subtitle: { color: '#4B5563', fontSize: 11, textAlign: 'center', marginTop: 4, letterSpacing: 1 },
  tabs: { display: 'flex', marginTop: 28, borderBottom: '1px solid #1F2937' },
  tab: {
    flex: 1, background: 'none', border: 'none', cursor: 'pointer',
    color: '#4B5563', fontSize: 12, padding: '10px 0',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  tabActive: { color: '#F59E0B', borderBottom: '2px solid #F59E0B' },
  form: { display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 10, color: '#4B5563', letterSpacing: 1.5 },
  input: {
    background: '#0A0A0A', border: '1px solid #1F2937', borderRadius: 8,
    padding: '10px 12px', color: '#E5E7EB', fontSize: 13, outline: 'none',
  },
  error: {
    background: '#450A0A', border: '1px solid #7F1D1D', borderRadius: 6,
    padding: '8px 12px', color: '#FCA5A5', fontSize: 12,
  },
  successMsg: {
    background: '#064E3B', border: '1px solid #065F46', borderRadius: 6,
    padding: '8px 12px', color: '#6EE7B7', fontSize: 12,
  },
  btn: {
    background: '#F59E0B', color: '#000', border: 'none', borderRadius: 8,
    padding: '12px', fontWeight: 800, fontSize: 14, cursor: 'pointer',
    fontFamily: "'Syne', sans-serif", marginTop: 4,
  },
  footer: { color: '#1F2937', fontSize: 10, textAlign: 'center', marginTop: 24 },
}
