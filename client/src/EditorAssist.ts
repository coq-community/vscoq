import * as vscode from "vscode";
const regenerate = require("regenerate");
import { CoqSettings } from "../../lib";

let subscriptions: vscode.Disposable[] = [];

export function unload() {
  subscriptions.forEach(x => x.dispose());
  subscriptions = [];
}

export function reload(): vscode.Disposable {
  unload();
  const matchNothing = /a^/;

  const settings = (vscode.workspace.getConfiguration(
    "coq"
  ) as any) as CoqSettings;

  const increaseIndentPatternParts: string[] = [];
  if (settings.format.indentAfterBullet === "indent")
    increaseIndentPatternParts.push(/\*|\+|\-/.source);
  if (settings.format.indentAfterOpenProof)
    increaseIndentPatternParts.push(/Proof\b/.source);
  const increaseIndentRE =
    settings.format.enable && increaseIndentPatternParts.length > 0
      ? new RegExp(String.raw`^\s*${increaseIndentPatternParts.join("|")}`)
      : matchNothing;

  const wordPattern = new RegExp(
    "(?:" +
      regenerate()
        .add(
          require("unicode-9.0.0/General_Category/Lowercase_Letter/code-points")
        )
        .add(
          require("unicode-9.0.0/General_Category/Uppercase_Letter/code-points")
        )
        .add(require("unicode-9.0.0/General_Category/Other_Letter/code-points"))
        .add(
          require("unicode-9.0.0/General_Category/Titlecase_Letter/code-points")
        )
        .addRange(0x1d00, 0x1d7f) // Phonetic Extensions.
        .addRange(0x1d80, 0x1dbf) // Phonetic Extensions Suppl.
        .addRange(0x1dc0, 0x1dff) // Combining Diacritical Marks Suppl.
        .add(0x005f) // Underscore.
        .add(0x00a0) // Non-breaking space.
        .toString() +
      ")" +
      "(?:" +
      regenerate()
        .add(
          require("unicode-9.0.0/General_Category/Lowercase_Letter/code-points")
        )
        .add(
          require("unicode-9.0.0/General_Category/Uppercase_Letter/code-points")
        )
        .add(require("unicode-9.0.0/General_Category/Other_Letter/code-points"))
        .add(
          require("unicode-9.0.0/General_Category/Titlecase_Letter/code-points")
        )
        .add(
          require("unicode-9.0.0/General_Category/Decimal_Number/code-points")
        )
        .add(
          require("unicode-9.0.0/General_Category/Letter_Number/code-points")
        )
        .add(require("unicode-9.0.0/General_Category/Other_Number/code-points"))
        .addRange(0x1d00, 0x1d7f) // Phonetic Extensions.
        .addRange(0x1d80, 0x1dbf) // Phonetic Extensions Suppl.
        .addRange(0x1dc0, 0x1dff) // Combining Diacritical Marks Suppl.
        .add(0x005f) // Underscore.
        .add(0x00a0) // Non-breaking space.
        .add(0x0027) // Special space/
        .toString() +
      ")*"
  );
  subscriptions.push(
    vscode.languages.setLanguageConfiguration("coq", {
      indentationRules: {
        increaseIndentPattern: increaseIndentRE,
        decreaseIndentPattern: matchNothing
      },
      wordPattern: wordPattern
    })
  );

  formatAlignAfterBulletEdits.clear();

  if (settings.format.enable) {
    const editProviders: {
      fun: (
        doc: vscode.TextDocument,
        pos: vscode.Position,
        ch: string,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
      ) => vscode.TextEdit[] | undefined;
      trigger: string;
    }[] = [];
    if (settings.format.unindentOnCloseProof)
      editProviders.push({ fun: formatCloseProof, trigger: "." });
    if (settings.format.indentAfterBullet === "align") {
      editProviders.push({ fun: formatAlignAfterBullet, trigger: "\n" });
      subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
          if (formatAlignAfterBulletEdits.size === 0) return;
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            if (editor.document !== event.document) return;
            const edit = formatAlignAfterBulletEdits.get(event.document);
            if (!edit || event.contentChanges.length !== 1) return;
            const editRange = event.contentChanges[0].range;
            if (
              !editRange.isEmpty ||
              edit.edit.newText.substring(editRange.start.character) !==
                event.contentChanges[0].text
            )
              return;
            formatAlignAfterBulletEdits.delete(event.document);
            const selectionIdx = editor.selections.findIndex(p =>
              p.active.isEqual(edit.currentPosition)
            );
            if (selectionIdx >= 0 && editor.selections[selectionIdx].isEmpty)
              editor.selections = [
                new vscode.Selection(edit.newPosition, edit.newPosition)
              ];
          }
        })
      );
    }

    if (editProviders.length > 0)
      subscriptions.push(
        vscode.languages.registerOnTypeFormattingEditProvider(
          "coq",
          {
            provideOnTypeFormattingEdits: (
              document,
              position,
              ch,
              options,
              token
            ): vscode.TextEdit[] | Thenable<vscode.TextEdit[]> => {
              for (let ep of editProviders) {
                const editors = ep.fun(document, position, ch, options, token);
                if (editors) return editors;
              }
              return [];
            }
          },
          editProviders[0].trigger,
          ...editProviders.map(x => x.trigger)
        )
      );
  }

  return { dispose: () => unload() };
}

