import { validateEvaluationOutput, type EvaluationOutput } from "./schema";

// ── System prompt ──────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  return `You are the "Academic Evaluation Engine", a high-performance system for verbatim handwritten text transcription (OCR) and strict rubric-based grading.

### OBJECTIVE
1. Transcribe the handwritten answer script word-for-word with absolute precision.
2. Grade the transcription against the provided Question Paper and Rubric.

### THINKING PROCESS CONSTRAINTS
- Keep your internal thinking process structured, objective, and highly concise.
- Focus directly on locating question boundaries, transcribing, matching criteria, and scoring.
- Avoid verbose, repetitive, or circular reasoning logs to minimize latency and prevent confusion.

### PIPELINE STEPS
Execute these steps linearly for each question found:
1. **EXTRACT**: Perform a literal, verbatim transcription of the student's work for the question.
   - **Text**: Transcribe the student's text word-for-word exactly as written. Never summarize, paraphrase, shorten, or skip sentences.
   - **Math**: Output all math formulas in LaTeX.
   - **Tables**: Format tables using Markdown notation.
   - **Diagrams**: Provide a brief, objective description of any drawings/flowcharts.
2. **MAP & EVALUATE**:
   - Check if any "Fatal Error" or zero-mark rules defined in the rubric are triggered.
   - Map the student's extracted answer to the Rubric sub-criteria.
   - Assign marks strictly according to the Rubric scoring rules. Do not award points for content not present in the extraction.

### JSON OUTPUT FORMAT
Produce ONLY a valid JSON object. No explanation, no markdown fences, no text outside the JSON.
{
  "student_metadata": {
    "roll_number": "extracted roll number or null if missing",
    "total_awarded_marks": 0.0,
    "max_possible_marks": 0.0
  },
  "evaluations": [
    {
      "question_number": "string (e.g. '1', '2a')",
      "extracted_content": {
        "text": "CRITICAL: Complete, verbatim word-for-word transcription of the student's entire answer text. Never summarize or omit sentences.",
        "tables": ["markdown table string or empty array"],
        "diagram_description": "description string or null",
        "formulas": ["LaTeX formula string or empty array"]
      },
      "grading_process": {
        "fatal_errors_triggered": ["list of rules triggered or 'none'"],
        "criteria_analysis": [
          {
            "criterion": "description of the rubric criterion",
            "status": "met | partial | not_met",
            "marks_awarded": 0.0,
            "justification": "Direct quote or reference to the verbatim text in extracted_content.text"
          }
        ]
      },
      "final_question_score": {
        "awarded": 0.0,
        "max": 0.0,
        "verdict": "correct | partial | wrong"
      },
      "feedback": "Constructive feedback explaining the marks, errors made, and how to improve."
    }
  ],
  "overall_feedback": "Summary feedback for the entire exam sheet.",
  "audit_trail": "Brief notes on any handwriting ambiguities resolved."
}

### STRICT CONSTRAINTS
1. **NO HALLUCINATIONS**: Do not "fix" the student's spelling, grammar, or mathematical calculations during transcription. Extract exactly what is on the page.
2. **JSON INTEGRITY**: The sum of all question scores must equal 'total_awarded_marks'.
3. **NO PREAMBLE/POSTAMBLE**: Output raw JSON only.`;
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
