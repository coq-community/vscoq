import * as path from "node:path";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

export async function openTextFile(file: string): Promise<vscode.Uri> {
  const docUri = vscode.Uri.file(
    path.resolve(__dirname, "../../../testFixture", file),
  );
  const doc = await vscode.workspace.openTextDocument(docUri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return docUri;
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
