'use strict'

import {Position, Range, TextDocumentContentChangeEvent, DiagnosticSeverity} from 'vscode-languageserver';
import {CancellationToken} from 'vscode-jsonrpc';
import * as vscode from 'vscode-languageserver';
import * as coqProto from './../coqtop/coq-proto';
import * as util from 'util';
import * as proto from './../protocol';
import * as textUtil from './../util/text-util';
import * as coqtop from './../coqtop/CoqTop';
import * as coqParser from './../parsing/coq-parser';
import * as errorParsing from '../parsing/error-parsing';
import {State, CoqDiagnostic, StateStatus} from './State';
import {Mutex} from './../util/Mutex';
import * as server from '../server';
import {AnnotatedText} from '../util/AnnotatedText'
import * as text from '../util/AnnotatedText'
import {GoalsCache} from './GoalsCache';

import {Settings} from '../protocol';
export {StateStatus} from './State';

type StateId = number;

interface BufferedFeedbackBase {
  stateId: number,
}

interface BufferedFeedbackStatus extends BufferedFeedbackBase {
  type: "status",
  status: coqProto.SentenceStatus,
  worker: string,
}

interface BufferedFeedbackFileLoaded extends BufferedFeedbackBase {
  type: "fileLoaded",
  filename: string,
  module: string,
}


interface CoqProject {
  getCoqProjectRoot() : string,
  readonly console : vscode.RemoteConsole,
  readonly settings : Settings,
}

type BufferedFeedback = BufferedFeedbackStatus | BufferedFeedbackFileLoaded;

export interface StateMachineCallbacks {
  sentenceStatusUpdate(range: Range, status: StateStatus) : void;
  clearSentence(range: Range) : void;
  updateStmFocus(focus: Position): void;
  error(sentenceRange: Range, errorRange: Range, message: AnnotatedText) : void;
  message(level: coqProto.MessageLevel, message: AnnotatedText, routeId: coqProto.RouteId) : void;
  ltacProfResults(range: Range, results: coqProto.LtacProfResults) : void;
  coqDied(reason: proto.CoqtopStopReason, error?: string) : void;
}

const dummyCallbacks : StateMachineCallbacks = {
  sentenceStatusUpdate() : void {},
  clearSentence() : void {},
  updateStmFocus(): void {},
  error() : void {},
  message() : void {},
  ltacProfResults() : void {},
  coqDied() : void {},
}

export type CommandIterator = (begin: Position, end?: Position) => Iterable<{text: string, range: Range}>;

type GoalErrorResult = proto.NotRunningResult | proto.FailureResult | proto.InterruptedResult
export type GoalResult = proto.NoProofResult | proto.NotRunningResult | proto.BusyResult |
  proto.FailureResult |
  proto.ProofViewResult |
  proto.InterruptedResult

class InconsistentState {
  constructor(
    public message: string
  ) {}
}

class AddCommandFailure implements proto.FailValue {
  constructor(
    public message: AnnotatedText,
    public range: vscode.Range,
    public sentence: vscode.Range)
  {}
}


enum STMStatus { Ready, Busy, Interrupting, Shutdown }

/**
 * Manages the parts of the proof script that have been interpreted and processed by coqtop
 *
 * Abstractions:
 * - addCommands(range: Range, commandText: string)
 *    ensures that the as much of commandText has been processed; cancels any previously overlapping sentences as needed
 *    returns the actual range that was accepted
 * - serialization: Coq commands may only run one at a time but are asynchronous. This STM ensures that each command is run one at a time, that edits are applied only when the prior commands are run
 * - interruption: queued may be interrupted; clears the queue of commands, interrupts coq, and applies the queued edits
 */
export class CoqStateMachine {
  private version = 0;
  // lazy init
  private root : State = null;
  // map id to sentence; lazy init
  private sentences = new Map<StateId,State>();
  // The sentence that coqtop considers "focused"; lazy init
  private focusedSentence : State = null;
  // The sentence that is closest to the end of the document; lazy init
  private lastSentence : State = null;
  // feedback may arrive before a sentence is assigned a stateId; buffer feedback messages for later
  private bufferedFeedback: BufferedFeedback[] = [];
  /** The error from the most recent Coq command (`null` if none) */
  private currentError : proto.FailValue = null;
  private status = STMStatus.Ready;
  /** The current state of coq options */
  private currentCoqOptions : coqtop.CoqOptions = {
    printingCoercions: false,
    printingMatching: true,
    printingNotations: true,
    printingExistentialInstances: false,
    printingImplicit: false,
    printingAll: false,
    printingUniverses: false,
  };
  /** Prevent concurrent calls to coqtop */
  private coqLock = new Mutex();
  /** Sequentialize edits */
  private editLock = new Mutex();
  /** goals */
  private goalsCache = new GoalsCache();
  /** The connected instance of coqtop */
  private coqtop : coqtop.CoqTop;


  constructor(private project: CoqProject
    , private spawnCoqtop : ()=>coqtop.CoqTop
    , private callbacks: StateMachineCallbacks
  ) {
    this.startFreshCoqtop();
  }

  private startFreshCoqtop() {
    this.coqtop = this.spawnCoqtop();
    this.coqtop.onFeedback((x1) => this.onFeedback(x1));
    this.coqtop.onMessage((x1, routeId, stateId) => this.onCoqMessage(x1, routeId, stateId));
    this.coqtop.onClosed((isError: boolean, message?: string) => this.onCoqClosed(isError, message));
  }

