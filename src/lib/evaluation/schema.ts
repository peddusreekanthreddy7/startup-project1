// ── Per-question evaluation result ────────────────────────────────────────────

export interface QuestionResult {
  qno: string;                        // "1", "2a", "4b" etc.
  awarded_marks: number;
  max_marks: number;
  verdict: "correct" | "partial" | "wrong";
  question_confidence?: number;        // 0.0–1.0, how confident AI is in this evaluation
  fatal_error_triggered?: string | null; // null or description of fatal error rule applied
  criteria_met?: string[];             // rubric sub-criteria fully satisfied (optional)
  criteria_not_met?: string[];         // rubric sub-criteria not satisfied (optional)
  ai_feedback: string;                // detailed evaluation
  correct_approach: string;           // ideal answer from rubric
  student_answer_text?: string | null; // verbatim transcription — optional
  deductions: Array<{
    reason: string;
    marks: number;
  }>;
}

// ── Per-student result ─────────────────────────────────────────────────────────

export interface StudentResult {
  roll_number: string;            // extracted from answer script cover page
  name_detected: string | null;
  page_start: number;             // 1-indexed
  page_end: number;
  extraction_confidence: number;  // 0.0 – 1.0 for roll number read confidence
  total_awarded: number;
  total_max: number;
  questions: QuestionResult[];
}

// ── Top-level pipeline output ──────────────────────────────────────────────────

export interface EvaluationOutput {
  pipeline_version: string;
  processed_at: string;           // ISO 8601
  source_file: string;
  total_pages: number;
  students_detected: number;
  students: StudentResult[];
  unresolved_roll_numbers: string[];
  parse_warnings: string[];
}

// ── Validation ─────────────────────────────────────────────────────────────────

export function validateEvaluationOutput(raw: unknown): EvaluationOutput {
  const obj = raw as EvaluationOutput;
  if (!obj || typeof obj !== "object") throw new Error("Output is not an object");
  if (!Array.isArray(obj.students)) throw new Error("Missing students array");

  // Ensure top-level arrays exist (Gemma may omit them)
  if (!Array.isArray(obj.parse_warnings)) obj.parse_warnings = [];
  if (!Array.isArray(obj.unresolved_roll_numbers)) obj.unresolved_roll_numbers = [];

  for (const s of obj.students) {
    if (!s.roll_number) throw new Error("Student missing roll_number");
    if (!Array.isArray(s.questions)) s.questions = [];

    // Cross-validate total
    const calculatedTotal = s.questions.reduce((sum, q) => sum + (q.awarded_marks ?? 0), 0);
    if (Math.abs(calculatedTotal - (s.total_awarded ?? 0)) > 0.5) {
      // Fix mismatch — trust per-question marks
      obj.parse_warnings.push(
        `Roll ${s.roll_number}: total_awarded mismatch (AI said ${s.total_awarded}, calculated ${calculatedTotal}). Using calculated value.`
      );
      s.total_awarded = calculatedTotal;
    }

    for (const q of s.questions) {
      if (!q.qno) throw new Error(`Missing qno in student ${s.roll_number}`);
      if (typeof q.awarded_marks !== "number") q.awarded_marks = 0;

      // Boundary guards
      if (q.awarded_marks < 0) {
        obj.parse_warnings.push(`Roll ${s.roll_number} Q${q.qno}: negative marks (${q.awarded_marks}), clamped to 0`);
        q.awarded_marks = 0;
      }
      if (q.awarded_marks > q.max_marks) {
        obj.parse_warnings.push(`Roll ${s.roll_number} Q${q.qno}: awarded (${q.awarded_marks}) > max (${q.max_marks}), clamped`);
        q.awarded_marks = q.max_marks;
      }

      if (!["correct", "partial", "wrong"].includes(q.verdict)) q.verdict = "wrong";
      if (!Array.isArray(q.deductions)) q.deductions = [];
      if (!Array.isArray(q.criteria_met)) q.criteria_met = [];
      if (!Array.isArray(q.criteria_not_met)) q.criteria_not_met = [];
      if (typeof q.question_confidence !== "number") q.question_confidence = 0.8;
      if (typeof q.fatal_error_triggered !== "string") q.fatal_error_triggered = null;
    }
  }
  return obj;
}
