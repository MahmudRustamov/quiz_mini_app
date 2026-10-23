export interface User {
  id: string;
  name: string;
  avatar_url: string | null;
  role: "student" | "teacher" | "admin";
  telegram_id: number;
  active: boolean;
}
export interface Part {
  id: string;
  label: string;
  prompt: string;
  weight: number;
  accepted?: string[];
  case_sensitive?: boolean;
  manual_review?: boolean;
}
export interface Question {
  id: string;
  position: number;
  kind: "single" | "matching" | "short" | "two_part" | "reading" | "image";
  text: string;
  topic: string;
  passage_id: string | null;
  image_paths: string[];
  options: { label: string; text: string }[];
  parts: Part[];
}
export interface Exam {
  id: string;
  title: string;
  subject: string;
  description: string;
  duration_minutes: number;
  question_count: number;
  status: string;
  certificate_thresholds: Record<string, number>;
  essay_required: boolean;
  expert_count: number;
  answer_released: boolean;
  results_published: boolean;
  questions?: Question[];
  passages?: { id: string; title: string; text: string }[];
}
export interface SavedResponse {
  question_id: string;
  answers: Record<string, string>;
  marked: boolean;
  revision: number;
}
export interface Attempt {
  id: string;
  exam_id: string;
  status: string;
  started_at: string;
  deadline: string;
  server_now: string;
  submitted_at: string | null;
  responses: SavedResponse[];
  essay_text: string;
  exam?: Exam;
  exam_title?: string;
  raw_percentage?: number;
  raw_score?: number;
  grade?: string | null;
}
export interface Grade {
  part_id: string;
  score: number | null;
  maximum: number;
  status: string;
}
export interface Result {
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  status: string;
  submitted_at: string;
  correct: number;
  incorrect: number;
  unanswered: number;
  pending_parts: number;
  raw_score: number;
  maximum: number;
  raw_percentage: number;
  essay_required: boolean;
  essay_ready: boolean;
  expert_count: number;
  assessed_experts: number;
  essay_score: number | null;
  converted_essay_score: number | null;
  theta: number | null;
  theta_se: number | null;
  z: number | null;
  t: number | null;
  final_score: number | null;
  grade: string | null;
  calibration_id: string | null;
  reference: { name: string; mean: number; sd: number } | null;
  scoring_version: string | null;
  results_published: boolean;
  answer_released: boolean;
  label: string;
  topics: { topic: string; score: number; maximum: number }[];
  review: (Question & { answers: Record<string, string>; grades: Grade[] })[];
}
export interface TeacherAttempt {
  id: string;
  exam_id: string;
  exam_title: string;
  student_name: string;
  user_id: string;
  status: string;
  essay_required: boolean;
  assessed_experts: number;
  expert_count: number;
  submitted_at: string | null;
}
export interface Rubric {
  id: string;
  source_name: string;
  source_sha256: string;
  table: Record<string, number>;
}
export interface Calibration {
  id: string;
  approved: boolean;
  diagnostics: {
    converged: boolean;
    persons: number;
    items: number;
    flags: string[];
    latent_mean: number;
    [key: string]: unknown;
  };
  reference_name: string | null;
  reference_mean: number | null;
  reference_sd: number | null;
  validation_note: string | null;
}
export interface ImportDoc {
  id: string;
  source_name: string;
  extracted: {
    verification_required: boolean;
    pages: {
      page: number;
      text: string;
      two_columns: boolean;
      scanned: boolean;
      page_image: string;
      images: string[];
      warnings: string[];
    }[];
  };
}