  public dispose() {
    if(this.status === STMStatus.Shutdown)
      return; // already disposed
    this.status = STMStatus.Shutdown;
    this.sentences = undefined;
    this.bufferedFeedback = undefined;
    // this.project = undefined;
    this.setFocusedSentence(undefined);
    this.callbacks = dummyCallbacks;
    if(this.coqtop)
      this.coqtop.dispose();
  }

  public async shutdown() {
    if(this.isShutdown())
      return;
    this.status = STMStatus.Shutdown;
    await this.acquireCoq(async () => await this.coqtop.coqQuit());
    this.dispose();
  }

  private get console() { return this.project.console; }

  /**
   *
  */
  public async interrupt() : Promise<void> {
    if(!this.isBusy() || this.isShutdown())
      return;
    else
      this.status = STMStatus.Interrupting;
    try {
      await this.coqtop.coqInterrupt();
    } catch(err) {
      // this will fail on user interrupt
      this.console.error('Exception thrown while interrupting Coq: ' + err.toString());
    } finally {
      // The command being interrupted should update this.status
      // If not, then it is probably best to kill coqtop via this.shutdown()
      // this.status = STMStatus.Ready
    }
  }

  public isRunning() : boolean {
    return this.status !== STMStatus.Shutdown && this.root !== null;
  }

  /**
   * @returns the document position that Coqtop considers "focused"; use this to update the cursor position or
   * to determine which commands to add when stepping through a script.
   */
  public getFocusedPosition() : Position {
    if(!this.focusedSentence)
      return Position.create(0,0);
    return this.focusedSentence.getRange().end;
  }

  public getStatesText() : string {
    if(!this.isRunning())
      return "";
    const texts : string[] = [];
    for(let sent of this.root.descendants())
      texts.push(sent.getText())
    return texts.join('');
  }


  /**
   * Applies the changes to the sentences
   * @return a list of invalidated sentences -- these need to be cancelled
   */
  private applyChangesToSentences(sortedChanges: TextDocumentContentChangeEvent[], updatedDocumentText: string) : State[] {
    const invalidatedSentences : State[] = [];
    try {
      const deltas = sortedChanges.map((c) => textUtil.toRangeDelta(c.range,c.text))

      if(this.currentError && this.currentError.range) {
        for(let idx = 0; idx < sortedChanges.length; ++idx) {
          this.currentError.range = textUtil.rangeDeltaTranslate(this.currentError.range, deltas[idx])
        }
      }

      for (let sent of this.lastSentence.backwards()) {
        // // optimization: remove any changes that will no longer overlap with the ancestor sentences
        // while (sortedChanges.length > 0 && textUtil.positionIsAfterOrEqual(sortedChanges[0].range.start, sent.getRange().end)) {
        //   // this change comes after this sentence and all of its ancestors, so get rid of it
        //   sortedChanges.shift();
        // }
        // // If there are no more changes, then we are done adjusting sentences
        // if (sortedChanges.length == 0)
        //   break sent; // sent

        // apply the changes
        const preserved = sent.applyTextChanges(sortedChanges,deltas, updatedDocumentText);
        if(!preserved) {
          invalidatedSentences.push(sent);
        }

      } // for sent in ancestors of last sentence
      return invalidatedSentences;
    } catch(err) {
      this.handleInconsistentState(err);
      return [];
    }
  }

  /** Cancel a list of sentences that have (presumably) been invalidated.
   * This will attempt to place the focus just before the topmost cancellation.
   * @param invalidatedSentences -- assumed to be sorted in descending order (bottom first)
   */
  private async cancelInvalidatedSentences(invalidatedSentences: State[]) : Promise<void> {
    // Unlink and delete the invalidated sentences before any async operations
    for(let sent of invalidatedSentences) {
      sent.unlink();
      this.deleteSentence(sent);
    }

    if(invalidatedSentences.length <= 0)
      return;
    // Cancel the invalidated sentences
    const releaseLock = await this.editLock.lock();
    try {
      if(this.status === STMStatus.Busy)
        await this.interrupt();
          // now, this.status === STMStatus.Interrupting until the busy task is cancelled, then it will become STMStatus.Ready

      // Cancel sentences in the *forward* direction
      // // E.g. cancelling the first invalidated sentence may cancel all subsequent sentences,
      // // in which case, the remaining cancellations will become NOOPs
      // for(let idx = invalidatedSentences.length - 1; idx >= 0; --idx) {
      //   const sent = invalidatedSentences[idx];
      for(let sent of invalidatedSentences) {
        await this.cancelSentence(sent);
      }
      // The focus should be at the topmost cancelled sentences
      this.focusSentence(invalidatedSentences[invalidatedSentences.length-1].getParent());
    } catch(err) {
      this.handleInconsistentState(err);
    } finally {
      releaseLock();
    }
  }

  /** Adjust sentence ranges and cancel any sentences that are invalidated by the edit
   * @param sortedChanges -- a list of changes, sorted by their start position in descending order: later change in doc appears first
   * @returns `true` if no sentences were cancelled
  */
  public applyChanges(sortedChanges: TextDocumentContentChangeEvent[], newVersion: number, updatedDocumentText: string) : boolean {
    if(!this.isRunning() || sortedChanges.length == 0)
      return true;

    const invalidatedSentences = this.applyChangesToSentences(sortedChanges, updatedDocumentText);

    try {
      if(invalidatedSentences.length === 0) {
        this.callbacks.updateStmFocus(this.getFocusedPosition())
        return true;
      } else {
        // We do not bother to await this async function
        this.cancelInvalidatedSentences(invalidatedSentences);
        return false;
      }
    } finally {
      this.version = newVersion;
    }
  }

