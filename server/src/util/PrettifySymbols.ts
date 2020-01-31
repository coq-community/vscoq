import { AnnotatedText, TextAnnotation, Substitution } from "../../../lib";
import {
  combineAnnotationText,
  Annotation,
  mapAnnotation
} from "./AnnotatedText";
import * as server from "../server";

function regexpOptionalGroup(re: string) {
  if (re) return `(?:${re})`;
  else return "";
}

export class PrettifySymbolsMode {
  private regex: RegExp | null;
  private substs: string[];

  public constructor(substitutions: Substitution[]) {
    if (!substitutions || substitutions.length === 0) {
      this.regex = null;
      return;
    }

    const uglyAllStrings = [];
    for (let prettySubst of substitutions) {
      const uglyStr =
        regexpOptionalGroup(prettySubst.pre) +
        "(" +
        prettySubst.ugly +
        ")" +
        regexpOptionalGroup(prettySubst.post);
      try {
        uglyAllStrings.push(`(?:${uglyStr})`);
      } catch (e) {
        server.connection.console.warn(
          `Could not add rule "${uglyStr}" --> "${prettySubst.pretty}"; invalid regular expression`
        );
      }
    }
    this.regex = new RegExp(uglyAllStrings.join("|"), "g");
    this.substs = substitutions.map(s => s.pretty);
  }

  private getMatchSubst(
    match: RegExpExecArray,
    text: string
  ): { start: number; pretty: string; ugly: string } | undefined {
    const matches = match
      .map((value, idx) => ({ index: idx, match: value }))
      .filter(value => value.match !== undefined);
    if (matches.length <= 1) return undefined;
    const matchIdx = matches[matches.length - 1].index;
    const matchStr = match[matchIdx];
    const start = match.index + match[0].indexOf(matchStr);
    const end = start + matchStr.length;

    // continue the search at the end of the ugly bit; not the whole match
    this.regex.lastIndex = end;

    return { start: start, pretty: this.substs[matchIdx - 1], ugly: matchStr };
  }

  private prettifyString(text: string, baseAnn: Annotation): AnnotatedText {
    let newText: (string | TextAnnotation)[] = [];
    this.regex.lastIndex = 0;
    let currentIdx = 0;
    let match: RegExpExecArray;
    while ((match = this.regex.exec(text))) {
      if (match[0].length === 0) return text;
      try {
        const subst = this.getMatchSubst(match, text);
        if (subst && currentIdx === subst.start)
          newText.push(
            combineAnnotationText(
              { substitution: subst.pretty, text: subst.ugly },
              baseAnn
            )
          );
        else if (subst)
          newText.push(
            combineAnnotationText(
              text.substring(currentIdx, subst.start),
              baseAnn
            ),
            combineAnnotationText(
              { substitution: subst.pretty, text: subst.ugly },
              baseAnn
            )
          );
        else newText.push(combineAnnotationText(match[0], baseAnn));
      } catch (e) {
        newText.push(combineAnnotationText(match[0], baseAnn));
      }
      currentIdx = this.regex.lastIndex;
    }
    // add the rest of the text (no substitutions found)
    if (currentIdx < text.length)
      newText.push(combineAnnotationText(text.substring(currentIdx), baseAnn));
    return newText;
  }

  public prettify(text: AnnotatedText): AnnotatedText {
    if (!this.regex) return text;
    return mapAnnotation(text, (plainText, ann, start, displayStart) => {
      return this.prettifyString(plainText, ann);
    });
  }
}
