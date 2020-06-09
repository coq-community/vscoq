'use strict';

import * as vscode from 'vscode';
import * as proto from './protocol';
import * as cp from 'child_process';

import { workspace, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions } from 'vscode-languageclient';

export class CoqLanguageServer implements vscode.Disposable {
  private static instance: CoqLanguageServer;
  private subscriptions: vscode.Disposable[] = [];
  private server: LanguageClient;
  private serverProcess: cp.ChildProcessWithoutNullStreams;
  private cancelRequest = new vscode.CancellationTokenSource();
  private documentCallbacks = new Map<string,DocumentCallbacks>();

  private constructor(context: ExtensionContext) {

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
      // Register the server for Coq scripts
      documentSelector: ['coq'],
      synchronize: {
        // Synchronize the setting section 'languageServerExample' to the server
        configurationSection: ['coqtop', 'coq', 'prettifySymbolsMode'],
        // Notify the server about file changes to '.clientrc files contain in the workspace
        fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
      }
    }

    let launchServer = async () => {
      let command = 'vscoqtop.opt';
      let serverProcess = cp.spawn(command, [], {});
      if (!serverProcess || !serverProcess.pid) {
          return Promise.reject(`Launching server using command ${command} failed.`);
      }
      this.serverProcess = serverProcess;
      return Promise.resolve(serverProcess);
    }

    // Create the language client and start the client.
    this.server = new LanguageClient(
                  'coqLanguageServer',
                  'Coq Language Server',
                  launchServer,
                  clientOptions
              );
    this.server.onReady()
      .then(() => {
        this.server.onNotification(proto.UpdateHighlightsNotification.type, (p) => {
          const doc = this.documentCallbacks.get(p.uri);
          if(doc)
            doc.onUpdateHighlights.forEach(l => l(p));
          // this.onUpdateHighlightsHandlers.forEach((h) => h(p))
        });
        this.server.onNotification(proto.CoqMessageNotification.type, (p) => {
          const doc = this.documentCallbacks.get(p.uri);
          if(doc)
            doc.onMessage.forEach(l => l(p));
          // this.onMessageHandlers.forEach((h) => h(p))
        });
        this.server.onNotification(proto.CoqResetNotification.type, (p) => {
          const doc = this.documentCallbacks.get(p.uri);
          if(doc)
            doc.onReset.forEach(l => l(p));
          // this.onResetHandlers.forEach((h) => h(p))
        });
        this.server.onNotification(proto.CoqStmFocusNotification.type, (p) => {
          const doc = this.documentCallbacks.get(p.uri);
          if(doc)
            doc.onUpdateCoqStmFocus.forEach(l => l(p));
          // this.onUpdateCoqStmFocusHandlers.forEach((h) => h(p))
        });
        this.server.onNotification(proto.CoqLtacProfResultsNotification.type, (p) => {
          const doc = this.documentCallbacks.get(p.uri);
          if(doc)
            doc.onLtacProfResults.forEach(l => l(p.results));
          // this.onLtacProfResultsHandlers.forEach((h) => h(p))
        });
        this.server.onNotification(proto.CoqtopStartNotification.type, (p) => {
          const doc = this.documentCallbacks.get(p.uri);
          if(doc)
            doc.onCoqtopStart.forEach(l => l(p));
        });
        this.server.onNotification(proto.CoqtopStopNotification.type, (p) => {
          const doc = this.documentCallbacks.get(p.uri);
          if(doc)
            doc.onCoqtopStop.forEach(l => l(p));
        });
        console.log("Coq language server ready")
      }, (reason) =>
        console.log("Coq language server failed to load: " + reason.toString()));

