import { Position, Range, DiagnosticSeverity } from "vscode-languageserver";
import * as vscode from "vscode-languageserver";
import { CoqProto } from "./../../../lib";
import * as parser from "./../parsing/coq-parser";
import * as textUtil from "./../util/text-util";
import { ProofView } from "../../../lib";
import { AnnotatedText } from "../util/AnnotatedText";
import * as diff from "./DiffProofView";
import { ProofViewReference, GoalsCache } from "./GoalsCache";
type StateId = number;

interface CoqDiagnosticInternal {
  /** Error message */
  message: AnnotatedText;
  /** Range of error within this sentence w.r.t. document positions. Is `undefined` if the error applies to the whole sentence */
  range?: Range;
  severity: DiagnosticSeverity;
}

export interface CoqDiagnostic extends CoqDiagnosticInternal {
  /** Error message */
  message: AnnotatedText;
  /** Range of error within this sentence w.r.t. document positions. Is `undefined` if the error applies to the whole sentence */
  range?: Range;
  /** Range of the sentence containing the error */
  sentence: Range;
  severity: DiagnosticSeverity;
}

export enum StateStatus {
  Parsing,
  Processing,
  Processed,
  Error,
  Axiom,
  Incomplete
}

enum StateStatusFlags {
  Parsing = 0,
  Processing = 1 << 0,
  Incomplete = 1 << 1,
  Unsafe = 1 << 2,
  Error = 1 << 3,
  Warning = 1 << 4
}

export class State {
  private status: StateStatusFlags;
  private diagnostics: CoqDiagnosticInternal[] = [];
  // set to true when a document change has invalidated the meaning of the associated sentence; this state needs to be cancelled
  private markedInvalidated = false;
  private goal: ProofViewReference | null = null;

  private constructor(
    private commandText: string,
    private stateId: StateId,
    private textRange: Range,
    private prev: State | null,
    private next: State | null
  ) {
    this.status = StateStatusFlags.Parsing;
  }

  public static newRoot(stateId: StateId): State {
    return new State("", stateId, Range.create(0, 0, 0, 0), null, null);
  }

  public static add(
    parent: State,
    command: string,
    stateId: number,
    range: Range,
    computeStart: [number, number]
  ): State {
    // This implies a strict order of descendents by document position
    // To support comments that are not added as sentences,
    // this could be loosened to if(textUtil.isBefore(range.start,parent.textRange.end)).
    if (!textUtil.positionIsEqual(range.start, parent.textRange.end))
      throw "New sentence is expected to be adjacent to its parent";
    const result = new State(command, stateId, range, parent, parent.next);
    parent.next = result;
    return result;
  }

  public toString(): string {
    return this.commandText;
  }

  public getText(): string {
    return this.commandText;
  }
  public getStateId(): StateId {
    return this.stateId;
  }

  /** Iterates all parent states */
  public *ancestors(): Iterable<State> {
    let state = this.prev;
    while (state != null) {
      yield state;
      state = state.prev;
    }
  }

  /** Iterates all decendent states */
  public *descendants(): Iterable<State> {
    let state = this.next;
    while (state != null) {
      yield state;
      state = state.next;
    }
  }

  /** Iterates all decendent states until, and not including, end */
  public *descendantsUntil(end: StateId | State): Iterable<State> {
    let state = this.next;
    while (state != null && state.stateId !== end && state !== end) {
      yield state;
      state = state.next;
    }
  }

  /** Iterates this and all ancestor states in the order they appear in the document */
  public *backwards(): Iterable<State> {
    yield this;
    yield* this.ancestors();
  }

  /** Iterates this and all decentant states in the order they appear in the document */
  public *forwards(): Iterable<State> {
    yield this;
    yield* this.descendants();
  }

  public getParent(): State {
    return this.prev;
  }

  public getNext(): State {
    return this.next;
  }

  public truncate() {
    if (this.next) this.next.prev = null;
    this.next = null;
  }

  public unlink() {
    if (this.prev) this.prev.next = this.next;
    if (this.next) this.next.prev = this.prev;
  }

