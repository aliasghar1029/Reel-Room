# Reel Room

A lightweight content-planning tool for creators running multiple Facebook pages.
Pure HTML/CSS/JS, deployable free on GitHub Pages, no server needed — all data is
stored in **your own Google Drive** (the app can only see files it creates).

## Features
- One workspace per Facebook page
- Ideas table: title, description, hashtags, scheduled date, thumbnail, video
- A separate **Master / Sticky Prompt** per page (your base style / system prompt)
- Tick "Uploaded" and the reel automatically moves to the **Uploaded Reels** tab
- Fully responsive (phone, tablet, desktop)
- Sign in with Google — no passwords to manage

## Setup
See `SETUP_GUIDE.md` (Roman Urdu) for the full step-by-step: getting a free Google
Client ID and deploying to GitHub Pages. Takes about 15–20 minutes, one-time.

## Files
- `index.html` — page structure
- `style.css` — styling
- `app.js` — app logic + Google Drive integration
- `config.js` — paste your Google Client ID here
- `SETUP_GUIDE.md` — setup instructions
