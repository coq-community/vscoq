import * as vscode from "vscode";

import * as proto from "../../lib";

export enum DisplayState {
  Proof,
  Top,
  Error
}

export function getDisplayState(state: proto.CommandResult) {
  switch (state.type) {
    case "failure":
      return DisplayState.Error;
    case "proof-view":
      return DisplayState.Proof;
    case "interrupted":
      return DisplayState.Error;
    case "no-proof":
    case "not-running":
    case "busy":
      return DisplayState.Top;
  }
}

function countUnfocusedGoalStack(
  u: proto.UnfocusedGoalStack | undefined
): number {
  if (u)
    return u.before.length + u.after.length + countUnfocusedGoalStack(u.next);
  else return 0;
}

export function countAllGoals(state: proto.CommandResult): number {
  if (state.type === "proof-view") {
    const result =
      state.goals.length +
      countUnfocusedGoalStack(state.backgroundGoals) +
      state.abandonedGoals.length +
      state.shelvedGoals.length;
    return result;
  } else return 0;
}

export function adjacentPane(pane: vscode.ViewColumn): vscode.ViewColumn {
  switch (pane) {
    case vscode.ViewColumn.One:
      return vscode.ViewColumn.Two;
    case vscode.ViewColumn.Two:
      return vscode.ViewColumn.Three;
    default:
      return vscode.ViewColumn.One;
  }
}

export interface CoqView extends vscode.Disposable {
  update(state: proto.CommandResult): void;
  // message(message: string) : void;
  readonly resize: vscode.Event<number>;

  show(pane: vscode.ViewColumn, state?: proto.CommandResult): Promise<void>;

  isVisible(): boolean;
}