    console.log("starting vscoqtop");
    this.subscriptions.push(this.server.start());
    console.log("vscoqtop started");
  }

  public static create(context: ExtensionContext): CoqLanguageServer {
    if (!CoqLanguageServer.instance)
      CoqLanguageServer.instance = new CoqLanguageServer(context);
    return CoqLanguageServer.instance;
  }

  public static getInstance(): CoqLanguageServer {
    return this.instance;
  }

  public dispose() {
    this.server.stop();
    this.subscriptions.forEach((d) => d.dispose());
    this.cancelRequest.dispose();
    this.subscriptions = [];
    this.documentCallbacks.clear();
  }

  public registerDocument(uri: string, doc: DocumentCallbacks) {
    if(this.documentCallbacks.has(uri))
      throw "Duplicate Coq document being registered.";
    this.documentCallbacks.set(uri, doc);
  }

  public unregisterDocument(uri: string) {
    this.documentCallbacks.delete(uri);
  }

  // private onUpdateHighlightsHandlers = new Set<(params: proto.NotifyHighlightParams) => void>();
  // public onUpdateHighlights(listener: (params: proto.NotifyHighlightParams) => void) : vscode.Disposable {
  //   this.onUpdateHighlightsHandlers.add(listener);
  //   return { dispose: () => this.onUpdateHighlightsHandlers.delete(listener) }
  // }

  // private onMessageHandlers = new Set<(params: proto.NotifyMessageParams) => void>();
  // public onMessage(listener: (params: proto.NotifyMessageParams) => void) {
  //   this.onMessageHandlers.add(listener);
  //   return { dispose: () => this.onMessageHandlers.delete(listener) }
  // }

  // private onResetHandlers = new Set<(params: proto.NotificationParams) => void>();
  // public onReset(listener: (params: proto.NotificationParams) => void) {
  //   this.onResetHandlers.add(listener);
  //   return { dispose: () => this.onResetHandlers.delete(listener) }
  // }

  // private onUpdateCoqStmFocusHandlers = new Set<(params: proto.DocumentPositionParams) => void>();
  // public onUpdateCoqStmFocus(listener: (params: proto.DocumentPositionParams) => void) {
  //   this.onUpdateCoqStmFocusHandlers.add(listener);
  //   return { dispose: () => this.onUpdateCoqStmFocusHandlers.delete(listener) }
  // }

  // private onLtacProfResultsHandlers = new Set<(params: proto.NotifyLtacProfResultsParams) => void>();
  // public onLtacProfResults(listener: (params: proto.NotifyLtacProfResultsParams) => void) {
  //   this.onLtacProfResultsHandlers.add(listener);
  //   return { dispose: () => this.onLtacProfResultsHandlers.delete(listener) }
  // }

  public async interruptCoq(uri: string) {
   this.serverProcess.kill("SIGINT");
  }

  public async quitCoq(uri: string) {
    await this.server.onReady();
    return await this.server.sendRequest(proto.QuitCoqRequest.type, { uri: uri });
  }

  public async resetCoq(uri: string) {
    await this.server.onReady();
    return await this.server.sendRequest(proto.ResetCoqRequest.type, { uri: uri });
  }

  public async getGoal(uri: string): Promise<proto.CommandResult> {
    await this.server.onReady();
    return await this.server.sendRequest(proto.GoalRequest.type, { uri: uri }, this.cancelRequest.token);
  }

  public async getCachedGoal(uri: string, pos: vscode.Position, direction: "preceding"|"subsequent"): Promise<proto.CommandResult> {
    await this.server.onReady();
    return await this.server.sendRequest(proto.CachedGoalRequest.type, { uri: uri, position: pos, direction: direction }, this.cancelRequest.token);
  }

  public async finishComputations(uri: string): Promise<void> {
    await this.server.onReady();
    return await this.server.sendRequest(proto.FinishComputationsRequest.type, { uri: uri }, this.cancelRequest.token);
  }

  public async stepForward(uri: string): Promise<proto.CommandResult> {
    await this.server.onReady();
    return this.server.sendRequest(proto.StepForwardRequest.type, { uri: uri }, this.cancelRequest.token);
  }

  public async stepBackward(uri: string): Promise<proto.CommandResult> {
    await this.server.onReady();
    return this.server.sendRequest(proto.StepBackwardRequest.type, { uri: uri }, this.cancelRequest.token);
  }

  public async interpretToPoint(uri: string, location: number|vscode.Position, synchronous?: boolean): Promise<proto.CommandResult> {
    await this.server.onReady();
    const params : proto.CoqTopInterpretToPointParams = {
      uri: uri,
      location: location,
      synchronous: synchronous,
    };
    return this.server.sendRequest(proto.InterpretToPointRequest.type, params, this.cancelRequest.token);
  }

  public async interpretToEnd(uri: string, synchronous: boolean): Promise<proto.CommandResult> {
    await this.server.onReady();
    return this.server.sendRequest(proto.InterpretToEndRequest.type, { uri: uri, synchronous: synchronous }, this.cancelRequest.token);
  }

  public async resizeView(uri: string, columns: number): Promise<void> {
    await this.server.onReady();
    return this.server.sendRequest(proto.ResizeWindowRequest.type, <proto.CoqTopResizeWindowParams>{ uri: uri, columns: columns }, this.cancelRequest.token);
  }

  public async ltacProfGetResults(uri: string, offset?: number): Promise<void> {
    await this.server.onReady();
    return this.server.sendRequest(proto.LtacProfResultsRequest.type, { uri: uri, offset: offset }, this.cancelRequest.token);
  }

  public async getPrefixText(uri: string, pos: vscode.Position, token?: vscode.CancellationToken): Promise<string> {
    await this.server.onReady();
    return this.server.sendRequest(proto.GetSentencePrefixTextRequest.type, { uri: uri, position: pos }, token || this.cancelRequest.token);
  }

  public async query(uri: string, query: "locate"|"check"|"print"|"search"|"about"|"searchAbout", term: string, routeId:Number): Promise<void> {
    await this.server.onReady();
    const params : proto.CoqTopQueryParams =
      {
      uri: uri,
      queryFunction: query,
      query: term,
      routeId
      };
    return this.server.sendRequest(proto.QueryRequest.type, params , this.cancelRequest.token);
  }

  public async setDisplayOptions(uri: string, options: { item: proto.DisplayOption, value: proto.SetDisplayOption }[]): Promise<void> {
    await this.server.onReady();
    return this.server.sendRequest(proto.SetDisplayOptionsRequest.type, <proto.CoqTopSetDisplayOptionsParams>{
      uri: uri,
      options: options
    }, this.cancelRequest.token);
  }
}


