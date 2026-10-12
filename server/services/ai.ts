import { GoogleGenAI, Type, type Schema } from '@google/genai';
import type { QuizQuestion, ReportMetrics, ReportNarrative } from '../../shared/types.ts';

export class AiUnavailableError extends Error {
  constructor(message = 'AI features are not configured. Add a GEMINI_API_KEY to enable them.') {
    super(message);
  }
}

export interface QuizGenInput {
  courseTitle: string;
  subject: string;
  gradeLevel: number;
  month: string;
  questionCount: number;
  homework: Array<{ title: string; instructions: string }>;
  sessionTopics: string[];
  curriculum?: string;
}

export interface HomeworkGenInput {
  courseTitle: string;
  subject: string;
  gradeLevel: number;
  curriculum?: string;
  recentTopics: string[];
  focus?: string;
  difficulty: 'easier' | 'standard' | 'challenging';
  estimatedMinutes: number;
}

export interface ReportGenInput {
  studentFirstName: string;
  grade?: number;
  monthLabel: string;
  metrics: ReportMetrics;
  organizationName: string;
}

export type GeneratedQuestion = Omit<QuizQuestion, 'id'>;

export interface AiService {
  readonly enabled: boolean;
  generateQuiz(input: QuizGenInput): Promise<GeneratedQuestion[]>;
  generateHomework(input: HomeworkGenInput): Promise<{ title: string; instructions: string }>;
  writeReport(input: ReportGenInput): Promise<ReportNarrative>;
  outlineCurriculumPdf(pdf: Buffer, title: string): Promise<string>;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function validateQuestions(raw: unknown, expected: number): GeneratedQuestion[] {
  const list = Array.isArray(raw) ? raw : (raw as { questions?: unknown[] })?.questions;
  if (!Array.isArray(list)) throw new Error('AI response did not contain questions.');
  const out: GeneratedQuestion[] = [];
  for (const q of list) {
    const item = q as Partial<GeneratedQuestion>;
    const options = Array.isArray(item.options) ? item.options.map((o) => String(o).trim()).filter(Boolean) : [];
    const answerIndex = Number(item.answerIndex);
    if (!item.prompt || options.length < 2 || options.length > 6) continue;
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) continue;
    if (new Set(options).size !== options.length) continue;
    out.push({
      prompt: String(item.prompt).trim(),
      options,
      answerIndex,
      explanation: String(item.explanation || '').trim(),
      topic: String(item.topic || 'General').trim() || 'General',
    });
  }
  if (out.length < Math.min(3, expected)) throw new Error('AI response did not contain enough valid questions.');
  return out.slice(0, expected);
}

