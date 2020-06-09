'use strict';

import {TextDocument, TextDocumentContentChangeEvent, RemoteConsole, Position, Range, Diagnostic} from 'vscode-languageserver';
import * as vscode from 'vscode-languageserver';
import {CancellationToken} from 'vscode-jsonrpc';
import * as thmProto from './protocol';
import * as coqProto from './coqtop/coq-proto';
import * as coqParser from './parsing/coq-parser';
import * as textUtil from './util/text-util';
import {AnnotatedText, textToDisplayString} from './util/AnnotatedText';
import {CoqStateMachine, GoalResult, StateStatus} from './stm/STM';
import {FeedbackSync, DocumentFeedbackCallbacks} from './FeedbackSync';
import {SentenceCollection} from './sentence-model/SentenceCollection';
import {CoqProject} from './CoqProject';

/** vscode needs to export this class */
export interface TextDocumentItem {
    uri: string;
    languageId: string;
    version: number;
    text: string;
}


export interface MessageCallback {
  sendMessage(level: string, message: AnnotatedText, routeId: coqProto.RouteId) : void;
}
export interface ResetCallback {
  sendReset() : void;
}
export interface LtacProfCallback {
  sendLtacProfResults(results: coqProto.LtacProfResults) : void;
}

export interface CoqtopStartCallback {
  sendCoqtopStart() : void;
}

export interface CoqtopStopCallback {
  sendCoqtopStop(reason: thmProto.CoqtopStopReason, message?: string);
}

export type DocumentCallbacks = MessageCallback & ResetCallback & LtacProfCallback & CoqtopStartCallback & CoqtopStopCallback & DocumentFeedbackCallbacks;

export class CoqDocument implements TextDocument {
  // TextDocument
  public get uri() { return this.document.uri };
  public get languageId() { return this.document.languageId };
  public get version() { return this.document.version };
  public get lineCount() { return this.document.lineCount };
  public getText() {
    return this.document.getText();;
  }

  private project: CoqProject;


  private stm: CoqStateMachine|null = null;
  private clientConsole: RemoteConsole;
  private callbacks : MessageCallback & ResetCallback & LtacProfCallback & CoqtopStartCallback & CoqtopStopCallback;
  private document: SentenceCollection = null;
  // Feedback destined for the extension client/view
  private feedback : FeedbackSync;

  private parsingRanges : Range[] = [];
  // private interactionCommands = new AsyncWorkQueue();
  // private interactionLoopStatus = InteractionLoopStatus.Idle;
  // we'll use this as a callback, so protect it with an arrow function so it gets the correct "this" pointer

  constructor(project : CoqProject, document: TextDocumentItem, clientConsole: RemoteConsole, callbacks: DocumentCallbacks) {
    this.clientConsole = clientConsole;
    this.document = new SentenceCollection(document);
    this.callbacks = callbacks;
    this.project = project;
    this.feedback = new FeedbackSync(callbacks, 200);

    if(project.settings.coqtop.startOn === "open-script")
      this.resetCoq();
  }

  public async applyTextEdits(changes: TextDocumentContentChangeEvent[], newVersion: number) {
    // sort the edits such that later edits are processed first
    let sortedChanges =
      changes.slice().sort((change1,change2) =>
        textUtil.positionIsAfter(change1.range.start, change2.range.start) ? -1 : 1)

    this.document.applyTextChanges(newVersion, changes);

    if(this.isStmRunning()) {
      try {
        this.stm.applyChanges(sortedChanges, newVersion, this.document.getText());
      } catch (err) {
        this.clientConsole.error("STM crashed while applying text edit: " + err.toString())
      }

      this.updateHighlights();
      this.updateDiagnostics();
    }

    if(this.isStmRunning() && this.project.settings.coq.diagnostics && this.project.settings.coq.diagnostics.checkTextSynchronization) {
      const documentText = this.document.getText();
      const parsedSentencesText = this.document.getSentenceText();
      await this.stm.flushEdits();
      const stmText = this.stm.getStatesText();
      if(!documentText.startsWith(parsedSentencesText) && this.document.getDocumentVersion() === newVersion) {
        console.error("Document text differs from parsed-sentences text");
        console.error("On applied changes: ");
        changes.forEach(change => {
          console.error("  > " + textUtil.rangeToString(change.range) + " -> " + change.text);
        })
      }
      if(!documentText.startsWith(stmText) && this.stm.getDocumentVersion() === newVersion) {
        console.error("Document text differs from STM text");
        console.error("On applied changes: ");
        changes.forEach(change => {
          console.error("  > " + textUtil.rangeToString(change.range) + " -> " + change.text);
        })
      }
    }
  }