  /** @returns the version of the document that the STM recognizes */
  public getDocumentVersion() : number {
    return this.version;
  }


  /**
   * Adds the next command
   * @param verbose - generate feedback messages with more info
   * @throw proto.FailValue if advancing failed
   */
  public async stepForward(commandSequence: CommandIterator, verbose: boolean = false) : Promise<(proto.FailureResult & proto.FocusPosition)|proto.NotRunningResult|null>  {
    const endCommand = await this.startCommand();
    if(!endCommand)
      return;
    try {
      await this.validateState(true);
      const currentFocus = this.getFocusedPosition();
      // Advance one statement: the one that starts at the current focus
      await this.iterateAdvanceFocus(
        { iterateCondition: (command) => textUtil.positionIsEqual(command.range.start, currentFocus)
        , commandSequence: commandSequence
        , verbose: verbose
        });
      return null;
    } catch (error) {
      if(error instanceof AddCommandFailure)
        return {...error, type: 'failure', focus: this.getFocusedPosition()};
      else if(error instanceof coqtop.CoqtopSpawnError)
        return {type: "not-running", reason: "spawn-failed", coqtop: error.binPath}
      else
        throw error;
    } finally {
      endCommand();
    }
  }

  /**
   * Steps back from the currently focused sentence
   * @param verbose - generate feedback messages with more info
   * @throws proto.FailValue if advancing failed
   */
  public async stepBackward() : Promise<proto.NotRunningResult|null>  {
    const endCommand = await this.startCommand();
    if(!endCommand)
      return null;
    try {
      await this.validateState(false);
      if (this.focusedSentence !== this.root)
        await this.cancelSentence(this.focusedSentence);
      return null;
    } catch (error) {
      if(error instanceof coqtop.CoqtopSpawnError)
        return {type: "not-running", reason: "spawn-failed", coqtop: error.binPath}
      else
        throw error;
    } finally {
      endCommand();
    }
  }


  private convertCoqTopError(err) : GoalErrorResult {
    if(err instanceof coqtop.Interrupted)
      return {type: 'interrupted', range: this.sentences.get(err.stateId).getRange()}
    else if(err instanceof coqtop.CoqtopSpawnError)
      return {type: 'not-running', reason: "spawn-failed", coqtop: err.binPath}
    // else if(err instanceof coqtop.CallFailure) {
    //   const sent = this.sentences.get(err.stateId);
    //   const start = textUtil.positionAtRelative(sent.getRange().start,sent.getText(),err.range.start);
    //   const end = textUtil.positionAtRelative(sent.getRange().start,sent.getText(),err.range.stop);
    //   const range = Range.create(start,end); // err.range
    //   return Object.assign<proto.FailureTag,proto.FailValue>({type: 'failure'}, <proto.FailValue>{message: err.message, range: range, sentence: this.sentences.get(err.stateId).getRange()})
    else
      throw err;
  }

  /**
   * Return the goal for the currently focused state
   * @throws FailValue
   */
  public async getGoal() : Promise<GoalResult> {
    if(!this.isCoqReady())
      return {type: 'not-running', reason: "not-started"}
    const endCommand = await this.startCommand();
    if(!endCommand)
      return {type: 'busy'};
    try {
      await this.refreshOptions();
      const result = await this.coqtop.coqGoal();
      return this.convertGoals(result);
    } catch(error) {
      if(error instanceof coqtop.CallFailure) {
        const sent = this.focusedSentence;
        const failure = await this.handleCallFailure(error, {range: sent.getRange(), text: sent.getText() });
        return Object.assign(failure, <proto.FailureTag>{type: 'failure'})
      } else
        return this.convertCoqTopError(error)
    } finally {
      endCommand();
    }
  }

  /**
   * Return the cached goal for the given position
   * @throws FailValue
   */
  public async getCachedGoal(pos: vscode.Position, direction: "preceding"|"subsequent") : Promise<GoalResult> {
    try {
      const state = (direction==="subsequent" ? this.getStateAt(pos) : null) || this.getPrecedingStateAt(pos);
      if(state && state.hasGoal())
        return Object.assign({type: 'proof-view'} as {type: 'proof-view'}, state.getGoal(this.goalsCache));
      else
        return {type: "no-proof"}
    } catch(error) {
       return {type: "no-proof"}
    }
  }

  private getPrecedingStateAt(pos: vscode.Position) : State|null {
    let preceding = this.root;
    for(let s of this.sentences.values()) {
      if(textUtil.positionIsBeforeOrEqual(s.getRange().end, pos) && textUtil.positionIsAfter(s.getRange().start, preceding.getRange().start))
        preceding = s;
      if(s.contains(pos))
        return s.getParent();
    }
    return preceding;
  }

  private getStateAt(pos: vscode.Position) : State|null {
    for(let s of this.sentences.values()) {
      if(s.contains(pos))
        return s;
    }
    return null;
  }


  public async getStatus(force: boolean) : Promise<(proto.FailureResult & proto.FocusPosition)|proto.NotRunningResult|null> {
    if(!this.isCoqReady())
      return {type: 'not-running', reason: "not-started"}
    const endCommand = await this.startCommand();
    if(!endCommand)
      return null;
    try {
    } finally {
      endCommand();
    }
    return null;
  }

  public async finishComputations() {
    await this.getStatus(true);
  }

