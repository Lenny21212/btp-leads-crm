-- ─── BTP Leads CRM — Schema Supabase ───────────────────────────────────────
-- Colle ce SQL dans : Supabase Dashboard → SQL Editor → New query → Run

-- Table principale des leads
create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  scrape_date  timestamptz,
  user_id      uuid references auth.users(id) on delete set null,

  -- Données artisan
  source       text,          -- 'Pages Jaunes' | 'Google Maps'
  metier       text,          -- 'Électricien', 'Plombier', etc.
  nom          text not null default '—',
  dirigeant    text,
  telephone    text,
  siret        text,
  ville        text,
  adresse      text,
  site_web     text,

  -- CRM
  status       text not null default 'new'
                 check (status in ('new','calling','bloctel','refuse','raccroche','r2','closer')),
  note         text default ''
);

-- Index pour les recherches fréquentes
create index if not exists leads_status_idx     on public.leads(status);
create index if not exists leads_telephone_idx  on public.leads(telephone);
create index if not exists leads_scrape_date_idx on public.leads(scrape_date desc);

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table public.leads enable row level security;

-- Tout utilisateur connecté peut voir tous les leads (leads partagés en équipe)
create policy "Equipe — lecture"
  on public.leads for select
  to authenticated
  using (true);

-- Tout utilisateur connecté peut insérer
create policy "Equipe — insertion"
  on public.leads for insert
  to authenticated
  with check (true);

-- Tout utilisateur connecté peut modifier (update statut, note…)
create policy "Equipe — modification"
  on public.leads for update
  to authenticated
  using (true);

-- Seul le créateur peut supprimer (ou n'importe qui si user_id est null)
create policy "Equipe — suppression"
  on public.leads for delete
  to authenticated
  using (auth.uid() = user_id or user_id is null);

-- ─── Realtime ────────────────────────────────────────────────────────────────
-- Active le realtime sur la table pour la sync en direct entre membres
alter publication supabase_realtime add table public.leads;