  public getSentences() : SentenceCollection {
    return this.document;
  }

  public getSentencePrefixTextAt(pos: Position) {
    return this.document.getSentencePrefixTextAt(pos);
  }

  public offsetAt(pos: Position) : number {
    return this.document.offsetAt(pos);
  }

  /**
   * @returns the Position (line, column) for the location (character position)
   */
  public positionAt(offset: number) : Position {
    return this.document.positionAt(offset);
  }

  private sentenceToHighlightRange(status: StateStatus, highlights) : Range[] {
    switch(status) {
      case StateStatus.Axiom:           return highlights.axiomRange;
      case StateStatus.Error:           return highlights.errorRange;
      case StateStatus.Parsing:         return highlights.parsingRange;
      case StateStatus.Processing:      return highlights.processingRange;
      case StateStatus.Incomplete:      return highlights.incompleteRange;
      case StateStatus.Processed:       return highlights.processedRange;
    }
  }

  /** creates the current highlights from scratch */
  private createHighlights() : thmProto.Highlights {
    const highlights : thmProto.Highlights =
      { axiomRange: [],
        stateErrorRange: [],
        parsingRange: [],
        processingRange: [],
        incompleteRange: [],
        processedRange: []
      };
    if(!this.isStmRunning())
      return highlights;
    for(let sent of this.stm.getSentences()) {
      const ranges = this.sentenceToHighlightRange(sent.status, highlights);
      if(ranges.length > 0 && textUtil.positionIsEqual(ranges[ranges.length-1].end, sent.range.start))
        ranges[ranges.length-1].end = sent.range.end;
      else {
        ranges.push(Range.create(sent.range.start,sent.range.end));
      }
    }
    return highlights;
  }

  private onCoqStateStatusUpdate(range: Range, status: StateStatus) {
    this.updateHighlights();
  }

  private onClearSentence(range: Range) {
    // this.updateHighlights();
  }

  private updateHighlights(now = false) {
    this.feedback.updateHighlights(() => {
      const highlights = this.createHighlights();
      const parsingRanges = highlights.parsingRange;
      Array.prototype.push.apply(parsingRanges, this.parsingRanges);
      return highlights;
    }, now);
  }

  private onCoqStateError(sentenceRange: Range, errorRange: Range, message: AnnotatedText) {
    this.updateHighlights();
    this.updateDiagnostics()
    // this.addDiagnostic(
    //   { message: message
    //   , range: errorRange
    //   , severity: DiagnosticSeverity.Error
    //   });
  }


  private onCoqMessage(level: coqProto.MessageLevel, message: AnnotatedText, routeId: coqProto.RouteId) {
    this.callbacks.sendMessage(coqProto.MessageLevel[level], message, routeId);
  }

  private onCoqStateLtacProf(range: Range, results: coqProto.LtacProfResults) {
    this.callbacks.sendLtacProfResults(results);
  }

  private async onCoqDied(reason: thmProto.CoqtopStopReason, error?: string) {
    this.callbacks.sendCoqtopStop(reason, error);
    if(error) {
      this.resetCoq();
      this.callbacks.sendReset();
    }
  }

  public async resetCoq() {
    if(this.isStmRunning())
      this.stm.shutdown(); // Don't bother awaiting
    this.stm = new CoqStateMachine(
      this.project,
      () => {
        this.callbacks.sendCoqtopStart();
        return this.project.createCoqTopInstance(this.uri);
      }, {
        sentenceStatusUpdate: (x1,x2) => this.onCoqStateStatusUpdate(x1,x2),
        clearSentence: (x1) => this.onClearSentence(x1),
        updateStmFocus: (x1) => this.onUpdateStmFocus(x1),
        error: (x1,x2,x3) => this.onCoqStateError(x1,x2,x3),
        message: (x1,x2,x3) => this.onCoqMessage(x1,x2,x3),
        ltacProfResults: (x1,x2) => this.onCoqStateLtacProf(x1,x2),
        coqDied: (reason: thmProto.CoqtopStopReason, error?: string) => this.onCoqDied(reason, error),
      });
  }