  /** Interpret to point
   * Tell Coq to process the proof script up to the given point
   * This may not fully process everything, or it may rewind the state.
   * @throws proto.FailValue if advancing failed
   */
  public async interpretToPoint(position: Position, commandSequence: CommandIterator, interpretToEndOfSentence: boolean, synchronous: boolean, token: CancellationToken) : Promise<(proto.FailureResult & proto.FocusPosition)|proto.NotRunningResult|null> {
    const endCommand = await this.startCommand();
    if(!endCommand)
      return;
    try {

      await this.validateState(true);
      // Advance the focus until we reach or exceed the location
      await this.iterateAdvanceFocus(
        { iterateCondition: (command) => {
            return ((!interpretToEndOfSentence && textUtil.positionIsAfterOrEqual(position,command.range.end))
              || (interpretToEndOfSentence && textUtil.positionIsAfter(position,command.range.start))) &&
            (!token || !token.isCancellationRequested)
        }
        , commandSequence: commandSequence
        , end: interpretToEndOfSentence ? undefined : position
        , verbose: true
        , synchronous: synchronous
        });
      if(token && token.isCancellationRequested)
        throw "operation interrupted"

      if(!interpretToEndOfSentence && textUtil.positionIsBefore(position,this.getFocusedPosition())) {
        // We exceeded the desired position
        await this.focusSentence(this.getParentSentence(position));
      } else if(interpretToEndOfSentence && textUtil.positionIsBeforeOrEqual(position,this.focusedSentence.getRange().start)) {
        await this.focusSentence(this.getParentSentence(position).getNext());
      }


      return null;
    } catch (error) {
      if(error instanceof AddCommandFailure) {
        return {...error, type: 'failure', focus: this.getFocusedPosition()};
      } else if(error instanceof coqtop.CoqtopSpawnError)
        return {type: "not-running", reason: "spawn-failed", coqtop: error.binPath}
      else
        throw error;
    } finally {
      endCommand();
    }
  }

  public async doQuery(query: string, routeId: coqProto.RouteId, position?: Position) : Promise<void> {
    if(!this.isCoqReady())
      return;
    const endCommand = await this.startCommand();
    if(!endCommand)
      return;
    try {
      let state: StateId = undefined;
      state = position ? this.getParentSentence(position).getStateId() : this.focusedSentence.getStateId();
      await this.refreshOptions();
      await this.coqtop.coqQuery(query, state, routeId);
      return;
    } finally {
      endCommand();
    }
  }

  public async setWrappingWidth(columns: number) : Promise<void> {
    if(!this.isCoqReady())
      return;
    const endCommand = await this.startCommand();
    if(!endCommand)
      return;
    try {
      this.coqtop.coqResizeWindow(columns);
    } catch(error) {
      this.console.warn("error resizing window: " + error.toString())
    } finally {
      endCommand();
    }
  }

private routeId = 1;
  public async requestLtacProfResults(position?: Position) : Promise<void> {
    if(!this.isCoqReady())
      return;
    const endCommand = await this.startCommand();
    if(!endCommand)
      return;
    try {
      if(position !== undefined) {
        const sent = this.getSentence(position);
        if(sent) {
          await this.coqtop.coqLtacProfilingResults(sent.getStateId(), this.routeId++);
          return;
        }
      } else
        await this.coqtop.coqLtacProfilingResults(undefined, this.routeId++);
    } finally {
      endCommand();
    }
  }
  //     ltacProfResults: (offset?: number) => this.enqueueCoqOperation(async () => {
  //       if(offset) {
  //         const sent = this.sentences.findAtTextPosition(offset);
  //         return this.coqTop.coqLtacProfilingResults(sent===null ? undefined : sent.stateId);
  //       } else
  //         return this.coqTop.coqLtacProfilingResults();
  //     }, true),


  public async setDisplayOptions(options: {item: proto.DisplayOption, value: proto.SetDisplayOption}[]) {
    function set(old: boolean, change: proto.SetDisplayOption) : boolean {
      switch(change) {
        case proto.SetDisplayOption.On: return true;
        case proto.SetDisplayOption.Off: return false;
        case proto.SetDisplayOption.Toggle: return !old;
      }
    }
    for(let option of options) {
      switch(option.item) {
        case proto.DisplayOption.AllLowLevelContents: {
          // for toggle: on-->off iff all are on; off->on iff any are off
          const value = set(this.currentCoqOptions.printingAll && this.currentCoqOptions.printingExistentialInstances && this.currentCoqOptions.printingUniverses, option.value)
          this.currentCoqOptions.printingAll = value;
          this.currentCoqOptions.printingExistentialInstances = value;
          this.currentCoqOptions.printingUniverses = value;
          break;
        }
        case proto.DisplayOption.AllBasicLowLevelContents:
          this.currentCoqOptions.printingAll = set(this.currentCoqOptions.printingAll, option.value);
          break;
        case proto.DisplayOption.Coercions:
          this.currentCoqOptions.printingCoercions = set(this.currentCoqOptions.printingCoercions, option.value);
          break;
        case proto.DisplayOption.ExistentialVariableInstances:
          this.currentCoqOptions.printingExistentialInstances = set(this.currentCoqOptions.printingExistentialInstances, option.value);
          break;
        case proto.DisplayOption.ImplicitArguments:
          this.currentCoqOptions.printingImplicit = set(this.currentCoqOptions.printingImplicit, option.value);
          break;
        case proto.DisplayOption.Notations:
          this.currentCoqOptions.printingNotations = set(this.currentCoqOptions.printingNotations, option.value);
          break;
        case proto.DisplayOption.NestedMatchingExpressions:
          this.currentCoqOptions.printingMatching = set(this.currentCoqOptions.printingMatching, option.value);
          break;
        case proto.DisplayOption.UniverseLevels:
          this.currentCoqOptions.printingUniverses = set(this.currentCoqOptions.printingUniverses, option.value);
          break;
      }
    }
    //await this.setCoqOptions(this.currentCoqOptions);
  }



