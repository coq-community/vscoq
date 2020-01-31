import * as peg from "pegjs";
export { ExpectedItem, LocationRange } from "pegjs";

export interface SentenceBase {
  text: string;
  rest: string;
}

export interface EOF {
  type: "EOF";
}

export interface Identifier {
  text: string;
  loc: peg.LocationRange;
}

export type QualifiedIdentifier = string;

export interface SAny extends SentenceBase {
  type: "any";
}

export interface Bullet extends SentenceBase {
  type: "bullet";
  bullet: string;
}

export interface SRequire extends SentenceBase {
  type: "require";
  intro: "Import" | "Export" | null;
  modules: QualifiedIdentifier[];
  dirPath: string | null;
}

export interface SDefinition extends SentenceBase {
  type: "definition";
  kind: string;
  ident: Identifier;
  stmt: string;
}

export interface SLtacDef extends SentenceBase {
  type: "ltacdef";
  ident: Identifier;
  ltac: string;
}

export interface SEnd extends SentenceBase {
  type: "end";
  ident: Identifier;
}

export interface ModuleWithModule {
  type: "module";
  qualid: QualifiedIdentifier;
  binding: QualifiedIdentifier;
}
export interface ModuleWithDefinition {
  type: "definition";
  qualid: QualifiedIdentifier;
  expr: string;
}

export interface ModuleType {
  qualid: QualifiedIdentifier;
  ignoreInlineDirective: boolean;
  bindings: QualifiedIdentifier[];
  withBindings: (ModuleWithModule | ModuleWithDefinition)[];
}

export interface ModuleExpression {
  qualid: QualifiedIdentifier;
  ignoreInlineDirective: boolean;
}

export interface ModuleBinding {
  intro: "Import" | "Export";
  idents: Identifier[];
  moduleType: ModuleType;
}

// Nonempty list of bindings

export interface SModuleType extends SentenceBase {
  type: "module-type";
  ident: Identifier;
  bindings: ModuleBinding[];
}

export interface SModuleTypeBind extends SentenceBase {
  type: "module-type-bind";
  ident: Identifier;
  bindings: ModuleBinding[];
  expr: ModuleType;
  moduleTypes: ModuleType[];
}

export interface SModule extends SentenceBase {
  type: "module";
  intro: "Export" | "Import" | null;
  ident: Identifier;
  bindings: ModuleBinding[];
  moduleTypes: ModuleType[];
}

export interface SModuleBind extends SentenceBase {
  type: "module-bind";
  ident: Identifier;
  bindings: ModuleBinding[];
  expr: ModuleExpression;
  moduleTypes: ModuleType[];
}

export interface SInclude extends SentenceBase {
  type: "include";
  qualids: QualifiedIdentifier[] & { [0]: QualifiedIdentifier };
}

export interface SSection extends SentenceBase {
  type: "section";
  ident: Identifier;
}

export interface SInductive extends SentenceBase {
  type: "inductive";
  kind: "Inductive" | "CoInductive";
  bodies: InductiveBody[];
}

export type Term = string;
export type Type = string;
export type Name = string;

export interface Binder {
  binderType: "name" | "name-term" | "name-list";
  name: Name;
}
export interface NameBinder extends Binder {
  binderType: "name";
  name: Name;
}
export interface NameTermBinder extends Binder {
  binderType: "name-term";
  name: Name;
  type: Type;
  term: Term;
}
export interface NameList {
  binderType: "name-list";
  names: Name[];
  type: Type;
}

export interface Constructor {
  ident: Identifier;
  binders: Binder[];
  term: Term;
}

export interface InductiveBody {
  ident: Identifier;
  termType: string | null;
  constructors: Constructor[];
  binders: Binder[];
}

export interface SAssumptions extends SentenceBase {
  type: "assumptions";
  kind:
    | "Axiom"
    | "Conjecture"
    | "Parameter"
    | "Parameters"
    | "Variable"
    | "Variables"
    | "Hypothesis"
    | "Hypotheses";
  idents: Identifier[];
}

export type Sentence =
  | EOF
  | Bullet
  | SRequire
  | SInclude
  | SEnd
  | SModuleType
  | SModuleTypeBind
  | SModule
  | SModuleBind
  | SSection
  | SDefinition
  | SInductive
  | SAssumptions
  | SLtacDef
  | SAny;