/** Deterministic parent-report text built only from the numbers; used without AI or if AI fails. */
export function templateNarrative(input: ReportGenInput): ReportNarrative {
  const { metrics: m, studentFirstName: name } = input;
  const strengths: string[] = [];
  const focus: string[] = [];
  const topics: Array<{ topic: string; pct: number }> = [];
  for (const c of m.courses) {
    for (const [topic, s] of Object.entries(c.topicBreakdown)) {
      if (s.total) topics.push({ topic: `${topic} (${c.subject})`, pct: Math.round((100 * s.correct) / s.total) });
    }
  }
  topics.sort((a, b) => b.pct - a.pct);
  for (const t of topics.filter((t) => t.pct >= 80).slice(0, 3)) strengths.push(`Strong understanding of ${t.topic} — ${t.pct}% correct on the monthly quiz.`);
  for (const t of topics.filter((t) => t.pct < 60).slice(-3).reverse()) focus.push(`${t.topic} needs more practice (${t.pct}% correct).`);
  if (m.attendanceRate !== null && m.attendanceRate >= 0.9) strengths.push(`Excellent attendance: ${m.classesAttended} of ${m.classesScheduled} classes attended.`);
  if (m.attendanceRate !== null && m.attendanceRate < 0.75) focus.push(`Attendance was ${m.classesAttended} of ${m.classesScheduled} classes — regular attendance will help progress.`);
  if (m.homeworkAssigned && m.homeworkSubmitted === m.homeworkAssigned) strengths.push(`Completed all ${m.homeworkAssigned} homework assignments.`);
  else if (m.homeworkAssigned && m.homeworkSubmitted / m.homeworkAssigned < 0.7) focus.push(`Submitted ${m.homeworkSubmitted} of ${m.homeworkAssigned} homework assignments.`);
  if (!strengths.length) strengths.push(`${name} has been taking part in classes this month.`);
  if (!focus.length) focus.push('Keep up the steady effort and review class recordings before quizzes.');

  const quizScores = m.courses.filter((c) => c.quizScore !== null).map((c) => `${c.subject}: ${c.quizScore}%`);
  const summary = [
    `Here is ${name}'s progress for ${input.monthLabel}.`,
    m.classesScheduled ? `${name} attended ${m.classesAttended} of ${m.classesScheduled} scheduled classes` : `${name} had no scheduled classes this month`,
    m.homeworkAssigned ? `and submitted ${m.homeworkSubmitted} of ${m.homeworkAssigned} homework assignments.` : 'and had no homework assigned.',
    quizScores.length ? `Monthly quiz results — ${quizScores.join(', ')}.` : 'No monthly quiz was completed this month.',
  ].join(' ');
  return {
    summary,
    strengths: strengths.slice(0, 3),
    focusAreas: focus.slice(0, 3),
    recommendations: [
      'Set aside a regular, quiet time each week for homework.',
      'Ask your child to explain one thing they learned in class this week.',
      'Encourage rewatching class recordings in the app during the week after each class — they are great for revision.',
    ],
  };
}

const questionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          prompt: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          answerIndex: { type: Type.INTEGER },
          explanation: { type: Type.STRING },
          topic: { type: Type.STRING },
        },
        required: ['prompt', 'options', 'answerIndex', 'explanation', 'topic'],
        propertyOrdering: ['topic', 'prompt', 'options', 'answerIndex', 'explanation'],
      },
    },
  },
  required: ['questions'],
};

const homeworkSchema: Schema = {
  type: Type.OBJECT,
  properties: { title: { type: Type.STRING }, instructions: { type: Type.STRING } },
  required: ['title', 'instructions'],
};

const narrativeSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    focusAreas: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['summary', 'strengths', 'focusAreas', 'recommendations'],
};

