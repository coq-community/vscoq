import h = require("hyperscript");
import {
  ProofView,
  UnfocusedGoalStack,
  HypothesisDifference,
  TextDifference,
  AnnotatedText,
  ScopedText,
  Hypothesis,
  Goal,
  CommandResult,
} from "./protocol";
import { makeBreakingText } from "./ui-util";

function countUnfocusedGoals(u: UnfocusedGoalStack | undefined): number {
  if (!u) return 0;
  return u.before.length + u.after.length + countUnfocusedGoals(u.next);
}

function countAllGoals(state: ProofView): number {
  const result =
    (state.goals ? state.goals.length : 0) +
    countUnfocusedGoals(state.backgroundGoals) +
    (state.abandonedGoals ? state.abandonedGoals.length : 0) +
    (state.shelvedGoals ? state.shelvedGoals.length : 0);
  return result;
}

function getDifferenceClass(diff: HypothesisDifference) {
  switch (diff) {
    case HypothesisDifference.Changed:
      return "changed";
    case HypothesisDifference.New:
      return "new";
    case HypothesisDifference.MovedUp:
      return "movedUp";
    case HypothesisDifference.MovedDown:
      return "movedDown";
    default:
      return "";
  }
}

function getTextDiffClass(diff?: TextDifference): string {
  if (diff === "added") return "charsAdded";
  if (diff === "removed") return "charsRemoved";
  else return "";
}

function isScopedText(text: AnnotatedText): text is ScopedText {
  return text.hasOwnProperty("scope");
}

function createAnnotatedText(text: AnnotatedText): HTMLElement[] {
  function helper(text: AnnotatedText): (Text | HTMLElement)[] {
    if (typeof text === "string") return makeBreakingText(text);
    else if (text instanceof Array) return text.map(helper).flat();
    else if (isScopedText(text)) {
      if (text.scope.trim() !== "") {
        const element = h("span", helper(text.text));
        element.classList.add(text.scope.replace(".", "-"));
        return [element];
      }
      return helper(text.text);
    } else {
      const addTextDiffClass = (element: HTMLElement) => {
        const className = getTextDiffClass(text.diff);

        if (className === "") return;
        element.classList.add(className);
      };

      if (text.substitution) {
        const element = h(
          "span",
          { subst: text.substitution, title: text.text },
          makeBreakingText(text.text)
        );
        element.classList.add("substitution");
        addTextDiffClass(element);
        return [element];
      } else {
        const element = h("span", makeBreakingText(text.text));
        addTextDiffClass(element);
        return [element];
      }
    }
  }

  const element = h("span", helper(text));
  element.classList.add("richpp");
  return [element];
}

function createHypothesis(hyp: Hypothesis): HTMLElement {
  const element = h("li", [
    h("span.ident", hyp.identifier),
    h("span.rel", hyp.relation),
    h("span.expr", createAnnotatedText(hyp.expression)),
  ]);

  element.classList.add("hypothesis", "breakText");

  const differenceClass = getDifferenceClass(hyp.diff);

  if (differenceClass !== "") {
    element.classList.add(differenceClass);
  }

  element.addEventListener("dblclick", function () {
    const target = this;

    if (target.classList.contains("hypothesis")) {
      target.classList.toggle("breakText");
      target.classList.toggle("noBreakText");
    }
  });

  return element;
}

function createHypotheses(hypotheses: Hypothesis[]): HTMLElement {
  const element = h("ul", hypotheses.map(createHypothesis));
  element.classList.add("hypotheses");
  return element;
}

function createGoal(goal: Goal, index: number, goals: Goal[]): HTMLElement {
  const element = h("li", [
    h("span.goalId", `${index + 1}/${goals.length}`),
    h("span.expr", createAnnotatedText(goal.goal)),
  ]);

  element.classList.add("goal");

  return element;
}

function createFocusedGoals(goals: Goal[]): HTMLElement {
  const element = h("ul", goals.map(createGoal));
  element.classList.add("goalsList");
  return element;
}

