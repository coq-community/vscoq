import {workspace, window, commands, languages, ExtensionContext,
  TextEditorSelectionChangeEvent,
  TextEditorSelectionChangeKind,
  TextEditor,
  ViewColumn,
  TextEditorRevealType,
  Selection,
  Uri,
  StatusBarItem,
  extensions,
  StatusBarAlignment,
  MarkdownString,
  TextEdit,
  WorkspaceEdit
} from 'vscode';

import {
  LanguageClientOptions,
  RequestType,
  ServerOptions,
  TextDocumentIdentifier,
} from 'vscode-languageclient/node';

import Client from './client';
import { updateServerOnConfigurationChange } from './configuration';
import { checkVersion } from './utilities/versioning';
import {initializeDecorations} from './Decorations';
import GoalPanel from './panels/GoalPanel';
import SearchViewProvider from './panels/SearchViewProvider';
import {
    MoveCursorNotification, 
    ProofViewNotification, 
    ResetCoqRequest, 
    ResetCoqResponse, 
    SearchCoqResult
} from './protocol/types';
import { 
    sendInterpretToPoint,
    sendInterpretToEnd,
    sendStepForward,
    sendStepBackward
} from './manualChecking';
import { 
    makeVersionedDocumentId,
    isMouseOrKeyboardEvent
} from './utilities/utils';
import { DocumentStateViewProvider } from './panels/DocumentStateViewProvider';
import VsCoqToolchainManager, {ToolchainError, ToolChainErrorCode} from './utilities/toolchain';
import { QUICKFIX_COMMAND, CoqWarningQuickFix } from './QuickFixProvider';

let client: Client;

