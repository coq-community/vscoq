import { AnnotatedText } from ".";

// export type CoqValue = any;
export namespace CoqProto {
  export type StateId = number;
  export type EditId = number;
  export type RouteId = number;
  export type ObjectId =
    | { objectKind: "stateid"; stateId: StateId }
    | { objectKind: "editid"; editId: EditId };

  export type Pair<X, Y> = { [0]: X; [1]: Y } & void[];

  export function hasStateId(
    objectId: ObjectId
  ): objectId is { objectKind: "stateid"; stateId: StateId } {
    return objectId.objectKind === "stateid";
  }

  export interface UnionL<X> {
    tag: "inl";
    value: X;
  }
  export interface UnionR<X> {
    tag: "inr";
    value: X;
  }
  export type Union<X, Y> = UnionL<X> | UnionR<Y>;

  // export type StateFeedback2 =
  //   (WorkerStatus | (CustomFeedback&FeedbackBase) | SentenceFeedback | MessageFeedback | FileLoaded | FileDependency | GlobReference | GlobDefinition | UnknownFeedback)
  //   & FeedbackBase;

  // export interface StateFeedback {
  //   stateId : number;
  //   route : number;
  //   workerStatus?: WorkerStatus[];
  //   fileDependencies?: Map<string,string[]>;
  //   fileLoaded?: FileLoaded;
  //   sentenceFeedback?: SentenceFeedback;
  //   custom?: CustomFeedback
  //   error?: ErrorMessage;
  // }

  export enum WorkerState {
    Idle,
    Processing,
    Dead,
    Proof
  }
  export interface WorkerStatus {
    feedbackKind: "worker-status";
    id: string;
    state: WorkerState;
    ident?: string;
  }

  export enum SentenceStatus {
    Parsing,
    ProcessingInWorker,
    Processed,
    InProgress,
    Incomplete,
    Complete,
    AddedAxiom,
    // NOTE!
    // Coq uses IDs like 'processingin'; the below lets us convert into SentenceStatus
    processingin = ProcessingInWorker,
    processed = Processed,
    inprogress = InProgress,
    incomplete = Incomplete,
    complete = Complete,
    addedaxiom = AddedAxiom
  }

  export interface FailValue {
    status: "fail";
    stateId: StateId;
    message: AnnotatedText;
    location?: Location;
  }

  // export interface Value {
  //   stateId?: number;
  //   error?: FailValue;
  //   value?: any;
  //   message?: AnnotatedText;
  //   unfocusedStateId?: number;
  // }

  export interface SentenceFeedback {
    feedbackKind: "sentence-status";
    status: SentenceStatus;
    worker: string;
    inProgressDelta: number;
  }

  export interface CustomFeedback {
    feedbackKind: "custom";
    type: string;
    location: Location;
    data: any;
  }

  export interface LtacProfFeedback extends LtacProfResults {
    feedbackKind: "ltacprof";
  }

  export interface GlobReference {
    feedbackKind: "glob-ref";
    location: Location;
    filePath: string;
    modulePath: string;
    identity: string;
    type: string;
  }

  export interface GlobDefinition {
    feedbackKind: "glob-def";
    location: Location;
    identity: string;
    secPath: string;
    type: string;
  }

  export interface FileDependency {
    feedbackKind: "file-dependency";
    source: string;
    dependsOn: string;
  }

  export interface UnknownFeedback {
    feedbackKind: "unknown";
    data: any;
  }

  export type FeedbackContent =
    | WorkerStatus
    | SentenceFeedback
    | MessageFeedback
    | FileLoaded
    | FileDependency
    | GlobReference
    | GlobDefinition
    | CustomFeedback
    | LtacProfFeedback
    | UnknownFeedback;

  export type MessageFeedback = Message & { feedbackKind: "message" };

  export interface FeedbackBase {
    objectId: ObjectId;
    route: number;
  }

  export interface FileLoaded {
    feedbackKind: "file-loaded";
    module: string;
    filename: string;
  }

  export enum MessageLevel {
    Warning,
    warning = Warning,
    Info,
    info = Info,
    Notice,
    notice = Notice,
    Error,
    error = Error,
    Debug,
    debug = Debug
  }