export const ProofState = () => {
  const mainGoalsElement = h("vscode-panel-view");
  const shelvedGoalsElement = h("vscode-panel-view");
  const givenUpGoalsElement = h("vscode-panel-view");
  const mainGoalCountBadge = h("vscode-badge", "0");
  const shelvedGoalCountBadge = h("vscode-badge", "0");
  const givenUpGoalCountBadge = h("vscode-badge", "0");
  const element = h("vscode-panels.panels", [
    h("vscode-panel-tab", "MAIN", mainGoalCountBadge),
    h("vscode-panel-tab", "SHELVED", shelvedGoalCountBadge),
    h("vscode-panel-tab", "GIVEN UP", givenUpGoalCountBadge),
    mainGoalsElement,
    shelvedGoalsElement,
    givenUpGoalsElement,
  ]);

  const updateState = (state: ProofView) => {
    mainGoalCountBadge.textContent = String(state.goals.length);
    shelvedGoalCountBadge.textContent = String(state.shelvedGoals.length);
    givenUpGoalCountBadge.textContent = String(state.abandonedGoals.length);

    const handleNoMainGoals = (state: ProofView) => {
      if (countAllGoals(state) === 0) {
        mainGoalsElement.textContent = "Proof finished";
        return;
      }

      if (countUnfocusedGoals(state.backgroundGoals) > 0) {
        mainGoalsElement.textContent = "There are unfocused goals";
        return;
      }

      if (state.shelvedGoals.length > 0) {
        const content = h("span", [
          "There are shelved goals. Try using ",
          h("code", "Unshelve"),
        ]);
        mainGoalsElement.appendChild(content);
        return;
      }

      if (state.abandonedGoals.length > 0) {
        const content = h("span", [
          "There are some goals you gave up. You need to go back and solve them, or use ",
          h("code", "Admitted."),
        ]);
        mainGoalsElement.appendChild(content);
        return;
      }
    };

    mainGoalsElement.innerHTML = "";
    if (state.goals.length === 0) {
      handleNoMainGoals(state);
    } else {
      if (state.abandonedGoals.length > 0) {
        mainGoalsElement.appendChild(
          h("div.given-up-goals-warning", [
            h("strong", "Warning: "),
            "You have given up goals",
          ])
        );
      }
      mainGoalsElement.appendChild(createHypotheses(state.goals[0].hypotheses));
      const goalElements = createFocusedGoals(state.goals);
      mainGoalsElement.appendChild(goalElements);
      const firstGoalElement = goalElements.firstElementChild;
      if (firstGoalElement) {
        firstGoalElement.scrollIntoView({ block: "center", inline: "nearest" });
      }
    }

    shelvedGoalsElement.innerHTML = "";
    if (state.shelvedGoals.length === 0) {
      shelvedGoalsElement.textContent = "No shelved goals";
    } else {
      shelvedGoalsElement.appendChild(createFocusedGoals(state.shelvedGoals));
    }

    givenUpGoalsElement.innerHTML = "";
    if (state.abandonedGoals.length === 0) {
      givenUpGoalsElement.textContent = "No given up goals";
    } else {
      givenUpGoalsElement.appendChild(createFocusedGoals(state.abandonedGoals));
    }
  };

  const unmount = () => {
    element.parentNode.removeChild(element);
  };

  return { element, updateState, unmount };
};

export const OtherInfoView = () => {
  const messageView = h("vscode-panel-view");
  const element = h("vscode-panels.panels", [
    h("vscode-panel-tab", "MESSAGE"),
    messageView
  ]);

  let messageViewInnerDiv = h("pre");
  messageView.appendChild(messageViewInnerDiv);
  
  /* 
    clear-on-demand: 
    if this flag is set, the message panel will be reset on receiving the next incoming message
    and this flag will be unset immediately after that
  */
  let ready : boolean = true;

  const readyForMessageReset = () => {
    ready = true;
  };

  const updateInnerMessage = (s : AnnotatedText) => {
    if (ready){
      messageViewInnerDiv.innerHTML = "";
      ready = false;
    }
    messageViewInnerDiv.appendChild(h("span", [...createAnnotatedText(s), "\n"]));
  };

  return { element, updateInnerMessage, readyForMessageReset };
};

export const Infoview = () => {
  const element = h("div");

  let proofStateInstance: ReturnType<typeof ProofState> | undefined = undefined;
  let otherViewInstance = OtherInfoView();
  let divider = h("vscode-divider");

  const updateState = (state: CommandResult) => {
    if (state.type === "proof-view") {
      if (proofStateInstance === undefined) {
        element.innerHTML = "";
        proofStateInstance = ProofState();
        element.appendChild(proofStateInstance.element);
        element.appendChild(divider);
        element.appendChild(otherViewInstance.element);
      }

      proofStateInstance.updateState(state);
    } else if (state.type === "message-query") {
      // if (state.innertext)
      otherViewInstance.updateInnerMessage(state.innertext);
      // else
      //   otherViewInstance.updateInnerMessage("nothing. why?");
    } else if (state.type === "message-ready-clear") {
      otherViewInstance.readyForMessageReset();
    } else {
      if (proofStateInstance !== undefined) {
        proofStateInstance.unmount();
        proofStateInstance = undefined;
      }
    }

    const setMessage = (message: string) => {
      element.innerHTML = "";
      const formatted = h("div.message", message);
      element.appendChild(formatted);
      element.appendChild(divider);
      element.appendChild(otherViewInstance.element);
    };

    const setErrorMessage = (message: HTMLElement) => {
      element.innerHTML = "";
      const formatted = h("div.message", [
        h("strong", "Error: "),
        h("code#error", message),
      ]);
      element.appendChild(formatted);
      element.appendChild(divider);
      element.appendChild(otherViewInstance.element);
    };

    if (state.type === "not-running") {
      setMessage("coqtop is not running");
    } else if (state.type === "failure") {
      setErrorMessage(createAnnotatedText(state.message)[0]);
    } else if (state.type === "interrupted") {
      setMessage("Interrupted");
    } else if (state.type === "no-proof") {
      setMessage("Not in proof mode");
    }
  };

  const unmount = () => {
    element.parentNode.removeChild(element);
  };

  return { element, updateState, unmount };
};
