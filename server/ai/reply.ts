import { AppError } from '../utils/errors.js';
/** Never publish partial generations, thought parts, or model drafting notes. */
export function validatedReply(response: {candidates?: {finishReason?: string; content?: {parts?: {text?: string; thought?: boolean}[]}}[]}, max: number): string {
  const candidate=response.candidates?.[0];
  if (candidate?.finishReason !== 'STOP')
    throw new AppError('GEMINI_RESPONSE', `Gemini did not finish a reply (${candidate?.finishReason || 'missing completion status'}). Nothing was posted.`);
  const raw=candidate.content?.parts?.filter(p=>!p.thought).map(p=>p.text || '').join('').trim();
  let parsed: unknown;
  try { parsed=JSON.parse(raw || '').reply; } catch { /* Fail closed on prose or malformed JSON. */ }
  if (typeof parsed !== 'string') throw new AppError('GEMINI_RESPONSE','Gemini did not return a structured reply. Nothing was posted.');
  const text=parsed.trim();
  if (!text || [...text].length>max || /[\r\n]|```|\*\*|^\s*[-*•]|<\/?(?:think|analysis)>/i.test(text) ||
      /\b(?:constraint checklist|final answer|final reply|system prompt|chain of thought|plain text only|reasoning process)\b|^(?:analysis|reasoning|draft|checklist|here(?:'s| is) (?:the|your|a) reply)\s*:/i.test(text) ||
      !/[.!?]["'”’)]?$/.test(text))
    throw new AppError('GEMINI_RESPONSE',`Gemini returned incomplete text, drafting notes, or a reply exceeding ${max} characters. Nothing was posted.`);
  return text;
}
