import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'

// ─── Constants ───────────────────────────────────────────────────────────────
const APIFY_BASE = 'https://api.apify.com/v2'

const METIERS = [
  'Électricien', 'Plombier', 'Chauffagiste', 'Menuisier',
  'Entreprise maçonnerie', 'Carreleur', 'Peintre en bâtiment', 'Couvreur',
  'Serrurier', 'Climatisation',
]

const STATUSES = {
  new:       { label: 'Nouveau',     color: '#4B5563', bg: '#1F2937' },
  calling:   { label: 'En appel',    color: '#F59E0B', bg: '#451A03' },
  bloctel:   { label: '🚫 Bloctel',  color: '#DC2626', bg: '#2D0808' },
  refuse:    { label: 'Refusé',      color: '#EF4444', bg: '#450A0A' },
  raccroche: { label: 'Raccroché',   color: '#F97316', bg: '#431407' },
  r2:        { label: 'R2',          color: '#60A5FA', bg: '#1E3A5F' },
  closer:    { label: 'Closer 🔥',  color: '#34D399', bg: '#064E3B' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function normalizePhone(tel) {
  if (!tel) return null
  let n = tel.replace(/[\s.\-()]/g, '')
  if (n.startsWith('+33')) n = '0' + n.slice(3)
  if (n.startsWith('0033')) n = '0' + n.slice(4)
  return /^0[1-9]\d{8}$/.test(n) ? n : null
}

const PROXY = '/api/apify'

async function apifyCall(body) {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`)
  return res.json()
}

async function runApifyActor(apiKey, actorId, input) {
  const run = await apifyCall({ action: 'start', apiKey, actorId, input })
  if (!run?.data?.id) throw new Error(run?.error?.message || 'Lancement acteur échoué')
  const runId = run.data.id
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const status = await apifyCall({ action: 'status', apiKey, runId })
    const s = status?.data?.status
    if (s === 'SUCCEEDED') {
      const datasetId = status.data.defaultDatasetId
      return apifyCall({ action: 'results', apiKey, datasetId })
    }
    if (s === 'FAILED' || s === 'ABORTED') throw new Error(`Acteur ${s}`)
  }
  throw new Error('Timeout')
}

function normalizePJ(item, metier) {
  // Compatible ahmed_hrid/pagejaunes-leads-scraper + autres acteurs PJ
  return {
    source: 'Pages Jaunes', metier,
    nom: item.name || item.companyName || item.title || '—',
    dirigeant: item.ownerName || item.contactName || item.managerName || null,
    telephone: item.phone || item.phoneNumber || item.telephone ||
               (Array.isArray(item.phones) ? item.phones[0] : null) || null,
    siret: item.siret || item.siren || null,
    ville: item.city || item.locality || item.address?.city ||
           (typeof item.address === 'string' ? item.address : null) || '—',
    adresse: item.address?.street || item.streetAddress || item.fullAddress ||
             (typeof item.address === 'string' ? item.address : null) || null,
    site_web: item.website || item.url || null,
    status: 'new', note: '',
    scrape_date: new Date().toISOString(),
  }
}

function normalizeGM(item, metier) {
  return {
    source: 'Google Maps', metier,
    nom: item.title || item.name || '—',
    dirigeant: null, siret: null,
    telephone: item.phone || item.phoneNumber || null,
    ville: item.city || item.address || '—',
    adresse: item.address || null,
    site_web: item.website || null,
    status: 'new', note: '',
    scrape_date: new Date().toISOString(),
  }
}

async function checkBloctelProxy(bloctelKey, phones, proxyUrl) {
  const url = proxyUrl
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: bloctelKey, numeros: phones }),
  })
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`)
  const data = await res.json()
  return new Set(data?.inscrits || [])
}

// ─── Helpers localStorage ────────────────────────────────────────────────────
const LS = {
  get: (k, fallback) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : fallback } catch { return fallback } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
}

