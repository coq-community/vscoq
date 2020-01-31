import * as textUtil from "../util/text-util";
import { Position, Range } from "vscode-languageserver";
import * as vscode from "vscode-languageserver";
import { Sentence } from "./Sentence";
import * as parser from "../parsing/coq-parser";
import { TextDocumentItem } from "../document";
import * as server from "../server";
import * as util from "util";
import { QualId, ScopeFlags, SymbolInformation } from "./Scopes";

type SentencesInvalidatedCallback = (invalidatedSentences: Sentence[]) => void;

export class SentenceCollection implements vscode.TextDocument {
  private sentences: Sentence[] = [];
  private sentencesInvalidatedCallbacks = new Set<
    SentencesInvalidatedCallback
  >();

  public languageId: string = "coq";
  public lineCount: number = 0;
  public uri: string;
  public version: number;
  private documentText: string;
  private currentError: vscode.Diagnostic | null = null;

  public constructor(document: TextDocumentItem) {
    this.uri = document.uri;
    this.version = document.version;
    this.documentText = document.text;
    this.lineCount = textUtil.positionAt(
      document.text,
      document.text.length - 1
    ).line;
    try {
      this.reparseSentences(0);
    } catch (err) {
      server.connection.console.error(err);
    }
  }

  private applyChangesToDocumentText(
    sortedChanges: vscode.TextDocumentContentChangeEvent[]
  ): void {
    for (const change of sortedChanges) {
      const beginOffset = textUtil.offsetAt(
        this.documentText,
        change.range.start
      );
      this.documentText =
        this.documentText.substring(0, beginOffset) +
        change.text +
        this.documentText.substring(beginOffset + change.rangeLength);

      const delta = textUtil.toRangeDelta(change.range, change.text);
      this.lineCount += delta.linesDelta;
    }
  }

  public getText(): string {
    return this.documentText;
  }

  public getSentenceLine(pos: Position): string | null {
    const sent = this.getSentenceAt(pos);
    if (sent) return sent.getLine(pos);
    else return null;
  }

  public getLine(
    line: number
  ): { text: string; range: Range; offset: number } | null {
    const lineRE = /.*/g;

    const offset = this.offsetAt(Position.create(line, 0));
    lineRE.lastIndex = offset;
    const match = lineRE.exec(this.documentText);
    if (match) {
      return {
        text: match[0],
        range: Range.create(
          this.positionAt(match.index),
          this.positionAt(match.index + match[0].length)
        ),
        offset: match.index
      };
    } else return null;
  }

