import * as $ from 'jquery';
import { ProofView, UnfocusedGoalStack, HypothesisDifference, TextDifference, AnnotatedText, ScopedText, Hypothesis, Goal, CommandResult } from './protocol';
import { makeBreakingText } from './ui-util';

function countUnfocusedGoals(u: UnfocusedGoalStack|undefined) : number {
  if(!u)
    return 0;
  return u.before.length + u.after.length + countUnfocusedGoals(u.next);
}

function countAllGoals(state: ProofView): number {
  const result =
    (state.goals ? state.goals.length : 0)
    + countUnfocusedGoals(state.backgroundGoals)
    + (state.abandonedGoals ? state.abandonedGoals.length : 0)
    + (state.shelvedGoals ? state.shelvedGoals.length : 0);
  return result;
}

function getDifferenceClass(diff: HypothesisDifference) {
  switch(diff) {
    case HypothesisDifference.Changed:
      return ' changed';
    case HypothesisDifference.New:
      return ' new';
    case HypothesisDifference.MovedUp:
      return ' movedUp';
    case HypothesisDifference.MovedDown:
      return ' movedDown';
    default:
      return '';
  }
}

function getTextDiffClass(diff?: TextDifference) : string {
  if(diff === "added")
    return 'charsAdded'
  if(diff === "removed")
    return 'charsRemoved'
  else
    return ''
}

function isScopedText(text: AnnotatedText): text is ScopedText {
  return text.hasOwnProperty('scope');
}


let hasSubstitutions = false;

function createAnnotatedText(text: AnnotatedText) : HTMLElement[] {
  function helper(text: AnnotatedText) : (Text | HTMLElement)[] {
    if(typeof text === 'string')
      return makeBreakingText(text)
    else if(text instanceof Array)
      return Array.prototype.concat(...text.map(helper))
    else if(isScopedText(text))
      return text.scope.trim()!== ""
        ? [$('<span>')
          .addClass(text.scope.replace('.', '-'))
          .append(helper(text.text))
          .get(0)]
        : helper(text.text);
    else if(text.substitution) {// TextAnnotation
      hasSubstitutions = true;
      return [$('<span>')
        .addClass('substitution')
        .addClass(getTextDiffClass(text.diff))
        .attr("subst",text.substitution)
        .attr("title",text.text)
        .append(makeBreakingText(text.text))
        .get(0)];
    } else // TextAnnotation
      return [$('<span>')
        .addClass(getTextDiffClass(text.diff))
        .append(makeBreakingText(text.text))
        .get(0)];
  }
  return [$('<span>')
    .addClass('richpp')
    .append(helper(text))
    .get(0)];
}

function onDoubleClickBreakableText(event: JQueryMouseEventObject) {
  // var target = <Element>event.currentTarget;
  if($(event.currentTarget).hasClass('hypothesis')) {
    $(event.currentTarget).toggleClass('breakText');
    $(event.currentTarget).toggleClass('noBreakText');
  }
}


function createHypothesis(hyp: Hypothesis) : JQuery {
  var r = $('<li>')
    .addClass('hypothesis')
    .addClass('breakText')
    .addClass(getDifferenceClass(hyp.diff))
    .append($('<span>').addClass('ident').text(hyp.identifiers.join(',')));
  
  if (hyp.body) {
    r.append(
      [ $('<span>').addClass('rel').text(':=')
      , $('<span>').addClass('expr')
        .append($(createAnnotatedText(hyp.body)))
      ]
    )
  }

  return r.append(
      [ $('<span>').addClass('rel').text(':')
      , $('<span>').addClass('expr')
        .append($(createAnnotatedText(hyp.type)))
      ])
    .on('dblclick', onDoubleClickBreakableText)

}

function createHypotheses(hyps: Hypothesis[]) {
  return $('<ul>')
    .addClass('hypotheses')
    .append(hyps.map((hyp) => createHypothesis(hyp)));
}

function createGoal(goal: Goal, idx:number, count:number) {
  let expr = $('<span>').addClass('expr');
  expr.append($(createAnnotatedText(goal.goal)));
  if (idx == 0) {expr.attr("id", "firstGoal")};
  return $('<li>')
    .addClass('goal')
    .append(
      [ $('<span>').addClass('goalId').text(`${idx+1}/${count}`)
      , $('<span>').addClass('error')
      , expr
      ]);
}

function createFocusedGoals(goals: Goal[]) : JQuery {
  return $('<ul>')
    .addClass('goalsList')
    .append(goals.map((g,i) => createGoal(g,i,goals.length)));
  // return $(goals.map((g,idx) =>
  //   createGoal(g, idx, goals.length)));
}

export class StateModel {

  // private static hypothesesNodeClass = '.hypotheses';
  // private static goalNodeClass = '.goal';
  // private static focusedStateClass = '.focusedState';
  //private focusedState = 0;
  // private coqState : ProofView;


  constructor() {
  }


  private setMessage(message: string) {
    $('#messages').text(message);
  }

  private setErrorMessage(message: AnnotatedText) {
    if(typeof message === 'string')
      $('#error').text(message);
    else {
      $('#error').append($(createAnnotatedText(message)));
    }
  }
  private clearErrorMessage() {
    $('#error').empty();
  }

  public updateState(state: CommandResult) {
    try {
      hasSubstitutions = false;
      //this.focusedState = 0;
      this.clearErrorMessage();
      $('#stdout').text('');

      $('#states').empty();
      if(state.type === 'failure')
        this.setErrorMessage(state.message);
      else if(state.type === 'not-running')
        this.setMessage('Not running.');
      else if(state.type === 'no-proof')
        this.setMessage('Not in proof mode.');
      else if(state.type === 'interrupted')
        this.setMessage("Interrupted.");
      else if(state.type === 'proof-view') {
        if (countAllGoals(state) == 0) {
          this.setMessage("No more subgoals.");
        } else if (state.goals) {
          if(state.goals.length > 0) {
            this.setMessage("");
            $('#states')
            .append(
              [ createHypotheses(state.goals[0].hypotheses)
              , createFocusedGoals(state.goals)
            ])
            var elmnt = document.getElementById("firstGoal");
            elmnt.scrollIntoView({block: "center", inline: "nearest"}); 
          } else {
            this.setMessage("There are unfocused goals.");
          }
        }

      if(hasSubstitutions)
        $('#togglePrettifySymbols').removeClass("hidden")
      else
        $('#togglePrettifySymbols').addClass("hidden")
    }
      //   case 'not-running':
      //     return DisplayState.NotRunning;
      //   case 'no-proof':
      //     return DisplayState.NoProof;
      //   case 'interrupted':
      //     return DisplayState.Interrupted;
      // }

    } catch(err) {
      this.setMessage(err);
    }
  }

}