interface DocumentCallbacks {
  onUpdateHighlights: ((params: proto.Highlights) => void)[],
  onMessage: ((params: proto.NotifyMessageParams) => void)[],
  onReset: ((params: proto.NotificationParams) => void)[],
  onUpdateCoqStmFocus: ((params: proto.DocumentPositionParams) => void)[],
  onLtacProfResults: ((params: proto.LtacProfResults) => void)[],
  onCoqtopStart: ((params: proto.NotificationParams) => void)[],
  onCoqtopStop: ((params: proto.NotifyCoqtopStopParams) => void)[],
}

function removeFromArray<T>(arr: T[], item: T) {
  const idx = arr.findIndex(x => x===item);
  if(idx >= 0)
    arr.splice(idx,1);
}

function registerCallback<T>(arr: T[], listener: T) : vscode.Disposable {
  arr.push(listener);
  return { dispose: () => removeFromArray(arr, listener) };
}

export class CoqDocumentLanguageServer implements vscode.Disposable {
  private server = CoqLanguageServer.getInstance();
  private callbacks : DocumentCallbacks = {
    onUpdateHighlights: [],
    onMessage: [],
    onReset: [],
    onUpdateCoqStmFocus: [],
    onLtacProfResults: [],
    onCoqtopStart: [],
    onCoqtopStop: [],
  };

  public constructor(
    private uri: string
  ) {
    this.server.registerDocument(this.uri, this.callbacks);
  }

  public dispose() {
    this.callbacks = {
      onUpdateHighlights: [],
      onMessage: [],
      onReset: [],
      onUpdateCoqStmFocus: [],
      onLtacProfResults: [],
      onCoqtopStart: [],
      onCoqtopStop: [],
    };
    this.server.unregisterDocument(this.uri);
  }


  public onUpdateHighlights(listener: (params: proto.Highlights) => void) : vscode.Disposable {
    return registerCallback(this.callbacks.onUpdateHighlights, listener);
  }

  public onMessage(listener: (params: proto.NotifyMessageParams) => void) {
    return registerCallback(this.callbacks.onMessage, listener);
  }

  public onReset(listener: (params: proto.NotificationParams) => void) {
    return registerCallback(this.callbacks.onReset, listener);
  }

  public onUpdateCoqStmFocus(listener: (params: proto.DocumentPositionParams) => void) {
    return registerCallback(this.callbacks.onUpdateCoqStmFocus, listener);
  }

  public onLtacProfResults(listener: (params: proto.LtacProfResults) => void) {
    return registerCallback(this.callbacks.onLtacProfResults, listener);
  }

  public onCoqtopStart(listener: (params: proto.NotificationParams) => void) {
    return registerCallback(this.callbacks.onCoqtopStart, listener);
  }

  public onCoqtopStop(listener: (params: proto.NotifyCoqtopStopParams) => void) {
    return registerCallback(this.callbacks.onCoqtopStop, listener);
  }

  public async interruptCoq() {
    await this.server.interruptCoq(this.uri);
  }

  public quitCoq() {
    return this.server.quitCoq(this.uri);
  }

  public resetCoq() {
    return this.server.resetCoq(this.uri);
  }

  public getGoal(): Thenable<proto.CommandResult> {
    return this.server.getGoal(this.uri);
  }

  public getCachedGoal(pos: vscode.Position, direction: "preceding"|"subsequent"): Thenable<proto.CommandResult> {
    return this.server.getCachedGoal(this.uri, pos, direction);
  }

  public finishComputations(): Thenable<void> {
    return this.server.finishComputations(this.uri);
  }

  public stepForward(): Thenable<proto.CommandResult> {
    return this.server.stepForward(this.uri);
  }

  public stepBackward(): Thenable<proto.CommandResult> {
    return this.server.stepBackward(this.uri);
  }

  public interpretToPoint(offset: number|vscode.Position, synchronous: boolean): Thenable<proto.CommandResult> {
    return this.server.interpretToPoint(this.uri, offset, synchronous);
  }

  public interpretToEnd(synchronous: boolean): Thenable<proto.CommandResult> {
    return this.server.interpretToEnd(this.uri, synchronous);
  }

  public resizeView(columns: number): Thenable<void> {
    return this.server.resizeView(this.uri, columns);
  }

  public ltacProfGetResults(offset?: number): Thenable<void> {
    return this.server.ltacProfGetResults(this.uri, offset);
  }

  public query(query: proto.QueryFunction, term: string, routeId: Number): Thenable<void> {
    return this.server.query(this.uri, query, term, routeId);
  }

  public setDisplayOptions(options: { item: proto.DisplayOption, value: proto.SetDisplayOption }[]): Thenable<void> {
    return this.server.setDisplayOptions(this.uri, options);
  }

}
