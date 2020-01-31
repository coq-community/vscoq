import * as vscode from "vscode";
import * as text from "./AnnotatedText";

/** Essentially mirrors vscode.DecorationRenderOptions, but restricted to the
 * properties that apply to both :before/:after decorations and plain decorations */
interface PrettyStyleProperties {
  border?: string;
  textDecoration?: string;
  color?: string;
  backgroundColor?: string;
}

interface PrettyStyle extends PrettyStyleProperties {
  dark?: PrettyStyleProperties;
  light?: PrettyStyleProperties;
}

/** An individual substitution */
interface Substitution {
  ugly: string; // regular expression describing the text to replace
  pretty: string; // plain-text symbol to show instead
  pre?: string; // regular expression guard on text before "ugly"
  post?: string; // regular expression guard on text after "ugly"
  style?: PrettyStyle; // stylings to apply to the "pretty" text, if specified, or else the ugly text
}

interface LanguageEntry {
  /** language(s) to apply these substitutions on */
  language: vscode.DocumentSelector;
  /** substitution rules */
  substitutions: Substitution[];
}

interface PrettifySymbolsMode {
  /** Register a handler to receive notifications when PSM is enabled or disabled.
   * @returns a disposable object to unregister the handler
   */
  onDidEnabledChange: (
    handler: (enabled: boolean) => void
  ) => vscode.Disposable;
  /** Query whether PSM is "enabled" - this refers to the user's ability to
   * temporarily enable/disable the mode for an instance of vscode."
   * @returns `true` iff PSM is currently enabled
   */
  isEnabled: () => boolean;
  /** Temporarily add more substitutions.
   * @returns a disposable object to remove the provided substitutions
   */
  registerSubstitutions: (substitutions: LanguageEntry) => vscode.Disposable;
}

let enabled = false;
const enabledChangeEvent = new vscode.EventEmitter<boolean>();
export function isEnabled() {
  return enabled;
}

export const onEnabledChange = enabledChangeEvent.event;

function onPrettifySymbolsModeEnabledChange(isEnabled: boolean) {
  if (enabled === isEnabled) return;
  enabled = isEnabled;
  enabledChangeEvent.fire(enabled);
}

export function prettyTextToString(txt: text.AnnotatedText): string {
  const str: string = enabled
    ? text.textToDisplayString(txt)
    : text.textToString(txt);
  // `coqtop` loves outputting non-breaking spaces instead of normal whitespace, so we replace them
  // here with tabs and spaces to allow the user to copy any output and use it directly as input.
  return str.replace(/\u00a0{4}/, "\t").replace(/\u00a0/g, " ");
}

export function load(): vscode.Disposable {
  const subscriptions: vscode.Disposable[] = [];
  const psm = vscode.extensions.getExtension<PrettifySymbolsMode>(
    "siegebell.prettify-symbols-mode"
  );
  if (psm) {
    psm.activate().then(() => {
      subscriptions.push(
        psm.exports.onDidEnabledChange(onPrettifySymbolsModeEnabledChange)
      );
      onPrettifySymbolsModeEnabledChange(psm.exports.isEnabled());
      subscriptions.push(
        psm.exports.registerSubstitutions({
          language: "coq",
          substitutions: [{ ugly: "COQ", pretty: "⫝" }]
        })
      );
    });
  }

  return {
    dispose: () => {
      subscriptions.forEach(d => d.dispose);
    }
  };
}
