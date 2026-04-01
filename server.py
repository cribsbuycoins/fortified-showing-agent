#!/usr/bin/env python3
"""Fortified Showing Agent Application — Backend Server"""
import asyncio
import json
import os
import time
import base64
import httpx
from datetime import datetime
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import pytz

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SHEET_ID = "14RtpFBd0dGp1gcsoWiUe9t4ihi29zhJmaeuEtIGUAyg"
CHAT_WEBHOOK = "https://chat.googleapis.com/v1/spaces/AAQAdS7gYW4/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=cwGbECCB4q2bfD2tjZI7nXrBGHzP9nMd14j2RMNpIww"
UPLOAD_DIR = "/home/user/workspace/uploads"

os.makedirs(UPLOAD_DIR, exist_ok=True)


async def call_tool(source_id, tool_name, arguments):
    proc = await asyncio.create_subprocess_exec(
        "external-tool", "call", json.dumps({
            "source_id": source_id, "tool_name": tool_name, "arguments": arguments,
        }),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode())
    return json.loads(stdout.decode())


@app.post("/api/submit")
async def submit_application(request: Request):
    try:
        data = await request.json()

        full_name = data.get("fullName", "Unknown")
        phone = data.get("phone", "N/A")
        file_name = data.get("fileName", "video.mp4")
        mime_type = data.get("mimeType", "video/mp4")
        file_data_b64 = data.get("fileData", "")

        # Save video locally
        safe_name = "".join(c for c in full_name if c.isalnum() or c in " -").strip()[:50]
        ts = int(time.time())
        local_filename = f"{safe_name}-{ts}-{file_name}"
        local_path = os.path.join(UPLOAD_DIR, local_filename)

        video_bytes = base64.b64decode(file_data_b64)
        with open(local_path, "wb") as f:
            f.write(video_bytes)

        # Build video URL (served from this backend)
        video_url = f"/api/video/{local_filename}"

        # Log to Google Sheet
        et = pytz.timezone("America/New_York")
        timestamp = datetime.now(et).strftime("%m/%d/%Y %I:%M:%S %p")

        await call_tool("google_sheets__pipedream", "google_sheets-add-single-row", {
            "sheetId": SHEET_ID,
            "worksheetId": 0,
            "hasHeaders": True,
            "Timestamp": timestamp,
            "Full Name": full_name,
            "Phone": phone,
            "Video Link": video_url
        })

        # Send Google Chat notification
        try:
            async with httpx.AsyncClient() as client:
                await client.post(CHAT_WEBHOOK, json={
                    "text": f"🏠 *New Showing Agent Application*\n\n*Name:* {full_name}\n*Phone:* {phone}\n*Video:* {video_url}"
                })
        except Exception:
            pass  # Don't fail if chat notification fails

        return JSONResponse({"status": "ok"})

    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=422)


@app.get("/api/video/{filename}")
async def serve_video(filename: str):
    path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(path):
        return FileResponse(path)
    return JSONResponse({"error": "not found"}, status_code=404)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
