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

open Lsp.Types
open Protocol
open Protocol.LspWrapper
open Protocol.Printing
open Types

let Log log = Log.mk_log "documentManager"

type observe_id = Id of Types.sentence_id | Top

let to_sentence_id = function
| Top -> None
| Id id -> Some id

(* let observe_id_to_string = function
| Top -> "Top"
| Id id -> Stateid.to_string id *)

type state = {
  uri : DocumentUri.t;
  init_vs : Vernacstate.t;
  opts : Coqargs.injection_command list;
  document : Document.document;
  execution_state : ExecutionManager.state;
  observe_id : observe_id option;
}

type event =
  | Execute of { (* we split the computation to help interruptibility *)
      id : Types.sentence_id; (* sentence of interest *)
      vst_for_next_todo : Vernacstate.t; (* the state to be used for the next
        todo, it is not necessarily the state of the last sentence, since it
        may have failed and this is a surrogate used for error resiliancy *)
      todo : ExecutionManager.prepared_task list;
      started : float; (* time *)
      background: bool; (* Just to re-set execution priorities later down the loop *)
    }
  | ExecutionManagerEvent of ExecutionManager.event
let pp_event fmt = function
  | Execute { id; todo; started; _ } ->
      let time = Unix.gettimeofday () -. started in 
      Stdlib.Format.fprintf fmt "ExecuteToLoc %d (%d tasks left, started %2.3f ago)" (Stateid.to_int id) (List.length todo) time
  | ExecutionManagerEvent _ -> Stdlib.Format.fprintf fmt "ExecutionManagerEvent"

let inject_em_event x = Sel.Event.map (fun e -> ExecutionManagerEvent e) x
let inject_em_events events = List.map inject_em_event events

type events = event Sel.Event.t list

