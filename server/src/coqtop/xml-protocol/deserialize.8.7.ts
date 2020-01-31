import { CoqProto } from "../../../../lib";
import { AnnotatedText } from "../../util/AnnotatedText";
import { Deserialize, Node, Nodes } from "./deserialize.base";

namespace Nodes_8_7 {
  export interface MessageNode {
    $name: "message";
    $: {};
    $children: {
      [0]: CoqProto.MessageLevel;
      [1]: CoqProto.Location;
      [2]: AnnotatedText;
    } & {}[];
    message_level: CoqProto.MessageLevel;
  }

  export interface MessageFeedbackNode {
    $name: "feedback_content";
    $kind: "message"; // set for type narrowing
    $: { val: "message" };
    $children: {
      [0]: CoqProto.MessageLevel;
      [1]: CoqProto.Location;
      [2]: AnnotatedText;
    } & {}[];
  }

  export interface LtacProfTacticNode {
    $name: "ltacprof_tactic";
    $: {
      name: string;
      total: string;
      local: string;
      ncalls: string;
      max_total: string;
    };
    $children: CoqProto.LtacProfTactic[];
  }

  export type FeedbackContentNode =
    /* 8.6 */
    | MessageFeedbackNode
    /* Base */
    | Nodes.WorkerStatusNode
    | Nodes.FileDependencyNode
    | Nodes.FileLoadedNode
    | Nodes.GlobReferenceNode
    | Nodes.GlobDefinitionNode
    | Nodes.SentenceStatusProcessedNode
    | Nodes.SentenceStatusIncompleteNode
    | Nodes.SentenceStatusCompleteNode
    | Nodes.SentenceStatusProcessingInNode
    | Nodes.CustomFeeedbackNode
    | Nodes.LtacProfFeeedbackNode;

  export type TypedNode =
    /** 8.6 */
    | MessageNode
    | LtacProfTacticNode
    /** Base */
    | Nodes.StateIdNode
    | Nodes.EditIdNode
    | Nodes.IntNode
    | Nodes.StringNode
    | Nodes.UnitNode
    | Nodes.BoolNode
    | Nodes.PairNode
    | Nodes.ListNode
    | Nodes.UnionNode
    | Nodes.OptionNode
    | Nodes.OptionValueNode
    | Nodes.OptionStateNode
    | Nodes.GoalNode
    | Nodes.GoalsNode
    | Nodes.LocationNode
    | Nodes.MessageLevelNode
    | Nodes.LtacProfResultsNode
    | Nodes.FeedbackNode
    | Nodes.FeedbackContentNode
    | Nodes.ValueNode;
}

export class Deserialize_8_7 extends Deserialize {
  public deserialize(v: Node): CoqProto.CoqValue {
    const value = v as Nodes_8_7.TypedNode;
    try {
      switch (value.$name) {
        case "message":
          return {
            level: value.$children[0],
            location: value.$children[1],
            message: value.$children[2]
          } as CoqProto.Message;
        case "ltacprof":
          return {
            total_time: +value.$.total_time,
            tactics: value.$children
          } as CoqProto.LtacProfResults;
        case "ltacprof_tactic":
          return {
            name: value.$.name,
            statistics: {
              total: +value.$.total,
              local: +value.$.local,
              num_calls: +value.$.ncalls,
              max_total: +value.$.max_total
            },
            tactics: value.$children
          } as CoqProto.LtacProfTactic;
        default:
          return super.deserialize(v);
      }
    } catch (err) {
      // debugger;
    }
  }

  // public deserializeFeedbackContent(v: Node) : any {
  //   const value = v as Nodes_8_7.FeedbackContentNode;
  //   switch (value.$kind) {
  //   default:
  //     return super.deserializeFeedbackContent(value);
  //   }
  // }

  public static readonly baseVersion = "8.6";
}
