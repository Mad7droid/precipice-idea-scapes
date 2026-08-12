/**
 * A small presentational hint inferred from the question, not a protocol the model must obey.
 *
 * The prompt remains responsible for choosing useful Markdown. This only gives the completed
 * card a quick-to-scan label when the user's intent is unmistakable; an imperfect hint is
 * harmless because it never changes, parses, or rejects the answer itself.
 */
export type AnswerFormat =
  | "summarise"
  | "expand"
  | "simplify"
  | "compare"
  | "troubleshoot"
  | "suggest"
  | "locate"
  | "howto"
  | "research"
  | "direct";

export function inferAnswerFormat(question: string): AnswerFormat {
  const text = question.toLowerCase();
  if (/\b(summari[sz]e|summary|tldr|shorten|brief)\b/.test(text)) return "summarise";
  if (/\b(expand|more detail|elaborate|go deeper)\b/.test(text)) return "expand";
  if (/\b(simplify|plainer|plain language|eli5)\b/.test(text)) return "simplify";
  if (/\b(compare|versus|vs\.?|difference between)\b/.test(text)) return "compare";
  if (/\b(debug|troubleshoot|why (?:is|does|isn't|is not)|broken|error|problem)\b/.test(text)) {
    return "troubleshoot";
  }
  if (
    /\b(missing|risk|weak(?:ness)?|critique|review|suggest|recommend|improve|idea)\b/.test(text)
  ) {
    return "suggest";
  }
  if (/\b(where|which objects?|find|locate|connected|orphans?)\b/.test(text)) return "locate";
  if (/\b(how (?:do|to|can)|steps?|walk me through)\b/.test(text)) return "howto";
  if (/\b(research|latest|current|market|competitor|outside|web)\b/.test(text)) return "research";
  return "direct";
}

export function answerFormatLabel(format: AnswerFormat): string {
  switch (format) {
    case "summarise":
      return "Summary";
    case "expand":
      return "Expanded";
    case "simplify":
      return "Simplified";
    case "compare":
      return "Comparing";
    case "troubleshoot":
      return "Troubleshooting";
    case "suggest":
      return "Suggestions";
    case "locate":
      return "Finding";
    case "howto":
      return "Working through it";
    case "research":
      return "Researching";
    case "direct":
      return "Scapey";
  }
}

/** An explicit, advisory brief gives the model a reliable scanning contract without a wire protocol. */
export function responseGuidance(question: string): string {
  switch (inferAnswerFormat(question)) {
    case "summarise":
      return "Give a compact summary: one direct sentence, then at most four bullets. Roll related objects into plain-language groups; name no more than three object ids unless the user asks for an inventory. Omit background.";
    case "expand":
      return "Explain the existing answer or topic in more depth with short headed sections. Keep every section useful.";
    case "simplify":
      return "Use plain language, short sentences, and define unavoidable jargon in place. Keep the meaning intact.";
    case "compare":
      return "Lead with the deciding difference, then use a compact markdown table. End with one rule of thumb if useful.";
    case "troubleshoot":
      return "Lead with the most likely diagnosis. Then give evidence from the scape and the smallest ordered steps to resolve it.";
    case "suggest":
      return "Lead with the recommended next move. List no more than three prioritised suggestions, each tied to evidence in the scape.";
    case "locate":
      return "Answer with the relevant object ids first, then one short reason for each. Do not add a general preamble.";
    case "howto":
      return "Give a concise numbered procedure. Mention a prerequisite only when it changes the outcome.";
    case "research":
      return "State the practical conclusion first. Separate canvas facts from web findings and keep sources to the source block.";
    case "direct":
      return "Give the direct answer in one or two sentences. Add up to three bullets only when they improve scanning.";
  }
}

/** A ceiling backs up the writing brief so an ordinary question cannot turn into an essay. */
export function responseTokenBudget(question: string): number {
  switch (inferAnswerFormat(question)) {
    case "summarise":
    case "direct":
    case "locate":
    case "simplify":
      return 220;
    case "compare":
    case "suggest":
    case "howto":
      return 320;
    case "troubleshoot":
    case "research":
    case "expand":
      return 520;
  }
}
