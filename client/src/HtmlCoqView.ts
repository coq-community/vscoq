"use strict";
import * as vscode from "vscode";

import * as view from "./CoqView";
import { extensionContext } from "./extension";
import * as proto from "./protocol";
import * as path from "path";
import * as docs from "./CoqProject";
import * as psm from "./prettify-symbols-mode";

import mustache = require("mustache");

interface ControllerEvent {
  eventName: string;
  params: ResizeEvent; // | | | | | ;
}

interface ResizeEvent {
  columns: number;
}

interface GoalUpdate {
  command: "goal-update";
  goal: proto.CommandResult;
}

interface SettingsUpdate extends SettingsState {
  command: "settings-update";
}

export interface ProofViewDiffSettings {
  addedTextIsItalic: boolean;
  removedTextIsStrikedthrough: boolean;
  enabled: boolean;
}

interface SettingsState {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  prettifySymbolsMode?: boolean;
  proofViewDiff?: ProofViewDiffSettings;
}

interface QueryMessageUpdate {
  command: "message-query";
  msg: string
}

type ProofViewProtocol = GoalUpdate | SettingsUpdate | QueryMessageUpdate;

const VIEW_PATH = "html_views";

function proofViewFile(file: string = "") {
  return vscode.Uri.file(
    extensionContext.asAbsolutePath(path.join("out", VIEW_PATH, file))
  );
}

function proofViewHtmlPath() {
  return proofViewFile("Coq.html");
}

/**
 * Displays a Markdown-HTML file which contains javascript to connect to this view
 * and update the goals and show other status info
 */
export class HtmlCoqView implements view.CoqView {
  private docUri: vscode.Uri;
  private coqViewUri: vscode.Uri;
  private currentSettings: SettingsState = {};
  private visible = false;
  private initialState: undefined | proto.CommandResult;

  private panel: vscode.WebviewPanel | null = null;

  private resizeEvent = new vscode.EventEmitter<number>();

  public get resize(): vscode.Event<number> {
    return this.resizeEvent.event;
  }

  constructor(uri: vscode.Uri, context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(() => this.updateSettings())
    );

    this.docUri = uri;

    psm.onEnabledChange((enabled) => {
      this.currentSettings.prettifySymbolsMode = enabled;
      this.sendMessage(
        Object.assign<SettingsState, { command: "settings-update" }>(
          { prettifySymbolsMode: enabled },
          { command: "settings-update" }
        )
      );
    });
  }

  private handleClientResize(event: ResizeEvent) {
    this.resizeEvent.fire(event.columns);
  }

  private handleClientMessage(event: string) {
    const message = <ControllerEvent>JSON.parse(event);
    switch (message.eventName) {
      case "resize":
        this.handleClientResize(message.params);
        return;
      case "focus":
        docs.getProject().setActiveDoc(this.docUri);
        return;
      case "getInitialGoal":
        if (this.initialState) this.update(this.initialState);
        return;
    }
  }

  private async createBuffer(): Promise<void> {
    try {
      this.coqViewUri = vscode.Uri.parse(
        `file://${proofViewHtmlPath().path.replace(/%3A/, ":")}`
      );
      console.log(
        "Goals: " +
          decodeURIComponent(
            this.coqViewUri.with({ scheme: "file" }).toString()
          )
      );
    } catch (err) {
      vscode.window.showErrorMessage(err.toString());
    }
  }

  public getUri(): vscode.Uri {
    return this.coqViewUri;
  }

  public isVisible() {
    return this.visible;
  }

  public async initializePanel(pane: vscode.ViewColumn) {
    if (this.panel === null) {
      this.panel = vscode.window.createWebviewPanel(
        "html_coq",
        "ProofView: " + path.basename(this.docUri.fsPath),
        {
          preserveFocus: true,
          viewColumn: pane,
        },
        {
          enableScripts: true,
          enableFindWidget: true
        }
      );

      this.panel.onDidDispose(() => {
        this.visible = false;
        this.panel = null;
      });

      const doc = await vscode.workspace.openTextDocument(this.coqViewUri);
      vscode.window.showTextDocument(vscode.window.activeTextEditor?.document);

      const csspath = path.join(
        extensionContext.extensionPath,
        "out",
        VIEW_PATH,
        "proof-view.css"
      );
      const csspathAsVscodeResource = this.panel.webview.asWebviewUri(
        vscode.Uri.file(csspath)
      );

      const jspath = path.join(
        extensionContext.extensionPath,
        "out",
        VIEW_PATH,
        "goals.js"
      );
      const jspathAsVscodeResource = this.panel.webview.asWebviewUri(
        vscode.Uri.file(jspath)
      );

      this.panel.webview.html = mustache.render(doc.getText(), {
        jsPath: jspathAsVscodeResource,
        cssPath: csspathAsVscodeResource,
      });

      this.panel.webview.onDidReceiveMessage((message) =>
        this.handleClientMessage(message)
      );
      await this.updateSettings();
    }
  }

  public async show(pane: vscode.ViewColumn, state?: proto.CommandResult) {
    if (!this.coqViewUri) await this.createBuffer();

    this.initialState = state;
    this.initializePanel(pane);

    this.visible = true;
  }

  public dispose() {
    if (this.panel !== null) this.panel.dispose();
  }

  private async sendMessage(message: ProofViewProtocol) {
    if (this.panel !== null) this.panel.webview.postMessage(message);
  }

  private async updateClient(state: proto.CommandResult) {
    await this.sendMessage({ command: "goal-update", goal: state });
  }

  public update(state: proto.CommandResult) {
    this.updateClient(state);
  }

  private async updateSettings() {
    this.currentSettings.fontFamily = vscode.workspace
      .getConfiguration("editor")
      .get("fontFamily") as string;
    this.currentSettings.fontSize = `${
      vscode.workspace.getConfiguration("editor").get("fontSize") as number
    }pt`;
    this.currentSettings.fontWeight = vscode.workspace
      .getConfiguration("editor")
      .get("fontWeight") as string;
    this.currentSettings.proofViewDiff = vscode.workspace
      .getConfiguration("coq")
      .get("proofViewDiff") as ProofViewDiffSettings;
    this.currentSettings.prettifySymbolsMode = psm.isEnabled();
    await this.sendMessage(
      Object.assign<SettingsState, { command: "settings-update" }>(
        this.currentSettings,
        { command: "settings-update" }
      )
    );
  }
}
