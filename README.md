# ⚡ BTP Leads CRM

CRM de prospection artisans (électriciens, plombiers, chauffagistes…)  
Scraping Apify · Filtrage Bloctel · Sync équipe temps réel · Auth email/password

---

## 🚀 Deploy en 10 minutes

### 1. Supabase (base de données + auth)

1. Va sur [supabase.com](https://supabase.com) → ton projet existant (ou crée-en un nouveau gratuit)
2. **SQL Editor** → **New query** → colle tout le contenu de `schema.sql` → **Run**
3. Récupère tes clés : **Settings → API**
   - `Project URL` → c'est ton `VITE_SUPABASE_URL`
   - `anon public` key → c'est ton `VITE_SUPABASE_ANON_KEY`

### 2. GitHub

```bash
git init
git add .
git commit -m "init btp-leads-crm"
# Crée un repo GitHub et push
git remote add origin https://github.com/TON_USER/btp-leads-crm.git
git push -u origin main
```

### 3. Vercel (hébergement gratuit)

1. Va sur [vercel.com](https://vercel.com) → **New Project** → importe ton repo GitHub
2. Dans **Environment Variables**, ajoute :
   - `VITE_SUPABASE_URL` = `https://XXXXXXXX.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `eyJ...`
3. **Deploy** → Vercel te donne une URL genre `https://btp-leads-crm.vercel.app`

**C'est tout.** L'app est en ligne, accessible depuis n'importe quel appareil.

---

## 👥 Inviter l'équipe

Partage simplement l'URL Vercel.  
Chaque membre crée son compte via l'écran de connexion (ou tu peux désactiver l'inscription libre dans Supabase → **Authentication → Settings → Disable signups** et inviter manuellement).

Pour inviter manuellement : **Supabase → Authentication → Users → Invite user**

---

## 🔌 Proxy Bloctel (n8n)

1. Importe `bloctel-proxy.n8n.json` dans ton instance n8n
2. Active le workflow
3. Copie l'URL webhook → colle dans le champ **URL PROXY N8N** de l'app
4. Entre ton token Bloctel pro dans **CLÉ BLOCTEL**

---

## 💻 Dev local

```bash
cp .env.example .env
# Remplis les variables dans .env

npm install
npm run dev
# → http://localhost:5173
```

---

## Stack

- React + Vite
- Supabase (PostgreSQL + Auth + Realtime)
- Vercel (deploy)
- Apify (scraping Pages Jaunes + Google Maps)
- n8n (proxy Bloctel)
