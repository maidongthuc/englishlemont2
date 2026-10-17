from datetime import datetime, timezone
from io import BytesIO
import importlib.util
import json
import os
from pathlib import Path
import threading
import urllib.error
import urllib.request

from flask import Flask, jsonify, render_template, request, send_file
from gtts import gTTS
from gtts.tts import gTTSError

app = Flask(__name__)
DATA_FILE = Path(app.root_path) / "data.json"

# Accents for English come from different Google domains (tld)
ALLOWED_LANGS = {"en", "vi"}
ALLOWED_TLDS = {"com", "co.uk", "com.au", "co.in", "ca"}

# Speech to text runs locally with faster-whisper (same Whisper models, ~4x faster than openai-whisper, no ffmpeg needed).
# Pick a bigger model for better accuracy: tiny.en, base.en, small.en, medium.en
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base.en")
MAX_AUDIO_BYTES = 10 * 1024 * 1024
_whisper = None
_whisper_lock = threading.Lock()


def get_whisper():
    # Load the model once, on the first recording (downloads it the first time)
    global _whisper
    with _whisper_lock:
        if _whisper is None:
            from faster_whisper import WhisperModel
            _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        return _whisper


# On Vercel the app's files are read-only, so data.json can't be saved there.
# When SUPABASE_URL and SUPABASE_KEY are set, the same JSON is kept in Supabase (table app_data, see supabase.sql).
# The first time, it starts from the data.json in the repo. Without them, data.json is used (local).
ON_VERCEL = os.environ.get("VERCEL") == "1"
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or ""
USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_KEY)
DATA_ROW_ID = "main"


def supabase_request(method, query="", body=None, prefer=None):
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/app_data{query}",
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        text = res.read().decode("utf-8")
        return json.loads(text) if text else None


def storage_error(action, e):
    if not USE_SUPABASE and ON_VERCEL:
        return DataError("No database is connected. In Vercel add SUPABASE_URL and SUPABASE_KEY "
                         "under Settings > Environment Variables, then redeploy.")
    if isinstance(e, urllib.error.HTTPError):
        detail = e.read().decode("utf-8", "replace")[:300]
        if e.code == 404 or "PGRST205" in detail:
            return DataError("The app_data table is missing in Supabase. Run supabase.sql in the Supabase SQL Editor.")
        if e.code in (401, 403) or "42501" in detail:
            return DataError("Supabase refused the request. Check SUPABASE_KEY and the table's access policy (supabase.sql).")
        return DataError(f"Could not {action} the data: Supabase error {e.code} {detail}")
    return DataError(f"Could not {action} the data ({type(e).__name__}).")


def read_data_file():
    if not DATA_FILE.exists():
        return {"items": [], "books": []}
    with DATA_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_data():
    try:
        if USE_SUPABASE:
            rows = supabase_request("GET", f"?id=eq.{DATA_ROW_ID}&select=data")
            data = rows[0]["data"] if rows else read_data_file()
        else:
            data = read_data_file()
    except Exception as e:
        # Raise instead of returning empty data: the page would then save the empty list over everything
        raise storage_error("load", e)
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
    try:
        if USE_SUPABASE:
            updated_at = datetime.now(timezone.utc).isoformat()
            supabase_request("POST", body={"id": DATA_ROW_ID, "data": payload, "updated_at": updated_at},
                             prefer="resolution=merge-duplicates,return=minimal")
            return
        if ON_VERCEL:
            raise OSError("Vercel's files are read-only")
        # Write a temp file first, then swap it in: a crash mid-write can't leave a half-written data.json
        tmp = DATA_FILE.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DATA_FILE)
    except Exception as e:
        raise storage_error("save", e)


class DataError(Exception):
    pass


@app.route("/api/data", methods=["GET", "POST"])
def api_data():
    try:
        if request.method == "GET":
            return jsonify(load_data())

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(error="Invalid JSON payload."), 400

        save_data(data)
        return jsonify(success=True)
    except DataError as e:
        return jsonify(error=str(e)), 503


@app.route("/")
def index():
    # Without faster-whisper (e.g. on Vercel) the page uses the browser's own speech recognition instead
    return render_template("index.html", whisper_available=importlib.util.find_spec("faster_whisper") is not None)


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


@app.route("/transcribe", methods=["POST"])
def transcribe():
    audio = request.files.get("audio")
    if audio is None:
        return jsonify(error="No recording received."), 400
    data = audio.read(MAX_AUDIO_BYTES + 1)
    if not data:
        return jsonify(error="The recording is empty."), 400
    if len(data) > MAX_AUDIO_BYTES:
        return jsonify(error="The recording is too long."), 400

    try:
        model = get_whisper()
    except ImportError:
        return jsonify(error="Speech recognition is not installed. Run: pip install faster-whisper"), 503
    except OSError:
        # ctranslate2.dll needs the Microsoft Visual C++ Redistributable on Windows
        return jsonify(error="Speech recognition can't start. Install the Microsoft Visual C++ Redistributable: "
                             "https://aka.ms/vs/17/release/vc_redist.x64.exe"), 503

    try:
        # The whole model call is serialized: one CPU model, one recording at a time
        with _whisper_lock:
            segments, _ = model.transcribe(BytesIO(data), language="en", beam_size=5, vad_filter=True)
            text = " ".join(s.text.strip() for s in segments).strip()
    except Exception as e:
        return jsonify(error=f"Could not understand the recording: {e}"), 400

    return jsonify(text=text)


if __name__ == "__main__":
    # Listen on all network interfaces so other devices (phone, laptop) can open it.
    # Debug mode stays off here: its interactive debugger must not be reachable from the network.
    # Turn it on locally with: FLASK_DEBUG=1 python app.py
    app.run(host="0.0.0.0", port=5000, debug=os.environ.get("FLASK_DEBUG") == "1")