  private onUpdateStmFocus(focus: Position) {
    this.feedback.updateFocus(focus, false);
  }


  // private async cancellableOperation<T>(operation: Thenable<T>) : Promise<T> {
  //   return await Promise.race<T>(
  //     [ operation
  //     , this.cancelProcessing.event.then(() => Promise.reject<T>('operation cancelled'))
  //     ]);
  // }

  /** generates a list of contiguous commands
   * @param begin: where to start parsing commands
   * @param endOffset: if specified, stop at the last command to not exceed the offset
   */
  private *commandSequenceGenerator(begin: Position, end?: Position, highlight: boolean = false) : IterableIterator<{text: string, range: Range}> {
    const documentText = this.document.getText();
    let endOffset : number;
    if(end === undefined)
      endOffset = documentText.length;
    else
      endOffset = Math.min(this.offsetAt(end), documentText.length);

    let currentOffset = this.offsetAt(begin);
    if(currentOffset >= endOffset)
      return;

    while(true) {
      const commandLength = coqParser.parseSentenceLength(documentText.substr(currentOffset, endOffset))
      const nextOffset = currentOffset + commandLength;
      if(commandLength > 0 || nextOffset > endOffset) {
        let result =
          { text: documentText.substring(currentOffset, nextOffset)
          , range: Range.create(this.positionAt(currentOffset),this.positionAt(nextOffset))
          };
        yield result;
        // only highlight if the command was accepted (i.e. another is going to be request; i.e. after yield)
        if (highlight) {// Preliminary "parsing" highlight
          this.parsingRanges.push(result.range);

        this.updateHighlights(true);
        }
      } else
        return;
      currentOffset = nextOffset;
    }
  }

  private commandSequence(highlight=false) {
    return (begin,end?) => this.commandSequenceGenerator(begin,end,highlight);
  }

  // /**
  //  * @param currentSentence: where to start parsing the next sentence
  //  * @param maxOffset: do not parse past maxOffset
  //  * @returns the next parsed sentence OR else null if parsing exceeds @maxOffset
  //  */
  // private async plainStepForward(maxOffset?: number) : Promise<StepResult> {
  //   const start = this.stm.getFocusedPosition();
  //   const startOffset = this.offsetAt(start);
  //   const docText = this.documentText;
  //   const sentenceLength = coqParser.parseSentence(this.documentText.substr(startOffset,maxOffset));
  //   if(sentenceLength == -1)
  //     return StepResult.NoMoreCommands;
  //   const stopPos = startOffset + sentenceLength;

  //   if(maxOffset!==undefined && stopPos > maxOffset)
  //     return StepResult.ExceedsMaxOffset;

  //   const range = Range.create(start,this.positionAt(stopPos));
  //   let command = docText.substring(startOffset, stopPos);

  //   // Preliminary "parsing" highlight
  //   const parsingHighlights = [
  //     { style: thmProto.HighlightType.Parsing, textBegin: startOffset, textEnd: stopPos }
  //     ];
  //   this.callbacks.sendHighlightUpdates(parsingHighlights);

  //   try {
  //     const unfocused = await this.stm.stepForward(command, range, this.version, true);
  //     return unfocused ? StepResult.Unfocused : StepResult.Focused;
  //   } catch(err) {
  //     const error = <CommandParseError>err;

  //     const highlights = [
  //       { style: thmProto.HighlightType.Clear, textBegin: startOffset, textEnd: stopPos }
  //       // { style: thmProto.HighlightType.SyntaxError, textBegin: errorEnd, textEnd: errorEnd },
  //       ];
  //     this.callbacks.sendHighlightUpdates(highlights);

  //     this.addDiagnostic({
  //       message: error.message,
  //       range: error.range,
  //       severity: DiagnosticSeverity.Error
  //       });

  //     throw error;
  //   }
  // }

