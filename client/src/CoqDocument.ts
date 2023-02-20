'use strict';

import * as vscode from 'vscode';
import { TextEditor, Disposable } from 'vscode';
import * as vscodeTypes from 'vscode-languageserver-types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {decorations} from './Decorations';
import {Highlights} from './Highlights';
// import {CoqView, SimpleCoqView} from './SimpleCoqView';
// import {MDCoqView} from './MDCoqView';
import {HtmlCoqView} from './HtmlCoqView';
import {HtmlLtacProf} from './HtmlLtacProf';
import * as proto from './protocol';
import * as textUtil from './text-util';
import {extensionContext} from './extension';
import {CoqDocumentLanguageServer} from './CoqLanguageServer';
import {CoqView, adjacentPane} from './CoqView';
import {StatusBar} from './StatusBar';
import {CoqProject} from './CoqProject';
import * as psm from './prettify-symbols-mode';

namespace DisplayOptionPicks {
  type T = vscode.QuickPickItem & {displayItem: number};
  export const ImplicitArguments : T =
  { label: "Implicit Arguments", description: "toggle display of *implicit arguments*", detail: "some detail", displayItem: proto.DisplayOption.ImplicitArguments };
  export const Coercions : T =
  { label: "Coercions", description: "toggle display of *coercions*", displayItem: proto.DisplayOption.Coercions };
  export const RawMatchingExpressions : T =
  { label: "Raw Matching Expressions", description: "toggle display of *raw matching expressions*", displayItem: proto.DisplayOption.RawMatchingExpressions };
  export const Notations : T =
  { label: "Notations", description: "toggle display of notations", displayItem: proto.DisplayOption.Notations };
  export const AllBasicLowLevelContents : T =
  { label: "All Basic Low Level Contents", description: "toggle display of ", displayItem: proto.DisplayOption.AllBasicLowLevelContents };
  export const ExistentialVariableInstances : T =
  { label: "Existential Variable Instances", description: "toggle display of ", displayItem: proto.DisplayOption.ExistentialVariableInstances };
  export const UniverseLevels : T =
  { label: "Universe Levels", description: "toggle display of ", displayItem: proto.DisplayOption.UniverseLevels };
  export const AllLowLevelContents : T =
  { label: "All Low Level Contents", description: "toggle display of ", displayItem: proto.DisplayOption.AllLowLevelContents };
  export const allPicks = [ImplicitArguments, Coercions, RawMatchingExpressions, Notations, AllBasicLowLevelContents, ExistentialVariableInstances, UniverseLevels, AllLowLevelContents];
}

export class CoqDocument implements vscode.Disposable {
  /** A list of things to dispose */
  private readonly queryRouteId = 2;
  private readonly hoverQueryRouteId = 3;
  private readonly hoverQueryTimeout = 500; // ms
  private hoverListener : undefined | ((str:string) => void);
  private subscriptions : Disposable[] = []
  private statusBar: StatusBar;
  public documentUri: string;
  public highlights = new Highlights();
  private document: vscode.TextDocument;
  private langServer: CoqDocumentLanguageServer;
  private view : CoqView;
  /** Tracks which editors of this document have not had cursors positions changed since the last call to `rememberCursors()`. When stepping forward, the cursor is advanced for all editors whose cursors have not moved since the previous step. */
  private cursorUnmovedSinceCommandInitiated = new Set<vscode.TextEditor>();
  /** Coq STM focus  */
  private focus?: vscode.Position;
  private stateViewFocus?: vscode.Position;
  private project: CoqProject;
  private currentLtacProfView: HtmlLtacProf|null = null;
  //private coqtopRunning = false;

