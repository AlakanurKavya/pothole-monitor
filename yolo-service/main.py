"""FastAPI bridge for an existing YOLOv8 pothole model.

This service is the only AI integration point for the web app.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from detector import UnavailableDetector, YoloV8Detector, get_detector

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_PATH = os.path.join(BASE_DIR, "best.pt")
if not os.environ.get("YOLO_WEIGHTS_PATH") and os.path.exists(DEFAULT_MODEL_PATH):
    os.environ["YOLO_WEIGHTS_PATH"] = DEFAULT_MODEL_PATH

detector = get_detector()
inference_lock = asyncio.Lock()


def _parse_gps_track(gps_track: str | None, latitude: float | None, longitude: float | None) -> list[dict[str, Any]] | None:
    if latitude is not None and longitude is not None:
        return [{"lat": latitude, "lng": longitude}]

    if not gps_track:
        return None

    try:
        parsed = json.loads(gps_track)
    except json.JSONDecodeError as exc:
        raise ValueError("gps_track must be valid JSON") from exc

    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        return [parsed]
    raise ValueError("gps_track must be a JSON array or object")


app = FastAPI(title="Pothole Detection API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    model_loaded = isinstance(detector, YoloV8Detector)
    model_path = os.environ.get("YOLO_WEIGHTS_PATH") or DEFAULT_MODEL_PATH
    return {
        "status": "ok" if model_loaded else "model_unavailable",
        "service": "pothole-detection-api",
        "model_loaded": model_loaded,
        "model_path": model_path,
        "mode": "yolov8" if model_loaded else "unavailable",
    }


@app.post("/detect/image")
async def detect_image_endpoint(
    file: UploadFile = File(...),
    lat: float | None = Form(default=None),
    lng: float | None = Form(default=None),
) -> dict[str, Any]:
    if isinstance(detector, UnavailableDetector):
        raise HTTPException(status_code=503, detail="YOLO weights are unavailable; inference is disabled.")
    payload = await file.read()
    async with inference_lock:
        detections = await run_in_threadpool(detector.detect_image, payload, lat=lat, lng=lng)
    return {"detections": detections, "source": "image"}


@app.post("/api/detect/image")
async def detect_image_api(
    file: UploadFile = File(...),
    lat: float | None = Form(default=None),
    lng: float | None = Form(default=None),
) -> dict[str, Any]:
    return await detect_image_endpoint(file=file, lat=lat, lng=lng)


@app.post("/detect/video")
async def detect_video_endpoint(
    file: UploadFile = File(...),
    gps_track: str | None = Form(default=None),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
) -> dict[str, Any]:
    if isinstance(detector, UnavailableDetector):
        raise HTTPException(status_code=503, detail="YOLO weights are unavailable; inference is disabled.")
    payload = await file.read()
    track = _parse_gps_track(gps_track, latitude, longitude)
    async with inference_lock:
        detections = await run_in_threadpool(detector.detect_video, payload, gps_track=track)
    return {"detections": detections, "source": "video"}


@app.post("/api/detect/video")
async def detect_video_api(
    file: UploadFile = File(...),
    gps_track: str | None = Form(default=None),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
) -> dict[str, Any]:
    return await detect_video_endpoint(file=file, gps_track=gps_track, latitude=latitude, longitude=longitude)

