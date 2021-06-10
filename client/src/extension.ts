'use strict';
import * as vscode from 'vscode';
import { TextEditor, TextEditorEdit, ExtensionContext } from 'vscode';
import * as proto from './protocol';
import { CoqProject, CoqDocument } from './CoqProject';
import * as snippets from './Snippets';
import { initializeDecorations } from './Decorations';
import * as editorAssist from './EditorAssist';
import * as psm from './prettify-symbols-mode';

vscode.Range.prototype.toString = function rangeToString(this: vscode.Range) { return `[${this.start.toString()},${this.end.toString()})` }
vscode.Position.prototype.toString = function positionToString(this: vscode.Position) { return `{${this.line}@${this.character}}` }

console.log(`Coq Extension: process.version: ${process.version}, process.arch: ${process.arch}}`);

let project: CoqProject;


export var extensionContext: ExtensionContext;

export function activate(context: ExtensionContext) {
  console.log(`execArgv: ${process.execArgv.join(' ')}`);
  console.log(`argv: ${process.argv.join(' ')}`);
  extensionContext = context;

  // Indentation rules
  vscode.languages.setLanguageConfiguration("coq", {
    // @Note Literal whitespace in below regexps is removed
    onEnterRules: [
      {
        beforeText: new RegExp(
          String.raw`
          ^\s*
          (
            (\|) .+
          )
          \s*$
          `.replace(/\s+?/g, "")
        ),
        action: {
          indentAction: vscode.IndentAction.None
        }
      },
      {
        beforeText: new RegExp(
          String.raw`
          ^\s*
          (
            (Definition|Fixpoint|Record|Ltac|Let|Notation|Program Definition) .+:=
          )
          \s*$
          `.replace(/\s+?/g, "")
        ),
        action: {
          indentAction: vscode.IndentAction.Indent
        }
      }
    ]
  });

  project = CoqProject.create(context);
  context.subscriptions.push(project);

  function regTCmd(command: string, callback: (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => void) {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('extension.coq.' + command, callback));
  }
  function regCmd(command: string, callback: (...args: any[]) => any, thisArg?: any) {
    context.subscriptions.push(vscode.commands.registerCommand('extension.coq.' + command, callback, thisArg));
  }
  function regProjectCmd(command: string, callback: (...args: any[]) => any, thisArg?: any) {
    context.subscriptions.push(vscode.commands.registerCommand('extension.coq.' + command, callback, project));
  }

  initializeDecorations(context);

  regProjectCmd('quit', project.quitCoq);
  regProjectCmd('reset', project.resetCoq);
  regProjectCmd('interrupt', project.interruptCoq);
  regProjectCmd('finishComputations', project.finishComputations);
  regProjectCmd('stepForward', project.stepForward);
  regProjectCmd('stepBackward', project.stepBackward);
  regProjectCmd('interpretToPoint', project.interpretToPoint);
  regProjectCmd('interpretToPointSynchronous', () => project.interpretToPoint({ synchronous: true }));
  regProjectCmd('interpretToEnd', project.interpretToEnd);
  regProjectCmd('interpretToEndSynchronous', () => project.interpretToEnd({ synchronous: true }));
  regProjectCmd('moveCursorToFocus', project.setCursorToFocus);
  regTCmd('query.check', check);
  regTCmd('query.locate', locate);
  regTCmd('query.search', search);
  regTCmd('query.about', about);
  regTCmd('query.searchAbout', searchAbout);
  regTCmd('query.print', print);
  regTCmd('query.prompt.check', queryCheck);
  regTCmd('query.prompt.locate', queryLocate);
  regTCmd('query.prompt.search', querySearch);
  regTCmd('query.prompt.about', queryAbout);
  regTCmd('query.prompt.searchAbout', querySearchAbout);
  regTCmd('query.prompt.print', queryPrint);
  regTCmd('proofView.viewStateAt', viewProofStateAt);
  regTCmd('proofView.open', viewCurrentProofState);
  regProjectCmd('ltacProf.getResults', project.ltacProfGetResults);
  regCmd('display.toggle.implicitArguments', () => project.setDisplayOption(proto.DisplayOption.ImplicitArguments, proto.SetDisplayOption.Toggle));
  regCmd('display.toggle.coercions', () => project.setDisplayOption(proto.DisplayOption.Coercions, proto.SetDisplayOption.Toggle));
  regCmd('display.toggle.nestedMatchingExpressions', () => project.setDisplayOption(proto.DisplayOption.NestedMatchingExpressions, proto.SetDisplayOption.Toggle));
  regCmd('display.toggle.notations', () => project.setDisplayOption(proto.DisplayOption.Notations, proto.SetDisplayOption.Toggle));
  regCmd('display.toggle.allBasicLowLevelContents', () => project.setDisplayOption(proto.DisplayOption.AllBasicLowLevelContents, proto.SetDisplayOption.Toggle));
  regCmd('display.toggle.existentialVariableInstances', () => project.setDisplayOption(proto.DisplayOption.ExistentialVariableInstances, proto.SetDisplayOption.Toggle));
  regCmd('display.toggle.universeLevels', () => project.setDisplayOption(proto.DisplayOption.UniverseLevels, proto.SetDisplayOption.Toggle));
  regCmd('display.toggle.allLowLevelContents', () => project.setDisplayOption(proto.DisplayOption.AllLowLevelContents, proto.SetDisplayOption.Toggle));
  regCmd('display.toggle', () => project.setDisplayOption());

  context.subscriptions.push(editorAssist.reload());
  snippets.setupSnippets(context.subscriptions);
  context.subscriptions.push(psm.load());
}


