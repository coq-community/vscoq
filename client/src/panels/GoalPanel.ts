import {
  Disposable,
  TextEditor,
  Uri,
  ViewColumn,
  Webview,
  WebviewPanel,
  window,
  workspace,
} from "vscode";
import Client from "../client";
import { ProofViewNotification } from "../protocol/types";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";

// /////////////////////////////////////////////////////////////////////////////
// GOAL VIEW PANEL CODE
// /////////////////////////////////////////////////////////////////////////////

/**
 * This class manages the state and behavior of Goal webview panels.
 *
 * It contains all the data and methods for:
 *
 * - Creating and rendering Goal webview panels
 * - Properly cleaning up and disposing of webview resources when the panel is closed
 * - Setting the HTML (and by proxy CSS/JavaScript) content of the webview panel
 * - Setting message listeners so data can be passed between the webview and extension
 */
export default class GoalPanel {
  public static currentPanel: GoalPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];

  /**
   * The GoalPanel class private constructor (called only from the render method).
   *
   * @param panel A reference to the webview panel
   * @param extensionUri The URI of the directory containing the extension
   */
  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    // Set an event listener to listen for when the panel is disposed (i.e. when the user closes
    // the panel or when the panel is closed programmatically)
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Set the HTML content for the webview panel
    this._panel.webview.html = this._getWebviewContent(
      this._panel.webview,
      extensionUri,
    );

    // Set an event listener to listen for messages passed from the webview context
    this._setWebviewMessageListener(this._panel.webview);

    //init the app settings
    this._updateDisplaySettings(this._panel.webview);
    this._updateGoalDepth(this._panel.webview);
  }

  /**
   * Renders the current webview panel if it exists otherwise a new webview panel
   * will be created and displayed.
   *
   * @param extensionUri The URI of the directory containing the extension.
   */
  public static render(
    editor: TextEditor,
    extensionUri: Uri,
    callback?: (panel: GoalPanel) => any,
  ) {
    //Get the correct view column
    let column =
      editor && editor.viewColumn ? editor.viewColumn + 1 : ViewColumn.Two;
    if (column === 4) {
      column = ViewColumn.Three;
    }

    if (GoalPanel.currentPanel) {
      // If the webview panel already exists reveal it
      GoalPanel.currentPanel._panel.reveal(column);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        // Panel view type
        "coq",
        // Panel title
        "Coq Goals",
        // The editor column the panel should be displayed in
        { preserveFocus: true, viewColumn: column },
        // Extra panel configurations
        {
          // Enable JavaScript in the webview
          enableScripts: true,
          // Restrict the webview to only load resources from the `out` and `webview-ui/build` directories
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "goal-view-ui/build"),
          ],

          retainContextWhenHidden: true,

          enableFindWidget: true,
        },
      );

      GoalPanel.currentPanel = new GoalPanel(panel, extensionUri);
      if (callback) {
        callback(GoalPanel.currentPanel);
      }
    }
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
    GoalPanel.currentPanel = undefined;

    // Dispose of the current webview panel
    this._panel.dispose();

    // Dispose of all disposables (i.e. commands) for the current webview panel
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  // /////////////////////////////////////////////////////////////////////////////
  // Change the goal display settings (gets triggered if the user changes
  // his settings)
  // /////////////////////////////////////////////////////////////////////////////
  public static toggleGoalDisplaySettings() {
    if (GoalPanel.currentPanel) {
      Client.writeToVscoq2Channel("[GoalPanel] Toggling display settings");
      GoalPanel.currentPanel._updateDisplaySettings(
        GoalPanel.currentPanel._panel.webview,
      );
    }
  }

  public static changeGoalDisplayDepth() {
    if (GoalPanel.currentPanel) {
      Client.writeToVscoq2Channel("[GoalPanel] Changing goal depth");
      GoalPanel.currentPanel._updateGoalDepth(
        GoalPanel.currentPanel._panel.webview,
      );
    }
  }

  // /////////////////////////////////////////////////////////////////////////////
  // Reset the goal panel
  //
  // /////////////////////////////////////////////////////////////////////////////
  public static resetGoalPanel() {
    if (GoalPanel.currentPanel) {
      Client.writeToVscoq2Channel("[GoalPanel] Resetting goal panel");
      GoalPanel.currentPanel._reset();
    }
  }

  // /////////////////////////////////////////////////////////////////////////////
  // Create the goal panel if it doesn't exit and then
  // handle a proofview notification
  // /////////////////////////////////////////////////////////////////////////////
  public static proofViewNotification(
    extensionUri: Uri,
    editor: TextEditor,
    pv: ProofViewNotification,
  ) {
    Client.writeToVscoq2Channel("[GoalPanel] Received proofview notification");

    if (!GoalPanel.currentPanel) {
      GoalPanel.render(editor, extensionUri, (goalPanel) => {
        Client.writeToVscoq2Channel("[GoalPanel] Created new goal panel");
        goalPanel._handleProofViewResponseOrNotification(pv);
      });
    } else {
      Client.writeToVscoq2Channel("[GoalPanel] Rendered in current panel");
      GoalPanel.currentPanel._handleProofViewResponseOrNotification(pv);
    }
  }

  private _reset() {
    this._panel.webview.postMessage({ command: "reset" });
  }

  private _handleProofViewResponseOrNotification(pv: ProofViewNotification) {
    this._panel.webview.postMessage({
      command: "renderProofView",
      proofView: pv,
    });
  }

  /**
   * Defines and returns the HTML that should be rendered within the webview panel.
   *
   * @remarks This is also the place where references to the React webview build files
   * are created and inserted into the webview HTML.
   *
   * @param webview A reference to the extension webview
   * @param extensionUri The URI of the directory containing the extension
   * @returns A template string literal containing the HTML that should be
   * rendered within the webview panel
   */
  private _getWebviewContent(webview: Webview, extensionUri: Uri) {
    // The CSS file from the React build output
    const stylesUri = getUri(webview, extensionUri, [
      "goal-view-ui",
      "build",
      "assets",
      "index.css",
    ]);
    // The JS file from the React build output
    const scriptUri = getUri(webview, extensionUri, [
      "goal-view-ui",
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
          <title>Goal View</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }

  private _updateDisplaySettings(webview: Webview) {
    const config = workspace.getConfiguration("vscoq.goals");
    webview.postMessage({
      command: "updateDisplaySettings",
      text: config.display,
    });
  }

  private _updateGoalDepth(webview: Webview) {
    const config = workspace.getConfiguration("vscoq.goals");
    webview.postMessage({
      command: "updateGoalDepth",
      text: config.maxDepth,
    });
  }

  /**
   * Sets up an event listener to listen for messages passed from the webview context and
   * executes code based on the message that is received.
   *
   * @param webview A reference to the extension webview
   */
  private _setWebviewMessageListener(webview: Webview) {
    webview.onDidReceiveMessage(
      (message: any) => {
        const command = message.command;

        switch (
          command
          // Add more switch case statements here as more webview message commands
          // are created within the webview context (i.e. inside media/main.js)
        ) {
        }
      },
      undefined,
      this._disposables,
    );
  }
}
