from io import BytesIO
import json
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from gtts import gTTS
from gtts.tts import gTTSError

app = Flask(__name__)
DATA_FILE = Path(app.root_path) / "data.json"

# Accents for English come from different Google domains (tld)
ALLOWED_LANGS = {"en", "vi"}
ALLOWED_TLDS = {"com", "co.uk", "com.au", "co.in", "ca"}


def load_data():
    if not DATA_FILE.exists():
        return {"items": [], "books": []}
    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"items": [], "books": []}
    if not isinstance(data, dict):
        return {"items": [], "books": []}
    items = data.get("items") if isinstance(data.get("items"), list) else []
    books = data.get("books") if isinstance(data.get("books"), list) else []
    return {"items": items, "books": books}


def save_data(data):
    payload = {
        "items": data.get("items", []),
        "books": data.get("books", []),
    }
    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


@app.route("/api/data", methods=["GET", "POST"])
def api_data():
    if request.method == "GET":
        return jsonify(load_data())

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify(error="Invalid JSON payload."), 400

    save_data(data)
    return jsonify(success=True)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/speak", methods=["POST"])
def speak():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    lang = data.get("lang", "en")
    tld = data.get("tld", "com")
    slow = bool(data.get("slow", False))

    if not text:
        return jsonify(error="Type some text first."), 400
    if len(text) > 5000:
        return jsonify(error="Text is too long. Keep it under 5000 characters."), 400
    if lang not in ALLOWED_LANGS:
        lang = "en"
    if tld not in ALLOWED_TLDS:
        tld = "com"

    try:
        buffer = BytesIO()
        gTTS(text=text, lang=lang, tld=tld, slow=slow).write_to_fp(buffer)
        buffer.seek(0)
    except gTTSError as e:
        return jsonify(error=f"Google TTS failed: {e}. Check your internet connection."), 502

    return send_file(buffer, mimetype="audio/mpeg", download_name="speech.mp3")


if __name__ == "__main__":
    # Listen on all network interfaces so other devices (phone, laptop) can open it.
    # Debug mode stays off here: its interactive debugger must not be reachable from the network.
    # Turn it on locally with: FLASK_DEBUG=1 python app.py
    app.run(host="0.0.0.0", port=5000, debug=os.environ.get("FLASK_DEBUG") == "1")
