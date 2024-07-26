import * as vscode from "vscode";
import {
  RequestType,
  VersionedTextDocumentIdentifier,
} from "vscode-languageclient";
import {
  AboutCoqRequest,
  AboutCoqResponse,
  CheckCoqRequest,
  CheckCoqResponse,
  LocateCoqRequest,
  LocateCoqResponse,
  PrintCoqRequest,
  PrintCoqResponse,
  QueryError,
  SearchCoqHandshake,
  SearchCoqRequest,
  SearchCoqResult,
} from "../protocol/types";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";

import Client from "../client";

interface Query {
  type: string;
  pattern: string;
}

export default class SearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "vscoq.search";

  private _view?: vscode.WebviewView;
  private _queries: Query[] = [];

  constructor(
    private _extensionUri: vscode.Uri,
    private _client: Client,
  ) {}

  dispose(): void {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Set an event listener to listen for messages passed from the webview context
    this._setWebviewMessageListener(webviewView.webview, this._client);
  }

  public addTab() {
    this._view?.webview.postMessage({ command: "addTab" });
  }

  public collapseAll() {
    vscode.commands.executeCommand(
      "setContext",
      "vscoq.expandedQueries",
      false,
    );
    this._view?.webview.postMessage({ command: "collapseAll" });
  }

  public expandAll() {
    vscode.commands.executeCommand("setContext", "vscoq.expandedQueries", true);
    this._view?.webview.postMessage({ command: "expandAll" });
  }

  public launchQuery(pattern: string, type: string) {
    const query = { pattern: pattern, type: type };
    if (this._view && this._queries.length === 0) {
      this._view?.webview.postMessage({ command: "query", query: query });
    } else {
      this._queries.push(query);
    }
  }

  public dequeueQueries() {
    while (this._queries.length > 0) {
      const query = this._queries.shift();
      this._view?.webview.postMessage({ command: "query", query: query });
    }
  }

  public renderSearchResult(searchResult: SearchCoqResult) {
    this._view?.webview.postMessage({
      command: "searchResponse",
      result: searchResult,
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // The CSS file from the React build output
    const stylesUri = getUri(webview, this._extensionUri, [
      "search-ui",
      "build",
      "assets",
      "index.css",
    ]);
    // The JS file from the React build output
    const scriptUri = getUri(webview, this._extensionUri, [
      "search-ui",
      "build",
      "assets",
      "index.js",
    ]);

    const nonce = getNonce();

    // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
    return /*html*/ `
            <!DOCTYPE html>
                <html lang="en">
                    <head>
                        <meta charset="UTF-8" />
                        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                        <link rel="stylesheet" type="text/css" nonce="${nonce}" href="${stylesUri}">
                        <title>Search View</title>
                    </head>
                    <body>
                        <div id="root"></div>
                        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
                    </body>
                </html>
            `;
  }

  /**
   * Sets up an event listener to listen for messages passed from the webview context and
   * executes code based on the message that is recieved.
   *
   * @param webview A reference to the extension webview
   * @param context A reference to the extension context
   */
  private _setWebviewMessageListener(webview: vscode.Webview, client: Client) {
    webview.onDidReceiveMessage((message: any) => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      const version = vscode.window.activeTextEditor?.document.version;
      const position = vscode.window.activeTextEditor?.selection.active;
      const command = message.command;
      //const text = message.text;

      switch (command) {
        // Add more switch case statements here as more webview message commands
        // are created within the webview context (i.e. inside media/main.js)
        case "ready":
          this.dequeueQueries();

        case "coqQuery":
          if (version && uri && position) {
            const id = message.id;
            const pattern = message.text;
            const type = message.type;
            const textDocument = VersionedTextDocumentIdentifier.create(
              uri.toString(),
              version,
            );

            if (type === "search") {
              const params: SearchCoqRequest = {
                id,
                textDocument,
                pattern,
                position,
              };
              const req = new RequestType<
                SearchCoqRequest,
                SearchCoqHandshake,
                void
              >("vscoq/search");
              client.sendRequest(req, params).then(
                (handshake: SearchCoqHandshake) => {
                  webview.postMessage({
                    command: "launchedSearch",
                  });
                },
                (err: QueryError) => {
                  const error = {
                    code: err.code,
                    message: err.message,
                  };
                  webview.postMessage({
                    command: "searchError",
                    error: error,
                    id: id,
                  });
                },
              );
            }

            if (type === "about") {
              const params: AboutCoqRequest = {
                textDocument,
                pattern,
                position,
              };
              const req = new RequestType<
                AboutCoqRequest,
                AboutCoqResponse,
                void
              >("vscoq/about");

              client.sendRequest(req, params).then(
                (result: AboutCoqResponse) => {
                  const notification = {
                    statement: result,
                    id: id,
                  };
                  webview.postMessage({
                    command: "aboutResponse",
                    result: notification,
                  });
                },
                (err: QueryError) => {
                  const error = {
                    code: err.code,
                    message: err.message,
                  };
                  webview.postMessage({
                    command: "searchError",
                    error: error,
                    id: id,
                  });
                },
              );
            }

            if (type === "check") {
              const params: CheckCoqRequest = {
                textDocument,
                pattern,
                position,
              };
              const req = new RequestType<
                CheckCoqRequest,
                CheckCoqResponse,
                void
              >("vscoq/check");

              client.sendRequest(req, params).then(
                (result: CheckCoqResponse) => {
                  const notification = {
                    statement: result,
                    id: id,
                  };
                  webview.postMessage({
                    command: "checkResponse",
                    result: notification,
                  });
                },
                (err: QueryError) => {
                  const error = {
                    code: err.code,
                    message: err.message,
                  };
                  webview.postMessage({
                    command: "searchError",
                    error: error,
                    id: id,
                  });
                },
              );
            }

            if (type === "locate") {
              const params: CheckCoqRequest = {
                textDocument,
                pattern,
                position,
              };
              const req = new RequestType<
                LocateCoqRequest,
                LocateCoqResponse,
                void
              >("vscoq/locate");

              client.sendRequest(req, params).then(
                (result: LocateCoqResponse) => {
                  const notification = {
                    statement: result,
                    id: id,
                  };
                  webview.postMessage({
                    command: "locateResponse",
                    result: notification,
                  });
                },
                (err: QueryError) => {
                  const error = {
                    code: err.code,
                    message: err.message,
                  };
                  webview.postMessage({
                    command: "searchError",
                    error: error,
                    id: id,
                  });
                },
              );
            }

            if (type === "print") {
              const params: CheckCoqRequest = {
                textDocument,
                pattern,
                position,
              };
              const req = new RequestType<
                PrintCoqRequest,
                PrintCoqResponse,
                void
              >("vscoq/print");

              client.sendRequest(req, params).then(
                (result: PrintCoqResponse) => {
                  const notification = {
                    statement: result,
                    id: id,
                  };
                  webview.postMessage({
                    command: "locateResponse",
                    result: notification,
                  });
                },
                (err: QueryError) => {
                  const error = {
                    code: err.code,
                    message: err.message,
                  };
                  webview.postMessage({
                    command: "searchError",
                    error: error,
                    id: id,
                  });
                },
              );
            }
          } else {
            vscode.window.showErrorMessage(
              "Search: " + message.text + " impossible. No active text editor.",
            );
          }
          return;

        case "copySearchResult":
          vscode.env.clipboard.writeText(message.text);
          vscode.window.showInformationMessage(
            "Successfuly copied command " + message.text + " to clipboard.",
          );
          return;

        case "toggleExpandButton":
          vscode.commands.executeCommand(
            "setContext",
            "vscoq.expandedQueries",
            message.value,
          );
          return;

        case "enableCollapseButton":
          vscode.commands.executeCommand(
            "setContext",
            "vscoq.hasSearchResults",
            true,
          );
          return;

        case "disableCollapseButton":
          vscode.commands.executeCommand(
            "setContext",
            "vscoq.hasSearchResults",
            false,
          );
          return;
      }
    });
  }
}
