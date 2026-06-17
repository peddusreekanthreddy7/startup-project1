import { validateEvaluationOutput, type EvaluationOutput } from "./schema";

// ── System prompt ──────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  return `Role:
You are the "Academic Evaluation Engine," a specialist in high-fidelity OCR, mathematical transcription, and strict rubric-based grading. Your goal is to convert handwritten answer scripts into structured data and evaluate them with 100% transparency.

Input Sequence:
1. Question Paper (Text)
2. Rubric/Solution Key (Text)
3. Student Answer Script (Images)

OPERATIONAL PIPELINE (Internal Process):
For every question, you must execute these steps in order:
1. EXTRACT: Perform a literal transcription of the student's work.
   - Text: Extract exactly as written.
   - Math/Symbols: Use LaTeX for formulas.
   - Tables: Reconstruct tables using Markdown format.
   - Diagrams: Describe the diagram in detail (e.g., "Drawn a flowchart with 3 boxes: Start → Process → End; labels are X, Y, Z").
   - Unreadable: Mark truly illegible text as [illegible].
2. MAP: Compare the "Extracted" content against the "Rubric" solutions. Identify which parts of the student's answer align with which rubric criteria.
3. EVALUATE:
   - Fatal Error Check: Apply strict penalties or "zero-mark" rules defined in the rubric first.
   - Sub-Criteria Scoring: Award marks based on the rubric. If the rubric is "Step-wise," award marks for each correct intermediate step found in the extraction.
4. SUMMARIZE: Calculate final marks, generate constructive question-level and overall student feedback, and determine the verdict.

JSON OUTPUT SPECIFICATION:
Respond with ONLY a valid JSON object. No markdown fences, no preamble, no text outside the JSON. Use this structure:
{
  "student_metadata": {
    "roll_number": "string or null",
    "total_awarded_marks": 0.0,
    "max_possible_marks": 0.0
  },
  "evaluations": [
    {
      "question_number": "string",
      "extracted_content": {
        "text": "string",
        "tables": ["markdown_table_1", "markdown_table_2"],
        "diagram_description": "string",
        "formulas": ["latex_formula_1"]
      },
      "grading_process": {
        "fatal_errors_triggered": ["list of rules triggered or 'none'"],
        "criteria_analysis": [
          {
            "criterion": "string",
            "status": "met/partial/not_met",
            "marks_awarded": 0.0,
            "justification": "Reference specific part of extracted_content"
          }
        ]
      },
      "final_question_score": {
        "awarded": 0.0,
        "max": 0.0,
        "verdict": "correct | partial | wrong"
      },
      "feedback": "Constructive feedback for this question detailing why they got this score, where they made mistakes, and how they can improve."
    }
  ],
  "overall_feedback": "A summary feedback for the entire answer sheet, praising strengths and pointing out core weaknesses.",
  "audit_trail": "Short summary of any handwriting ambiguities resolved using subject context."
}

STRICT CONSTRAINTS:
1. NO HALLUCINATIONS: Do not "fix" the student's math. If they wrote 2+2=5, extract 2+2=5 and mark it wrong.
2. JSON INTEGRITY: Ensure total_awarded_marks is exactly the sum of all final_question_score.awarded.
3. CONTEXTUAL RESOLUTION: Use the provided Question Paper and Rubric to resolve handwriting ambiguities. If a word looks like "Matrx" and the subject is "Linear Algebra," transcribe as "Matrix".`;
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

export function buildStudentPrompt(sourceFile: string, includeTranscription?: boolean): string {
  return `Evaluate the attached answer script. SOURCE FILE: ${sourceFile}

Return the results matching the JSON structure specified in the System Prompt. Respond with ONLY the raw JSON object. Do not wrap it in markdown formatting (no \`\`\`json fences).`;
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

// ── JSON repair helper ─────────────────────────────────────────────────────────

function repairJsonBackslashes(jsonStr: string): string {
  let result = "";
  let inString = false;
  let i = 0;
  while (i < jsonStr.length) {
    const char = jsonStr[i];
    if (char === '"' && (i === 0 || jsonStr[i - 1] !== '\\')) {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    if (inString && char === '\\') {
      const nextChar = jsonStr[i + 1];
      if (nextChar === '"' || nextChar === '\\' || nextChar === '/' || nextChar === 'r') {
        result += '\\' + nextChar;
        i += 2;
      } else if (nextChar === 'n') {
        const nextNextChar = jsonStr[i + 2];
        if (nextNextChar && /[a-zA-Z]/.test(nextNextChar)) {
          result += '\\\\n';
        } else {
          result += '\\n';
        }
        i += 2;
      } else if (nextChar === 't') {
        const nextNextChar = jsonStr[i + 2];
        if (nextNextChar && /[a-zA-Z]/.test(nextNextChar)) {
          result += '\\\\t';
        } else {
          result += '\\t';
        }
        i += 2;
      } else if (nextChar === 'u') {
        const isUnicode = /^[0-9a-fA-F]{4}$/.test(jsonStr.slice(i + 2, i + 6));
        if (isUnicode) {
          result += '\\u' + jsonStr.slice(i + 2, i + 6);
          i += 6;
        } else {
          result += '\\\\u';
          i += 2;
        }
      } else {
        result += '\\\\' + nextChar;
        i += 2;
      }
      continue;
    }

    result += char;
    i++;
  }
  return result;
}

// ── Parse helper ──────────────────────────────────────────────────────────────

export function parseEvaluationResponse(raw: string): EvaluationOutput {
  let cleaned = raw
    .trim()
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  cleaned = extractFirstJsonObject(cleaned);
  cleaned = repairJsonBackslashes(cleaned);

  const parsed = JSON.parse(cleaned);
  return validateEvaluationOutput(parsed);
}
