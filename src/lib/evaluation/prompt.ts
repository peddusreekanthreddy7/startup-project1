import type { EvaluationOutput } from "./schema";

// ── System prompt ──────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  return `You are a JSON-only exam evaluation API. Respond with ONLY a valid JSON object — no markdown, no fences, no text outside the JSON.

EVALUATION METHOD — for EACH question, follow this order:
1. FATAL ERROR CHECK: If rubric defines fatal/strict penalty rules for this question, check those FIRST. If triggered, apply the penalty cap and skip sub-criteria.
2. SUB-CRITERIA: Evaluate each rubric criterion individually. State which criteria met/not met in ai_feedback.
3. MARKS: Sum sub-criteria marks (or apply fatal error cap). awarded_marks must be >= 0 and <= max_marks.
4. VERDICT: correct (>=80%), partial (>=30%), wrong (<30%).

HANDWRITING: Use context + subject vocabulary to resolve illegible words. Truly unreadable → "[illegible]".
DIAGRAMS: Evaluate visually — check states, transitions, labels, correctness. Describe what student drew.
MULTI-STUDENT: Detect cover pages with roll numbers to split students.
CROSS-CHECK: total_awarded must equal sum of all question awarded_marks.

Start with { and end with }.`;
}

// ── Static exam context — cached per exam ─────────────────────────────────────

export function buildExamContext(
  questionPaper: string,
  rubric: string,
  examMeta: { title: string; subject: string; totalMarks: number }
): string {
  return `EXAM: ${examMeta.title} | Subject: ${examMeta.subject} | Total Marks: ${examMeta.totalMarks}

QUESTION PAPER:
${questionPaper}

MARKING SCHEME / RUBRIC (follow each sub-criterion and penalty rule exactly):
${rubric}`;
}

// ── Per-student prompt ────────────────────────────────────────────────────────

export function buildStudentPrompt(sourceFile: string, includeTranscription: boolean): string {
  const transcriptionField = includeTranscription
    ? `"student_answer_text": "<concise but complete transcription of the student's answer — include key equations, steps, and reasoning, omit filler>",`
    : "";

  return `Evaluate the attached answer script. SOURCE FILE: ${sourceFile}

Return ONLY this JSON:
{
  "pipeline_version": "1.1",
  "processed_at": "<ISO 8601>",
  "source_file": "${sourceFile}",
  "total_pages": <number>,
  "students_detected": <number>,
  "students": [
    {
      "roll_number": "<from cover page>",
      "name_detected": "<string or null>",
      "page_start": <1-indexed>,
      "page_end": <1-indexed>,
      "extraction_confidence": <0.0-1.0>,
      "total_awarded": <number>,
      "total_max": <number>,
      "questions": [
        {
          "qno": "<e.g. 1, 2a>",
          "awarded_marks": <number>,
          "max_marks": <number>,
          "verdict": "correct" | "partial" | "wrong",
          "question_confidence": <0.0-1.0>,
          "fatal_error_triggered": <null or "description">,
          "ai_feedback": "<which rubric criteria met/not met, what student did right/wrong, specific deduction reasons>",
          "correct_approach": "<ideal answer>",${transcriptionField}
          "deductions": [{ "reason": "<specific>", "marks": <number> }]
        }
      ]
    }
  ],
  "unresolved_roll_numbers": [],
  "parse_warnings": []
}`;
}

// ── JSON extractor ────────────────────────────────────────────────────────────

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No { found in response");

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  const end = text.lastIndexOf("}");
  if (end > start) return text.slice(start, end + 1);

  throw new Error(`Unmatched braces in response. Raw (first 300): ${text.slice(0, 300)}`);
}

// ── Parse helper ──────────────────────────────────────────────────────────────

export function parseEvaluationResponse(raw: string): EvaluationOutput {
  let cleaned = raw
    .trim()
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  cleaned = extractFirstJsonObject(cleaned);

  return JSON.parse(cleaned) as EvaluationOutput;
}
