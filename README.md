# Routeswipe

A Tinder-style web app for discovering running routes. Connect your Strava account, set your daily distance and terrain preferences, optionally pick a race training goal, then "swipe" (click the heart) to save routes you like or skip them. The app learns from your likes and your Strava run history over time, ranking new routes to match your running style.

## Features

- **Strava OAuth login**: authenticates via Strava and reads your public profile and recent run history
- **Daily preference picker**: choose a distance range (short / medium / long) and terrain type (flat / rolling / hilly) before each session
- **Training goal**: set a race target (5K, 10K, half-marathon, or full marathon) that persists across sessions; the recommender nudges you toward progressively longer routes as you build fitness
- **Swipe-to-discover**: browse Strava segments near your current GPS location presented as cards with an embedded map, distance, elevation gain, and runner count
- **Smart ranking**: routes are scored using a blend of Strava popularity signals and a Gaussian preference model built from your liked routes (distance, elevation, and geographic centroid)
- **Warm-start profiling**: your 10 most recent Strava runs are fetched on login and seed the recommendation model so it is useful from your very first session, not just after you have liked many routes
- **Saved tab**: view all liked routes in a list; tap any to open a full interactive map and stats; remove routes you no longer want
- **Auto-expanding search**: if no unseen routes exist at the current radius, the search automatically widens up to 3×

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3 · Flask |
| Strava data | [Strava API v3](https://developers.strava.com/docs/reference/) |
| Frontend | Vanilla JS · HTML · CSS |
| Maps | [Leaflet.js 1.9.4](https://leafletjs.com/) · CartoDB Voyager tiles |
| Fonts | Google Fonts (Bebas Neue, DM Sans) |

## Running the app

### Prerequisites

- Python 3.9+
- A free [Strava](https://www.strava.com) account

No personal API key is required — `app.py` already contains the `CLIENT_ID` and `CLIENT_SECRET` for the registered Strava application. You only need a Strava account to log in.

### Install dependencies

```bash
pip install flask requests python-dotenv
```

### Start the server

```bash
python app.py
```

The app runs on port 5000. Open `http://localhost:5000` in your browser and click **Connect with Strava** to log in.

### GitHub Codespaces

The app auto-detects when it is running inside a Codespace and sets the Strava OAuth redirect URI to the correct public forwarding URL (`https://<codespace>-5000.<domain>/callback`). No extra configuration is needed — just run `python app.py` and open the forwarded port 5000 in your browser.

### Location permission

The browser will ask for your location when you start a session. The app needs GPS coordinates to find segments near you. If you deny location access, route loading will fail with an error message.

### Strava permissions

When you connect with Strava the app requests two OAuth scopes:

- `read` — your public profile (name and avatar)
- `activity:read` — your recent run history, used to warm-start the recommendation model

The app never posts anything to Strava on your behalf.

## Project structure

```
cs32-finalproject/
├── app.py              # Flask backend: OAuth flow + Strava API proxy
└── static/
    ├── index.html      # Single-page app shell
    ├── script.js       # All frontend logic (state, ranking, maps, UI)
    └── style.css       # Styles
```

## External contributors and sources

### Libraries

- **[Leaflet.js](https://leafletjs.com/)** (BSD 2-Clause) — interactive maps on swipe cards and the route detail modal
- **[CartoDB Basemaps](https://carto.com/basemaps/)** — map tile layer used by Leaflet
- **[Strava API](https://developers.strava.com/)** — all segment data (geometry, distance, elevation, athlete counts) and user activity history

### Generative AI usage

**I used Claude Code (Anthropic)** as a coding assistant throughout development. Specific contributions vs. mine:

- I designed and implemented the core recommendation system architecture, including user profiling, scoring logic, and ranking pipeline in `script.js`. Claude assisted in refining parts of the mathematical formulation (e.g., suggesting the Gaussian soft-matching and cold-start blending), but the overall system design, feature selection, and weighting strategy were my own.
- I developed the training goal scoring logic (`trainingGoalScore`), including the progressive-overload target distance formula and the confidence-blending approach that weights liked routes more heavily than past activities. Claude helped debug and tune the weight constants.
- I developed the multi-query geospatial search strategy in `app.py` (`/api/segments`), including the idea of using offset bounding boxes and deduplication to improve coverage. Claude helped streamline parts of the implementation.
- I integrated and adapted the polyline decoding logic in `script.js` based on standard algorithms I found while researching the Strava encoded-polyline format, with Claude assisting in the translation and cleanup.

The overall product concept, UI design, Strava OAuth integration structure, warm-start profiling idea, and swipe interaction model were written by the project author.