(* let prepare_overview st id =
  match Document.get_sentence st.document id with
  | None -> st (*Can't find the sentence, just return the state as is*)
  | Some { id } ->
    (* Sentence already executed, no need to prepare*)
    if ExecutionManager.is_executed st.execution_state id then
      st
    else
      (* Create the correct prepared range *)
      begin match st.observe_id with
      | None -> st (* No observe_id means continuous mode, no need to do anything*)
      | Some Top ->
        (* Create range from first sentence to id *)
        let range = Document.range_of_id_with_blank_space st.document id in
        let start = Position.create ~character:0 ~line:0 in
        let range = Range.create ~end_: range.end_ ~start: start in
        let prepared = [range] in
        let execution_state = ExecutionManager.prepare_overview st.execution_state prepared in
        {st with execution_state}
      | Some (Id o_id) ->
        (* Create range from o_id to id*)
        let o_range = Document.range_of_id_with_blank_space st.document o_id in
        let range = Document.range_of_id_with_blank_space st.document id in
        if Position.compare o_range.end_ range.end_ < 0 then
          let range = Range.create ~end_: range.end_ ~start: o_range.end_ in
          let prepared = [range] in
          let execution_state = ExecutionManager.prepare_overview st.execution_state prepared in
          {st with execution_state}
        else
          st
    end *)

let executed_ranges st =
  match st.observe_id with
  | None -> ExecutionManager.overview st.execution_state
  | Some Top -> empty_overview
  | Some (Id id) ->
      let range = Document.range_of_id st.document id in
      ExecutionManager.overview_until_range st.execution_state range

let observe_id_range st = 
  let doc = Document.raw_document st.document in
  match st.observe_id with
    | None -> None
    | Some Top -> None
    | Some (Id id) -> match Document.get_sentence st.document id with
      | None -> failwith "observe_id does not exist"
      | Some { start; stop } ->
      let start = RawDocument.position_of_loc doc start in 
      let end_ = RawDocument.position_of_loc doc stop in 
      let range = Range.{ start; end_ } in 
      Some range

let make_diagnostic doc range oloc message severity =
  let range =
    match oloc with
    | None -> range
    | Some loc ->
      RawDocument.range_of_loc (Document.raw_document doc) loc
  in
  Diagnostic.create ~range ~message ~severity ()

let mk_diag st (id,(lvl,oloc,msg)) =
  let lvl = DiagnosticSeverity.of_feedback_level lvl in
  make_diagnostic st.document (Document.range_of_id st.document id) oloc (Pp.string_of_ppcmds msg) lvl

let mk_error_diag st (id,(oloc,msg)) = mk_diag st (id,(Feedback.Error,oloc, msg))

let mk_parsing_error_diag st Document.{ msg = (oloc,msg); start; stop } =
  let doc = Document.raw_document st.document in
  let severity = DiagnosticSeverity.Error in
  let start = RawDocument.position_of_loc doc start in
  let end_ = RawDocument.position_of_loc doc stop in
  let range = Range.{ start; end_ } in
  make_diagnostic st.document range oloc msg severity

let all_diagnostics st =
  let parse_errors = Document.parse_errors st.document in
  let all_exec_errors = ExecutionManager.all_errors st.execution_state in
  let all_feedback = ExecutionManager.all_feedback st.execution_state in
  (* we are resilient to a state where invalidate was not called yet *)
  let exists (id,_) = Option.has_some (Document.get_sentence st.document id) in
  let exec_errors = all_exec_errors |> List.filter exists in
  let feedback = all_feedback |> List.filter exists in
  List.map (mk_parsing_error_diag st) parse_errors @
    List.map (mk_error_diag st) exec_errors @
    List.map (mk_diag st) feedback

let id_of_pos st pos =
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match Document.find_sentence_before st.document loc with
  | None -> None
  | Some { id } -> Some id

let id_of_pos_opt st = function
  | None -> begin match st.observe_id with None | Some Top  -> None | Some Id id -> Some id end
  | Some pos -> id_of_pos st pos

let get_messages st pos =
  match id_of_pos_opt st pos with
  | None -> log "get_messages: Could not find id";[]
  | Some id -> log "get_messages: Found id";
    let error = ExecutionManager.error st.execution_state id in
    let feedback = ExecutionManager.feedback st.execution_state id in
    let feedback = List.map (fun (lvl,_oloc,msg) -> DiagnosticSeverity.of_feedback_level lvl, pp_of_coqpp msg) feedback  in
    match error with
    | Some (_oloc,msg) -> (DiagnosticSeverity.Error, pp_of_coqpp msg) :: feedback
    | None -> feedback

let observe ~background state id : (state * event Sel.Event.t list) =
  match Document.get_sentence state.document id with
  | None -> (state, []) (* TODO error? *)
  | Some {id } ->
    let vst_for_next_todo, todo, execution_state = ExecutionManager.build_tasks_for state.document (Document.schedule state.document) state.execution_state id in
    if CList.is_empty todo then
      ({state with execution_state}, [])
    else
      let priority = if background then None else Some PriorityManager.execution in
      let event = Sel.now ?priority (Execute {id; vst_for_next_todo; todo; started = Unix.gettimeofday (); background }) in
      ({state with execution_state}, [ event ] )

let clear_observe_id st = 
  { st with observe_id = None }

let reset_to_top st =
  { st with observe_id = Some Top }

let interpret_to st id =
  let observe_id = if st.observe_id = None then None else (Some (Id id)) in
  let st = { st with observe_id} in
  observe ~background:false st id

let interpret_to_position st pos =
  match id_of_pos st pos with
  | None -> (st, []) (* document is empty *)
  | Some id -> interpret_to st id

let get_next_range st pos =
  match id_of_pos st pos with
  | None -> None
  | Some id ->
    match Document.get_sentence st.document id with
    | None -> None
    | Some { stop } ->
      match Document.find_sentence_after st.document (stop+1) with
      | None -> Some (Document.range_of_id st.document id)
      | Some { id } -> Some (Document.range_of_id st.document id)

let get_previous_range st pos =
  match id_of_pos st pos with
  | None -> None
  | Some id ->
    match Document.get_sentence st.document id with
    | None -> None
    | Some { start } ->
      match Document.find_sentence_before st.document (start) with
      | None -> Some (Document.range_of_id st.document id)
      | Some { id } -> Some (Document.range_of_id st.document id)

let interpret_to_previous st =
  match st.observe_id with
  | None -> failwith "interpret to previous with no observe_id"
  | Some Top -> (st, [])
  | Some (Id id) ->
    match Document.get_sentence st.document id with
    | None -> (st, []) (* TODO error? *)
    | Some { start } ->
      match Document.find_sentence_before st.document start with
      | None -> 
        Vernacstate.unfreeze_full_state st.init_vs; 
        { st with observe_id=(Some Top)}, []
      | Some { id } -> interpret_to st id

let interpret_to_next st =
  match st.observe_id with
  | None -> failwith "interpret to next with no observe_id"
  | Some Top ->
    begin match Document.get_first_sentence st.document with
    | None -> (st, []) (*The document is empty*)
    | Some {id} -> interpret_to st id
    end
  | Some (Id id) ->
    match Document.get_sentence st.document id with
    | None -> (st, []) (* TODO error? *)
    | Some { stop } ->
      match Document.find_sentence_after st.document (stop+1) with
      | None -> (st, [])
      | Some {id } -> interpret_to st id

let interpret_to_end st =
  match Document.get_last_sentence st.document with
  | None -> (st, [])
  | Some {id} -> log ("interpret_to_end id = " ^ Stateid.to_string id); interpret_to st id

let interpret_in_background st =
  match Document.get_last_sentence st.document with
  | None -> (st, [])
  | Some {id} -> log ("interpret_to_end id = " ^ Stateid.to_string id); observe ~background:true st id

let is_above st id1 id2 =
  let range1 = Document.range_of_id st id1 in
  let range2 = Document.range_of_id st id2 in
  Position.compare range1.start range2.start < 0

let validate_document state =
  let unchanged_id, invalid_roots, document = Document.validate_document state.document in
  let observe_id = match unchanged_id, state.observe_id with
    | _, None -> None
    | None, Some (Id _) -> None
    | _, Some Top -> Some Top
    | Some id, Some (Id id') -> if is_above state.document id id' then Some (Id id) else state.observe_id
  in
  let execution_state =
    List.fold_left (fun st id ->
      ExecutionManager.invalidate state.document (Document.schedule state.document) id st
      ) state.execution_state (Stateid.Set.elements invalid_roots) in
  { state with document; execution_state; observe_id }

[%%if coq = "8.18" || coq = "8.19"]
let start_library top opts = Coqinit.start_library ~top opts
[%%else]
let start_library top opts =
  let intern = Vernacinterp.fs_intern in
  Coqinit.start_library ~intern ~top opts;
[%%endif]

let init init_vs ~opts uri ~text observe_id =
  Vernacstate.unfreeze_full_state init_vs;
  let top = try Coqargs.(dirpath_of_top (TopPhysical (DocumentUri.to_path uri))) with
    e -> raise e
  in
  start_library top opts;
  let init_vs = Vernacstate.freeze_full_state () in
  let document = Document.create_document init_vs.Vernacstate.synterp text in
  let execution_state, feedback = ExecutionManager.init init_vs in
  let st = { uri; opts; init_vs; document; execution_state; observe_id } in
  validate_document st, [inject_em_event feedback]

let reset { uri; opts; init_vs; document; execution_state; observe_id } =
  let text = RawDocument.text @@ Document.raw_document document in
  Vernacstate.unfreeze_full_state init_vs;
  let document = Document.create_document init_vs.synterp text in
  ExecutionManager.destroy execution_state;
  let execution_state, feedback = ExecutionManager.init init_vs in
  let observe_id = if observe_id = None then None else (Some Top) in
  let st = { uri; opts; init_vs; document; execution_state; observe_id } in
  validate_document st, [inject_em_event feedback]

let apply_text_edits state edits =
  let document = Document.apply_text_edits state.document edits in
  let shift_diagnostics_locs_and_overview exec_st (range, new_text) =
    let edit_start = RawDocument.loc_of_position (Document.raw_document state.document) range.Range.start in
    let edit_stop = RawDocument.loc_of_position (Document.raw_document state.document) range.Range.end_ in
    let edit_length = edit_stop - edit_start in
    let exec_st = ExecutionManager.shift_diagnostics_locs exec_st ~start:edit_stop ~offset:(String.length new_text - edit_length) in
    ExecutionManager.shift_overview exec_st (Document.raw_document state.document) ~start:edit_stop ~offset:(String.length new_text - edit_length)
  in
  let execution_state = List.fold_left shift_diagnostics_locs_and_overview state.execution_state edits in
  validate_document { state with document; execution_state }

let handle_event ev st =
  match ev with
  | Execute { id; todo = []; started } -> (* the vst_for_next_todo is also in st.execution_state *)
    let time = Unix.gettimeofday () -. started in
    log (Printf.sprintf "ExecuteToLoc %d ends after %2.3f" (Stateid.to_int id) time);
    (* We update the state to trigger a publication of diagnostics *)
    (Some st, [])
  | Execute { id; vst_for_next_todo; started; todo = task :: todo; background } ->
    (*log "Execute (more tasks)";*)
    let (execution_state,vst_for_next_todo,events,_interrupted) =
      ExecutionManager.execute st.execution_state (vst_for_next_todo, [], false) task in
    (* We do not update the state here because we may have received feedback while
       executing *)
    let priority = if background then None else Some PriorityManager.execution in
    let event = Sel.now ?priority (Execute {id; vst_for_next_todo; todo; started; background }) in
    let execution_state = ExecutionManager.update_overview task todo execution_state st.document in
    (Some {st with execution_state}, inject_em_events events @ [event])
  | ExecutionManagerEvent ev ->
    let id, execution_state_update, events = ExecutionManager.handle_event ev st.execution_state in
    let st = 
      match (id, execution_state_update) with
      | Some id, Some exec_st ->
        let execution_state = ExecutionManager.update_processed id exec_st st.document in
        Some {st with execution_state}
      | Some id, None ->
        let execution_state = ExecutionManager.update_processed id st.execution_state st.document in
        Some {st with execution_state}
      | _, _ -> Option.map (fun execution_state -> {st with execution_state}) execution_state_update
    in
    (st, inject_em_events events)

let get_proof st diff_mode pos =
  let previous_st id =
    let oid = fst @@ Scheduler.task_for_sentence (Document.schedule st.document) id in
    Option.bind oid (ExecutionManager.get_vernac_state st.execution_state)
  in
  let observe_id = 
    match st.observe_id with
    | None -> None
    | Some observe_id -> to_sentence_id observe_id 
  in
  let oid = Option.cata (id_of_pos st) observe_id pos in
  let ost = Option.bind oid (ExecutionManager.get_vernac_state st.execution_state) in
  let previous = Option.bind oid previous_st in
  Option.bind ost (ProofState.get_proof ~previous diff_mode)

let context_of_id st = function
  | None -> Some (ExecutionManager.get_initial_context st.execution_state)
  | Some id -> ExecutionManager.get_context st.execution_state id

(** Get context at the start of the sentence containing [pos] *)
let get_context st pos = context_of_id st (id_of_pos st pos)

let get_completions st pos =
  match id_of_pos st pos with
  | None -> Error ("Can't get completions, no sentence found before the cursor")
  | Some id ->
    let ost = ExecutionManager.get_vernac_state st.execution_state id in
    let settings = ExecutionManager.get_options () in
    match Option.bind ost @@ CompletionSuggester.get_completions settings.completion_options with
    | None -> Error ("Can't get completions")
    | Some lemmas -> Ok (lemmas)

[%%if coq = "8.18" || coq = "8.19"]
let parse_entry st pos entry pattern =
  let pa = Pcoq.Parsable.make (Gramlib.Stream.of_string pattern) in
  let st = match Document.find_sentence_before st.document pos with
  | None -> st.init_vs.Vernacstate.synterp.parsing
  | Some { synterp_state } -> synterp_state.Vernacstate.Synterp.parsing
  in
  Vernacstate.Parser.parse st entry pa
[%%else]
let parse_entry st pos entry pattern =
  let pa = Pcoq.Parsable.make (Gramlib.Stream.of_string pattern) in
  let st = match Document.find_sentence_before st.document pos with
  | None -> Vernacstate.(Synterp.parsing st.init_vs.synterp)
  | Some { synterp_state } -> Vernacstate.Synterp.parsing synterp_state
  in  
  Pcoq.unfreeze st;
  Pcoq.Entry.parse entry pa
[%%endif]

let about st pos ~pattern =
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match get_context st pos with
  | None -> Error ("No context found") (*TODO execute *)
  | Some (sigma, env) ->
    try
      let ref_or_by_not = parse_entry st loc (Pcoq.Prim.smart_global) pattern in
      let udecl = None (* TODO? *) in
      Ok (pp_of_coqpp @@ Prettyp.print_about env sigma ref_or_by_not udecl)
    with e ->
      let e, info = Exninfo.capture e in
      Error (Pp.string_of_ppcmds @@ CErrors.iprint (e, info))

let search st ~id pos pattern =
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match get_context st pos with
  | None -> [] (* TODO execute? *)
  | Some (sigma, env) ->
    let query, r = parse_entry st loc (G_vernac.search_queries) pattern in
    SearchQuery.interp_search ~id env sigma query r

(** Try to generate hover text from [pattern] the context of the given [sentence] *)
let hover_of_sentence st loc pattern sentence = 
  match context_of_id st (Option.map (fun ({ id; _ }: Document.sentence) -> id) sentence) with
  | None -> log "hover: no context found"; None
  | Some (sigma, env) ->
    try
      let ref_or_by_not = parse_entry st loc (Pcoq.Prim.smart_global) pattern in
      Language.Hover.get_hover_contents env sigma ref_or_by_not
    with e ->
      let e, info = Exninfo.capture e in
      log ("Exception while handling hover: " ^ (Pp.string_of_ppcmds @@ CErrors.iprint (e, info)));
      None

let hover st pos =
  (* Tries to get hover at three difference places:
     - At the start of the current sentence
     - At the start of the next sentence (for symbols defined in the current sentence)
       e.g. Definition, Inductive
     - At the next QED (for symbols defined after proof), if the next sentence 
       is in proof mode e.g. Lemmas, Definition with tactics *)
  let opattern = RawDocument.word_at_position (Document.raw_document st.document) pos in
  match opattern with
  | None -> log "hover: no word found at cursor"; None
  | Some pattern ->
    log ("hover: found word at cursor: " ^ pattern);
    let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
    (* hover at previous sentence *)
    match hover_of_sentence st loc pattern (Document.find_sentence_before st.document loc) with
    | Some _ as x -> x
    | None -> 
    match Document.find_sentence_after st.document loc with
    | None -> None (* Skip if no next sentence *)
    | Some sentence as opt ->
    (* hover at next sentence *)
    match hover_of_sentence st loc pattern opt with
    | Some _ as x -> x
    | None -> 
    match sentence.ast.classification with
    (* next sentence in proof mode, hover at qed *)
    | VtProofStep _ | VtStartProof _ -> 
        hover_of_sentence st loc pattern (Document.find_next_qed st.document loc)
    | _ -> None

let check st pos ~pattern =
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match get_context st pos with
  | None -> Error ("No context found") (*TODO execute *)
  | Some (sigma,env) ->
    let rc = parse_entry st loc Pcoq.Constr.lconstr pattern in
    try
      let redexpr = None in
      Ok (pp_of_coqpp @@ Vernacentries.check_may_eval env sigma redexpr rc)
    with e ->
      let e, info = Exninfo.capture e in
      Error (Pp.string_of_ppcmds @@ CErrors.iprint (e, info))

[%%if coq = "8.18" || coq = "8.19"]
let print_located_qualid _ qid = Prettyp.print_located_qualid qid
[%%else]
let print_located_qualid = Prettyp.print_located_qualid
[%%endif]

let locate st pos ~pattern = 
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match get_context st pos with
  | None -> Error ("No context found") (*TODO execute *)
  | Some (sigma, env) ->
    match parse_entry st loc (Pcoq.Prim.smart_global) pattern with
    | { v = AN qid } -> Ok (pp_of_coqpp @@ print_located_qualid env qid)
    | { v = ByNotation (ntn, sc)} ->
      Ok( pp_of_coqpp @@ Notation.locate_notation
        (Constrextern.without_symbols (Printer.pr_glob_constr_env env sigma)) ntn sc)

[%%if coq = "8.18" || coq = "8.19"]
let print st pos ~pattern = 
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match get_context st pos with
  | None -> Error("No context found")
  | Some (sigma, env) ->
    let qid = parse_entry st loc (Pcoq.Prim.smart_global) pattern in
    let udecl = None in (*TODO*)
    Ok ( pp_of_coqpp @@ Prettyp.print_name env sigma qid udecl )
[%%else]
let print st pos ~pattern =
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match get_context st pos with
  | None -> Error("No context found")
  | Some (sigma, env) ->
    let qid = parse_entry st loc (Pcoq.Prim.smart_global) pattern in
    let udecl = None in (*TODO*)
    let access = Library.indirect_accessor[@@warning "-3"] in
    Ok ( pp_of_coqpp @@ Prettyp.print_name access env sigma qid udecl )
[%%endif]
    

module Internal = struct

  let document st =
    st.document

  let raw_document st = 
    Document.raw_document st.document

  let execution_state st =
    st.execution_state

  let observe_id st =
    match st.observe_id with
    | None | Some Top -> None
    | Some (Id id) -> Some id

  let validate_document st =
    validate_document st

  let string_of_state st =
    let code_lines = Document.code_lines_sorted_by_loc st.document in
    let string_of_state id =
      if ExecutionManager.is_executed st.execution_state id then "(executed)"
      else if ExecutionManager.is_remotely_executed st.execution_state id then "(executed in worker)"
      else "(not executed)"
    in
    let string_of_item item =
      Document.Internal.string_of_item item ^ " " ^
        match item with
        | Sentence { id } -> string_of_state id
        | ParsingError _ -> "(error)"
        | Comment _ -> "(comment)"
    in
    String.concat "\n" @@ List.map string_of_item code_lines

end