  // private async addDiagnostic(diagnostic: Diagnostic) {
  //   const diag = diagnostic;
  //   diag.message = await richppToMarkdown(diag.message);
  //   this.diagnostics.push(diag);
  //   this.callbacks.sendDiagnostics(this.diagnostics);
  // }

  // private removeDiagnosticsContaining(pos: Position, sendUpdate?: boolean) {
  //   this.diagnostics = this.diagnostics
  //     .filter((d) => !textUtil.rangeContains(d.range, pos));
  //   if(sendUpdate === undefined || sendUpdate===true)
  //     this.callbacks.sendDiagnostics(this.diagnostics);
  // }

  // private removeDiagnosticsIntersecting(range: Range, sendUpdate?: boolean) {
  //   this.diagnostics = this.diagnostics
  //     .filter((d) => !textUtil.rangeTouches(d.range, range));
  //   if(sendUpdate === undefined || sendUpdate===true)
  //     this.callbacks.sendDiagnostics(this.diagnostics);
  // }


  // private shiftDiagnostics(delta: textUtil.RangeDelta) {
  //   for(let idx = 0; idx < this.diagnostics.length; ++idx) {
  //     this.diagnostics[idx].range = textUtil.rangeTranslate(this.diagnostics[idx].range, delta);
  //   }
  // }


  // private clearSentenceHighlight(sentence: Sentence, endSentence?: Sentence) {
  //   this.callbacks.sendHighlightUpdates([{
  //     style: thmProto.HighlightType.Clear,
  //     textBegin: sentence.textBegin,
  //     textEnd: endSentence ? endSentence.textEnd : sentence.textEnd
  //   }]);
  // }

  // private clearSentenceHighlightAfter(sentence: Sentence, endSentence?: Sentence) {
  //   this.callbacks.sendHighlightUpdates([{
  //     style: thmProto.HighlightType.Clear,
  //     textBegin: sentence.textEnd,
  //     textEnd: endSentence ? endSentence.textEnd : sentence.textEnd
  //   }]);
  // }


  // /** Interpret to point
  //  * Tell Coq to process the proof script up to the given point
  //  * This may not fully process everything, or it may rewind the state.
  //  */
  // private async interpretToPoint(position: Position) : Promise<thmProto.CoqTopGoalResult> {
  //   try {
  //     do {
  //       const focus = this.stm.getFocusedPosition();
  //       const focusOffset = this.offsetAt(focus);
  //       const offset = this.offsetAt(position);
  //       if(textUtil.positionIsAfterOrEqual(position, focus)) {
  //         // We need to step forward to reach the location.
  //         // We might be focused in the middle of a proof, so even if there is a
  //         // closer state we can jump to, we cannot call coqEditAt just yet.
  //         // (Or else we will get a Coq anomally :/ )
  //         for(let command of this.commandSequence(focus,offset)) {
  //           const focusChanged = this.stm.stepForward(command.text, command.range, this.version, true);
  //           if(focusChanged)
  //             break;
  //         }

  //         // At this point, either we have reached the location we're looking for,
  //         // or else the proof has become unfocused (the current state might be
  //         // anywhere) and we will need to call coqEditAt to get closer to the location.
  //         const closestSentence = this.sentences.findPrecedingSentence(location);
  //         // Are we at the closest sentence?
  //         if(forwardSentence.stateId !== closestSentence.stateId) {
  //           // No; jump there
  //           await this.jumpToLocation(closestSentence);
  //         }
  //         // We can now step forward directly to the location
  //         return await this.interpretToEnd(location);
  //       } else {
  //         // Our desired location is above us; we'll have to jump there
  //         const closestSentence = this.sentences.findPrecedingSentence(location);
  //         await this.jumpToLocation(closestSentence);
  //         return await this.rawGetGoal();
  //       }
  //     }
  //   } catch(error) {
  //     return this.errorGoalResult(error);
  //   }
  // }


  // private errorGoalResult(error: FailureResult) : thmProto.CoqTopGoalResult {
  //   const e = <coqProto.FailValue>{
  //     message: error.message,
  //     range: error.range
  //     };
  //   return {error: e};
  // }

  // /**
  //  *
  //  *  */
  // private async interpretToEnd(maxOffset?: number) : Promise<thmProto.CoqTopGoalResult> {
  //   let currentSentence = this.sentences.getTip();

