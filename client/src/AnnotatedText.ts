import { AnnotatedText, TextAnnotation, ScopedText } from "../../lib";
export {
  ProofView,
  Goal,
  Hypothesis,
  AnnotatedText,
  HypothesisDifference,
  TextAnnotation,
  ScopedText
} from "../../lib";

export interface Annotation {
  /** the relationship this text has to the text of another state */
  diff?: "added";
  /** what to display instead of this text */
  substitution?: string;
}

export function isScopedText(text: AnnotatedText): text is ScopedText {
  return text.hasOwnProperty("scope");
}

export function isTextAnnotation(text: AnnotatedText): text is TextAnnotation {
  return typeof (text as any).text === "string";
}

export function textToString(text: AnnotatedText): string {
  if (typeof text === "string") {
    return text;
  } else if (text instanceof Array) {
    return text.map(textToString).join("");
  } else if (isScopedText(text)) {
    return textToString(text.text);
  } else {
    // TextAnnotation
    return textToString(text.text);
  }
}

export function textToDisplayString(text: AnnotatedText): string {
  if (typeof text === "string") {
    return text;
  } else if (text instanceof Array) {
    return text.map(textToDisplayString).join("");
  } else if (isScopedText(text)) {
    return textToDisplayString(text.text);
  } else if (text.substitution) {
    // TextAnnotation
    return textToDisplayString(text.substitution);
  } else {
    // TextAnnotation
    return text.substitution ? text.substitution : text.text;
  }
}
