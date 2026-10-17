from io import BytesIO
import importlib.util
import json
import os
from pathlib import Path
import threading
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
# When a Redis store is connected (Vercel > Storage > Upstash Redis), the same JSON is kept in Redis instead.
# The first time, it starts from the data.json in the repo.
REDIS_URL = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
REDIS_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
REDIS_KEY = "data.json"


def redis(*command):
    req = urllib.request.Request(
        REDIS_URL,
        data=json.dumps(command).encode("utf-8"),
        headers={"Authorization": f"Bearer {REDIS_TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)["result"]


def read_data_file():
    if not DATA_FILE.exists():
        return {"items": [], "books": []}
    with DATA_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_data():
    try:
        if REDIS_URL and REDIS_TOKEN:
            stored = redis("GET", REDIS_KEY)
            data = json.loads(stored) if stored is not None else read_data_file()
        else:
            data = read_data_file()
    except (OSError, ValueError, KeyError):
        # Raise instead of returning empty data: the page would then save the empty list over everything
        raise DataError("Could not load the saved data.")
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
        if REDIS_URL and REDIS_TOKEN:
            redis("SET", REDIS_KEY, json.dumps(payload, ensure_ascii=False))
            return
        # Write a temp file first, then swap it in: a crash mid-write can't leave a half-written data.json
        tmp = DATA_FILE.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DATA_FILE)
    except (OSError, ValueError, KeyError):
        raise DataError("Could not save the data.")


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