  //   try {
  //     await this.stepForwardUntil(maxOffset);

  //     return await this.rawGetGoal();
  //   } catch(error) {
  //     return this.errorGoalResult(error);
  //   }
  // }

//   private async rollbackState(startingSentence: Sentence, endSentence?: Sentence) {
//     if(this.sentences.getTip().stateId !== startingSentence.stateId) {
//       // Undo the sentence
// this.clientConsole.log("rolling back state");
//       await this.coqTop.coqEditAt(startingSentence.stateId);
//       this.sentences.rewindTo(startingSentence);
//       if(endSentence !== undefined)
//         this.clearSentenceHighlightAfter(startingSentence,endSentence);
// this.clientConsole.log("rolled back");
//     }
//   }


  // private async stepForward() : Promise<thmProto.CoqTopGoalResult> {
  //   const currentSentence = this.sentences.getTip();
  //   try {
  //     const interp = await this.plainStepForward(currentSentence);
  //     if(!interp)
  //       return {}

  //     return await this.rawGetGoal(interp.nextSentence ? interp.nextSentence.stateId : undefined);
  //   } catch(error) {
  //     this.rollbackState(currentSentence);
  //     return this.errorGoalResult(error);
  //   }
  // }

  // /**
  //  *
  //  *  */
  // private async stepBackward() : Promise<thmProto.CoqTopGoalResult> {
  //   // grab the tip sentence
  //   const currentSentence = this.sentences.getTip();

  //   try {
  //     const prevSentence = this.sentences.getPredecessor(currentSentence);

  //     if(prevSentence == null) {
  //       await this.doResetCoq();
  //       return {};
  //     }

  //     await this.coqTop.coqEditAt(prevSentence.stateId);
  //     this.sentences.rewindTo(prevSentence);
  //     this.callbacks.sendHighlightUpdates([
  //       this.highlightSentence(currentSentence, thmProto.HighlightType.Clear)
  //       ]);
  //     return await this.rawGetGoal(prevSentence.stateId);
  //   } catch(err) {
  //     const error = <FailureResult>err;
  //     const beforeErrorSentence = this.sentences.get(error.stateId);
  //     await this.coqTop.coqEditAt(error.stateId);

  //     this.clearSentenceHighlightAfter(beforeErrorSentence,currentSentence);
  //     this.sentences.rewindTo(beforeErrorSentence);
  //     return await this.getGoal();
  //   }

  // }

  public async dispose() {
    if(this.isStmRunning()) {
      await this.stm.shutdown();
      this.stm = null;
    }
  }

  // private async protectOperation(op: (wasReset:boolean)=>Promise<thmProto.CoqTopGoalResult>, lazyInitialize?: boolean) : Promise<thmProto.CoqTopGoalResult> {
  //   lazyInitialize = (lazyInitialize===undefined) ? true : false;
  //   let unlock : () => Promise<void>;
  //   try {
  //     unlock = await this.processingLock.lock(this.cancelProcessing.event);
  //   } catch(reason) {
  //     return <coqProto.FailValue>{message: "operation cancelled"};
  //   }
  //   try {
  //     if(!this.coqTop.isRunning()) {
  //       if(!lazyInitialize)
  //         return {};
  //       await this.cancellableOperation(this.doResetCoq());
  //       const result = await this.cancellableOperation(op(true));
  //     } else
  //       return await this.cancellableOperation(op(false));
  //   } catch(reason) {
  //     return <coqProto.FailValue>{message: reason};
  //   } finally {
  //     unlock();
  //   }
  // }

  // private interrupt() {
  //   this.coqTop.coqInterrupt();
  // }


  // /**
  //  * This loop handles each coq command and text edit sequentially.
  //  * One of the requirements is that a command's document position is still valid when it returns so that we can report accurate error messages, so text edits that arrive while a command is being processed are delayed until the command finished so that we do not invalidate its document positions.
  //  *
  //  * To cancel the current queue of commands, call cancelCoqOperations()
  //  */
  // private async interactionLoop() {
  //   while(true) {
  //     try {
  //       await this.interactionCommands.executeOneTask();
  //     } catch(error) {
  //       this.clientConsole.warn(`Interaction loop exception: ${error}`);
  //     } finally {
  //     }
  //   }
  // }