  public *getSentences() : IterableIterator<{range: Range, status: StateStatus}> {
    if(!this.isRunning())
      return;
    for(let sent of this.root.descendants())
      yield { range: sent.getRange(), status: sent.getStatus()}
  }

  public *getSentenceDiagnostics() : IterableIterator<CoqDiagnostic> {
    if(!this.isRunning())
      return;
    for(let sent of this.root.descendants()) {
      yield* sent.getDiagnostics();
    }
  }

  public *getDiagnostics() : IterableIterator<CoqDiagnostic> {
    if(!this.isRunning())
      return;
    yield* this.getSentenceDiagnostics();
    if(this.currentError !== null)
      yield Object.assign(this.currentError, <CoqDiagnostic>{severity: DiagnosticSeverity.Error});
  }

  private getParentSentence(position: Position) : State {
    for(let sentence of this.root.descendants()) {
      if(!sentence.isBefore(position))
        return sentence.getParent();
    }
    // This should never be reached
    return this.root;
  }

  private getSentence(position: Position) : State {
    for(let sentence of this.root.descendants()) {
      if(sentence.contains(position))
        return sentence;
    }
    // This should never be reached
    return this.root;
  }

  private initialize(rootStateId: StateId) {
    if(this.root != null)
      throw "STM is already initialized."
    if(this.isShutdown())
      throw "Cannot reinitialize the STM once it has died; create a new one."
    this.root = State.newRoot(rootStateId);
    this.sentences.set(this.root.getStateId(),this.root);
    this.lastSentence = this.root;
    this.setFocusedSentence(this.root);
  }

  /** Assert that we are in a "running"" state
   * @param initialize - initialize Coq if true and Coq has not yet been initialized
   * @returns true if it is safe to communicate with coq
  */
  private isCoqReady() : boolean {
    return this.isRunning() && this.coqtop.isRunning();
  }

  /** Assert that we are in a "running"" state
   * @param initialize - initialize Coq if true and Coq has not yet been initialized
   * @returns true if it is safe to communicate with coq
  */
  private async validateState(initialize: boolean) : Promise<boolean> {
    if(this.isShutdown() && initialize)
      throw "Cannot perform operation: coq STM manager has been shut down."
    else if(this.isShutdown())
      return false;
    else if(this.isCoqReady())
      return true;
    else if(initialize) {
      if(!this.coqtop)
        this.startFreshCoqtop();
      let value = await this.coqtop.startCoq();
      this.initialize(value.stateId);
      return true;
    } else
      return false;
  }


  /** Continues to add next next command until the callback returns false.
   * Commands are always added from the current focus, which may advance seuqentially or jump around the Coq script document
   *
   * @param params.end: optionally specify and end position to speed up command parsing (for params.commandSequence)
   * */
  private async iterateAdvanceFocus(params: {iterateCondition: (command: {text:string,range:Range}, contiguousFocus: boolean)=>boolean, commandSequence: CommandIterator, verbose: boolean, end?: Position, synchronous?: boolean}) : Promise<void> {
    if(params.synchronous === undefined)
      params.synchronous = false;

    // true if the focus has not jumped elsewhere in the document
    let contiguousFocus = true;
    // Start advancing sentences
    let commandIterator = params.commandSequence(this.getFocusedPosition(),params.end)[Symbol.iterator]();
    for(let nextCommand = commandIterator.next(); !nextCommand.done; ) {
      const command = nextCommand.value;
      // Do we satisfy the initial condition?
      if(!params.iterateCondition(command, contiguousFocus))
        return;

      // let the command-parsing iterator that we want the next value *NOW*,
      // before we await the command to be added.
      // This is useful for the caller to provide highlighting feedback to the user
      // while we wait for the command to be parsed by Coq
      nextCommand = commandIterator.next();

      const result = await this.addCommand(command,params.verbose);
      contiguousFocus = !result.unfocused;

      if(params.synchronous)
        await this.coqtop.coqGoal();

      // If we have jumped to a new position, create a new iterator since the next command will not be adjacent
      if(result.unfocused)
        commandIterator = params.commandSequence(this.getFocusedPosition(),params.end)[Symbol.iterator]();
    } // for
  }

