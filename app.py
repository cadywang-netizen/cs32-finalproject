from flask import Flask, request, jsonify, session, redirect, send_from_directory
import requests
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder="static")
app.secret_key = os.urandom(24)

CLIENT_ID = "222006"
CLIENT_SECRET = "1c6cc6c22a33219f2939b12731ab4b1cfa4cb9a8"
STRAVA_BASE = "https://www.strava.com/api/v3"

_codespace = os.environ.get("CODESPACE_NAME")
_fwd_domain = os.environ.get("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN")
if _codespace and _fwd_domain:
    REDIRECT_URI = f"https://{_codespace}-5000.{_fwd_domain}/callback"
else:
    REDIRECT_URI = "http://localhost:5000/callback"


#serve frontend
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


#authentication/redirect to strava login
@app.route("/login")
def login():
    url = (
        f"https://www.strava.com/oauth/authorize"
        f"?client_id={CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={REDIRECT_URI}"
        f"&approval_prompt=force"
        f"&scope=read,activity:read"
    )
    return redirect(url)


# ── Auth: handle Strava callback ────────────────────────────────
@app.route("/callback")
def callback():
    code = request.args.get("code")
    if not code:
        return redirect("/?error=no_code")

    res = requests.post("https://www.strava.com/oauth/token", data={
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "grant_type": "authorization_code",
    })
    data = res.json()

    if "access_token" not in data:
        return redirect("/?error=auth_failed")

    session["token"] = data["access_token"]
    session["athlete"] = data["athlete"]
    return redirect("/")


# logout
@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


#api: getting current user info
@app.route("/api/me")
def me():
    if "athlete" not in session:
        return jsonify({"error": "not_logged_in"}), 401
    return jsonify(session["athlete"])


#api: explore segments near user location
@app.route("/api/segments")
def segments():
    if "token" not in session:
        return jsonify({"error": "not_logged_in"}), 401

    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    radius = request.args.get("radius", 1, type=int)
    if not lat or not lng:
        return jsonify({"error": "missing lat/lng"}), 400

    # scale offsets by radius so wider searches find new segments
    r = max(1, min(radius, 3))
    step = 0.08 * r
    box = 0.09 * r
    lng_box = 0.13 * r
    offsets = [
        (0, 0),
        (step, 0), (-step, 0),
        (0, step * 1.5), (0, -step * 1.5),
        (step, step * 1.5), (-step, -step * 1.5),
        (step * 2, 0), (-step * 2, 0),
        (0, step * 3), (step * 2, step * 1.5),
    ]

    seen_ids = set()
    all_segments = []

    for dlat, dlng in offsets:
        clat, clng = lat + dlat, lng + dlng
        bounds = f"{clat - box},{clng - lng_box},{clat + box},{clng + lng_box}"
        res = requests.get(f"{STRAVA_BASE}/segments/explore", params={
            "bounds": bounds,
            "activity_type": "running",
        }, headers={"Authorization": f"Bearer {session['token']}"})

        if res.ok:
            for seg in res.json().get("segments", []):
                if seg["id"] not in seen_ids:
                    seen_ids.add(seg["id"])
                    all_segments.append(seg)

    return jsonify(all_segments)


#api: get segment info
@app.route("/api/segments/<int:segment_id>")
def segment_detail(segment_id):
    if "token" not in session:
        return jsonify({"error": "not_logged_in"}), 401

    res = requests.get(f"{STRAVA_BASE}/segments/{segment_id}",
        headers={"Authorization": f"Bearer {session['token']}"})

    if not res.ok:
        return jsonify({"error": "strava_error"}), res.status_code

    return jsonify(res.json())


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
