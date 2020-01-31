/** Manages the status bar at the bottom of vscode. All Coq documents should go through this module
 *
 */
import * as vscode from "vscode";
import * as proto from "../../lib";
import * as textUtil from "./text-util";

type StoppedState = { status: "stopped" };
type ReadyState = { status: "ready" };
type ComputingState = {
  status: "computing";
  message: string;
  startTime: [number, number];
  computeTimeMS: number;
  computeStatus: proto.ComputingStatus;
  updateTime: () => number;
};
type MessageState = { status: "message"; message: string };

type State = StoppedState | ReadyState | ComputingState | MessageState;

class CoqStatusBarManager implements vscode.Disposable {
  private statusBar: vscode.StatusBarItem;
  private computingStatusBar: vscode.StatusBarItem;
  private interruptButtonStatusBar: vscode.StatusBarItem;
  private computingTimer: NodeJS.Timer | null = null;
  private showingComputingTimeStatus = false;

  constructor() {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      3
    );
    this.statusBar.text = "Loading Coq";
    this.statusBar.show();
    this.computingStatusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      2
    );
    this.computingStatusBar.tooltip = "Time elapsed on the current computation";
    this.computingStatusBar.text = "";
    this.interruptButtonStatusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1
    );
    this.interruptButtonStatusBar.tooltip = "Interrupt Coq computation";
    this.interruptButtonStatusBar.color = "rgba(255,100,100,1)";
    this.interruptButtonStatusBar.command = "extension.coq.interrupt";
    this.interruptButtonStatusBar.text = "$(primitive-square)";
  }

  public dispose() {
    this.interruptButtonStatusBar.dispose();
    this.computingStatusBar.dispose();
    this.statusBar.dispose();
    if (this.computingTimer) clearInterval(this.computingTimer);
    this.computingTimer = null;
  }

  public showState(state: State) {
    this.statusBar.show();
    if (
      this.computingTimer &&
      (state.status != "computing" ||
        state.computeStatus !== proto.ComputingStatus.Computing)
    ) {
      clearInterval(this.computingTimer);
      this.computingTimer = null;
      this.showingComputingTimeStatus = false;
    }

    switch (state.status) {
      case "stopped": {
        this.statusBar.text = "coqtop is not running.";
        this.interruptButtonStatusBar.hide();
        this.computingStatusBar.hide();
        break;
      }
      case "ready": {
        this.statusBar.text = "Ready";
        this.interruptButtonStatusBar.hide();
        this.computingStatusBar.hide();
        break;
      }
      case "message": {
        const state_ = <MessageState>state;
        this.computingStatusBar.hide();
        this.interruptButtonStatusBar.hide();
        this.statusBar.text = state_.message;
        break;
      }
      case "computing": {
        this.statusBar.text = state.message;
        switch (state.computeStatus) {
          case proto.ComputingStatus.Finished:
            this.computingStatusBar.hide();
            this.interruptButtonStatusBar.hide();
            break;
          case proto.ComputingStatus.Computing:
            if (!this.computingTimer)
              this.computingTimer = setInterval(
                () => this.setComputeMS(state.updateTime()),
                500
              );
            this.setComputeMS(state.computeTimeMS);
            break;
          case proto.ComputingStatus.Interrupted:
            this.computingStatusBar.text = `[Interrupted $(watch) ${textUtil.formatTimeSpanMS(
              state.computeTimeMS
            )}]`;
            this.computingStatusBar.show();
            this.interruptButtonStatusBar.hide();
            break;
        }
        break;
      }
    }
  }

  private setComputeMS(timeMS: number) {
    if (timeMS > 2000) {
      this.computingStatusBar.text = `[${textUtil.formatTimeSpanMS(timeMS)}]`;
      if (!this.showingComputingTimeStatus) {
        this.showingComputingTimeStatus = true;
        this.computingStatusBar.show();
        this.interruptButtonStatusBar.show();
      }
    } else {
      this.computingStatusBar.text = "";
      if (this.showingComputingTimeStatus) {
        this.showingComputingTimeStatus = false;
        this.computingStatusBar.hide();
        this.interruptButtonStatusBar.hide();
      }
    }
  }

  public hide() {
    this.computingStatusBar.hide();
    this.interruptButtonStatusBar.hide();
    this.statusBar.hide();
  }
}

