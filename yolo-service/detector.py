"""YOLO inference integration for the existing pothole model."""

from __future__ import annotations

import base64
import io
import os
from abc import ABC, abstractmethod
from typing import Any

from PIL import Image


BBox = dict[str, float]


class Detector(ABC):
    @abstractmethod
    def detect_image(
        self,
        image_bytes: bytes,
        lat: float | None = None,
        lng: float | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def detect_video(
        self,
        video_bytes: bytes,
        gps_track: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError


def _encode_image(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _gps_for_frame(
    gps_track: list[dict[str, Any]] | None,
    frame_index: int,
    timestamp: float | None = None,
) -> tuple[float | None, float | None]:
    if not gps_track:
        return None, None

    if any("timestamp" in point or "time" in point for point in gps_track):
        target = timestamp if timestamp is not None else float(frame_index) / 30.0
        closest = min(
            gps_track,
            key=lambda point: abs(float(point.get("timestamp", point.get("time", 0.0))) - target),
        )
        return closest.get("lat"), closest.get("lng")

    point = gps_track[min(frame_index, len(gps_track) - 1)]
    return point.get("lat"), point.get("lng")


class UnavailableDetector(Detector):
    def detect_image(
        self,
        image_bytes: bytes,
        lat: float | None = None,
        lng: float | None = None,
    ) -> list[dict[str, Any]]:
        raise RuntimeError("YOLO weights are unavailable; inference is disabled.")

    def detect_video(
        self,
        video_bytes: bytes,
        gps_track: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        raise RuntimeError("YOLO weights are unavailable; inference is disabled.")


class YoloV8Detector(Detector):
    def __init__(self, weights_path: str) -> None:
        from ultralytics import YOLO

        self.model = YOLO(weights_path)

    def _boxes_from_result(
        self, result: Any, image: Image.Image, frame_number: int, timestamp: float,
        lat: float | None, lng: float | None,
    ) -> list[dict[str, Any]]:
        detections: list[dict[str, Any]] = []
        width, height = image.size
        encoded = _encode_image(image)
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return detections

        names = getattr(self.model, "names", {})
        xywhn = boxes.xywhn.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        class_ids = boxes.cls.cpu().numpy()

        for xywh, conf, cls_id in zip(xywhn, confs, class_ids):
            cx, cy, w, h = [float(v) for v in xywh]
            class_name = names.get(int(cls_id), "pothole")
            detections.append(
                {
                    "class_name": class_name,
                    "bbox": {
                        "x": max(0.0, cx - w / 2),
                        "y": max(0.0, cy - h / 2),
                        "w": min(1.0, w),
                        "h": min(1.0, h),
                    },
                    "confidence": float(conf),
                    "frame_image_b64": encoded,
                    "frame_number": frame_number,
                    "timestamp": timestamp,
                    "lat": lat,
                    "lng": lng,
                    "image_size": {"width": width, "height": height},
                }
            )
        return detections

    def detect_image(
        self,
        image_bytes: bytes,
        lat: float | None = None,
        lng: float | None = None,
    ) -> list[dict[str, Any]]:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        results = self.model.predict(source=image, verbose=False)
        if not results:
            return []
        return self._boxes_from_result(results[0], image, 0, 0.0, lat, lng)

    def detect_video(
        self,
        video_bytes: bytes,
        gps_track: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        import tempfile

        detections: list[dict[str, Any]] = []
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as tmp:
            tmp.write(video_bytes)
            tmp.flush()
            results = self.model.predict(source=tmp.name, stream=True, verbose=False)
            for index, result in enumerate(results):
                if index % 15 != 0:
                    continue
                plotted = result.orig_img
                image = Image.fromarray(plotted[..., ::-1])
                timestamp = float(index) / 30.0
                lat, lng = _gps_for_frame(gps_track, index, timestamp)
                detections.extend(
                    self._boxes_from_result(result, image, index, timestamp, lat, lng)
                )
        return detections


def get_detector() -> Detector:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    default_weights = os.path.join(base_dir, "best.pt")
    weights = os.environ.get("YOLO_WEIGHTS_PATH") or default_weights
    if os.path.exists(weights):
        os.environ.setdefault("YOLO_WEIGHTS_PATH", weights)
        return YoloV8Detector(weights)
    return UnavailableDetector()