async function withDocAsync<T>(editor: TextEditor, callback: (doc: CoqDocument) => Promise<T>): Promise<void> {
  const doc = editor ? project.getOrCurrent(editor.document.uri.toString()) || null : null;
  if (doc)
    await callback(doc);
}

function coqIdOrNotationFromPosition(editor: TextEditor) {
  let range : vscode.Range | undefined = editor.selection;
  if (range.isEmpty)
    range = editor.document.getWordRangeAtPosition(editor.selection.active);
    
  let regExpCoqNotation = /[^\p{Z}\p{C}"]+/u;
  if (range == undefined)
    range = editor.document.getWordRangeAtPosition(editor.selection.active,regExpCoqNotation);
  let text = editor.document.getText(range);

  if (new RegExp("\^"+regExpCoqNotation.source+"\$",regExpCoqNotation.flags).test(text)
      && ! new RegExp("\^"+editorAssist.regExpQualifiedCoqIdent.source+"\$",regExpCoqNotation.flags).test(text))
    return "\""+text+"\"";
  return text;
}

async function queryStringFromPlaceholder(prompt: string, editor: TextEditor) {
  return await vscode.window.showInputBox({
    prompt: prompt,
    value: coqIdOrNotationFromPosition(editor)
  });
}

async function queryStringFromPosition(prompt: string, editor: TextEditor) {
  let query = coqIdOrNotationFromPosition(editor);
  if (query.trim() === "")
    return await vscode.window.showInputBox({
      prompt: prompt,
      value: undefined
    });
  else
    return query;
}

function queryCheck(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("check", await queryStringFromPlaceholder("Check:", editor))
  )
}

function queryLocate(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("locate", await queryStringFromPlaceholder("Locate:", editor))
  )
}

function querySearch(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("search", await queryStringFromPlaceholder("Search:", editor))
  )
}

function queryAbout(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("about", await queryStringFromPlaceholder("Search:", editor))
  )
}

function querySearchAbout(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("searchAbout", await queryStringFromPlaceholder("Search About:", editor))
  )
}

function queryPrint(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("print", await queryStringFromPlaceholder("Print:", editor))
  )
}

function check(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("check", await queryStringFromPosition("Check:", editor))
  )
}

function locate(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("locate", await queryStringFromPosition("Locate:", editor))
  )
}

function search(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("search", await queryStringFromPosition("Search:", editor))
  )
}

function about(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("about", await queryStringFromPosition("Search:", editor))
  )
}

function searchAbout(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("searchAbout", await queryStringFromPosition("Search About:", editor))
  )
}

function print(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.query("print", await queryStringFromPosition("Search About:", editor))
  )
}

function viewProofStateAt(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.viewGoalAt(editor)
  );
}

function viewCurrentProofState(editor: TextEditor, edit: TextEditorEdit) {
  return withDocAsync(editor, async (doc) =>
    doc.viewGoalState(editor)
  )
}
