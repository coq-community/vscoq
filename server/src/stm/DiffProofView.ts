import {
  ProofView,
  Goal,
  Hypothesis,
  HypothesisDifference,
  UnfocusedGoalStack
} from "../../../lib";
import * as text from "../util/AnnotatedText";
import * as server from "../server";

function diffHypotheses(
  oldHyps: Hypothesis[],
  newHyps: Hypothesis[]
): Hypothesis[] {
  const results: Hypothesis[] = [];
  newHyps.forEach((hyp, idxHyp) => {
    let oldHypIdx = idxHyp;
    let oldHyp = oldHyps[oldHypIdx];
    if (oldHyp === undefined || oldHyp.identifier !== hyp.identifier) {
      oldHypIdx = oldHyps.findIndex(h => h.identifier === hyp.identifier);
      oldHyp = oldHyps[oldHypIdx];
    }

    if (oldHyp === undefined)
      results.push({
        diff: HypothesisDifference.New,
        expression: hyp.expression,
        identifier: hyp.identifier,
        relation: hyp.relation
      });
    else {
      const diff = text.diffText(oldHyp.expression, hyp.expression);
      results.push({
        diff: diff.different
          ? HypothesisDifference.Changed
          : HypothesisDifference.None,
        expression: diff.text,
        identifier: hyp.identifier,
        relation: hyp.relation
      });
    }
  });
  return results;
}

function diffGoal(oldGoal: Goal, newGoal: Goal): Goal {
  if (oldGoal.id === newGoal.id) return newGoal;
  return {
    hypotheses: diffHypotheses(oldGoal.hypotheses, newGoal.hypotheses),
    goal: text.diffText(oldGoal.goal, newGoal.goal).text,
    id: newGoal.id
  };
}

function diffGoals(oldGoals: Goal[], newGoals: Goal[]): Goal[] {
  if (!newGoals || !oldGoals || oldGoals.length <= 0) return newGoals;

  // console.log(`[${oldGoals.map(g=>g.id).join(',')}] --> [${newGoals.map(g=>g.id).join(',')}]`);
  const results: Goal[] = [];
  const old = oldGoals.filter(
    o => newGoals.findIndex(n => n.id === o.id) === -1
  );
  let oIdx = 0;
  for (let nIdx = 0; nIdx < newGoals.length; ++nIdx) {
    const hyp = newGoals[nIdx];
    let o = oldGoals.findIndex(g => g.id === hyp.id);
    if (o >= 0 || !old[oIdx]) {
      results.push(hyp);
    } else {
      results.push(diffGoal(old[oIdx], hyp));
      ++oIdx;
    }
  }

  // newGoals.forEach((g,idxGoal) => {
  //   if(oldGoals[idxGoal] !== undefined)
  //     results.push(diffGoal(oldGoals[idxGoal], g));
  // })

  return results;
}

type ProofViewNoFocus = {
  goals: Goal[];
  backgroundGoals?: UnfocusedGoalStack;
  shelvedGoals: Goal[];
  abandonedGoals: Goal[];
};
export function diffProofView(
  oldState: ProofViewNoFocus,
  newState: ProofView
): ProofView {
  try {
    return { ...newState, goals: diffGoals(oldState.goals, newState.goals) };
  } catch (err) {
    server.connection.console.error(
      "diffGoals threw an exception: " + err.toString()
    );
    return newState;
  }
}