  export interface Message {
    level: MessageLevel;
    location?: Location;
    message: AnnotatedText;
  }

  export interface Location {
    start: number;
    stop: number;
  }

  export interface OptionState {
    synchronized: boolean;
    deprecated: boolean;
    name: string;
    value: number | string | boolean;
  }

  export interface LtacProfTactic {
    name: string;
    statistics: {
      total: number;
      local: number;
      num_calls: number;
      max_total: number;
    };
    tactics: LtacProfTactic[];
  }
  export interface LtacProfResults {
    total_time: number;
    tactics: LtacProfTactic[];
  }

  export interface CoqStatus {
    path: string[];
    proofName?: string;
    allProofs: string[];
    proofNumber: number;
  }

  export interface CoqObject<T> {
    prefix: string[];
    qualid: string[];
    object: T;
  }

  export interface CoqInfo {
    coqtop_version: string;
    protocol_version: string;
    release_date: string;
    compile_date: string;
  }

  export interface Subgoal {
    id: number;
    hypotheses: AnnotatedText[];
    goal: AnnotatedText;
  }

  export interface UnfocusedGoalStack {
    // subgoals that appear before the focus
    before: Subgoal[];
    // reference to the more-focused background goals
    next?: UnfocusedGoalStack;
    // subgoals that appear after the focus
    after: Subgoal[];
  }

  export interface Goals {
    goals: Subgoal[];
    backgroundGoals: UnfocusedGoalStack;
    shelvedGoals: Subgoal[];
    abandonedGoals: Subgoal[];
    // error?: FailValue;
  }

  export type StateFeedback =
    | (WorkerStatus & FeedbackBase)
    | (CustomFeedback & FeedbackBase)
    | (SentenceFeedback & FeedbackBase)
    | (LtacProfFeedback & FeedbackBase)
    | (MessageFeedback & FeedbackBase)
    | (FileLoaded & FeedbackBase)
    | (FileDependency & FeedbackBase)
    | (GlobReference & FeedbackBase)
    | (GlobDefinition & FeedbackBase)
    | (UnknownFeedback & FeedbackBase);

  export type PairCoqValue = { [0]: CoqValue; [1]: CoqValue } & void[];
  export interface UnionCoqValueL extends UnionL<CoqValue> {}
  export interface UnionCoqValueR extends UnionR<CoqValue> {}
  export type UnionCoqValue = UnionCoqValueL | UnionCoqValueR;
  export interface CoqValueList extends Array<CoqValue> {}
  export type CoqValue =
    | string
    | boolean
    | PairCoqValue
    | UnionCoqValue
    | CoqValueList
    | StateId
    | EditId
    | StateFeedback
    | OptionState
    | Subgoal
    | Goals
    | AnnotatedText
    | Location
    | MessageLevel
    | Message
    | FeedbackContent
    | LtacProfTactic
    | LtacProfResults
    | CoqStatus
    | ValueReturn
    | FailValue;

  export type Add_rty = Pair<StateId, Pair<Union<{}, StateId>, AnnotatedText>>;
  export type Goal_rty = Goals;
  export type EditAt_rty = Union<{}, Pair<StateId, Pair<StateId, StateId>>>;
  export type Query_rty = {};
  export type Evars_rty = string[] | undefined;
  export type Hints_rty =
    | Pair<Pair<string, string>[][], Pair<string, string>[]>
    | undefined;
  export type Status_rty = CoqStatus;
  export type Search_rty = CoqObject<string>[];
  export type GetOptions_rty = Pair<string[], OptionState>[];
  export type SetOptions_rty = {};
  export type MkCases_rty = string[][];
  export type Quit_rty = {};
  export type About_rty = CoqInfo;
  export type Init_rty = StateId;
  export type Interp_rty = Pair<StateId, Union<string, string>>;
  export type StopWorker_rty = {};
  export type PrintAst_rty = {}; // xml
  export type Annotate_rty = {}; // xml

  export interface ValueReturn {
    status: "good";
    result:
      | Add_rty
      | Goal_rty
      | EditAt_rty
      | Query_rty
      | Evars_rty
      | Hints_rty
      | Status_rty
      | Search_rty
      | GetOptions_rty
      | SetOptions_rty
      | MkCases_rty
      | Quit_rty
      | About_rty
      | Init_rty
      | Interp_rty
      | StopWorker_rty
      | PrintAst_rty
      | Annotate_rty;
  }

