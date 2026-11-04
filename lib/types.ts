export type UserRole = "government" | "vehicle_operator" | "public";
export type DetectionSource = "vehicle" | "public";
export type ProcessingStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "ai_disconnected";
export type VerificationStatus = "pending" | "verified" | "rejected" | "corrected";
export type SeverityLevel = "low" | "medium" | "high";
export type MaintenanceStatus =
  | "reported"
  | "verified"
  | "assigned"
  | "under_repair"
  | "repaired";
export type PriorityLevel = "low" | "medium" | "high";

export type BBox = { x: number; y: number; w: number; h: number };

export type Profile = {
  id: string;
  full_name: string | null;
  role: UserRole;
  vehicle_id: string | null;
};

export type PotholeLocation = {
  id: string;
  public_id: string;
  latitude: number;
  longitude: number;
  address: string | null;
  public_report_count: number;
  vehicle_detection_count: number;
  severity: SeverityLevel | null;
  verification_status: VerificationStatus;
  maintenance_status: MaintenanceStatus;
  computed_priority: PriorityLevel;
  priority_override: PriorityLevel | null;
  location_weight: number;
  first_reported_at: string;
  updated_at: string;
};

export type AiDetection = {
  id: string;
  source: DetectionSource;
  vehicle_upload_id: string | null;
  public_report_id: string | null;
  pothole_location_id: string | null;
  frame_image_path: string;
  bbox: BBox;
  confidence: number;
  verification_status?: VerificationStatus;
  frame_number: number | null;
  video_timestamp: number | null;
  captured_at?: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  pothole_locations?: PotholeLocation | null;
};

export type PublicReport = {
  id: string;
  reporter_id: string | null;
  report_code: string;
  storage_path: string;
  latitude: number;
  longitude: number;
  reported_at: string;
  processing_status: ProcessingStatus;
  processing_error: string | null;
};

export type VehicleUpload = {
  id: string;
  operator_id: string;
  vehicle_id: string;
  storage_path: string;
  gps_track: { lat: number; lng: number }[] | null;
  uploaded_at: string;
  processing_status: ProcessingStatus;
  processing_error: string | null;
};

export type VerificationRecord = {
  id: string;
  ai_detection_id: string;
  pothole_location_id: string | null;
  verified_by: string;
  action: VerificationStatus;
  original_bbox: BBox;
  corrected_bbox: BBox | null;
  notes: string | null;
  created_at: string;
};

export type YoloDetection = {
  class_name?: string;
  bbox: BBox;
  confidence: number;
  frame_image_b64: string;
  frame_number: number;
  timestamp: number;
  lat: number | null;
  lng: number | null;
  captured_at?: string;
  frame_hash?: string;
  detection_index?: number;
};