  public updateWorkerStatus(workerId: string, status: string) {}

  /** Handle sentence-status updates as they come from coqtop */
  public updateStatus(status: CoqProto.SentenceStatus) {
    switch (status) {
      case CoqProto.SentenceStatus.Parsing:
        this.status = StateStatusFlags.Parsing;
        break;
      case CoqProto.SentenceStatus.AddedAxiom:
        this.status &= ~(StateStatusFlags.Processing | StateStatusFlags.Error);
        this.status |= StateStatusFlags.Unsafe;
        break;
      case CoqProto.SentenceStatus.Processed:
        if (this.status & StateStatusFlags.Processing) {
          this.status &= ~StateStatusFlags.Processing;
        }
        break;
      case CoqProto.SentenceStatus.ProcessingInWorker:
        if (!(this.status & StateStatusFlags.Processing)) {
          this.status |= StateStatusFlags.Processing;
        }
        break;
      case CoqProto.SentenceStatus.Incomplete:
        this.status |= StateStatusFlags.Incomplete;
        break;
      case CoqProto.SentenceStatus.Complete:
        this.status &= ~StateStatusFlags.Incomplete;
        break;
      case CoqProto.SentenceStatus.InProgress:
        break;
    }
  }

  public getRange(): Range {
    return this.textRange;
  }

  public hasGoal(): boolean {
    return this.goal !== null;
  }

  public setGoal(goal: ProofViewReference) {
    this.goal = goal;
  }

  public getGoal(goalsCache: GoalsCache): ProofView | null {
    if (!this.goal) return null;
    const newGoals = {
      ...goalsCache.getProofView(this.goal),
      focus: this.textRange.end
    };
    if (this.prev && this.prev.goal) {
      const oldGoals = goalsCache.getProofView(this.prev.goal);
      return diff.diffProofView(oldGoals, newGoals);
    }
    return newGoals;
  }

  private translateDiagnostic(
    d: CoqDiagnosticInternal,
    delta: textUtil.RangeDelta
  ): void {
    if (d.range) {
      d.range = textUtil.rangeDeltaTranslate(d.range, delta);
    }
  }

  /**
   * Applies the textual changes to the sentence
   * @return false if the change has invalidated the sentence; true if preserved
   */
  public applyTextChanges(
    changes: vscode.TextDocumentContentChangeEvent[],
    deltas: textUtil.RangeDelta[],
    updatedDocumentText: string
  ): boolean {
    if (this.isRoot()) return true;

    let newText = this.commandText;
    let newRange = this.textRange;
    let touchesEnd = false; // indicates whether a change has touched the end of this sentence
    change: for (let idx = 0; idx < changes.length; ++idx) {
      const change = changes[idx];
      const delta = deltas[idx];
      switch (parser.sentenceRangeContainment(newRange, change.range)) {
        case parser.SentenceRangeContainment.Before:
          newRange = textUtil.rangeDeltaTranslate(newRange, delta);
          var translate = this.translateDiagnostic;
          this.diagnostics.forEach(function(d) {
            translate(d, delta);
          });
          continue change;
        case parser.SentenceRangeContainment.After:
          if (textUtil.positionIsEqual(this.textRange.end, change.range.start))
            touchesEnd = true;
          continue change; // ignore this change
        case parser.SentenceRangeContainment.Crosses:
          return false; // give up; this sentence is toast (invalidated; needs to be cancelled)
        case parser.SentenceRangeContainment.Contains:
          // the change falls within this sentence
          const beginOffset = textUtil.relativeOffsetAtAbsolutePosition(
            newText,
            newRange.start,
            change.range.start
          );
          if (beginOffset == -1) continue change;
          newText =
            newText.substring(0, beginOffset) +
            change.text +
            newText.substring(beginOffset + change.rangeLength);
          // newRange = Range.create(newRange.start,textUtil.positionRangeDeltaTranslateEnd(newRange.end,delta));
          // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
          newRange.end = textUtil.positionRangeDeltaTranslateEnd(
            newRange.end,
            delta
          );

          var translate = this.translateDiagnostic;
          this.diagnostics.forEach(function(d) {
            translate(d, delta);
          });
      } // switch
    } // change: for

    if (touchesEnd) {
      // We need to reparse the sentence to make sure the end of the sentence has not changed
      const endOffset = textUtil.offsetAt(updatedDocumentText, newRange.end);
      // The problem is if a non-blank [ \r\n] is now contacting the end-period of this sentence; we need only check one more character
      const newEnd = parser.parseSentenceLength(
        newText + updatedDocumentText.substr(endOffset, 1)
      );
      if (newEnd === -1 || newEnd !== newText.length) return false; // invalidate: bad or changed syntax
    }

    if (parser.isPassiveDifference(this.commandText, newText)) {
      this.commandText = newText;
      this.textRange = newRange;
      return true;
    } else return false;
  }