  public getDefinitionAt(
    pos: Position
  ): { id: QualId; range: Range; offset: number } | null {
    const line = this.getLine(pos.line);
    if (!line) return null;
    const identRE = /[a-zA-Z_][a-z-A-Z0-9_']*(?:[.][a-zA-Z_][a-z-A-Z0-9_']*)*/g;
    identRE.lastIndex = 0;
    let match: RegExpExecArray;
    while ((match = identRE.exec(line.text))) {
      if (
        match.index <= pos.character &&
        pos.character <= match.index + match[0].length
      ) {
        // console.log("qualid: " + match[0]);
        const start = textUtil.positionAtRelative(
          line.range.start,
          line.text,
          match.index
        );
        const end = textUtil.positionAtRelative(
          line.range.start,
          line.text,
          match.index + match[0].length
        );
        return {
          id: match[0].split("."),
          range: Range.create(start, end),
          offset: line.offset + match.index
        };
      }
    }
    return null;
  }

  public lookupDefinition(pos: vscode.Position): SymbolInformation<Sentence>[] {
    const def = this.getDefinitionAt(pos);
    if (!def) return [];
    const sent = this.getSentenceIndexBeforeOrAt(pos);
    if (sent < 0) return [];
    return this.sentences[sent].getScope().lookup(def.id, ScopeFlags.All);
  }

  public positionAt(offset: number): Position {
    for (let sent of this.sentences) {
      const sentOffset = sent.getDocumentOffset();
      const sentEndOffset = sent.getDocumentEndOffset();
      if (sentOffset <= offset && offset < sentEndOffset) {
        return sent.positionAt(offset - sentOffset);
      }
    }
    // Can't find the offset in a sentence, so calculate the position from the whole document
    return textUtil.positionAt(this.documentText, offset);
  }

  public offsetAt(position: Position): number {
    const sentIdx = this.getSentenceIndexBeforeOrAt(position);
    if (sentIdx < 0 || this.sentences[sentIdx].isBefore(position))
      return textUtil.offsetAt(this.documentText, position);
    else return this.sentences[sentIdx].documentOffsetAt(position);
  }

  public onSentencesInvalidated(
    handler: SentencesInvalidatedCallback
  ): { dispose: () => void } {
    this.sentencesInvalidatedCallbacks.add(handler);
    return {
      dispose: () => {
        this.sentencesInvalidatedCallbacks.delete(handler);
      }
    };
  }

  /**
   * @returns the index of the closest sentence containing or appearing before `pos`, or `-1` if no sentence is before or contains `pos`.
   */
  private getSentenceIndexBeforeOrAt(pos: Position): number {
    let sentIdx = 0;
    while (
      sentIdx < this.sentences.length &&
      this.sentences[sentIdx].isBeforeOrAt(pos)
    )
      ++sentIdx;
    if (sentIdx >= this.sentences.length) return -1;
    else return sentIdx - 1;
  }

  /**
   * Applies text changes to the sentences; adjusting ranges and possibly invalidating sentences.
   * Invalidated sentences will be automatically reparsed.
   */
  public applyTextChanges(
    newVersion: number,
    changes: vscode.TextDocumentContentChangeEvent[]
  ) {
    this.currentError = null;

    // sort the edits such that later edits are processed first
    let sortedChanges = changes
      .slice()
      .sort((change1, change2) =>
        textUtil.positionIsAfter(change1.range.start, change2.range.start)
          ? -1
          : 1
      );

    this.applyChangesToDocumentText(changes);

    const invalidatedSentences: number[] = [];

    for (let change of changes) {
      if (
        textUtil.positionIsAfterOrEqual(
          change.range.end,
          this.getLastPosition()
        )
      ) {
        invalidatedSentences.push(this.sentences.length);
        break;
      }
    }

    const deltas = sortedChanges.map(c =>
      textUtil.toRangeDelta(c.range, c.text)
    );
    for (let sentIdx = this.sentences.length - 1; sentIdx >= 0; --sentIdx) {
      const sent = this.sentences[sentIdx];

      const preserved = sent.applyTextChanges(
        changes,
        deltas,
        this.documentText
      );
      if (!preserved) {
        invalidatedSentences.push(sentIdx);
      }
    }

    try {
      const removed = this.reparseSentencesByIndices(invalidatedSentences);
      this.sentencesInvalidatedCallbacks.forEach(handler =>
        handler(removed.removed)
      );
    } catch (err) {
      server.connection.console.warn(
        "Error reparsing sentences: " + err.toString()
      );
    } finally {
      this.version = newVersion;
    }
  }

  /** @returns the version of the document currently represented. The version is updated in response to each document change; the version is provided by the editor  */
  public getDocumentVersion(): number {
    return this.version;
  }

  public *getErrors(): Iterable<vscode.Diagnostic> {
    if (this.currentError) yield this.currentError;
  }

  public getSentenceText(): string {
    return this.sentences.map(s => s.getText()).join("");
  }

  private getSentencePosition(sentenceIndex: number): Position {
    if (this.sentences.length === 0) {
      return Position.create(0, 0);
    } else if (sentenceIndex < this.sentences.length) {
      return this.sentences[sentenceIndex].getRange().start;
    } else {
      return this.sentences[this.sentences.length - 1].getRange().end;
    }
  }

  private getSentenceOffset(sentenceIndex: number): number {
    if (this.sentences.length === 0) {
      return 0;
    } else if (sentenceIndex < this.sentences.length) {
      return this.sentences[sentenceIndex].getDocumentOffset();
    } else {
      return this.sentences[this.sentences.length - 1].getDocumentEndOffset();
    }
  }

  private getLastPosition(): Position {
    if (this.sentences.length === 0) {
      return Position.create(0, 0);
    } else {
      return this.sentences[this.sentences.length - 1].getRange().end;
    }
  }

  public getSentences() {
    return this.sentences;
  }

  public getSentencePrefixTextAt(pos: Position, normalize = true): string {
    const sent = this.getSentenceIndexBeforeOrAt(pos);
    let range: Range;
    let text: string;
    let prefix: string;
    if (sent < 0) {
      const offset = this.offsetAt(pos);
      prefix = parser.normalizeText(this.documentText.substring(0, offset));
    } else if (this.sentences[sent].contains(pos)) {
      range = this.sentences[sent].getRange();
      text = this.sentences[sent].getText();
      const offset = textUtil.relativeOffsetAtAbsolutePosition(
        text,
        range.start,
        pos
      );
      prefix = parser.normalizeText(text.substring(0, offset));
    } else if (sent + 1 < this.sentences.length) {
      const start = this.sentences[sent].getRange().end;
      const end = this.sentences[sent + 1].getRange().start;
      text = this.documentText.substring(
        this.offsetAt(start),
        this.offsetAt(end)
      );
      const offset = textUtil.relativeOffsetAtAbsolutePosition(
        text,
        start,
        pos
      );
      prefix = parser.normalizeText(text.substring(0, offset));
    } else {
      const start = this.sentences[sent].getRange().end;
      text = this.documentText.substring(this.offsetAt(start));
      const offset = textUtil.relativeOffsetAtAbsolutePosition(
        text,
        start,
        pos
      );
      prefix = parser.normalizeText(text.substring(0, offset));
    }
    if (normalize) return parser.normalizeText(prefix);
    else return prefix;
  }

  /**
   * @param `pos` -- position in the text document
   * @return the sentence containing `pos`, or `null` if no such sentence exists
   */
  public getSentenceAt(pos: Position): Sentence | null {
    const idx = this.getSentenceIndexBeforeOrAt(pos);
    if (idx < 0) return null;
    if (this.sentences[idx].contains(pos)) return this.sentences[idx];
  }

  /**
   * @param indices -- a set of indices to reparse; parsing may continue after the sentence until a stable state is reached.
   * @return reparsed sentences
   */
  private reparseSentencesByIndices(
    indices: number[]
  ): { removed: Sentence[]; added: Sentence[] } {
    if (indices.length <= 0) return { removed: [], added: [] };

    // sort in ascending order
    indices = indices.sort((x, y) => x - y);

    const removed: Sentence[] = [];
    const added: Sentence[] = [];
    let shift = 0;
    for (let idx = 0; idx < indices.length; ++idx) {
      const sentIdx = shift + indices[idx];
      const patch = this.reparseSentences(sentIdx);
      removed.push(...patch.removed);
      added.push(...patch.added);

      if (patch.endOfSentences) break;

      // skip past any indices that were reparsed in this patch
      while (
        idx < indices.length &&
        shift + indices[idx] < sentIdx + patch.removed.length
      )
        ++idx;

      // removing & inserting parsed sentences will cause `indices` to drift w.r.t. `this.sentences`
      // this tracks the adjustments for indices past our current point
      // (but is not accurate for `< idx`)
      shift += patch.added.length - patch.removed.length;
    }

    return { removed: removed, added: added };
  }

  /**
   * @param start -- the index of the sentence to reparse
   * @param minCount -- minimum number of sentences to reparse
   * @return removed sentences
   */
  private reparseSentences(
    start: number,
    minCount: number = 0
  ): { removed: Sentence[]; added: Sentence[]; endOfSentences: boolean } {
    if (start < 0 || start > this.sentences.length)
      throw new RangeError("sentence index out of range");
    else if (minCount > this.sentences.length - start)
      minCount = this.sentences.length - start;

    let currentPosition = this.getSentencePosition(start);
    let currentOffset = this.getSentenceOffset(start);

    const reparsed: Sentence[] = [];
    let prev = this.sentences[start - 1] || null;

    if (prev !== null && prev.getDocumentEndOffset() < currentOffset) {
      // There is a gap between `start` and its predecessor sentence
      // Begin parsing immediately after the predecessor.
      currentPosition = prev.getRange().end;
      currentOffset = prev.getDocumentEndOffset();
    }

    try {
      for (let idx = 0 /**/; ; ++idx) {
        const parseText = this.documentText.substring(currentOffset);
        const sent = parser.parseSentence(parseText);

        if (sent.type === "EOF") {
          // end of document
          const removed = this.sentences.splice(
            start,
            this.sentences.length - start,
            ...reparsed
          );
          // next pointers are adjusted as sentences are reparsed; if none were reparsed, then adjust here:
          if (reparsed.length == 0 && this.sentences[start - 1])
            this.sentences[start - 1].next = null;
          //
          removed.forEach(sent => sent.dispose());
          return { removed: removed, added: reparsed, endOfSentences: true };
        }
        if (
          idx >= minCount &&
          start + idx < this.sentences.length &&
          currentOffset + sent.text.length ===
            this.sentences[start + idx].getDocumentEndOffset() &&
          sent.text === this.sentences[start + idx].getText()
        ) {
          // no need to parse further; keep remaining sentences
          const removed = this.sentences.splice(start, idx, ...reparsed);
          // adjust prev/next reference at the last reparsed sentence
          if (reparsed.length > 0) {
            const lastReparsed = reparsed[reparsed.length - 1];
            lastReparsed.next = this.sentences[start + reparsed.length] || null;
            if (lastReparsed.next) lastReparsed.next.prev = lastReparsed;
          } else {
            if (this.sentences[start - 1])
              this.sentences[start - 1].next = this.sentences[start] || null;
            if (this.sentences[start])
              this.sentences[start].prev = this.sentences[start - 1] || null;
          }
          // this.sentences[start+reparsed.length-1].next = this.sentences[start+reparsed.length]||null;
          // if(start+reparsed.length < this.sentences.length)
          //   this.sentences[start+reparsed.length].prev = this.sentences[start+reparsed.length-1]||null;
          //
          removed.forEach(sent => sent.dispose());
          return { removed: removed, added: reparsed, endOfSentences: false };
        }

        const command = sent.text;
        const range = Range.create(
          currentPosition,
          textUtil.positionAtRelative(
            currentPosition,
            command,
            sent.text.length
          )
        );
        const newSent = new Sentence(command, range, currentOffset, prev, sent);
        reparsed.push(newSent);
        if (prev) prev.next = newSent;
        prev = newSent;
        currentPosition = range.end;
        currentOffset += sent.text.length;
      }
    } catch (error) {
      if (error instanceof parser.SyntaxError) {
        this.currentError = vscode.Diagnostic.create(
          textUtil.rangeTranslateRelative(currentPosition, error.range),
          error.message,
          vscode.DiagnosticSeverity.Error,
          undefined,
          "parser"
        );
        // end of parsable sentences
        // treat the rest of the document as unparsed
        const removed = this.sentences.splice(
          start,
          this.sentences.length - start,
          ...reparsed
        );
        removed.forEach(sent => sent.dispose());
        return { removed: removed, added: reparsed, endOfSentences: true };
      } else {
        server.connection.console.warn(
          "unknown parsing error: " + util.inspect(error, false, undefined)
        );
        throw error;
      }
    }
  }
}