  export interface AddReturn {
    assignedState: StateId;
    nextFocusState?: StateId;
    message: AnnotatedText;
  }
  export interface EditAtJumpFocusReturn {
    focusedState: StateId;
    focusedQedState: StateId;
    oldFocusedState: StateId;
  }
  export type Hint = [string, string][];
  export interface HintsReturn {
    hintsA: Hint[];
    hintB: Hint;
  }
  export interface InterpReturn {
    assignedState: StateId;
    tag: string;
    value: string;
  }

  export type ReturnValue =
    | AddReturn
    | Goals
    | EditAtJumpFocusReturn
    | HintsReturn
    | InterpReturn
    | AnnotatedText
    | StateId
    | CoqStatus
    | CoqInfo
    | CoqObject<string>
    | Map<string[], OptionState>
    | string[]
    | string[][]
    | {};
  export function GetValue(x: "Add", value: ValueReturn): AddReturn;
  export function GetValue(
    x: "Edit_at",
    value: ValueReturn
  ): EditAtJumpFocusReturn | null;
  export function GetValue(x: "Goal", value: ValueReturn): Goals | null;
  export function GetValue(x: "Query", value: ValueReturn): void;
  export function GetValue(x: "Evars", value: ValueReturn): string[];
  export function GetValue(x: "Hints", value: ValueReturn): HintsReturn;
  export function GetValue(x: "Status", value: ValueReturn): CoqStatus;
  export function GetValue(x: "Search", value: ValueReturn): CoqObject<string>;
  export function GetValue(
    x: "GetOptions",
    value: ValueReturn
  ): Map<string[], OptionState>;
  export function GetValue(x: "SetOptions", value: ValueReturn): void;
  export function GetValue(x: "MkCases", value: ValueReturn): string[][];
  export function GetValue(x: "Quit", value: ValueReturn): void;
  export function GetValue(x: "About", value: ValueReturn): CoqInfo;
  export function GetValue(x: "Init", value: ValueReturn): StateId;
  export function GetValue(x: "Interp", value: ValueReturn): InterpReturn;
  export function GetValue(x: "StopWorker", value: ValueReturn): void;
  export function GetValue(x: "PrintAst", value: ValueReturn): void;
  export function GetValue(x: "Annotate", value: ValueReturn): void;
  export function GetValue(x: string, value: ValueReturn): ReturnValue {
    if (value.status !== "good") throw "Cannot get value of failed command";
    switch (x) {
      case "Add": {
        let v = value.result as Add_rty;
        return {
          assignedState: v[0],
          nextFocusState: v[1][0].tag === "inr" ? v[1][0].value : undefined,
          message: v[0][0]
        };
      }
      case "Edit_at": {
        let v = value.result as EditAt_rty;
        if (v.tag === "inl") return null;
        else
          return {
            focusedState: v.value[0],
            focusedQedState: v.value[1][0],
            oldFocusedState: v.value[1][1]
          };
      }
      case "Goal": {
        return value.result;
      }
      case "Query": {
        return value.result as Query_rty;
      }
      case "Evars": {
        return (value.result as Evars_rty) || [];
      }
      case "Hints": {
        return value.result as Hints_rty;
      }
      case "Status": {
        return value.result as CoqStatus;
      }
      case "Search": {
        return value.result as CoqObject<string>;
      }
      case "GetOptions": {
        const v = value.result as GetOptions_rty;
        return new Map<string[], OptionState>(
          v.map<[string[], OptionState]>(x => [x[0], x[1]])
        );
      }
      case "SetOptions": {
        return;
      }
      case "MkCases": {
        return value.result as string[][];
      }
      case "Quit": {
        return;
      }
      case "About": {
        return value.result as CoqInfo;
      }
      case "Init": {
        return value.result as StateId;
      }
      case "value.result": {
        const v = value.result as Interp_rty;
        return {
          assignedState: v[0],
          tag: v[1].tag,
          value: v[1].value
        };
      }
      case "StopWorker": {
        return;
      }
      case "PrintAst": {
        return;
      }
      case "Annotate":
        return;
      default:
        return undefined;
    }
  }
}