export function activate(context: ExtensionContext) {
    
    const coqTM = new VsCoqToolchainManager();
    coqTM.intialize().then(
        () => {
            const serverOptions = coqTM.getServerConfiguration(); 
            intializeExtension(serverOptions);
        }, 
        (err: ToolchainError) => {
            switch(err.status) {

                case ToolChainErrorCode.notFound: 
                    window.showErrorMessage("No language server found", {modal: true, detail: err.message}, {title: "Install the VsCoq language server (Recommended for Coq >= 8.18)", id: 0}, {title: "Install VsCoq Legacy (Required for Coq <= 8.17)", id: 1})
                    .then(act => {
                        if(act?.id === 0) {
                            commands.executeCommand("vscode.open", Uri.parse('https://github.com/coq-community/vscoq#installing-the-language-server'));
                        }
                        if (act?.id === 1) {
                            commands.executeCommand("extension.open", "coq-community.vscoq1");
                        }
                    });
                    break;

                case ToolChainErrorCode.launchError: 
                    window.showErrorMessage("Could not launch language server", {modal: true, detail: err.message}, {title: "Get Coq", id: 0}, {title: "Install VsCoq Legacy (Required for Coq <= 8.17)", id: 1})
                    .then(act => {
                        if(act?.id === 0) {
                            commands.executeCommand("vscode.open", Uri.parse('https://coq.inria.fr/download'));
                        }
                        if (act?.id === 1) {
                            commands.executeCommand("extension.open", "coq-community.vscoq1");
                        }
                        
                    });
                    
            }
        }
    );
    
    // Detect if vscoq1 is installed and active
    const vscoq1 = extensions.getExtension("coq-community.vscoq1");
    if (vscoq1) {
        if (vscoq1.isActive) {
            const message = "VsCoq2 is incompatible with VsCoq1. it is recommended that you disable one of them.";
            window.showErrorMessage(message, { title: "Disable VsCoq1", id: 0 }, { title: "Disable VsCoq2", id: 1 })
                .then(act => {
                    if (act?.id === 0) {
                        commands.executeCommand("extension.open", "coq-community.vscoq1");
                    }
                    if (act?.id === 1) {
                        commands.executeCommand("extension.open", "maximedenes.vscoq");
                    }

                });
        }
    }



    function registerVscoqTextCommand(command: string, callback: (textEditor: TextEditor, ...args: any[]) => void) {
        context.subscriptions.push(commands.registerTextEditorCommand('extension.coq.' + command, callback));
    };
    
    function intializeExtension(serverOptions: ServerOptions) {
        const config = workspace.getConfiguration('vscoq');

        let clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: 'coq' }],
            initializationOptions: config
        };

        // Create the language client and start the client.
        client = new Client(
            serverOptions,
            clientOptions
        );

        //register the search view provider 
        const searchProvider = new SearchViewProvider(context.extensionUri, client);
        context.subscriptions.push(window.registerWebviewViewProvider(SearchViewProvider.viewType, searchProvider));

        const documentStateProvider = new DocumentStateViewProvider(client); 
        context.subscriptions.push(workspace.registerTextDocumentContentProvider("vscoq-document-state", documentStateProvider));

        //status bar item for showing coq version and language server version
        const statusBar: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 1000);
        context.subscriptions.push(statusBar);

        const launchQuery = (editor: TextEditor, type: string)=> {
            const selection = editor.selection;
            const {end, start} = selection; 
            if(end.line !== start.line) {return;} //don't allow for multiline selections
            //either use the user selection or if no selection than infer the word under the cursor
            const wordAtCurorRange = (end.character !== start.character) ? selection : editor.document.getWordRangeAtPosition(end);
            if(!wordAtCurorRange) {return; } //there is no word: do nothing
            const queryText = editor.document.getText(wordAtCurorRange);
            //focus on the query panel
            commands.executeCommand('vscoq.search.focus');
            //launch the query
            searchProvider.launchQuery(queryText, type);
        };

        registerVscoqTextCommand('reset', (editor) => {
            const uri = editor.document.uri;
            const textDocument = TextDocumentIdentifier.create(uri.toString());
            const params: ResetCoqRequest = {textDocument};
            const req = new RequestType<ResetCoqRequest, ResetCoqResponse, void>("vscoq/resetCoq");
            Client.writeToVscoq2Channel(uri.toString());
            client.sendRequest(req, params).then(
                (res) => {
                    GoalPanel.resetGoalPanel();
                }, 
                (err) => {
                    window.showErrorMessage(err);
                }
            );
        });
        registerVscoqTextCommand('query.search', (editor) => launchQuery(editor, "search"));
        registerVscoqTextCommand('query.about', (editor) => launchQuery(editor, "about"));
        registerVscoqTextCommand('query.check', (editor) => launchQuery(editor, "check"));
        registerVscoqTextCommand('query.locate', (editor) => launchQuery(editor, "locate"));
        registerVscoqTextCommand('query.print', (editor) => launchQuery(editor, "print"));
        registerVscoqTextCommand('addQueryTab', () => searchProvider.addTab());
        registerVscoqTextCommand('collapseAllQueries', () => searchProvider.collapseAll());
        registerVscoqTextCommand('expandAllQueries', () => searchProvider.expandAll());
        registerVscoqTextCommand('interpretToPoint', (editor) => sendInterpretToPoint(editor, client));
        registerVscoqTextCommand('interpretToEnd', (editor) => sendInterpretToEnd(editor, client));
        registerVscoqTextCommand('stepForward', (editor) => {
            
            if(workspace.getConfiguration('vscoq.proof').mode === 1) {
                const textDocument = makeVersionedDocumentId(editor);
                const position = editor.selection.active;
                client.sendNotification("vscoq/stepForward", {textDocument: textDocument, position: position});
            }
            else {
                sendStepForward(editor, client);
            }
                
        });
        registerVscoqTextCommand('stepBackward', (editor) => {
            if(workspace.getConfiguration('vscoq.proof').mode === 1) {
                const textDocument = makeVersionedDocumentId(editor);
                const position = editor.selection.active;
                client.sendNotification("vscoq/stepBackward", {textDocument: textDocument, position: position});
            }
            else {
                sendStepBackward(editor, client);
            }
        });
        registerVscoqTextCommand('documentState', async (editor) => {
                
            documentStateProvider.setDocumentUri(editor.document.uri);

            const document = await workspace.openTextDocument(documentStateProvider.uri);

            documentStateProvider.fire();

            await window.showTextDocument(document, {
                viewColumn: ViewColumn.Two,
                preserveFocus: true,
            }); 
            
        });
            
        client.onNotification("vscoq/updateHighlights", (notification) => {
        
            client.saveHighlights(
                notification.uri,
                notification.preparedRange,
                notification.processingRange,
                notification.processedRange
            );
        
            client.updateHightlights();
        });

        client.onNotification("vscoq/moveCursor", (notification: MoveCursorNotification) => {
            const {uri, range} = notification;
            const editors = window.visibleTextEditors.filter(editor => {
                return editor.document.uri.toString() === uri.toString();
            });
            if(workspace.getConfiguration('vscoq.proof.cursor').sticky === true ||
            workspace.getConfiguration('vscoq.proof').mode === 1) {
                editors.map(editor => {
                    editor.selections = [new Selection(range.end, range.end)];
                    editor.revealRange(range, TextEditorRevealType.Default);
                });
            }
        });

        client.onNotification("vscoq/searchResult", (searchResult: SearchCoqResult) => {
            searchProvider.renderSearchResult(searchResult);
        });

        client.onNotification("vscoq/proofView", (proofView: ProofViewNotification) => {
            const editor = window.activeTextEditor ? window.activeTextEditor : window.visibleTextEditors[0];
            GoalPanel.proofViewNotification(context.extensionUri, editor, proofView);
        });

        context.subscriptions.push(commands.registerCommand(QUICKFIX_COMMAND, (data) => {
            const {text, range, document} = data;
            const edit = new WorkspaceEdit();
            edit.replace(document.uri, range, text);
            workspace.applyEdit(edit);
        }));
        languages.registerCodeActionsProvider('coq', new CoqWarningQuickFix(), {
            providedCodeActionKinds: CoqWarningQuickFix.providedCodeActionKinds
        });

        client.start()
        .then(() => {
            
            checkVersion(client, context);
            const serverInfo = client.initializeResult!.serverInfo;
            statusBar.text = `${serverInfo?.name} ${serverInfo?.version}, coq ${coqTM.getCoqVersion()}`;
            statusBar.tooltip = new MarkdownString(
                
`**Coq Installation**

${coqTM.getversionFullOutput()}

Path: \`${coqTM.getCoqPath()}\`
---

**vscoqtop** ${serverInfo?.version}

Path: \`${coqTM.getVsCoqTopPath()}\`
`
            );
            statusBar.show();

            initializeDecorations(context);
            
            // I think vscode should handle this automatically, TODO: try again after implemeting client capabilities
            context.subscriptions.push(workspace.onDidChangeConfiguration(event => {
                updateServerOnConfigurationChange(event, context, client);

                if(event.affectsConfiguration('vscoq.proof.mode')) {
                    client.resetHighlights();
                    client.updateHightlights();
                }

                if(event.affectsConfiguration('vscoq.goals.display')) {
                    GoalPanel.toggleGoalDisplaySettings();
                }
            }));

            let goalsHook = window.onDidChangeTextEditorSelection(
                (evt: TextEditorSelectionChangeEvent) => {                    
                    if (evt.textEditor.document.languageId === "coq"
                        && workspace.getConfiguration('vscoq.proof').mode === 1)
                    {
                        sendInterpretToPoint(evt.textEditor, client);
                    }
                }
            );

            window.onDidChangeActiveTextEditor(editor => {
                client.updateHightlights();
            });

        });

        context.subscriptions.push(client);
    }	

}

// This method is called when your extension is deactivated
export function deactivate() {}
