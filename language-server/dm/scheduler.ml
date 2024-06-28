(**************************************************************************)
(*                                                                        *)
(*                                 VSCoq                                  *)
(*                                                                        *)
(*                   Copyright INRIA and contributors                     *)
(*       (see version control and README file for authors & dates)        *)
(*                                                                        *)
(**************************************************************************)
(*                                                                        *)
(*   This file is distributed under the terms of the MIT License.         *)
(*   See LICENSE file.                                                    *)
(*                                                                        *)
(**************************************************************************)

open Types

let Log log = Log.mk_log "scheduler"

module SM = CMap.Make (Stateid)

type error_recovery_strategy =
  | RSkip
  | RAdmitted

type executable_sentence = {
  id : sentence_id;
  ast : Synterp.vernac_control_entry;
  classif : Vernacextend.vernac_classification;
  synterp : Vernacstate.Synterp.t;
  error_recovery : error_recovery_strategy;
}

type task =
  | Skip of { id: sentence_id; error: Pp.t option }
  | Exec of executable_sentence
  | OpaqueProof of { terminator: executable_sentence;
                     opener_id: sentence_id;
                     proof_using: Vernacexpr.section_subset_expr;
                     tasks : executable_sentence list; (* non empty list *)
                   }
  | Query of executable_sentence

(*
  | SubProof of ast list
  | ModuleWithSignature of ast list
*)


type proof_block = {
  proof_sentences : executable_sentence list;
  opener_id : sentence_id;
}

type state = {
  document_scope : sentence_id list; (* List of sentences whose effect scope is the document that follows them *)
  proof_blocks : proof_block list; (* List of sentences whose effect scope ends with the Qed *)
  section_depth : int; (* Statically computed section nesting *)
}

let initial_state = {
  document_scope = [];
  proof_blocks = [];
  section_depth = 0;
}

type schedule = {
  tasks : (sentence_id option * task) SM.t;
  dependencies : Stateid.Set.t SM.t;
}

let initial_schedule = {
  tasks = SM.empty;
  dependencies = SM.empty;
}

let push_executable_proof_sentence ex_sentence block =
  { block with proof_sentences = ex_sentence :: block.proof_sentences }

let push_ex_sentence ex_sentence st =
  match st.proof_blocks with
  | [] -> { st with document_scope = ex_sentence.id :: st.document_scope }
  | l::q -> { st with proof_blocks = push_executable_proof_sentence ex_sentence l :: q }

(* Not sure what the base_id for nested lemmas should be, e.g.
Lemma foo : X.
Proof.
Definition x := True.
intros ...
Lemma bar : Y. <- What should the base_id be for this command? -> 83
*)
let base_id st =
  let rec aux = function
  | [] -> (match st.document_scope with hd :: _ -> Some hd | [] -> None)
  | block :: l ->
    begin match block.proof_sentences with
    | [] -> aux l
    | ex_sentence :: _ -> Some ex_sentence.id
    end
  in
  aux st.proof_blocks

let open_proof_block ex_sentence st =
  let st = push_ex_sentence ex_sentence st in
  let block = { proof_sentences = []; opener_id = ex_sentence.id } in
  { st with proof_blocks = block :: st.proof_blocks }

let extrude_side_effect ex_sentence st =
  let document_scope = ex_sentence.id :: st.document_scope in
  let proof_blocks = List.map (push_executable_proof_sentence ex_sentence) st.proof_blocks in
  { st with document_scope; proof_blocks }

let flatten_proof_block st =
  match st.proof_blocks with
  | [] -> st
  | [block] ->
    let document_scope = CList.uniquize @@ List.map (fun x -> x.id) block.proof_sentences @ st.document_scope in
    { st with document_scope; proof_blocks = [] }
  | block1 :: block2 :: tl -> (* Nested proofs. TODO check if we want to extrude one level or directly to document scope *)
    let proof_sentences = CList.uniquize @@ block1.proof_sentences @ block2.proof_sentences in
    let block2 = { block2 with proof_sentences } in
    { st with proof_blocks = block2 :: tl }

(*
[1] Lemma foo : XX.
[2] Proof.
[3] Definition y := True.
[4] Lemma bar : y.
[5] Proof.
[6] exact I.
[7] Qed.

[8] apply bar.

[9] Qed.

-> We don't delegate

8: Exec(127, Qed)
2: Exec(1, Lemma foo : XX)

--> We delegate only pure proofs
*)

(* FIXME handle commands with side effects followed by `Abort` *)

let find_proof_using (ast : Synterp.vernac_control_entry) =
  match ast.CAst.v.expr with
  | VernacSynPure(VernacProof(_,Some e)) -> Some e
  | _ -> log "no ast for proof using, looking at a default";
         Proof_using.get_default_proof_using ()

(* TODO: There is also a #[using] annotation on the proof opener we should
   take into account (but it is not on a proof sentence, but rather
   on the proof opener). Ask maxime if the attribute is processed during
   synterp, and if so where its value is stored. *)
let find_proof_using_annotation { proof_sentences } =
  match List.rev proof_sentences with
  | ex_sentence :: _ -> find_proof_using ex_sentence.ast
  | _ -> None



let is_opaque_flat_proof terminator section_depth block =
  let open Vernacextend in
  let has_side_effect { classif } = match classif with
    | VtStartProof _ | VtSideff _ | VtQed _ | VtProofMode _ | VtMeta -> true
    | VtProofStep _ | VtQuery -> false
  in
  if List.exists has_side_effect block.proof_sentences then None
  else match terminator with
  | VtDrop -> Some Vernacexpr.SsEmpty
  | VtKeep VtKeepDefined -> None
  | VtKeep (VtKeepAxiom | VtKeepOpaque) ->
      if section_depth = 0 then Some Vernacexpr.SsEmpty
      else find_proof_using_annotation block

