# Routeswipe

A Tinder-style web app for discovering running routes. Connect your Strava account (so make sure you have a Strava account set up), set your daily distance and terrain preferences, then "swipe" (click heart) to save routes you like or  to skip them. The app learns from your likes over time and ranks new routes to match your running style.

## Features

- **Strava OAuth login** - authenticates via Strava and reads your public profile
- **Daily preference picker** — choose a distance range (short / medium / long) and terrain type (flat / rolling / hilly) before each session
- **Swipe-to-discover** — browse Strava segments near your current GPS location presented as cards with an embedded map, distance, elevation gain, and runner count
- **Smart ranking** — routes are scored using a blend of Strava popularity signals and a Gaussian preference model built from your liked routes (distance, elevation, and geographic centroid)
- **Saved tab** — view all liked routes in a list; tap any to open a full interactive map and stats; remove routes you no longer want
- **Auto-expanding search** — if no unseen routes exist at the current radius, the search automatically widens up to 3×

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
- A Strava account (free)
- The Strava API credentials already configured in `app.py` (`CLIENT_ID` and `CLIENT_SECRET` on lines 11-12 point to the registered Strava application for this project)

### Install dependencies

```bash
pip install flask requests python-dotenv
```

### Start the server

```bash
python app.py
```

The app runs on port 5000. Open `http://localhost:5000` in your browser.

### GitHub Codespaces

The app auto-detects when it is running inside a Codespace and sets the Strava OAuth redirect URI to the correct public forwarding URL (`https://<codespace>-5000.<domain>/callback`). No extra configuration is needed so just run `python app.py` and open the forwarded port 5000 in your browser.

### Location permission

The browser will ask for your location when you start a session. The app needs GPS coordinates to find segments near you. If you deny location access, route loading will fail with an error message.

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
- **[Strava API](https://developers.strava.com/)** — all segment data (geometry, distance, elevation, athlete counts)

### Generative AI usage

**I used Claude Code (Anthropic)** as a coding assistant/my "duck" throughout development. Specific contributions vs mine include:

- I designed and implemented the core recommendation system architecture, including user profiling, scoring logic, and ranking pipeline in script.js. Claude assisted in refining parts of the mathematical formulation (e.g., recommenging the Gaussian soft-matching and cold-start blending), but the overall system design, feature selection, and weighting strategy were my own.
- I developed the multi-query geospatial search strategy in app.py (/api/segments), including the idea of using offset bounding boxes and deduplication to improve coverage. Claude helped streamline parts of the implementation.
- I integrated and adapted the polyline decoding logic in script.js based on standard algorithms that I found when Googling, with Claude assisting in the translation and cleanup.

The overall product concept, UI design, Strava OAuth integration structure, and swipe interaction model were written by the project author.