  /**
   * Adds a command; assumes that it is adjacent to the current focus
  */
  private async addCommand(command: {text: string, range: Range}, verbose: boolean) : Promise<{sentence: State, unfocused: boolean}> {
    try {
      this.currentError = null;

      const startTime = process.hrtime();
      const parent = this.focusedSentence;
      if(!textUtil.positionIsEqual(parent.getRange().end, command.range.start))
        this.throwInconsistentState("Can only add a comand to the current focus");

      const value = await this.coqtop.coqAddCommand(command.text,this.version,parent.getStateId(),verbose);
      const newSentence = State.add(parent, command.text, value.stateId, command.range, startTime);
      this.sentences.set(newSentence.getStateId(),newSentence);
      // some feedback messages may have arrived before we get here
      this.applyBufferedFeedback();
      newSentence.updateStatus(coqProto.SentenceStatus.ProcessingInWorker);

      if(textUtil.positionIsAfterOrEqual(newSentence.getRange().start, this.lastSentence.getRange().end))
        this.lastSentence = newSentence;

      if(value.unfocusedStateId) {
        this.setFocusedSentence(this.sentences.get(value.unfocusedStateId));
        // create a new iterator since the next command will not be adjacent
      } else {
        this.setFocusedSentence(newSentence);
      }

      const result =
        { sentence: newSentence
        , unfocused: value.unfocusedStateId == undefined ? false : true
        };
      return result;
    } catch(error) {
      if(typeof error === 'string')
        throw new InconsistentState(error)
      else if(error instanceof coqtop.CallFailure) {
        const failure = await this.handleCallFailure(error, {range: command.range, text: command.text});
        throw new AddCommandFailure(failure.message, failure.range, failure.range);
      }
      else
        throw error
    } // try
  }

  /**
   * Converts a CallFailure from coqtop (where ranges are w.r.t. the start of the command/sentence) to a FailValue (where ranges are w.r.t. the start of the Coq script).
   */
  private async handleCallFailure(error: coqtop.CallFailure, command: {range: Range, text: string}) : Promise<proto.FailValue> {
    let errorRange : Range = undefined;
    if(error.range)
      errorRange = vscode.Range.create(
        textUtil.positionAtRelativeCNL(command.range.start, command.text, error.range.start)
      , textUtil.positionAtRelativeCNL(command.range.start, command.text, error.range.stop)
      );

    const diffError = errorParsing.parseError(error.message);
    const prettyError = server.project.getPrettifySymbols().prettify(diffError)
    const message = text.normalizeText(prettyError);
    this.currentError = {message: message, range: errorRange, sentence: command.range}

    // Some errors tell us the new state to assume
    if(error.stateId !== undefined && error.stateId != 0)
      await this.gotoErrorFallbackState(error.stateId);

    return this.currentError;
  }

  private parseConvertGoal(goal: coqProto.Subgoal) : proto.Goal {
    return <proto.Goal>{
      id: goal.id,
      goal: server.project.getPrettifySymbols().prettify(goal.goal),
      hypotheses: goal.hypotheses.map((hyp) => {
        let h = text.textSplit(hyp,/(:=|:)([^]*)/,2);
        const result =
          { identifier: text.textToString(h.splits[0]).trim()
          , relation: text.textToString(h.splits[1])
          , expression: text.normalizeText(server.project.getPrettifySymbols().prettify(h.rest))};
        return result;
      })
    };
  }

  private convertUnfocusedGoals(focusStack: coqProto.UnfocusedGoalStack) : proto.UnfocusedGoalStack {
    if(focusStack)
      return {
        before: focusStack.before.map(this.parseConvertGoal),
        next: this.convertUnfocusedGoals(focusStack.next),
        after: focusStack.after.map(this.parseConvertGoal)
      };
    else
      return null;
  }


  private convertGoals(goals: coqtop.GoalResult) : GoalResult {
    switch(goals.mode) {
      case 'no-proof':
        return {type: 'no-proof'}
      case 'proof':
        const pv = this.goalsCache.cacheProofView({
          goals: goals.goals.map(this.parseConvertGoal),
          backgroundGoals: this.convertUnfocusedGoals(goals.backgroundGoals),
          shelvedGoals: (goals.shelvedGoals || []).map(this.parseConvertGoal),
          abandonedGoals: (goals.abandonedGoals || []).map(this.parseConvertGoal),
          focus: this.getFocusedPosition()
        });
        this.focusedSentence.setGoal(pv);
        return {type: 'proof-view', ...this.focusedSentence.getGoal(this.goalsCache)};
      default:
        this.console.warn("Goal returned an unexpected value: " + util.inspect(goals,false,undefined));
    }
  }

  private async gotoErrorFallbackState(stateId: StateId) {
    try {
      const beforeErrorSentence = this.sentences.get(stateId);
      await this.coqtop.coqEditAt(stateId);
      this.rewindTo(beforeErrorSentence);
    } catch(err) {
      this.handleInconsistentState(err);
    }
  }

  private handleInconsistentState(error : any) {
    this.callbacks.coqDied(proto.CoqtopStopReason.InternalError, "Inconsistent state: " + error.toString());
    this.dispose();
  }

  private throwInconsistentState(error : string) {
    this.callbacks.coqDied(proto.CoqtopStopReason.InternalError, "Inconsistent state: " + error.toString());
    this.dispose();
    throw new InconsistentState(error);
  }

  /**
   * Focuses the sentence; a new sentence may be appended to it.
   * @param sentence -- does nothing if null, already the focus, or its state ID does not exist
   */
  private async focusSentence(sentence?: State) {
    if(!sentence || sentence == this.focusedSentence || !this.sentences.has(sentence.getStateId()))
      return;
    try {
      const result = await this.coqtop.coqEditAt(sentence.getStateId());
      if(result.enterFocus) {
        // Jumping inside an existing proof
        // cancels a range of sentences instead of rewinding everything to this point
        const endStateId = result.enterFocus.qedStateId;
        this.rewindRange(sentence, this.sentences.get(endStateId));
      } else {
        // Rewind the entire document to this point
        this.rewindTo(sentence);
      }
      this.setFocusedSentence(sentence);
    } catch(err) {
      const error = <coqtop.CallFailure>err;
      if(error.stateId)
        await this.gotoErrorFallbackState(error.stateId);
    }
  }


