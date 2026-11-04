# AI-Driven Autonomous Pothole Detection and Road Condition Monitoring System

Government road-condition monitoring: YOLOv8 proposes detections; officials verify, reject, or correct them before a pothole is official.

## Architecture

Public media and live phone-camera frames are sent by Next.js to the FastAPI YOLOv8 service and persisted through one server-side pipeline into Supabase. The vehicle dashboard pairs with a phone over a one-time QR link; WebRTC carries live video and GPS directly to the laptop, while Supabase Realtime carries pairing/signaling messages. Only pothole candidates above the session threshold are persisted. Government officials verify candidates and manage severity, priority, map, and maintenance.

The Next.js app never trains a model and does not call a generic image-recognition API. All inference goes through `yolo-service/`.

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS
- Supabase Auth, PostgreSQL, Storage, RLS
- Leaflet / OpenStreetMap
- FastAPI sidecar using `yolo-service/best.pt`

## 1. Supabase

1. Create a Supabase project. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. The service-role key is server-only; never prefix it with `NEXT_PUBLIC_` or put it in browser code.
2. Confirm migrations 001–009 are applied. Before migration 010, inspect hosted Realtime policies and grants using the read-only SQL checks documented in the migration comments. Then apply `010_vehicle_camera_pairing.sql` in the SQL editor. Never run the pairing migration against a different Supabase project from the one configured in the app.
3. Confirm the private Storage bucket `pothole-images` exists (created by the schema migration).
4. The government account must exist in Supabase Auth, have a matching `public.profiles` row with the same user UUID, and have `role = 'government'`. If promotion is needed, run:

```sql
update public.profiles
set role = 'government'
where id = (select id from auth.users where email = 'admin@example.gov');
```

Only users with `profiles.role = 'government'` can sign in to the protected `/dashboard` and `/vehicle` laptop routes. Vehicle operators do not receive accounts: a government administrator creates a temporary QR pairing from `/vehicle`, and the phone opens `/vehicle-camera` without signing in. The phone's single-use pairing token authorizes its short-lived camera, GPS, and WebRTC session.

Use the same Supabase project URL and anon key in the app. For confirmation and password-reset flows, set the Supabase Site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback` in Redirect URLs. An unconfirmed Auth user must be confirmed in Supabase Auth; do not weaken the application's role checks.

For password recovery across email apps and browsers, update the Supabase **Reset Password** email template action URL to pass the one-time token hash directly to the callback:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

The callback verifies this recovery token with Supabase and creates the short-lived recovery session. Keep `http://localhost:3000/auth/callback` in the Redirect URLs allowlist. Existing PKCE `code` callback links remain supported.

## 2. YOLOv8 service

```bash
cd yolo-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The service loads `best.pt` by default. If the weights are unavailable, health reports `model_unavailable` and inference returns HTTP 503; it does not generate mock detections. To select a different existing weights file:

```bash
set YOLO_WEIGHTS_PATH=C:\Users\Admin\pothole-monitor\yolo-service\best.pt
uvicorn main:app --reload --port 8000
```

The model loads once when the service starts. FastAPI only performs inference; it does not connect to Supabase or persist records. Detection API:

- `GET /health`
- `POST /detect/image` (multipart file, optional `lat`, `lng`)
- `POST /detect/video` (multipart file, optional `gps_track` JSON)

Returns bounding box, confidence, frame image, frame number/timestamp, and GPS when provided.

## 3. Web app

```bash
copy .env.example .env.local
npm install
npm run dev
```

Run FastAPI in a second terminal on port 8000. Set `NEXT_PUBLIC_APP_URL` in `.env.local` to the public HTTPS origin that both the laptop and phone can reach, then restart Next.js. The `/vehicle` dashboard creates a short-lived pairing link and QR; the phone opens `/vehicle-camera`. The phone requests rear-camera and GPS permissions only after the operator taps **Start Camera**. WebRTC sends the live stream and timestamped GPS peer-to-peer; no video file is uploaded. The laptop dashboard does not request camera access. Once the remote stream is connected, **Start Monitoring** samples that stream every 1–2 seconds and sends frames to FastAPI. Only positive pothole detections are stored through the shared persistence helper; frames without a fresh phone GPS sample are discarded before inference.

The dashboard URL must be HTTPS and reachable from the phone; localhost, loopback, and private LAN addresses are rejected for QR pairing. For local testing, install and start a trusted HTTPS tunnel yourself (the app does not install or start one). For example, with ngrok installed, run `ngrok http 3000`; copy its HTTPS forwarding origin into `NEXT_PUBLIC_APP_URL` in `.env.local`, then restart Next.js. Do not use the generated HTTP forwarding URL. Tunnel URLs can change, so update the variable and restart when they do. WebRTC uses STUN for direct ICE negotiation; some carrier or restrictive networks also require a TURN relay. Public reports post to Next.js and need no government sign-in. Set `YOLO_API_URL` in `.env.local` if FastAPI is not at `http://127.0.0.1:8000`.

| Role | Routes |
| --- | --- |
| Government administrator | `/dashboard`, `/dashboard/map`, `/dashboard/verify/[id]`, `/dashboard/potholes/[id]`, `/vehicle` |
| Mobile phone (temporary pairing; no account) | `/vehicle-camera` |
| Public | `/report`, `/my-reports` |

Public reports and vehicle detections both flow through `lib/persist-detections.ts`, use `ai_detections` with source `public` or `vehicle`, and are grouped into `pothole_locations`. Live detections retain per-candidate pending/verification status and positive-frame hashes prevent duplicate writes. Camera sessions use `vehicle_uploads`; legacy `vehicle_videos` rows are retained, copied into canonical upload records by migration 007, and are no longer written by FastAPI. The government map reads the shared detections and locations. Pairing creation requires a government administrator; mobile redemption uses a one-time token hashed at rest, expires after five minutes, and is invalidated when the session closes.

Verification options: **Correct Detection**, **False Detection / Reject**, **Modify Detection** (adjusted box stored in `verification_records`; original AI box remains on `ai_detections`).

Location grouping uses a ~40 m Haversine radius. Priority uses severity, repeat public reports, vehicle detections, age, location weight, and repaired status — not YOLO confidence. Officials can override priority.

## Demo seed

Pairing-link helper tests run with `npm run test:pairing` on Node 22 or newer. These are unit tests; they do not prove hosted Supabase policies or physical phone WebRTC connectivity.

`002_seed.sql` is a demo-only seed file that inserts clustered sample potholes around New Delhi (`P001`–`P005`). It is not part of the required production runtime and should not be used as a fallback when the database is empty. For a safe cleanup, use the script at `supabase/cleanup_demo_seed.sql` and review the affected IDs before deleting anything. Do not delete unknown or user-generated records automatically.