export class GeminiAi implements AiService {
  readonly enabled = true;
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private async json<T>(prompt: string, schema: Schema, system: string): Promise<T> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { systemInstruction: system, responseMimeType: 'application/json', responseSchema: schema, temperature: 0.4 },
    });
    const text = response.text;
    if (!text) throw new Error('The AI returned an empty response.');
    return JSON.parse(text) as T;
  }

  async generateQuiz(input: QuizGenInput): Promise<GeneratedQuestion[]> {
    const homework = input.homework
      .map((h, i) => `Homework ${i + 1}: ${h.title}\n${clip(h.instructions, 1500)}`)
      .join('\n\n');
    const prompt = `Create a monthly progress quiz for the class "${input.courseTitle}" (${input.subject}, grade ${input.gradeLevel}) covering ${input.month}.

The quiz must assess the skills practised in this month's homework:
${homework || '(no homework was assigned this month)'}

Topics covered in class this month: ${input.sessionTopics.length ? input.sessionTopics.join('; ') : '(not recorded)'}

${input.curriculum ? `Class curriculum for context (use it to pick the right level and terminology, but focus on what was taught this month):\n${clip(input.curriculum, 6000)}` : ''}

Write exactly ${input.questionCount} multiple-choice questions with 4 options each and one correct answer (answerIndex is 0-based).
This is a monthly assessment taken under exam conditions in 30 minutes, without notes or help:
- Make it slightly MORE challenging than the homework: ask students to apply what they practised to new situations, combine steps, or reason about why — avoid pure recall or copying a homework item.
- Every question must still be answerable in about 3 minutes by a well-prepared grade ${input.gradeLevel} student, with language suited to that grade.
- Use plausible distractors based on common mistakes; vary which option is correct.
- "topic" is a short skill label (2-4 words) reused across related questions, so results can be grouped by skill.
- "explanation" is one or two friendly sentences shown to the student after they submit.`;
    const raw = await this.json<unknown>(prompt, questionSchema, 'You are an experienced K-12 teacher who writes clear, accurate, age-appropriate assessment questions that test understanding and application, not memorisation.');
    return validateQuestions(raw, input.questionCount);
  }

  async generateHomework(input: HomeworkGenInput): Promise<{ title: string; instructions: string }> {
    const prompt = `Draft a homework assignment for "${input.courseTitle}" (${input.subject}, grade ${input.gradeLevel}).
Recent class topics: ${input.recentTopics.length ? input.recentTopics.join('; ') : '(none recorded)'}
${input.focus ? `Mentor's focus request: ${input.focus}` : ''}
Difficulty: ${input.difficulty}. Target time: about ${input.estimatedMinutes} minutes.
${input.curriculum ? `Curriculum:\n${clip(input.curriculum, 6000)}` : ''}

Write student-facing instructions in plain text: a one-line goal, then numbered tasks or questions, then what to submit.
Use simple language appropriate for grade ${input.gradeLevel}. Do not include answers.`;
    const out = await this.json<{ title: string; instructions: string }>(prompt, homeworkSchema, 'You are a supportive mentor who designs focused, age-appropriate homework.');
    if (!out.title || !out.instructions) throw new Error('The AI response was incomplete.');
    return { title: out.title.trim(), instructions: out.instructions.trim() };
  }

  async writeReport(input: ReportGenInput): Promise<ReportNarrative> {
    const prompt = `Write a monthly progress report for the parents of ${input.studentFirstName}${input.grade ? ` (grade ${input.grade})` : ''} for ${input.monthLabel}.

Use ONLY the data below. Do not invent scores, topics or events. If data is missing, say so gently.
DATA:
${JSON.stringify(input.metrics, null, 2)}

Guidelines:
- "summary": 3-5 warm, specific sentences for parents, mentioning attendance, homework and quiz results with the actual numbers.
- "strengths": 2-3 bullet points grounded in the data (e.g. topics scored >= 80%).
- "focusAreas": 1-3 bullet points on topics or habits that need work (e.g. topics < 60%, missed homework).
- "recommendations": 2-3 practical things parents can do at home this month.
- Address the parents, refer to the student by first name, keep it encouraging and professional.`;
    const out = await this.json<ReportNarrative>(prompt, narrativeSchema, `You write clear, kind and accurate progress reports for ${input.organizationName}, a K-12 tutoring company.`);
    if (!out.summary) throw new Error('The AI response was incomplete.');
    return {
      summary: out.summary.trim(),
      strengths: (out.strengths || []).slice(0, 4),
      focusAreas: (out.focusAreas || []).slice(0, 4),
      recommendations: (out.recommendations || []).slice(0, 4),
    };
  }

  async outlineCurriculumPdf(pdf: Buffer, title: string): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } },
            { text: `This PDF is the curriculum "${title}". Produce a faithful plain-text outline: units/weeks in order, the topics and skills in each, and any learning objectives. Do not add content that is not in the document.` },
          ],
        },
      ],
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Could not read the curriculum PDF.');
    return text;
  }
}

/** Used when no AI key is configured: reports fall back to templates, generation features are disabled. */
export class DisabledAi implements AiService {
  readonly enabled = false;
  async generateQuiz(): Promise<GeneratedQuestion[]> {
    throw new AiUnavailableError();
  }
  async generateHomework(): Promise<{ title: string; instructions: string }> {
    throw new AiUnavailableError();
  }
  async writeReport(input: ReportGenInput): Promise<ReportNarrative> {
    return templateNarrative(input);
  }
  async outlineCurriculumPdf(): Promise<string> {
    throw new AiUnavailableError();
  }
}