  private async cancelSentence(sentence: State) {
//>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
    // if(!this.sentences.has(sentence.getStateId()))
    //   return;
    await this.focusSentence(sentence.getParent());
  }

  private deleteSentence(sent: State) {
    this.callbacks.clearSentence(sent.getRange());
    this.sentences.delete(sent.getStateId());
  }

  /** Removes sentences from range (start,end), exclusive; assumes coqtop has already cancelled the sentences  */
  private rewindRange(start: State, end: State) {
    for(let sent of start.removeDescendentsUntil(end))
      this.deleteSentence(sent);
  }

  /** Rewind the entire document to this sentence, range (newLast, ..]; assumes coqtop has already cancelled the sentences  */
  private rewindTo(newLast: State) {
    for(let sent of newLast.descendants())
      this.deleteSentence(sent);
    newLast.truncate();
    this.lastSentence = newLast;
    this.setFocusedSentence(newLast);
  }

  /** Apply buffered feedback to existing sentences, then clear the buffer */
  private applyBufferedFeedback() {
    // Process any feedback that we may have seen out of order
    this.bufferedFeedback
      .forEach((feedback) => {
        const sent = this.sentences.get(feedback.stateId);
        if(!sent) {
          this.console.warn("Received buffered feedback for unknown stateId: " + feedback.stateId);
          return;
        }
        if(feedback.type === "status") {
          sent.updateStatus(feedback.status);
          this.callbacks.sentenceStatusUpdate(sent.getRange(), sent.getStatus())
        } else if(feedback.type === "fileLoaded") {
          // if(sent.getText().includes(feedback.module))
          //   sent.addSemantics(new LoadModule(feedback.filename, feedback.module));
        }
      });
    this.bufferedFeedback = [];
  }

  private setFocusedSentence(sent?: State) {
    if(sent === this.focusedSentence)
      return;
    this.focusedSentence = sent;
    this.callbacks.updateStmFocus(this.getFocusedPosition());
  }

  private onCoqMessage(msg: coqProto.Message, routeId: coqProto.RouteId, stateId?: StateId) {
    const prettyMessage = text.normalizeText(server.project.getPrettifySymbols().prettify(errorParsing.parseError(msg.message)));
    if(msg.level === coqProto.MessageLevel.Error && stateId!==undefined) {
      const sent = this.sentences.get(stateId);
      if(sent) {
        var range : Range = sent.pushDiagnostic(prettyMessage, DiagnosticSeverity.Error, msg.location);
        this.callbacks.error(sent.getRange(), range, prettyMessage);
      } else {
        this.console.warn(`Error for unknown stateId: ${stateId}; message: ${msg.message}`);
      }
    } else if(msg.level === coqProto.MessageLevel.Warning && stateId!==undefined) {
      const sent = this.sentences.get(stateId);
      if(sent) {
        var range : Range = sent.pushDiagnostic(prettyMessage, DiagnosticSeverity.Warning, msg.location);
      } else {
        this.console.warn(`Warning for unknown stateId: ${stateId}; message: ${msg.message}`);
      }
    } else
      this.callbacks.message(msg.level, prettyMessage, routeId);
  }

  private onFeedback(feedback: coqProto.StateFeedback) {
    const hasStateId = feedback.objectId.objectKind === 'stateid';
    const stateId = coqProto.hasStateId(feedback.objectId) ? feedback.objectId.stateId : undefined;

    if(!hasStateId) {
      this.console.log("Edit feedback: " + util.inspect(feedback));
    }

    if(feedback.feedbackKind === "ltacprof" && hasStateId) {
      const sent = this.sentences.get(stateId);
      if(sent) {
        this.callbacks.ltacProfResults(sent.getRange(),feedback);
      } else {
        this.console.warn(`LtacProf results for unknown stateId: ${stateId}`);
      }
    } else if(feedback.feedbackKind === "worker-status" && hasStateId) {
      const sent = this.sentences.get(stateId);
      if(sent)
        sent.updateWorkerStatus(feedback.id, feedback.ident);
    } else if(feedback.feedbackKind === "message") {
      // this.console.log("Message feedback: " + util.inspect(feedback));
      this.onCoqMessage(feedback, feedback.route, stateId /* can be undefined */);
    } else if(feedback.feedbackKind === "sentence-status" && hasStateId) {
      const sent = this.sentences.get(stateId);
      if(sent) {
        sent.updateStatus(feedback.status);
        this.callbacks.sentenceStatusUpdate(sent.getRange(), sent.getStatus())
      } else {
        // Sometimes, feedback will be received before CoqTop has given us the new stateId,
        // So we will buffer these messages until we get the next 'value' response.
        this.bufferedFeedback.push({stateId: stateId, type: "status", status: feedback.status, worker: feedback.worker});
      }
    }
  }

  /** recieved from coqtop controller */
  private async onCoqClosed(isError: boolean, message?: string) {
    this.callbacks.coqDied(isError ? proto.CoqtopStopReason.Anomaly : proto.CoqtopStopReason.UserRequest, message);
    this.console.log(`onCoqClosed(${message})`);
    if(!this.isRunning())
      return;
    this.dispose();
  }

  private async startCommand() : Promise<false | (()=>void)> {
    if(this.isBusy())
      return false
    if(this.coqLock.isLocked())
      this.console.warn("STM is 'not busy' but lock is still held");
    const release = await this.coqLock.lock();
    this.status = STMStatus.Busy;
    return () => {
      this.status = STMStatus.Ready
      release();
      // if()
      //   this.assertSentenceConsistency();
    };
  }