  public isRoot(): boolean {
    return this.prev === null;
  }

  public markInvalid(): void {
    this.markedInvalidated = true;
  }

  public isInvalidated(): boolean {
    return this.markedInvalidated;
  }

  /** Removes descendents until (and not including) state end */
  public *removeDescendentsUntil(end: State): Iterable<State> {
    for (let state of this.descendantsUntil(end.stateId)) yield state;
    // unlink the traversed sentences
    this.next = end;
    end.prev = this;
  }

  public getStatus(): StateStatus {
    if (this.status & StateStatusFlags.Error) return StateStatus.Error;
    else if (this.status & StateStatusFlags.Processing)
      return StateStatus.Processing;
    else if (this.status & StateStatusFlags.Unsafe) return StateStatus.Axiom;
    else if (this.status & StateStatusFlags.Incomplete)
      return StateStatus.Incomplete;
    else if (this.status & StateStatusFlags.Parsing) return StateStatus.Parsing;
    else return StateStatus.Processed;
  }

  /** @returns `true` if this sentence appears strictly before `position` */
  public isBefore(position: Position): boolean {
    return textUtil.positionIsBeforeOrEqual(this.textRange.end, position);
  }

  /** @returns `true` if this sentence appears before or contains `position` */
  public isBeforeOrAt(position: Position): boolean {
    return (
      textUtil.positionIsBeforeOrEqual(this.textRange.end, position) ||
      textUtil.positionIsBeforeOrEqual(this.textRange.start, position)
    );
  }

  /** @returns `true` if this sentence appears strictly after `position`. */
  public isAfter(position: Position): boolean {
    return textUtil.positionIsAfter(this.textRange.start, position);
  }

  /** @returns `true` if this sentence appears after or contains `position`. */
  public isAfterOrAt(position: Position): boolean {
    return (
      textUtil.positionIsAfterOrEqual(this.textRange.start, position) ||
      textUtil.positionIsAfter(this.textRange.end, position)
    );
  }

  /** @returns `true` if this sentence contains `position`. */
  public contains(position: Position): boolean {
    return (
      textUtil.positionIsBeforeOrEqual(this.textRange.start, position) &&
      textUtil.positionIsAfter(this.textRange.end, position)
    );
  }

  /** This sentence has reached an error state
   * @param location: optional offset range within the sentence where the error occurred
   */
  public pushDiagnostic(
    message: AnnotatedText,
    severity: DiagnosticSeverity,
    location?: CoqProto.Location
  ): Range | null {
    var d: CoqDiagnosticInternal = { message, severity };
    if (location && location.start !== location.stop) {
      if (severity == DiagnosticSeverity.Error) {
        this.status |= StateStatusFlags.Error;
      }
      this.status &= ~StateStatusFlags.Processing;
      const sentRange = this.getRange();
      const sentText = this.getText();
      d.range = Range.create(
        textUtil.positionAtRelativeCNL(
          sentRange.start,
          sentText,
          location.start
        ),
        textUtil.positionAtRelativeCNL(sentRange.start, sentText, location.stop)
      );
    }
    this.diagnostics.push(d);
    return d.range;
  }

  public getDiagnostics(): CoqDiagnostic[] {
    const range = this.getRange();
    return this.diagnostics.map(function(d) {
      return Object.assign(d, { sentence: range });
    });
  }
}
