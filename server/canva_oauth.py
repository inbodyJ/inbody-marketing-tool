"""
canva_oauth.py — Canva OAuth Callback Server
"""

import os
import requests
from flask import Flask, request
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent / ".env")

app = Flask(__name__)

CANVA_CLIENT_ID     = os.getenv("CANVA_CLIENT_ID",     "")
CANVA_CLIENT_SECRET = os.getenv("CANVA_CLIENT_SECRET", "")
CANVA_REDIRECT_URI  = os.getenv("CANVA_REDIRECT_URI",  "https://inbody-marketing-tool.vercel.app/callback")


@app.route("/callback")
def canva_callback():
    code = request.args.get("code")
    if not code:
        return "Missing code parameter", 400

    response = requests.post(
        "https://api.canva.com/rest/v1/oauth/token",
        data={
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  CANVA_REDIRECT_URI,
            "client_id":     CANVA_CLIENT_ID,
            "client_secret": CANVA_CLIENT_SECRET,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    return response.text, response.status_code


if __name__ == "__main__":
    app.run(debug=True, port=5001)