  public isBusy() {
    return this.status === STMStatus.Busy || this.status === STMStatus.Interrupting || this.editLock.isLocked();
  }

  private isShutdown() {
    return this.status === STMStatus.Shutdown
  }


  public async flushEdits() {
    // Wait until we can acquire the lock and there is no one else immediately waiting for the lock after us
    while(this.editLock.isLocked()) {
      const releaseLock = await this.editLock.lock();
      releaseLock();
    }
  }

  private async acquireCoq<T>(callback: () => T): Promise<T> {
    const release = await this.coqLock.lock();
    try {
      return callback();
    } finally {
      release();
    }
  }

  private debuggingGetSentences(params?: {begin?: State|string, end?: State|string}) {
    let begin : State, end : State;
    if(params && params.begin === 'focus')
      begin = this.focusedSentence;
    if(!params || !params.begin || typeof params.begin === 'string')
      begin = this.root;
    else
      begin = <State>params.begin;

    if(params && params.end === 'focus')
      end = this.focusedSentence;
    else if(!params || !params.end || typeof params.end === 'string')
      end = this.lastSentence;
    else
      end = <State>params.end;

    const results : DSentence[] = [];
    for(let sent of begin.descendantsUntil(end.getNext())) {
      results.push(createDebuggingSentence(sent));
    }
    Object.defineProperty(this,'__proto__',{enumerable: false});
    return results;
  }

  private async refreshOptions() : Promise<void> {
    let options : coqtop.CoqOptions = {};
    options.printingWidth = this.currentCoqOptions.printingWidth;
    options.printingCoercions = this.currentCoqOptions.printingCoercions;
    options.printingMatching = this.currentCoqOptions.printingMatching;
    options.printingNotations = this.currentCoqOptions.printingNotations;
    options.printingExistentialInstances = this.currentCoqOptions.printingExistentialInstances;
    options.printingImplicit = this.currentCoqOptions.printingImplicit;
    options.printingAll = this.currentCoqOptions.printingAll;
    options.printingUniverses = this.currentCoqOptions.printingUniverses;
    await this.coqtop.coqSetOptions(options);
  }

  /** Check for sentences that
   * - overlap
   * - exist but are unreachable
   * - exist but are invalidated
   * - are out of order (position in text does not agree with linking order)
   * @returns true if everything is seems okay
  */
  public assertSentenceConsistency() : boolean {
    var success = true;
    const error = (message: string) => {
      this.console.warn(message);
      success = false;
    }
    if(this.isBusy())
      return;
    let prev : State = this.root;
    const stateIds : number[] = [prev.getStateId()];
    while(prev.getNext()) {
      const st = prev.getNext();
      const range = st.getRange();
      if(textUtil.positionIsBefore(range.start, prev.getRange().end))
        error(`States are out of order: id=${prev.getStateId()} and id=${st.getStateId()}`)

      if(range.start === range.end && st !== this.root)
        error(`Empty state sentence: id=${st.getStateId()}`)

      if(st.isInvalidated())
        error(`State is invalidated but not deleted: id=${st.getStateId()}`)

      if(!this.sentences.has(st.getStateId()))
        error(`State is reachable but not mapped: id=${st.getStateId()}`)
      else if(this.sentences.get(st.getStateId()) !== st)
        error(`State does not map to itself: id=${st.getStateId()}`)

      stateIds.push(st.getStateId());
      prev = st;
    }

    const ids = new Set(stateIds);
    if(ids.size !== stateIds.length)
      error('Reachable states have duplicate IDs')

    for(let id of this.sentences.keys()) {
      if(!ids.has(id))
        error(`State is mapped but unreachable: id=${id}`)
    }

    return success;
  }


  public logDebuggingSentences(ds?: DSentence[]) {
    if(!ds)
      ds = this.debuggingGetSentences()
    this.console.log(ds.map((s,idx) => '  ' + (1+idx) + ':\t' + s).join('\n'));
  }

}

// function createDebuggingSentence(sent: Sentence) : {cmd: string, range: string} {
//   const cmd = sent.getText();
//   const range = `${sent.getRange().start.line}:${sent.getRange().start.character}-${sent.getRange().end.line}:${sent.getRange().end.character}`;
//   function DSentence() {
//     this.cmd = cmd;
//     this.range = range;
//     Object.defineProperty(this,'__proto__',{enumerable: false});
//   }
// //  Object.defineProperty(DSentence, "name", { value: cmd });
//   Object.defineProperty(DSentence, "name", { value: "A" });
//   return new DSentence();
// }
function abbrString(s:string) {
  var s2 = coqParser.normalizeText(s);
  if(s2.length > 80)
    return s2.substr(0,80-3) + '...';
  else return s2;
}

type DSentence = string;
function createDebuggingSentence(sent: State) : DSentence {
  return `${sent.getRange().start.line}:${sent.getRange().start.character}-${sent.getRange().end.line}:${sent.getRange().end.character} -- ${abbrString(sent.getText().trim())}`;
}



// class DSentence {
//   public cmd: string;
//   public range: string;
//   constructor(sent: Sentence) {
//     this.cmd = sent.getText();
//     this.range = `${sent.getRange().start.line}:${sent.getRange().start.character}-${sent.getRange().end.line}:${sent.getRange().end.character}`;
//  }
//   public toString() {
//     return this.cmd;
//   }
//   public inspect() {
//     return {cmd: this.cmd, range: this.range}
//   }
// }