// ─── Main CRM ────────────────────────────────────────────────────────────────
export default function CRM({ user, onSignOut }) {
  // Scrape settings — persistées dans localStorage
  const [apiKey, setApiKey] = useState(() => LS.get('btp_apify_key', ''))
  const [metier, setMetier] = useState(() => LS.get('btp_metier', 'Électricien'))
  const [ville, setVille] = useState(() => LS.get('btp_ville', ''))
  const [maxItems, setMaxItems] = useState(() => LS.get('btp_max_items', 50))
  const [sources, setSources] = useState(() => LS.get('btp_sources', { pj: true, gmaps: false }))
  const [actorPJ, setActorPJ] = useState(() => LS.get('btp_actor_pj', 'ahmed_hrid/pagejaunes-leads-scraper'))
  const [actorGM, setActorGM] = useState(() => LS.get('btp_actor_gm', 'compass/crawler-google-places'))
  const [showSettings, setShowSettings] = useState(false)

  // Bloctel — persisté dans localStorage
  const [bloctelKey, setBloctelKey] = useState(() => LS.get('btp_bloctel_key', ''))
  const [bloctelProxy, setBloctelProxy] = useState(() => LS.get('btp_bloctel_proxy', ''))
  const [autoCheckBloctel, setAutoCheckBloctel] = useState(() => LS.get('btp_auto_bloctel', true))
  const [checkingBloctel, setCheckingBloctel] = useState(false)
  const [bloctelLog, setBloctelLog] = useState('')

  // Leads
  const [leads, setLeads] = useState([])
  const [loadingLeads, setLoadingLeads] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scrapeLog, setScrapeLog] = useState('')

  // Call flow
  const [callingLead, setCallingLead] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [modalNote, setModalNote] = useState('')

  // ── Sauvegarde auto des clés dans localStorage ──
  useEffect(() => { LS.set('btp_apify_key', apiKey) }, [apiKey])
  useEffect(() => { LS.set('btp_bloctel_key', bloctelKey) }, [bloctelKey])
  useEffect(() => { LS.set('btp_bloctel_proxy', bloctelProxy) }, [bloctelProxy])
  useEffect(() => { LS.set('btp_metier', metier) }, [metier])
  useEffect(() => { LS.set('btp_ville', ville) }, [ville])
  useEffect(() => { LS.set('btp_max_items', maxItems) }, [maxItems])
  useEffect(() => { LS.set('btp_sources', sources) }, [sources])
  useEffect(() => { LS.set('btp_actor_pj', actorPJ) }, [actorPJ])
  useEffect(() => { LS.set('btp_actor_gm', actorGM) }, [actorGM])
  useEffect(() => { LS.set('btp_auto_bloctel', autoCheckBloctel) }, [autoCheckBloctel])

  // ── Sauvegarde auto des clés dans localStorage ──
  useEffect(() => { LS.set('btp_apify_key', apiKey) }, [apiKey])
  useEffect(() => { LS.set('btp_bloctel_key', bloctelKey) }, [bloctelKey])
  useEffect(() => { LS.set('btp_bloctel_proxy', bloctelProxy) }, [bloctelProxy])
  useEffect(() => { LS.set('btp_metier', metier) }, [metier])
  useEffect(() => { LS.set('btp_ville', ville) }, [ville])
  useEffect(() => { LS.set('btp_max_items', maxItems) }, [maxItems])
  useEffect(() => { LS.set('btp_sources', sources) }, [sources])
  useEffect(() => { LS.set('btp_actor_pj', actorPJ) }, [actorPJ])
  useEffect(() => { LS.set('btp_actor_gm', actorGM) }, [actorGM])
  useEffect(() => { LS.set('btp_auto_bloctel', autoCheckBloctel) }, [autoCheckBloctel])

  // ── Fetch leads from Supabase ──
  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('scrape_date', { ascending: false })
    if (!error) setLeads(data || [])
    setLoadingLeads(false)
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  // ── Realtime sync — toute l'équipe voit les updates en direct ──
  useEffect(() => {
    const channel = supabase
      .channel('leads-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        fetchLeads()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchLeads])

  // ── Stats ──
  const stats = Object.fromEntries(
    Object.keys(STATUSES).map(k => [k, leads.filter(l => l.status === k).length])
  )
  stats.total = leads.length

  // ── Filtered leads ──
  const filtered = leads.filter(l => {
    const matchFilter = filter === 'all' || l.status === filter
    const q = search.toLowerCase()
    const matchSearch = !q
      || (l.nom || '').toLowerCase().includes(q)
      || (l.telephone || '').includes(q)
      || (l.ville || '').toLowerCase().includes(q)
    return matchFilter && matchSearch
  })

  // ── Bloctel check ──
  const runBloctelCheck = useCallback(async (leadsToCheck) => {
    const phones = leadsToCheck
      .filter(l => l.status === 'new' && l.telephone)
      .map(l => normalizePhone(l.telephone))
      .filter(Boolean)
    if (!phones.length || !bloctelProxy) return leadsToCheck
    try {
      const bloctelSet = await checkBloctelProxy(bloctelKey, phones, bloctelProxy)
      return leadsToCheck.map(l => {
        const norm = normalizePhone(l.telephone)
        return norm && bloctelSet.has(norm) ? { ...l, status: 'bloctel' } : l
      })
    } catch (err) {
      setBloctelLog(`⚠️ Proxy Bloctel: ${err.message}`)
      return leadsToCheck
    }
  }, [bloctelKey, bloctelProxy])

  const handleBloctelCheckAll = async () => {
    if (!bloctelProxy) { setBloctelLog('⚠️ Configure l\'URL proxy n8n d\'abord.'); return }
    setCheckingBloctel(true)
    setBloctelLog('🔄 Vérification en cours...')
    try {
      const updated = await runBloctelCheck(leads)
      const toUpdate = updated.filter((l, i) => l.status !== leads[i]?.status)
      for (const l of toUpdate) {
        await supabase.from('leads').update({ status: 'bloctel' }).eq('id', l.id)
      }
      setBloctelLog(`✅ ${toUpdate.length} numéro(s) Bloctel bloqués`)
      fetchLeads()
    } finally {
      setCheckingBloctel(false)
    }
  }

  const toggleBloctel = async (lead) => {
    const next = lead.status === 'bloctel' ? 'new' : 'bloctel'
    await supabase.from('leads').update({ status: next }).eq('id', lead.id)
  }

  // ── Scrape ──
  const handleScrape = async () => {
    if (!apiKey) { setScrapeLog('⚠️ Entre ta clé Apify.'); return }
    if (!ville) { setScrapeLog('⚠️ Entre une ville.'); return }
    setScraping(true)
    setScrapeLog('🔄 Lancement...')
    let newLeads = []
    try {
      if (sources.pj) {
        setScrapeLog('🔄 Pages Jaunes...')
        const items = await runApifyActor(apiKey, actorPJ, { searchQuery: metier, location: ville, maxResults: maxItems, query: metier, maxItems })
        const norm = (items || []).map(i => normalizePJ(i, metier)).filter(l => l.telephone)
        newLeads = [...newLeads, ...norm]
        setScrapeLog(`✅ Pages Jaunes: ${norm.length} leads`)
      }
      if (sources.gmaps) {
        setScrapeLog(p => p + '\n🔄 Google Maps...')
        const items = await runApifyActor(apiKey, actorGM, {
          searchStringsArray: [`${metier} ${ville}`],
          maxCrawledPlaces: maxItems, language: 'fr', countryCode: 'fr',
        })
        const norm = (items || []).map(i => normalizeGM(i, metier)).filter(l => l.telephone)
        newLeads = [...newLeads, ...norm]
        setScrapeLog(p => p + `\n✅ Google Maps: ${norm.length} leads`)
      }

      // Dédoublonnage par téléphone
      const existingPhones = new Set(leads.map(l => l.telephone).filter(Boolean))
      let fresh = newLeads.filter(l => !existingPhones.has(l.telephone))

      // Bloctel check auto
      if (autoCheckBloctel && bloctelKey && bloctelProxy && fresh.length) {
        setScrapeLog(p => p + '\n🔄 Vérif Bloctel...')
        fresh = await runBloctelCheck(fresh)
        const nb = fresh.filter(l => l.status === 'bloctel').length
        if (nb) setScrapeLog(p => p + `\n🚫 ${nb} bloqués Bloctel`)
      }

      if (fresh.length) {
        const { error } = await supabase.from('leads').insert(
          fresh.map(l => ({ ...l, user_id: user.id }))
        )
        if (error) throw error
      }
      setScrapeLog(p => p + `\n\n🎯 ${fresh.length} leads ajoutés (${newLeads.length - fresh.length} doublons ignorés)`)
    } catch (err) {
      setScrapeLog(`❌ ${err.message}`)
    } finally {
      setScraping(false)
    }
  }

  // ── Call flow ──
  const startCall = async (lead) => {
    await supabase.from('leads').update({ status: 'calling' }).eq('id', lead.id)
    setCallingLead(lead)
    window.location.href = `tel:${lead.telephone?.replace(/\s/g, '')}`
  }

  const setCallResult = async (status) => {
    await supabase.from('leads').update({ status, note: modalNote }).eq('id', callingLead.id)
    setShowModal(false)
    setCallingLead(null)
    setModalNote('')
  }

  const deleteLead = async (id) => {
    await supabase.from('leads').delete().eq('id', id)
  }

  const resetAll = async () => {
    if (confirm('Supprimer TOUS les leads de l\'équipe ?')) {
      await supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0D0D0D; }
        ::-webkit-scrollbar-thumb { background: #2A2A2A; border-radius: 3px; }
        input, select, textarea { background: transparent; color: #E5E7EB; font-family: 'IBM Plex Mono', monospace; }
        input::placeholder, textarea::placeholder { color: #374151; }
        .lead-row:hover td { background: #0F0F0F !important; }
        .btn-call:hover { background: #D97706 !important; }
        .filter-btn:hover { opacity: 1 !important; }
      `}</style>

      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <div style={s.logo}>⚡ BTP LEADS</div>
          <div style={s.subtitle}>Prospection artisans — équipe</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={s.statsBar}>
            {[
              ['Total', leads.length, '#9CA3AF'],
              ['R2', stats.r2, STATUSES.r2.color],
              ['Closer', stats.closer, STATUSES.closer.color],
              ['Bloctel', stats.bloctel, STATUSES.bloctel.color],
            ].map(([label, val, color]) => (
              <div key={label} style={s.stat}>
                <span style={{ ...s.statNum, color }}>{val}</span>
                <span style={s.statLabel}>{label}</span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#6B7280', fontSize: 11 }}>{user.email}</div>
            <button style={s.signOutBtn} onClick={onSignOut}>Déconnexion</button>
          </div>
        </div>
      </div>

      {/* ── Scrape Panel ── */}
      <div style={s.panel}>
        <div style={s.panelRow}>
          <div style={s.fieldGroup}>
            <label style={s.label}>CLÉ API APIFY</label>
            <input style={s.input} type="password" placeholder="apify_api_xxx"
              value={apiKey} onChange={e => setApiKey(e.target.value)} />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>MÉTIER</label>
            <select style={s.input} value={metier} onChange={e => setMetier(e.target.value)}>
              {METIERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>VILLE / DÉPARTEMENT</label>
            <input style={s.input} placeholder="Lyon, 69, Rhône…"
              value={ville} onChange={e => setVille(e.target.value)} />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>MAX</label>
            <input style={{ ...s.input, width: 72 }} type="number" min={10} max={200} step={10}
              value={maxItems} onChange={e => setMaxItems(+e.target.value)} />
          </div>
        </div>
        <div style={s.panelRow}>
          <label style={s.checkLabel}>
            <input type="checkbox" checked={sources.pj}
              onChange={e => setSources(p => ({ ...p, pj: e.target.checked }))} />
            <span style={{ marginLeft: 6 }}>📒 Pages Jaunes</span>
          </label>
          <label style={s.checkLabel}>
            <input type="checkbox" checked={sources.gmaps}
              onChange={e => setSources(p => ({ ...p, gmaps: e.target.checked }))} />
            <span style={{ marginLeft: 6 }}>🗺 Google Maps</span>
          </label>
          <button style={s.linkBtn} onClick={() => setShowSettings(!showSettings)}>⚙ IDs acteurs</button>
          <button style={{ ...s.btnPrimary, opacity: scraping ? 0.6 : 1 }}
            onClick={handleScrape} disabled={scraping}>
            {scraping ? '⏳ Scraping...' : '🚀 Lancer le scraping'}
          </button>
        </div>
        {showSettings && (
          <div style={s.panelRow}>
            <div style={s.fieldGroup}>
              <label style={s.label}>ACTOR ID — PAGES JAUNES</label>
              <input style={s.input} value={actorPJ} onChange={e => setActorPJ(e.target.value)} />
            </div>
            <div style={s.fieldGroup}>
              <label style={s.label}>ACTOR ID — GOOGLE MAPS</label>
              <input style={s.input} value={actorGM} onChange={e => setActorGM(e.target.value)} />
            </div>
          </div>
        )}
        {scrapeLog && <pre style={s.log}>{scrapeLog}</pre>}
      </div>

      {/* ── Bloctel Panel ── */}
      <div style={{ ...s.panel, background: '#0C0808', borderBottom: '1px solid #1A0A0A' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ color: '#DC2626', fontWeight: 700, fontSize: 13 }}>🚫 BLOCTEL</span>
          <span style={{ color: '#4B5563', fontSize: 11 }}>— Liste anti-démarchage</span>
        </div>
        <div style={s.panelRow}>
          <div style={s.fieldGroup}>
            <label style={s.label}>CLÉ BLOCTEL</label>
            <input style={s.input} type="password" placeholder="Token abonné Bloctel"
              value={bloctelKey} onChange={e => setBloctelKey(e.target.value)} />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>URL PROXY N8N</label>
            <input style={{ ...s.input, minWidth: 280 }}
              placeholder="https://ton-n8n.com/webhook/bloctel-proxy"
              value={bloctelProxy} onChange={e => setBloctelProxy(e.target.value)} />
          </div>
          <label style={{ ...s.checkLabel, alignSelf: 'flex-end', paddingBottom: 8 }}>
            <input type="checkbox" checked={autoCheckBloctel}
              onChange={e => setAutoCheckBloctel(e.target.checked)} />
            <span style={{ marginLeft: 6, fontSize: 12 }}>Auto après scraping</span>
          </label>
          <button style={{ ...s.btnPrimary, background: '#7F1D1D', color: '#FCA5A5', alignSelf: 'flex-end' }}
            onClick={handleBloctelCheckAll} disabled={checkingBloctel}>
            {checkingBloctel ? '⏳...' : '🚫 Vérifier tous'}
          </button>
        </div>
        {bloctelLog && <pre style={{ ...s.log, borderColor: '#2D0808', color: '#FCA5A5' }}>{bloctelLog}</pre>}
      </div>

      {/* ── Toolbar ── */}
      <div style={s.toolbar}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[['all', 'Tous', '#9CA3AF'], ...Object.entries(STATUSES).map(([k, v]) => [k, v.label, v.color])].map(([k, label, color]) => (
            <button key={k} className="filter-btn" onClick={() => setFilter(k)} style={{
              ...s.filterBtn,
              borderColor: filter === k ? color : '#1F2937',
              color: filter === k ? color : '#6B7280',
              opacity: filter === k ? 1 : 0.7,
            }}>
              {label} ({k === 'all' ? leads.length : leads.filter(l => l.status === k).length})
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...s.input, width: 200, fontSize: 12 }}
            placeholder="🔍 Nom, téléphone, ville..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <button style={s.btnDanger} onClick={resetAll}>🗑 Reset</button>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={s.tableWrap}>
        {loadingLeads ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#374151' }}>Chargement…</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {['SOURCE', 'NOM / DIRIGEANT', 'TÉLÉPHONE', 'SIRET', 'VILLE', 'STATUT', 'ACTION'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#374151', padding: '40px 0' }}>
                    {leads.length === 0 ? 'Aucun lead — lance un scraping ↑' : 'Aucun résultat'}
                  </td>
                </tr>
              ) : filtered.map(lead => (
                <tr key={lead.id} className="lead-row" style={{
                  opacity: lead.status === 'bloctel' ? 0.45 : 1,
                  background: lead.status === 'bloctel' ? '#0C0404' : 'transparent',
                }}>
                  <td style={s.td}>
                    <span style={{
                      ...s.badge,
                      background: lead.source === 'Pages Jaunes' ? '#1C1035' : '#0A2540',
                      color: lead.source === 'Pages Jaunes' ? '#A78BFA' : '#38BDF8',
                    }}>
                      {lead.source === 'Pages Jaunes' ? 'PJ' : 'GM'}
                    </span>
                  </td>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600, color: '#F9FAFB', fontSize: 13 }}>{lead.nom}</div>
                    {lead.dirigeant && <div style={{ color: '#6B7280', fontSize: 11 }}>👤 {lead.dirigeant}</div>}
                    {lead.note && <div style={{ color: '#9CA3AF', fontSize: 11, fontStyle: 'italic' }}>💬 {lead.note}</div>}
                  </td>
                  <td style={s.td}>
                    <a href={`tel:${lead.telephone?.replace(/\s/g, '')}`} style={s.phone}>{lead.telephone}</a>
                  </td>
                  <td style={{ ...s.td, color: lead.siret ? '#9CA3AF' : '#374151', fontSize: 12 }}>
                    {lead.siret || '—'}
                  </td>
                  <td style={{ ...s.td, color: '#9CA3AF', fontSize: 12 }}>{lead.ville}</td>
                  <td style={s.td}>
                    <span style={{
                      ...s.badge,
                      background: STATUSES[lead.status]?.bg || '#1F2937',
                      color: STATUSES[lead.status]?.color || '#9CA3AF',
                    }}>
                      {STATUSES[lead.status]?.label || lead.status}
                    </span>
                  </td>
                  <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                    {lead.status === 'bloctel' ? (
                      <span style={{ color: '#DC2626', fontSize: 12, marginRight: 8 }}>🚫 Interdit</span>
                    ) : (
                      !['closer', 'refuse', 'raccroche'].includes(lead.status) && (
                        <button className="btn-call" style={s.btnCall} onClick={() => startCall(lead)}>
                          📞 Appeler
                        </button>
                      )
                    )}
                    <button style={{
                      ...s.btnIcon,
                      color: lead.status === 'bloctel' ? '#6B7280' : '#DC2626',
                      borderColor: lead.status === 'bloctel' ? '#1F2937' : '#450A0A',
                    }} title={lead.status === 'bloctel' ? 'Retirer Bloctel' : 'Marquer Bloctel'}
                      onClick={() => toggleBloctel(lead)}>🚫</button>
                    <button style={s.btnIcon} onClick={() => deleteLead(lead.id)} title="Supprimer">🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Calling Banner ── */}
      {callingLead && !showModal && (
        <div style={s.callingBanner}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>📞 Appel en cours — {callingLead.nom}</div>
            <div style={{ color: '#FCD34D', fontFamily: "'IBM Plex Mono', monospace", fontSize: 14 }}>
              {callingLead.telephone}
            </div>
          </div>
          <button style={s.btnEndCall} onClick={() => { setModalNote(''); setShowModal(true) }}>
            ✅ Fin d'appel
          </button>
        </div>
      )}

      {/* ── Post-Call Modal ── */}
      {showModal && callingLead && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={s.modal}>
            <div style={s.modalTitle}>Comment s'est passé l'appel ?</div>
            <div style={s.modalSub}>{callingLead.nom} · {callingLead.telephone}</div>
            <div style={s.modalBtns}>
              {[
                { status: 'refuse',    label: '🚫 Refusé',   desc: 'Pas intéressé' },
                { status: 'raccroche', label: '📴 Raccroché', desc: 'A raccroché' },
                { status: 'r2',        label: '🔁 R2',        desc: 'À rappeler' },
                { status: 'closer',    label: '🔥 Closer',    desc: 'À closer !' },
              ].map(({ status, label, desc }) => (
                <button key={status} style={{
                  ...s.modalBtn,
                  borderColor: STATUSES[status].color,
                  color: STATUSES[status].color,
                }} onClick={() => setCallResult(status)}>
                  <span style={{ fontSize: 22 }}>{label}</span>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>{desc}</span>
                </button>
              ))}
            </div>
            <textarea style={s.noteInput} rows={2} value={modalNote}
              onChange={e => setModalNote(e.target.value)}
              placeholder="Note optionnelle (rappeler mardi, demande un devis…)" />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = {
  root: { fontFamily: "'IBM Plex Mono', monospace", background: '#0A0A0A', minHeight: '100vh', color: '#E5E7EB', paddingBottom: 120 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 16px', borderBottom: '1px solid #1F2937', background: 'linear-gradient(135deg, #0A0A0A 0%, #0F1A0F 100%)' },
  logo: { fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, color: '#F59E0B', letterSpacing: 2 },
  subtitle: { color: '#4B5563', fontSize: 11, marginTop: 2, letterSpacing: 1 },
  statsBar: { display: 'flex', gap: 24 },
  stat: { textAlign: 'center' },
  statNum: { display: 'block', fontSize: 24, fontWeight: 700, fontFamily: "'Syne', sans-serif" },
  statLabel: { fontSize: 10, color: '#4B5563', letterSpacing: 1 },
  signOutBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#374151', fontSize: 11, textDecoration: 'underline' },
  panel: { background: '#0D0D0D', borderBottom: '1px solid #1A1A1A', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 },
  panelRow: { display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 10, color: '#4B5563', letterSpacing: 1.5 },
  input: { background: '#111', border: '1px solid #1F2937', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: '#E5E7EB', outline: 'none', fontFamily: "'IBM Plex Mono', monospace", minWidth: 160 },
  checkLabel: { display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#9CA3AF', fontSize: 13 },
  linkBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#4B5563', fontSize: 12, textDecoration: 'underline', padding: 0 },
  btnPrimary: { background: '#F59E0B', color: '#000', border: 'none', borderRadius: 7, padding: '9px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: "'Syne', sans-serif", whiteSpace: 'nowrap' },
  btnDanger: { background: '#1A0A0A', color: '#EF4444', border: '1px solid #450A0A', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" },
  log: { background: '#050505', border: '1px solid #1A2A1A', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#4ADE80', fontFamily: "'IBM Plex Mono', monospace", maxHeight: 100, overflowY: 'auto', lineHeight: 1.7 },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 24px', borderBottom: '1px solid #111', flexWrap: 'wrap', gap: 8 },
  filterBtn: { background: 'none', border: '1px solid', borderRadius: 20, padding: '4px 12px', cursor: 'pointer', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", transition: 'all 0.15s' },
  tableWrap: { overflowX: 'auto', padding: '0 24px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 10, letterSpacing: 1.5, color: '#374151', textAlign: 'left', padding: '12px 12px 8px', borderBottom: '1px solid #111' },
  td: { padding: '10px 12px', borderBottom: '1px solid #0F0F0F', fontSize: 13, verticalAlign: 'middle' },
  badge: { display: 'inline-block', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 },
  phone: { color: '#34D399', textDecoration: 'none', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 },
  btnCall: { background: '#F59E0B', color: '#000', border: 'none', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, marginRight: 6, fontFamily: "'Syne', sans-serif" },
  btnIcon: { background: 'none', border: '1px solid #1F2937', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#4B5563', marginRight: 4 },
  callingBanner: { position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg, #0A2010, #0D2010)', border: '1px solid #34D399', borderRadius: 12, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 24, boxShadow: '0 0 40px rgba(52,211,153,0.15)', zIndex: 1000 },
  btnEndCall: { background: '#34D399', color: '#000', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 800, fontSize: 14, fontFamily: "'Syne', sans-serif" },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' },
  modal: { background: '#111', border: '1px solid #1F2937', borderRadius: 16, padding: 32, width: 460, boxShadow: '0 24px 80px rgba(0,0,0,0.6)' },
  modalTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, color: '#F9FAFB', marginBottom: 6 },
  modalSub: { color: '#6B7280', fontSize: 12, marginBottom: 24 },
  modalBtns: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 },
  modalBtn: { background: '#0A0A0A', border: '2px solid', borderRadius: 10, padding: '14px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', fontFamily: "'IBM Plex Mono', monospace" },
  noteInput: { width: '100%', background: '#0A0A0A', border: '1px solid #1F2937', borderRadius: 8, padding: '10px 12px', color: '#E5E7EB', fontSize: 13, resize: 'none', outline: 'none', fontFamily: "'IBM Plex Mono', monospace" },
}