  // /**
  //  * Ensures that the text edits are applied *after* the currently scheduled operations; this delay prevents their document positions from being invalidated too soon
  //  * However, if the edit will result in changing an already-interpreted sentence, then all current Coq processing will be cancelled.
  //  * Text edits themselves cannot be cancelled, but the Coq operations they may perform to set the current editing positions *can* be cancelled.
  //  */
  // public textEdit(changes: TextDocumentContentChangeEvent[]) {
  //   // If any of the edits affect an interpreted sentence, then interrupt and cancel all Coq operations
  //   for(const change of changes) {
  //     const beginOffset = this.offsetAt(change.range.start);
  //     const endOffset = beginOffset + change.rangeLength;
  //     // Have any sentences been edited?
  //     const rangeSent = this.sentences.getRangeAffected(beginOffset,endOffset);

  //     if(!this.isPassiveEdit(rangeSent,change, beginOffset, endOffset) && rangeSent.length) {
  //       //this.clientConsole.info("Cancelling current Coq operations due to editing text of interpreted statements.");
  //       this.cancelCoqOperations();
  //       break;
  //     }
  //   }
  //   const cancelSignal = this.cancelProcessing;
  //   return this.interactionCommands.process<void>(async () => {
  //     this.interactionLoopStatus = InteractionLoopStatus.TextEdit;
  //     try {
  //       // applyTextEdits will check for a cancellation signal during Coq calls, but text-editing itself should never be cancelled
  //       return await this.applyTextEdits(changes, cancelSignal);
  //     } finally {
  //       this.interactionLoopStatus = InteractionLoopStatus.Idle;
  //     }
  //   });
  // }


  // private updateComputingStatus(status: thmProto.ComputingStatus, startTime: [number,number]) {
  //   const duration = process.hrtime(startTime);
  //   const interval = duration[0] * 1000.0 + (duration[1] / 1000000.0);
  //   this.callbacks.sendComputingStatus(status, interval);
  // }

  // private async doCoqOperation<X>(task: ()=>Promise<X>, lazyInitializeCoq? : boolean) {
  //   lazyInitializeCoq = (lazyInitializeCoq===undefined) ? true : lazyInitializeCoq;
  //   if(!this.coqTop.isRunning()) {
  //     if(lazyInitializeCoq) {
  //       await this.doResetCoq();
  //     } else
  //       return {};
  //   }

  //   return await task();
  // }

  // private enqueueCoqOperation<X>(task: ()=>Promise<X>, lazyInitializeCoq? : boolean) {
  //   // this.cancelProcessing might change in the future, so we want to make sure that, when
  //   // the task is eventually run, it will use the CURRENT this.cancelProcessing
  //   const cancelSignal = this.cancelProcessing;
  //   return this.interactionCommands.process<X>(async () => {
  //     if(cancelSignal.isCancelled())
  //       return Promise.reject<X>(<coqProto.FailValue>{message: 'operation cancelled'})

  //     this.interactionLoopStatus = InteractionLoopStatus.CoqCommand;
  //     const startTime = process.hrtime();
  //     const statusCheck = setInterval(() => this.updateComputingStatus(thmProto.ComputingStatus.Computing, startTime), 500);
  //     var interrupted = false;
  //     try {
  //       return await Promise.race<X>(
  //         [ this.doCoqOperation(task, lazyInitializeCoq)
  //         , cancelSignal.event.then(() => Promise.reject<X>(<coqProto.FailValue>{message: 'operation cancelled'}))
  //         ]);
  //     } catch(error) {
  //       this.updateComputingStatus(thmProto.ComputingStatus.Interrupted, startTime);
  //       interrupted = true;
  //       throw error;
  //     } finally {
  //       this.interactionLoopStatus = InteractionLoopStatus.Idle;
  //       clearInterval(statusCheck);
  //       if(!interrupted)
  //         this.updateComputingStatus(thmProto.ComputingStatus.Finished, startTime);
  //     }
  //   });
  // }