let push_state id ast synterp classif st =
  let open Vernacextend in
  let ex_sentence = { id; ast; classif; synterp; error_recovery = RSkip } in
  match classif with
  | VtStartProof _ ->
    base_id st, open_proof_block ex_sentence st, Exec ex_sentence
  | VtQed terminator_type ->
    log "scheduling a qed";
    begin match st.proof_blocks with
    | [] -> (* can happen on ill-formed documents *)
      base_id st, push_ex_sentence ex_sentence st, Exec ex_sentence
    | block :: pop ->
      (* TODO do not delegate if command with side effect inside the proof or nested lemmas *)
      match is_opaque_flat_proof terminator_type st.section_depth block with
      | Some proof_using ->
        log "opaque proof";
        let terminator = { ex_sentence with error_recovery = RAdmitted } in
        let tasks = List.rev block.proof_sentences in
        let st = { st with proof_blocks = pop } in
        base_id st, push_ex_sentence ex_sentence st, OpaqueProof { terminator; opener_id = block.opener_id; tasks; proof_using }
      | None ->
        log "not an opaque proof";
        let st = flatten_proof_block st in
        base_id st, push_ex_sentence ex_sentence st, Exec ex_sentence
    end
  | VtQuery -> (* queries have no impact, we don't push them *)
    base_id st, st, Query ex_sentence
  | VtProofStep _ ->
    base_id st, push_ex_sentence ex_sentence st, Exec ex_sentence
  | VtSideff _ ->
    base_id st, extrude_side_effect ex_sentence st, Exec ex_sentence
  | VtMeta -> base_id st, push_ex_sentence ex_sentence st, Skip { id; error = Some (Pp.str "Unsupported command") }
  | VtProofMode _ -> base_id st, push_ex_sentence ex_sentence st, Skip { id; error = Some (Pp.str "Unsupported command") }

let string_of_task (task_id,(base_id,task)) =
  let s = match task with
  | Skip { id } -> Format.sprintf "Skip %s" (Stateid.to_string id)
  | Exec { id } -> Format.sprintf "Exec %s" (Stateid.to_string id)
  | OpaqueProof { terminator; tasks } -> Format.sprintf "OpaqueProof [%s | %s]" (Stateid.to_string terminator.id) (String.concat "," (List.map (fun task -> Stateid.to_string task.id) tasks))
  | Query { id } -> Format.sprintf "Query %s" (Stateid.to_string id)
  in
  Format.sprintf "[%s] : [%s] -> %s" (Stateid.to_string task_id) (Option.cata Stateid.to_string "init" base_id) s

let _string_of_state st =
  let scopes = (List.map (fun b -> List.map (fun x -> x.id) b.proof_sentences) st.proof_blocks) @ [st.document_scope] in
  String.concat "|" (List.map (fun l -> String.concat " " (List.map Stateid.to_string l)) scopes)

let schedule_sentence (id, (ast, classif, synterp_st)) st schedule =
  let base, st, task = 
      let open Vernacexpr in
      let (base, st, task) = push_state id ast synterp_st classif st in
      begin match ast.CAst.v.expr with
      | VernacSynterp (EVernacBeginSection _) ->
        (base, { st with section_depth = st.section_depth + 1 }, task)
      | VernacSynterp (EVernacEndSegment _) ->
        (base, { st with section_depth = max 0 (st.section_depth - 1) }, task)
      | _ -> (base, st, task)
      end
  in
(*
  log @@ "Scheduled " ^ (Stateid.to_string id) ^ " based on " ^ (match base with Some id -> Stateid.to_string id | None -> "no state");
  log @@ "New scheduler state: " ^ string_of_state st;
  *)
  let tasks = SM.add id (base, task) schedule.tasks in
  let add_dep deps x id =
    let upd = function
    | Some deps -> Some (Stateid.Set.add id deps)
    | None -> Some (Stateid.Set.singleton id)
    in
    SM.update x upd deps
  in
  let dependencies = Option.cata (fun x -> add_dep schedule.dependencies x id) schedule.dependencies base in
  (* This new sentence impacts no sentence (yet) *)
  let dependencies = SM.add id Stateid.Set.empty dependencies in
  st, { tasks; dependencies }

let task_for_sentence schedule id =
  match SM.find_opt id schedule.tasks with
  | Some x -> x
  | None -> CErrors.anomaly Pp.(str "cannot find schedule for sentence " ++ Stateid.print id)

let dependents schedule id =
  match SM.find_opt id schedule.dependencies with
  | Some x -> x
  | None -> CErrors.anomaly Pp.(str "cannot find dependents for sentence " ++ Stateid.print id)

(** Dependency computation algo *)
(*
{}
1. Definition y := ...
{{1}}
2. Lemma x : T.
{{},{1,2}}
3. Proof using v.
{{3},{1,2}}
4. tac1.
{{3,4},{1,2}}
5. Definition f := Type.
{{3,4,5},{1,2,5}}
6. Defined.    ||     6. Qed.
{{1,2,3,4,5,6}}  ||     {{1,2,5,6}}
7. Check x.
*)

let string_of_schedule schedule =
  "Task\n" ^
  String.concat "\n" @@ List.map string_of_task @@ SM.bindings schedule.tasks