export class StatusBar implements vscode.Disposable {
  private static manager: CoqStatusBarManager | null = null;
  private static managerReferenceCount = 0;
  private static focusedContext: StatusBar | null = null;

  private state: State = { status: "stopped" };
  private hidden = false;

  constructor() {
    if (StatusBar.manager == null)
      StatusBar.manager = new CoqStatusBarManager();
    ++StatusBar.managerReferenceCount;
  }

  public dispose() {
    this.unfocus();
    if (StatusBar.managerReferenceCount == 0)
      throw "StatusBar manager already been deallocated.";
    --StatusBar.managerReferenceCount;
    if (StatusBar.managerReferenceCount == 0 && StatusBar.manager) {
      StatusBar.manager.hide();
      StatusBar.manager.dispose();
      StatusBar.manager = null;
    }
  }

  public focus() {
    if (StatusBar.focusedContext !== this) {
      StatusBar.focusedContext = this;
      this.refreshState();
    }
  }

  public unfocus() {
    if (StatusBar.focusedContext == this) {
      StatusBar.focusedContext = null;
      if (StatusBar.manager) StatusBar.manager.hide();
    }
  }

  // private currentMessage() : string {
  //   if(this.state.status === "message" || this.state.status === "computing")
  //     return (<MessageState|ComputingState>this.state).message;
  //   else
  //     return ""
  // }

  public setStateComputing(
    computeStatus: proto.ComputingStatus,
    message?: string
  ) {
    let startTime: [number, number];
    let computeTime = 0;
    if (
      this.state.status !== "computing" ||
      (computeStatus === proto.ComputingStatus.Computing &&
        this.state.computeStatus !== computeStatus)
    )
      startTime = process.hrtime();
    else {
      startTime = this.state.startTime;
      computeTime = this.state.computeTimeMS;
    }

    this.state = {
      status: "computing",
      message: message
        ? message
        : this.state.status === "computing"
        ? this.state.message
        : "",
      startTime: startTime,
      computeTimeMS: computeTime,
      computeStatus: computeStatus,
      updateTime: () => {
        if (
          this.state.status != "computing" ||
          this.state.computeStatus !== proto.ComputingStatus.Computing
        )
          return 0;
        const delta = process.hrtime(this.state.startTime);
        this.state.computeTimeMS = delta[0] * 1000.0 + delta[1] / 1000000.0;
        return this.state.computeTimeMS;
      }
    };
    this.refreshState();
  }

  public setCoqtopStatus(running: boolean) {
    if (running && this.state.status === "stopped")
      this.state = { status: "ready" };
    else if (!running) this.state = { status: "stopped" };
    this.refreshState();
  }

  private isStopped() {
    return this.state.status === "stopped";
  }

  public setStateReady() {
    if (this.isStopped()) return;
    this.state = { status: "ready" };
    this.refreshState();
  }

  public setStateWorking(name: string) {
    if (this.isStopped()) return;
    this.setStateComputing(proto.ComputingStatus.Computing, name);
  }

  public setStateMessage(name: string) {
    if (this.isStopped()) return;
    this.state = { status: "message", message: name };
  }

  private refreshState() {
    if (StatusBar.focusedContext == this && !this.hidden && StatusBar.manager)
      StatusBar.manager.showState(this.state);
  }

  public show() {
    this.hidden = false;
    this.refreshState();
  }

  public hide() {
    if (!this.hidden) {
      this.hidden = true;
      if (StatusBar.focusedContext == this && StatusBar.manager)
        StatusBar.manager.hide();
    }
  }
}
