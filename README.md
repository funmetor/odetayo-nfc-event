# Team Odetayo — NFC Event Access System

Guest registration + NFC entrance check-in, tested end-to-end locally. Three pages:

- `/register.html` — guest registration (name, email, phone, plus-one, tap to capture card ID)
- `/checkin.html` — entrance check-in (tap card → access granted / already used / not registered)
- `/admin.html` — upload the invite list (CSV), see live stats and the guest list

## Important: NFC support

Reading NFC tags from a web page only works via the **Web NFC API**, which is supported
**only in Chrome on Android**, and only over **HTTPS** (or `localhost`). It will not work
on iPhone, desktop Chrome, or Safari at all — that's an Apple/browser restriction, not
something this code can work around. Every page also has a manual "Card ID" text field
so you can test the whole flow from any device without physical NFC hardware.

## Run it locally

```
npm install
npm start
```

Then open `http://localhost:3000/register.html`.

## Deploy to Vercel (for real-device testing)

The NFC reader requires HTTPS, so `localhost` alone won't let you test on your phone —
you need a real public HTTPS URL. **Vercel** has a free tier that works well for this:

1. Push this folder to a new GitHub repo
2. Go to https://vercel.com and sign in with GitHub
3. Click **New Project** → import your repo
4. Vercel auto-detects the framework — just click **Deploy**
5. (Optional) Add environment variables from `.env.example` in the Vercel dashboard
   under **Settings → Environment Variables** if you want real welcome emails
6. Vercel gives you a public `https://your-app.vercel.app` URL
7. On an Android phone with Chrome, open `https://your-app.vercel.app/checkin.html`
   and tap a real NFC card to test.

**Note on data persistence:** this app uses an in-memory data store for Vercel
compatibility. Data resets on each cold start (serverless). For production use,
swap `db.js` for a hosted database (e.g. free tiers of Supabase, MongoDB Atlas,
or Vercel KV).

## CSV format for the invite list (admin page)

```
name,email,phone,plus_one
Amaka Obi,amaka@example.com,0803...,TRUE
Tunde Bello,tunde@example.com,0705...,FALSE
```