function makeIndent(
  indent: number | string,
  options: vscode.FormattingOptions
): { indent: string; columns: number } {
  let columns: number;
  if (typeof indent === "string")
    columns = indent.replace(/\t/g, " ".repeat(options.tabSize)).length;
  else columns = indent;

  if (options.insertSpaces)
    return { indent: " ".repeat(columns), columns: columns };
  else
    return {
      indent:
        "\t".repeat(Math.floor(columns / options.tabSize)) +
        " ".repeat(columns % options.tabSize),
      columns: columns
    };
}

function formatCloseProof(
  doc: vscode.TextDocument,
  pos: vscode.Position,
  ch: string,
  options: vscode.FormattingOptions,
  token: vscode.CancellationToken
): vscode.TextEdit[] | undefined {
  if (ch === "." && pos.line > 0) {
    const line = doc.lineAt(pos.line);

    let closeMatch: RegExpExecArray | null;
    if (
      !(closeMatch = /^(\s*)((?:Qed|Defined|Admitted)\.\s*)$/.exec(line.text))
    )
      return undefined;

    const prevLine = doc.lineAt(pos.line - 1);
    let alignMatch: RegExpExecArray | null;
    if (
      !(alignMatch = new RegExp(
        String.raw`^(\s*)(?:\s{${options.tabSize}}|\t)\S`
      ).exec(prevLine.text))
    )
      return undefined;
    const { indent: indent } = makeIndent(alignMatch[1], options);
    const edit = new vscode.TextEdit(
      new vscode.Range(pos.line, 0, pos.line, closeMatch[1].length),
      indent
    );
    return [edit];
  }
  return undefined;
}

const formatAlignAfterBulletEdits = new Map<
  vscode.TextDocument,
  {
    edit: vscode.TextEdit;
    newPosition: vscode.Position;
    currentPosition: vscode.Position;
  }
>();
function formatAlignAfterBullet(
  doc: vscode.TextDocument,
  pos: vscode.Position,
  ch: string,
  options: vscode.FormattingOptions,
  token: vscode.CancellationToken
): vscode.TextEdit[] | undefined {
  if (ch === "\n" && pos.line > 0) {
    const prevLine = doc.lineAt(pos.line - 1);
    const line = doc.lineAt(pos.line);

    let prevMatch: RegExpExecArray | null;
    if (!(prevMatch = /^(\s*(?:\*+|\++|\-+)\s*)\S/.exec(prevLine.text)))
      return undefined;
    const { indent: indent, columns: indentColumns } = makeIndent(
      prevMatch[1],
      options
    );
    const edit = new vscode.TextEdit(
      new vscode.Range(
        pos.line,
        0,
        pos.line,
        line.firstNonWhitespaceCharacterIndex
      ),
      indent
    );
    const newPosition = new vscode.Position(pos.line, indentColumns);
    formatAlignAfterBulletEdits.set(doc, {
      edit: edit,
      newPosition: newPosition,
      currentPosition: pos
    });
    return [edit];
  }
  return undefined;
}