  constructor(document: vscode.TextDocument, project: CoqProject) {
    this.statusBar = new StatusBar();
    this.document = document;
    this.project = project;
    // this.document = vscode.workspace.textDocuments.find((doc) => doc.uri === uri);

    this.documentUri = document.uri.toString();
    try {
      this.langServer = new CoqDocumentLanguageServer(document.uri.toString());
    }  catch(err) {
    var x = this.langServer;
    x = x;
    }

    this.view = new HtmlCoqView(document.uri, extensionContext);
    // this.view = new SimpleCoqView(uri.toString());
    // this.view = new MDCoqView(uri);
    if(this.project.settings.showProofViewOn === "open-script") {
      let viewCol = this.currentViewColumn();
      if (viewCol)
        this.view.show(adjacentPane(viewCol))
      else
        this.view.show(vscode.ViewColumn.One)
    };

    this.langServer.onUpdateHighlights((p) => this.onDidUpdateHighlights(p));
    this.langServer.onMessage((p) => this.onCoqMessage(p));
    this.langServer.onReset((p) => this.onCoqReset());
    this.langServer.onUpdateCoqStmFocus((p) => this.updateFocus(p.position));
    this.langServer.onLtacProfResults((p) => this.onLtacProfResults(p));
    this.langServer.onCoqtopStart(p => {
      //this.coqtopRunning = true;
      this.statusBar.setCoqtopStatus(true);
  })
    this.langServer.onCoqtopStop(p => {
      //this.coqtopRunning = false;
      if(p.reason === proto.CoqtopStopReason.Anomaly || p.reason === proto.CoqtopStopReason.InternalError)
        vscode.window.showErrorMessage(p.message || "Coqtop quit for an unknown reason.")
      this.statusBar.setCoqtopStatus(false);
    })

    this.view.resize(async (columns:number) => {
      try {
        await this.langServer.resizeView(Math.floor(columns));
        await this.refreshGoal();
      } catch(err) {}
    });

    this.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e:vscode.TextEditorSelectionChangeEvent) => {
      if(this.project.settings.autoRevealProofStateAtCursor && e.textEditor.document === this.document && e.selections.length === 1)
        this.viewGoalAt(e.textEditor,e.selections[0].active);
      if(this.cursorUnmovedSinceCommandInitiated.has(e.textEditor))
        this.cursorUnmovedSinceCommandInitiated.delete(e.textEditor);
    }));

    if(vscode.window.activeTextEditor)
      if(vscode.window.activeTextEditor.document.uri.toString() == this.documentUri)
        this.statusBar.focus();
    this.statusBar.setStateReady();
  }

  private async refreshGoal(e?: vscode.TextEditor) {
    if(!e)
      e = vscode.window.activeTextEditor;
    const value = await this.langServer.getGoal();
    this.updateView(value, false);

    if (e)
      if(this.project.settings.autoRevealProofStateAtCursor && e.document === this.document && e.selections.length === 1)
        this.viewGoalAt(e,e.selections[0].active)
  }

  public getUri() {
    return this.documentUri;
  }

  public getDocument() {
    return this.document;
  }

  public dispose() {
    this.quitCoq();
    this.langServer.dispose();
    this.highlights.clearAll(this.allEditors());
    this.statusBar.dispose();
    if(this.view)
      this.view.dispose();
    this.subscriptions.forEach((d) => d.dispose());
  }

  private reset() {
    this.highlights.clearAll(this.allEditors())
  }

  private rememberCursors() {
    this.cursorUnmovedSinceCommandInitiated.clear();
    for(let editor of this.allEditors()) {
      this.cursorUnmovedSinceCommandInitiated.add(editor);
    }
  }

  private onDidUpdateHighlights(params: proto.Highlights) {
    this.highlights.set(this.allEditors(),params);
  }


  // private onUpdateComputingStatus(params: proto.NotifyComputingStatusParams) {
  //   this.statusBar.setStateComputing(params.status);
  // }

  private onCoqMessage(params: proto.NotifyMessageParams) {
    /* 
      originally, all messages will be output to their corresponding channels
      now with the message panel, they will be output on the message panel, 
        EXCEPT those which should be displayed as hovering text
    */
    if (params.routeId == this.hoverQueryRouteId) {
      const hoverText = psm.prettyTextToString(params.message);
      if (this.hoverListener)
        this.hoverListener(hoverText);
    } else {
      this.view.update({ innertext: params.message, type: "message-query" });
    }
  }


  public onDidChangeTextDocument(params: vscode.TextDocumentChangeEvent) {
    this.updateFocus(this.focus, false);
  }


  public async interruptCoq() {
    this.statusBar.setStateMessage('Killing CoqTop');
    try {
      await this.langServer.interruptCoq();
    } finally {}
    this.statusBar.setStateReady();
  }

  public async quitCoq(editor?: TextEditor) {
    this.statusBar.setStateMessage('Killing CoqTop');
    try {
      await this.langServer.quitCoq();
    } finally {}
    this.reset();
    this.statusBar.setStateReady();
  }

  public async resetCoq(editor?: TextEditor) {
    this.statusBar.setStateMessage('Resetting Coq');
    try {
      await this.langServer.resetCoq();
    } finally {}
    this.reset();
    this.statusBar.setStateReady();
  }

  private findEditor() : vscode.TextEditor|undefined {
    return vscode.window.visibleTextEditors.find((editor,i,a) =>
      editor.document.uri.toString() === this.documentUri);
  }

  public allEditors() : vscode.TextEditor[] {
    return vscode.window.visibleTextEditors.filter((editor,i,a) =>
      editor.document.uri.toString() === this.documentUri)
  }

  private currentViewColumn() {
    let editor = this.findEditor();
    if(editor)
      return editor.viewColumn;
    else
      if (vscode.window.activeTextEditor)
        return vscode.window.activeTextEditor.viewColumn;
      else
        return undefined;
  }

  private onCoqReset() {
    this.reset();
    this.statusBar.setStateReady();
  }

  /** Bring the focus into the editor's view, but only scroll rightward
   * if the focus is not at the end of a line
   * */
  public setCursorToPosition(pos: vscode.Position|undefined, editor: vscode.TextEditor, scroll: boolean = true, scrollHorizontal = false) {
    if(!editor || !pos)
      return;
    editor.selections = [new vscode.Selection(pos, pos)]
    if(scroll) {
      if (scrollHorizontal || textUtil.positionIsBefore(pos, this.document.lineAt(pos.line).range.end))
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.Default)
      else
        editor.revealRange(new vscode.Range(pos.line, 0, pos.line + 1, 0), vscode.TextEditorRevealType.Default)
    }
  }

  private updateFocus(focus?: vscodeTypes.Position, moveCursor = false) {
    if(focus) {
      this.focus = new vscode.Position(focus.line,focus.character);
      if(moveCursor) {
        // adjust the cursor position
        for(let editor of this.cursorUnmovedSinceCommandInitiated)
          this.setCursorToPosition(this.focus, editor, editor === vscode.window.activeTextEditor);
      }

      // update the focus decoration
      this.showFocusDecorations();
    } else {
      for(let editor of this.allEditors())
        editor.setDecorations(decorations.focus, []);
    }
  }

  private async userSetCoqtopPath(global = false) {
    const current = vscode.workspace.getConfiguration("coqtop").get("binPath", "");
    const coqtopExe = vscode.workspace.getConfiguration("coqtop").get("coqtopExe", "");
    const newPath = await vscode.window.showInputBox({ignoreFocusOut: true, value: current, validateInput: (v:string):string => {
      try {
        const statDir = fs.statSync(v);
        if(!statDir.isDirectory())
          return "not a directory";
      } catch(err) {
        return "invalid path";
      }
      let stat : fs.Stats|undefined = undefined;
      try {
        stat = fs.statSync(path.join(v, coqtopExe));
      } catch {
        if (os.platform() === 'win32') {
          try {
            stat = fs.statSync(path.join(v, coqtopExe, '.exe'));
          } catch {}
        }
      }
      if (!stat)
        return "coqtop not found here"
      if (!stat.isFile())
        return "coqtop found here, but is not an executable file";

      return "";
    } });
    async function checkCoqtopExists(newPath: string) {
      if(!newPath)
        return false;
      try {
        return await fs.existsSync(path.join(newPath, coqtopExe)) ||
          os.platform() === 'win32' && await fs.existsSync(path.join(newPath, coqtopExe, '.exe'))
      } catch(err) {
        return false;
      }
    }

    if (newPath)
      if(await checkCoqtopExists(newPath))
        await vscode.workspace.getConfiguration("coqtop").update("binPath", newPath, global);
  }

  private handleResult(value: proto.CommandResult) {
    if(value.type === 'busy')
      return false;
    else if(value.type === 'failure' && value.range) {
      this.updateFocus(value.focus, false);
      if(this.project.settings.moveCursorToFocus) {
        for(let editor of this.cursorUnmovedSinceCommandInitiated)
          this.setCursorToPosition(new vscode.Position(value.range.start.line, value.range.start.character), editor, editor === vscode.window.activeTextEditor);
      }
    } else if(value.type === 'not-running') {
      this.updateFocus(undefined, false);
      if(value.reason === 'spawn-failed') {
        const getCoq = {title: "Get Coq", id: 0};
        const setPathLocal = {title: "Set path for this project", id: 1};
        const setPathGlobal = {title: "Set path globally", id: 2};
        vscode.window.showErrorMessage(`Could not start coqtop ${value.coqtop ? ` (${value.coqtop})` : ""}`, getCoq, setPathLocal, setPathGlobal)
          .then(async act => {
            if(act && act.id === getCoq.id) {
              vscode.commands.executeCommand("vscode.open", vscode.Uri.parse('https://coq.inria.fr/download'))
            } else if(act && (act.id === setPathLocal.id || act.id === setPathGlobal.id)) {
              await this.userSetCoqtopPath(act.id === setPathGlobal.id);
            }
          })
      }
    } else if(value.type === 'interrupted')
      this.statusBar.setStateComputing(proto.ComputingStatus.Interrupted)
    else if (value.type !== 'message-query' && value.type !== 'message-ready-clear')
      this.updateFocus(value.focus, this.project.settings.moveCursorToFocus);

    return true;
  }

  private updateView(state: proto.CommandResult, interactive = false) {
    if(interactive && !this.view.isVisible() && this.project.settings.showProofViewOn === "first-interaction") {
      let viewCol = this.currentViewColumn();
      if (viewCol)
        this.view.show(adjacentPane(viewCol), state)
      else
        this.view.show(vscode.ViewColumn.One, state)
    } else {
      this.view.update(state);
    }
    this.stateViewFocus = state.type==="proof-view" ? new vscode.Position(state.focus.line,state.focus.character) : undefined;
    this.showFocusDecorations();
  }

  private showFocusDecorations() {
    if(!this.focus)
      return;
    const focusRange = new vscode.Range(this.focus.line,0,this.focus.line,1);
    if(this.focus.line === 0 && this.focus.character === 0) {
      for(let editor of this.allEditors()) {
        editor.setDecorations(decorations.focusBefore, [focusRange]);
        editor.setDecorations(decorations.focus, []);
      }
    } else {
      for(let editor of this.allEditors()) {
        editor.setDecorations(decorations.focusBefore, []);
        editor.setDecorations(decorations.focus, [focusRange]);
      }
    }
    if(this.stateViewFocus && this.stateViewFocus.line !== this.focus.line) {
      const focusRange = new vscode.Range(this.stateViewFocus.line,0,this.stateViewFocus.line,1);
      for(let editor of this.allEditors()) {
        editor.setDecorations(decorations.proofViewFocus, [focusRange]);
      }
    } else {
      for(let editor of this.allEditors()) {
        editor.setDecorations(decorations.proofViewFocus, []);
      }
    }
  }

  private async makePreviewOpenedFilePermanent(editor: TextEditor){
     //Make sure that the file is really open instead of preview-open, to avoid accidentaly closing the file
    await vscode.commands.executeCommand("workbench.action.keepEditor",editor.document.uri);
  }

  public async stepForward(editor: TextEditor) {
    this.statusBar.setStateWorking('Stepping forward');
    try {
      this.makePreviewOpenedFilePermanent(editor);
      this.rememberCursors();
      this.view.update({ type:"message-ready-clear" });
      const value = await this.langServer.stepForward();
      this.updateView(value, true);
      this.handleResult(value);
    } catch (err) {
    }
    this.statusBar.setStateReady();
  }

  public async stepBackward(editor: TextEditor) {
    this.statusBar.setStateWorking('Stepping backward');
    try {
      this.makePreviewOpenedFilePermanent(editor);
      this.rememberCursors();
      const value = await this.langServer.stepBackward();
      this.updateView(value, true);
      if(this.handleResult(value))
        this.statusBar.setStateReady();
      // const range = new vscode.Range(editor.document.positionAt(value.commandStart), editor.document.positionAt(value.commandEnd));
      // clearHighlight(editor, range);
    } catch (err) {
    }
  }

  public async finishComputations(editor: TextEditor) {
    this.statusBar.setStateWorking('Finishing computations');
    try {
      this.view.update({ type:"message-ready-clear" });
      await this.langServer.finishComputations();
      this.statusBar.setStateReady();
    } catch (err) {
    }
  }

  public async interpretToCursorPosition(editor: TextEditor, synchronous = false) {
    this.statusBar.setStateWorking('Interpreting to point');
    try {
      if(!editor || editor.document.uri.toString() !== this.documentUri)
       return;
      this.makePreviewOpenedFilePermanent(editor);
      this.view.update({ type:"message-ready-clear" });
      const value = await this.langServer.interpretToPoint(editor.selection.active, synchronous);
      this.updateView(value, true);
      this.handleResult(value);
    } catch (err) {
      console.warn("Interpret to point failed: " + err.toString());
      if(err.stack)
        console.log("Stack: \n" + err.stack);
    }
    this.statusBar.setStateReady();
  }

  public async interpretToEnd(editor: TextEditor, synchronous = false) {
    this.statusBar.setStateWorking('Interpreting to end');
    try {
      this.makePreviewOpenedFilePermanent(editor);
      this.view.update({ type:"message-ready-clear" });
      const value = await this.langServer.interpretToEnd(synchronous);
      this.updateView(value, true);
      this.handleResult(value);
    } catch (err) { }
    this.statusBar.setStateReady();
  }

  public async query(query: proto.QueryFunction, term: string | undefined) {
    try {
      if (term) {
        // this.project.queryOut.clear();
        this.view.update({ type:"message-ready-clear" });
        // this.project.queryOut.show(true);
        this.langServer.query(query, term, this.queryRouteId);
      }
    } catch (err) {
    } finally {
      this.statusBar.setStateReady();
    }
  }

  // Hover queries aren't printed to the query screen
  // They instead return their value directly
  public async hoverQuery(query: proto.QueryFunction, term: string) {
    let response: string|undefined = undefined;
    try {
      // wait for response from server (called by onCoqMessage)
      const promise = new Promise<string>((resolve) => {
        this.hoverListener = resolve;
      });
      // timeout needed because no coq message is returned
      // when perfoming an invalid query (like checking a keyword)
      const timeout = Promise.race([
        promise,
        new Promise<string>((_r, rej) => setTimeout(rej, this.hoverQueryTimeout))
      ])
      this.langServer.query(query, term, this.hoverQueryRouteId);
      response = await timeout;
    } catch (err) {}
    this.hoverListener = undefined;
    this.statusBar.setStateReady();
    return response;
  }

  public async viewGoalState(editor: TextEditor) {
    try {
      if (editor.viewColumn)
        await this.view.show(adjacentPane(editor.viewColumn))
      else
        await this.view.show(vscode.ViewColumn.One)
    } catch (err) {}
  }

  public async ltacProfGetResults(editor: TextEditor) {
    this.statusBar.setStateWorking('Running query');
    try {
      if(!editor || editor.document.uri.toString() !== this.documentUri)
       return;
      const offset = editor.document.offsetAt(editor.selection.active);
      this.currentLtacProfView = new HtmlLtacProf({total_time: 0, tactics: []});
      this.currentLtacProfView.show(true);
      await this.langServer.ltacProfGetResults(offset);
      // const view = new HtmlLtacProf(results);
      // const out = vscode.window.createOutputChannel("LtacProfiler");
      // results.forEach((value,key) => {
      //     out.appendLine("-----------------------------------");
      //     this.outputLtacProfTreeNode(out, "", key, value);
      //   });
    } catch (err) {
    } finally {
      this.statusBar.setStateReady();
    }
  }

  private onLtacProfResults(results: proto.LtacProfResults) {
    if(!this.currentLtacProfView)
      this.currentLtacProfView = new HtmlLtacProf(results);
    else
      this.currentLtacProfView.update(results);
  }

  public async doOnLostFocus() {
    this.statusBar.unfocus();
  }

  public async doOnFocus(editor: TextEditor) {
    this.showFocusDecorations();
    this.highlights.refresh([editor]);
    this.statusBar.focus();
    // await this.view.show(true);
  }

  // public async doOnSwitchActiveEditor(oldEditor: TextEditor, newEditor: TextEditor) {
  //   this.showFocusDecorations();
  //   this.highlights.refresh([newEditor]);
  //   this.statusBar.focus();
  // }

  private async queryDisplayOptionChange() : Promise<proto.DisplayOption|null> {
      const result = await vscode.window.showQuickPick(DisplayOptionPicks.allPicks);
      if (result)
        return result.displayItem
      else
        return null;
  }

  public async setDisplayOption(item?: proto.DisplayOption, value?: proto.SetDisplayOption) {
    if(item===undefined) {
      item = await this.queryDisplayOptionChange() || undefined;
      if(!item)
        return;
    }
    value = value || proto.SetDisplayOption.Toggle;
    try {
      await this.langServer.setDisplayOptions([{item: item, value: value}]);
      await this.refreshGoal();
    } catch(err) { }
 }

 public async viewGoalAt(editor: vscode.TextEditor, pos?: vscode.Position) {
    try {
      if(!pos)
        pos = editor.selection.active;
      const proofview = await this.langServer.getCachedGoal(pos, this.project.settings.revealProofStateAtCursorDirection);
      if(proofview.type === "proof-view")
        this.updateView(proofview, false);
    } catch(err) { }
 }

 public getCurrentFocus() {
   return this.focus;
 }

}
