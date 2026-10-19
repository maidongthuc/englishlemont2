from io import BytesIO
import importlib.util
import json
import os
import threading
import urllib.error
import urllib.request

from flask import Flask, jsonify, render_template, request, send_file, url_for
from gtts import gTTS
from gtts.tts import gTTSError

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__)

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


# All notebooks and sentences live in Supabase (see supabase.sql). People sign in with Google through Supabase;
# each request carries the person's sign-in token, and Supabase's access rules decide what they may read and change.
# On Vercel set SUPABASE_URL and SUPABASE_KEY under Settings > Environment Variables; locally put them in .env
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
# The publishable key: the sign-in page in the browser needs it, so it must never be the secret key
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or ""


def supabase_rpc(function, body, token):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{function}",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        text = res.read().decode("utf-8")
        return json.loads(text) if text else None


def storage_error(action, e):
    if isinstance(e, urllib.error.HTTPError):
        detail = e.read().decode("utf-8", "replace")[:300]
        if e.code == 401 or "PGRST301" in detail or "PGRST303" in detail:
            return DataError("Your sign-in has expired. Reload the page and sign in again.", 401)
        if e.code == 404 or "PGRST202" in detail:
            return DataError("The database is not set up. Run supabase.sql in the Supabase SQL Editor.")
        if e.code == 403 or "42501" in detail:
            return DataError("You are not allowed to change this.", 403)
        if "23503" in detail:
            return DataError(f"Could not {action} the data: a sentence points to a notebook that doesn't exist.")
        return DataError(f"Could not {action} the data: Supabase error {e.code} {detail}")
    return DataError(f"Could not {action} the data ({type(e).__name__}).")


def config_error():
    if not (SUPABASE_URL and SUPABASE_KEY):
        return ("No database is connected. Set SUPABASE_URL and SUPABASE_KEY "
                "(Vercel: Settings > Environment Variables, then redeploy; locally: the .env file).")
    if SUPABASE_KEY.startswith("sb_secret_"):
        return "SUPABASE_KEY must be the publishable key (sb_publishable_...), not the secret key."
    return None


def load_data(token):
    try:
        data = supabase_rpc("load_app_data", {}, token)
    except Exception as e:
        # Raise instead of returning empty data: the page would then save the empty list over everything
        raise storage_error("load", e)
    if not isinstance(data, dict):
        data = {}
    items = data.get("items") if isinstance(data.get("items"), list) else []
    books = data.get("books") if isinstance(data.get("books"), list) else []
    return {"items": items, "books": books, "isAdmin": data.get("isAdmin") is True}


def save_data(data, token):
    books = data.get("books") if isinstance(data.get("books"), list) else []
    items = data.get("items") if isinstance(data.get("items"), list) else []
    try:
        supabase_rpc("save_app_data", {"p_books": books, "p_items": items}, token)
    except Exception as e:
        raise storage_error("save", e)


class DataError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


@app.route("/api/data", methods=["GET", "POST"])
def api_data():
    problem = config_error()
    if problem:
        return jsonify(error=problem), 503
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.startswith("Bearer ") else ""
    if not token:
        return jsonify(error="Sign in first."), 401
    try:
        if request.method == "GET":
            return jsonify(load_data(token))

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(error="Invalid JSON payload."), 400

        save_data(data, token)
        return jsonify(success=True)
    except DataError as e:
        return jsonify(error=str(e)), e.status


@app.context_processor
def static_assets():
    # asset("js/learn.js") -> /static/js/learn.js?v=<file time>: browsers fetch the new file after each change
    def asset(path):
        try:
            version = int(os.path.getmtime(os.path.join(app.static_folder, path)))
        except OSError:
            version = 0
        return url_for("static", filename=path, v=version)
    return {"asset": asset}


@app.route("/")
def index():
    return render_template(
        "index.html",
        # Without faster-whisper (e.g. on Vercel) the page uses the browser's own speech recognition instead
        whisper_available=importlib.util.find_spec("faster_whisper") is not None,
        # Google sign-in runs in the browser with Supabase's library
        supabase_url=SUPABASE_URL,
        supabase_key="" if config_error() else SUPABASE_KEY,
        config_problem=config_error() or "",
    )


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