  // /**
  //  * Cancels all coq commands that are associated with `cancelProcessing`, which should be every coq command in `interactionCommands`.
  //  * If a text edit invalidates a state, then this method should also be called.
  //  */
  // private cancelCoqOperations() : Promise<void> {
  //   // Cancel all current and pending operations
  //   this.cancelProcessing.cancel();
  //   // Do not cancel subsequent operations
  //   this.cancelProcessing = new CancellationSignal();
  //   if(this.interactionLoopStatus === InteractionLoopStatus.CoqCommand)
  //     return this.coqTop.coqInterrupt();
  // }

  // private async interactionsCoqQuit() {
  //   const waitMS = 1000;
  //   const cancelling = this.cancelCoqOperations();
  //   try {
  //     await Promise.race<{}>([cancelling, new Promise((resolve,reject) => setTimeout(() => reject(), waitMS))]);
  //   } finally {
  //     await this.coqTop.coqQuit();
  //   }
  // }

  // private async interactionsCoqReset() {
  //   const waitMS = 1000;
  //   const cancelling = this.cancelCoqOperations();
  //   try {
  //     await Promise.race<{}>([cancelling, new Promise((resolve,reject) => setTimeout(() => reject(), waitMS))]);
  //   } finally {
  //     await this.doResetCoq();
  //   }
  // }

  /** Make sure that the STM is running */
  private assertStm() {
    if(!this.isStmRunning())
      this.resetCoq();
  }

  // private convertErrorToCommandResult(error: any) : thmProto.FailureResult {
  //   if(error instanceof Interrupted) {
  //     return undefined;
  //   } else if(error instanceof CoqtopError) {
  //   } else if(error instanceof CallFailure) {
  //     return Object.assign<thmProto.FailureResult,thmProto.FocusPosition>({type: 'failure', message: error.message, range: error.range, sentence: error.stateId}, {focus: this.stm.getFocusedPosition()})
  //   else
  //     throw error;
  // }

  private toGoal(goal: GoalResult) : thmProto.CommandResult {
    if(goal.type === 'not-running')
      return goal;
    else if(!this.isStmRunning())
      return {type: 'not-running', reason: 'not-started'};
    // This is silly (Typescript is not yet smart enough)
    return {focus: this.stm.getFocusedPosition(), ...goal};

  //     export type GoalResult = proto.NoProofTag | proto.NotRunningTag |
  // (proto.FailValue & proto.FailureTag) |
  // (proto.ProofView & proto.ProofViewTag) |
  // (proto.CommandInterrupted & proto.InterruptedTag)


//   export type FocusPosition = {focus: vscode.Position}
// export type NotRunningTag = {type: 'not-running'}
// export type NoProofTag = {type: 'no-proof'}
// export type FailureTag = {type: 'failure'}
// export type ProofViewTag = {type: 'proof-view'}
// export type InterruptedTag = {type: 'interrupted'}
// export type NotRunningResult = NotRunningTag
// export type NoProofResult = NoProofTag & FocusPosition
// export type FailureResult = FailValue & FailureTag & FocusPosition
// export type ProofViewResult = ProofView & ProofViewTag & FocusPosition
// export type InterruptedResult = CommandInterrupted & InterruptedTag & FocusPosition
// export type CommandResult = NotRunningTag | FailureResult | ProofViewResult | InterruptedResult | NoProofResult
  }

  private updateDiagnostics(now = false) {
    if(!this.isStmRunning())
      return;

    this.feedback.updateDiagnostics(() => {
      const diagnostics : Diagnostic[] = [];
      for(let d of this.stm.getDiagnostics()) {
        var range : Range = d.sentence;
        if(d.range) {
          range = d.range;
        }
        diagnostics.push(Diagnostic.create(range,textToDisplayString(d.message),d.severity,undefined,'coqtop'))
      }

      diagnostics.push(...Array.from(this.document.getErrors()));
    return diagnostics;
    }, now);
  }


  public async stepForward(token: CancellationToken) : Promise<thmProto.CommandResult> {
    this.assertStm();
    try {
      this.parsingRanges = [];
      const error = await this.stm.stepForward(this.commandSequence(true));
      if(error)
        return error
      return this.toGoal(await this.stm.getGoal());
    } finally {
      this.parsingRanges = [];
      this.updateHighlights(true);
      this.updateDiagnostics(true);
    }
  }

