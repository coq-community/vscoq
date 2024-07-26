import {
  TextEditor,
  TextEditorSelectionChangeEvent,
  TextEditorSelectionChangeKind,
} from "vscode";
import { VersionedTextDocumentIdentifier } from "vscode-languageclient/node";

export const makeVersionedDocumentId = (editor: TextEditor) => {
  const uri = editor.document.uri;
  const version = editor.document.version;
  return VersionedTextDocumentIdentifier.create(uri.toString(), version);
};

export const isMouseOrKeyboardEvent = (evt: TextEditorSelectionChangeEvent) => {
  return (
    evt.kind === TextEditorSelectionChangeKind.Mouse ||
    evt.kind === TextEditorSelectionChangeKind.Keyboard
  );
};
