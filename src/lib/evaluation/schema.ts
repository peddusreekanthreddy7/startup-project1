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

  // New fields
  feedback?: string | null;
  formulas?: string[] | null;
  tables?: string[] | null;
  diagram_description?: string | null;
  criteria_analysis?: Array<{
    criterion: string;
    status: "met" | "partial" | "not_met";
    marks_awarded: number;
    justification: string;
  }> | null;
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
  
  // New fields
  overall_feedback?: string | null;
  audit_trail?: string | null;
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

  // New fields
  overall_feedback?: string | null;
  audit_trail?: string | null;
}

// ── Validation ─────────────────────────────────────────────────────────────────

export function validateEvaluationOutput(raw: unknown): EvaluationOutput {
  if (!raw || typeof raw !== "object") throw new Error("Output is not an object");

  const rawObj = raw as any;

  // Check if it is the new structure (has evaluations array or student_metadata)
  const isRestructured = ("student_metadata" in rawObj) || ("evaluations" in rawObj);

  if (isRestructured) {
    const studentMeta = rawObj.student_metadata || {};
    const rawEvaluations = Array.isArray(rawObj.evaluations) ? rawObj.evaluations : [];

    const studentQuestions: QuestionResult[] = rawEvaluations.map((q: any) => {
      const qno = q.question_number || "unknown";
      const ext = q.extracted_content || {};
      const grad = q.grading_process || {};
      const score = q.final_question_score || {};
      
      const fatalErrors = Array.isArray(grad.fatal_errors_triggered) ? grad.fatal_errors_triggered : [];
      const fatalErrorTriggered = fatalErrors.length > 0 && fatalErrors[0] !== "none" ? fatalErrors[0] : null;

      const criteriaAnalysis = Array.isArray(grad.criteria_analysis) ? grad.criteria_analysis : [];
      const criteriaMet = criteriaAnalysis.filter((c: any) => c.status === "met").map((c: any) => c.criterion);
      const criteriaNotMet = criteriaAnalysis.filter((c: any) => c.status === "not_met").map((c: any) => c.criterion);

      // Map to QuestionResult format
      const qResult: QuestionResult = {
        qno,
        awarded_marks: typeof score.awarded === "number" ? score.awarded : 0,
        max_marks: typeof score.max === "number" ? score.max : 0,
        verdict: ["correct", "partial", "wrong"].includes(score.verdict) ? score.verdict : "wrong",
        question_confidence: 0.8,
        fatal_error_triggered: fatalErrorTriggered,
        criteria_met: criteriaMet,
        criteria_not_met: criteriaNotMet,
        ai_feedback: q.feedback || "",
        correct_approach: "",
        student_answer_text: ext.text || null,
        deductions: [],
        
        feedback: q.feedback || null,
        formulas: Array.isArray(ext.formulas) ? ext.formulas : [],
        tables: Array.isArray(ext.tables) ? ext.tables : [],
        diagram_description: ext.diagram_description || null,
        criteria_analysis: criteriaAnalysis.map((c: any) => ({
          criterion: c.criterion || "",
          status: ["met", "partial", "not_met"].includes(c.status) ? c.status : "not_met",
          marks_awarded: typeof c.marks_awarded === "number" ? c.marks_awarded : 0,
          justification: c.justification || "",
        })),
      };

      // Boundary guards
      if (qResult.awarded_marks < 0) {
        qResult.awarded_marks = 0;
      }
      if (qResult.awarded_marks > qResult.max_marks) {
        qResult.awarded_marks = qResult.max_marks;
      }

      return qResult;
    });

    const totalAwarded = typeof studentMeta.total_awarded_marks === "number" 
      ? studentMeta.total_awarded_marks 
      : studentQuestions.reduce((sum, q) => sum + q.awarded_marks, 0);

    const totalMax = typeof studentMeta.max_possible_marks === "number"
      ? studentMeta.max_possible_marks
      : studentQuestions.reduce((sum, q) => sum + q.max_marks, 0);

    const studentResult: StudentResult = {
      roll_number: studentMeta.roll_number || "unknown",
      name_detected: null,
      page_start: 1,
      page_end: 1,
      extraction_confidence: 1.0,
      total_awarded: totalAwarded,
      total_max: totalMax,
      questions: studentQuestions,
      overall_feedback: rawObj.overall_feedback || null,
      audit_trail: rawObj.audit_trail || null,
    };

    return {
      pipeline_version: "2.0",
      processed_at: new Date().toISOString(),
      source_file: "unknown",
      total_pages: 1,
      students_detected: 1,
      students: [studentResult],
      unresolved_roll_numbers: studentResult.roll_number === "unknown" ? ["unknown"] : [],
      parse_warnings: [],
      overall_feedback: rawObj.overall_feedback || null,
      audit_trail: rawObj.audit_trail || null,
    };
  }

  // Fallback for old format
  const obj = raw as EvaluationOutput;
  if (!Array.isArray(obj.students)) throw new Error("Missing students array");
  if (!Array.isArray(obj.parse_warnings)) obj.parse_warnings = [];
  if (!Array.isArray(obj.unresolved_roll_numbers)) obj.unresolved_roll_numbers = [];

  for (const s of obj.students) {
    if (!s.roll_number) throw new Error("Student missing roll_number");
    if (!Array.isArray(s.questions)) s.questions = [];

    const calculatedTotal = s.questions.reduce((sum, q) => sum + (q.awarded_marks ?? 0), 0);
    if (Math.abs(calculatedTotal - (s.total_awarded ?? 0)) > 0.5) {
      obj.parse_warnings.push(
        `Roll ${s.roll_number}: total_awarded mismatch (AI said ${s.total_awarded}, calculated ${calculatedTotal}). Using calculated value.`
      );
      s.total_awarded = calculatedTotal;
    }

    for (const q of s.questions) {
      if (!q.qno) throw new Error(`Missing qno in student ${s.roll_number}`);
      if (typeof q.awarded_marks !== "number") q.awarded_marks = 0;

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
