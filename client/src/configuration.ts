import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export function sendConfiguration(
  context: vscode.ExtensionContext,
  client: LanguageClient,
) {
  const config = vscode.workspace.getConfiguration("vscoq");
  client.sendNotification("workspace/didChangeConfiguration", {
    settings: config,
  });
}

export function updateServerOnConfigurationChange(
  event: vscode.ConfigurationChangeEvent,
  context: vscode.ExtensionContext,
  client: LanguageClient,
) {
  if (event.affectsConfiguration("vscoq")) {
    sendConfiguration(context, client);
  }
}