  public async stepBackward(token: CancellationToken) : Promise<thmProto.CommandResult> {
    this.assertStm();
    try {
    const error = await this.stm.stepBackward();
    if(error)
      return error;
    return this.toGoal(await this.stm.getGoal());
    } finally {
      this.updateHighlights(true);
      this.updateDiagnostics(true);
    }
  }

  public async interpretToPoint(location: number|vscode.Position, synchronous = false, token: CancellationToken) : Promise<thmProto.CommandResult> {
    this.assertStm();
    try {
      const pos = (typeof location === 'number') ? this.positionAt(location) : location;

      this.parsingRanges = [Range.create(this.stm.getFocusedPosition(),pos)];
      this.updateHighlights(true);
      const error = await this.stm.interpretToPoint(pos,this.commandSequence(false), this.project.settings.coq.interpretToEndOfSentence, synchronous, token);
      if(error)
        return error;
      return this.toGoal(await this.stm.getGoal());
    } finally {
      this.parsingRanges = [];
      this.updateHighlights(true);
      this.updateDiagnostics(true);
    }

  }

  public async interpretToEnd(synchronous = false, token: CancellationToken) : Promise<thmProto.CommandResult> {
    return await this.interpretToPoint(this.document.getText().length,synchronous,token);
  }

  public async getGoal() : Promise<thmProto.CommandResult> {
    if(!this.isStmRunning())
      return {type: 'not-running', reason: "not-started"};
    try {
      return this.toGoal(await this.stm.getGoal());
    } finally {
      this.updateDiagnostics(true);
    }
  }

  public async getCachedGoal(pos: vscode.Position, direction: "preceding"|"subsequent") : Promise<thmProto.CommandResult> {
    if(!this.isStmRunning())
      return {type: 'not-running', reason: "not-started"};
    try {
      return this.toGoal(await this.stm.getCachedGoal(pos, direction));
    } finally {
      this.updateDiagnostics(true);
    }
  }

  public async getStatus(force: boolean) : Promise<thmProto.CommandResult> {
    if(!this.isStmRunning())
      return {type: 'not-running', reason: "not-started"};
    try {
      return await this.stm.getStatus(force);
    } finally {
      this.updateDiagnostics(true);
    }
  }

  public async finishComputations() {
    if(this.isStmRunning())
      this.stm.finishComputations();
  }

  public async query(query: "locate"|"check"|"print"|"search"|"about"|"searchAbout", term: string, routeId: coqProto.RouteId) {
    if(!this.isStmRunning())
      return "Coq is not running";
    switch(query) {
      case "locate":
        try {
          return await this.stm.doQuery(`Locate ${term}.`, routeId);
        } catch(err) {
          return await this.stm.doQuery(`Locate "${term}".`, routeId);
        }
      case "check":       return await this.stm.doQuery(`Check ${term}.`, routeId)
      case "print":       return await this.stm.doQuery(`Print ${term}.`, routeId)
      case "search":      return await this.stm.doQuery(`Search ${term}.`, routeId)
      case "about":       return await this.stm.doQuery(`About ${term}.`, routeId)
      case "searchAbout": return await this.stm.doQuery(`SearchAbout ${term}.`, routeId)
    }
  }

  public async setWrappingWidth(columns: number) {
    if(!this.isStmRunning())
      return;

    await this.stm.setWrappingWidth(columns);
  }

  public async requestLtacProfResults(offset?: number) {
    if(!this.isStmRunning())
      return;
    await this.stm.requestLtacProfResults(offset ? this.positionAt(offset) : undefined);
  }

  public async interrupt() {
    if(!this.isStmRunning())
      return;
    this.stm.interrupt();
  }

  public async quitCoq() {
    if(!this.isStmRunning())
      return;
    await this.stm.shutdown();
    this.stm.dispose();
    this.stm = null;
  }

  public async setDisplayOptions(options: {item: thmProto.DisplayOption, value: thmProto.SetDisplayOption}[]) {
    if(!this.isStmRunning())
      return;
    this.stm.setDisplayOptions(options);
  }

  public isStmRunning() : boolean {
    return this.stm && this.stm.isRunning();
  }

}
