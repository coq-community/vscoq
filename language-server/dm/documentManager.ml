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

type state = {
  uri : DocumentUri.t;
  init_vs : Vernacstate.t;
  opts : Coqargs.injection_command list;
  document : Document.document;
  execution_state : ExecutionManager.state;
  observe_id : Types.sentence_id option;
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

type exec_overview = {
  processing : Range.t list;
  processed : Range.t list;
}

let merge_ranges doc (r1,l) r2 =
  let loc1 = RawDocument.loc_of_position doc r1.Range.end_ in
  let loc2 = RawDocument.loc_of_position doc r2.Range.start in
  if RawDocument.only_whitespace_between doc (loc1+1) (loc2-1) then
    Range.{ start = r1.Range.start; end_ = r2.Range.end_ }, l
  else
    r2, r1 :: l

let compress_sorted_ranges doc = function
  | [] -> []
  | range :: tl ->
    let r, l = List.fold_left (merge_ranges doc) (range,[]) tl in
    r :: l

let compress_ranges doc ranges =
  let ranges = List.sort (fun { Range.start = s1 } { Range.start = s2 } -> Position.compare s1 s2) ranges in
  compress_sorted_ranges doc ranges

let executed_ranges doc execution_state loc =
  let ranges_of l =
    compress_ranges (Document.raw_document doc) @@ List.map (Document.range_of_id doc) l
  in
  let ids_before_loc = List.map (fun s -> s.Document.id) @@ Document.sentences_before doc loc in
  let processed_ids = List.filter (fun x -> ExecutionManager.is_executed execution_state x || ExecutionManager.is_remotely_executed execution_state x) ids_before_loc in
  log @@ Printf.sprintf "highlight: processed: %s" (String.concat " " (List.map Stateid.to_string processed_ids));
  { 
    processing = [];
    processed = ranges_of processed_ids; 
  }

let executed_ranges st =
  let loc = match Option.bind st.observe_id (Document.get_sentence st.document) with
  | None -> 0
  | Some { stop } -> stop
  in
  executed_ranges st.document st.execution_state loc

let observe_id_range st = 
  let doc = Document.raw_document st.document in
  match Option.bind st.observe_id (Document.get_sentence st.document) with 
    | None -> None
    | Some { start; stop} -> 
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

let get_messages st pos =
  match Option.cata (id_of_pos st) st.observe_id pos with
  | None -> log "get_messages: Could not find id";[]
  | Some id -> log "get_messages: Found id";
    let error = ExecutionManager.error st.execution_state id in
    let feedback = ExecutionManager.feedback st.execution_state id in
    let feedback = List.map (fun (lvl,_oloc,msg) -> DiagnosticSeverity.of_feedback_level lvl, pp_of_coqpp msg) feedback  in
    match error with
    | Some (_oloc,msg) -> (DiagnosticSeverity.Error, pp_of_coqpp msg) :: feedback
    | None -> feedback

let interpret_to ~skip_proofs ~stateful ~background state id : (state * event Sel.Event.t list) =
  match Document.get_sentence state.document id with
  | None -> (state, []) (* TODO error? *)
  | Some { id } ->
    let state = if stateful then { state with observe_id = Some id } else state in
    let vst_for_next_todo, todo = ExecutionManager.build_tasks_for ~skip_proofs (Document.schedule state.document) state.execution_state id in
    if CList.is_empty todo then
      (state, [])
    else
      let priority = if background then None else Some PriorityManager.execution in
      let event = Sel.now ?priority (Execute {id; vst_for_next_todo; todo; started = Unix.gettimeofday (); background }) in
      (state, [ event ])

let interpret_to_position ~skip_proofs ~stateful st pos =
  match id_of_pos st pos with
  | None -> (st, []) (* document is empty *)
  | Some id -> interpret_to ~skip_proofs ~stateful ~background:false st id

let interpret_to_previous ~skip_proofs st =
  match st.observe_id with
  | None -> (st, [])
  | Some oid ->
    match Document.get_sentence st.document oid with
    | None -> (st, []) (* TODO error? *)
    | Some { start } ->
      match Document.find_sentence_before st.document start with
      | None -> 
        Vernacstate.unfreeze_full_state st.init_vs; 
        { st with observe_id=None}, []
      | Some { id } -> interpret_to ~skip_proofs ~stateful:true ~background:false st id 

let interpret_to_next ~skip_proofs st =
  match st.observe_id with
  | None -> 
    begin match Document.get_first_sentence st.document with
    | None -> (st, []) (*The document is empty*)
    | Some {id} -> interpret_to ~skip_proofs ~stateful:true ~background:false st id
    end
  | Some id ->
    match Document.get_sentence st.document id with
    | None -> (st, []) (* TODO error? *)
    | Some { stop } ->
      match Document.find_sentence_after st.document (stop+1) with
      | None -> (st, [])
      | Some {id } -> interpret_to ~skip_proofs ~stateful:true ~background:false st id

let interpret_to_end ~skip_proofs st =
  match Document.get_last_sentence st.document with 
  | None -> (st, [])
  | Some {id} -> log ("interpret_to_end id = " ^ Stateid.to_string id); interpret_to ~skip_proofs ~stateful:true ~background:false st id

let interpret_in_background st =
  match Document.get_last_sentence st.document with 
  | None -> (st, [])
  | Some {id} -> log ("interpret_to_end id = " ^ Stateid.to_string id); interpret_to ~skip_proofs:false ~stateful:true ~background:true st id

let is_above st id1 id2 =
  let range1 = Document.range_of_id st id1 in
  let range2 = Document.range_of_id st id2 in
  Position.compare range1.start range2.start < 0

let validate_document state =
  let unchanged_id, invalid_roots, document = Document.validate_document state.document in
  let observe_id = match unchanged_id, state.observe_id with
    | None, _ | _, None -> None
    | Some id, Some id' -> if is_above state.document id id' then Some id else Some id'
  in
  let execution_state =
    List.fold_left (fun st id ->
      ExecutionManager.invalidate (Document.schedule state.document) id st
      ) state.execution_state (Stateid.Set.elements invalid_roots) in
  { state with document; execution_state; observe_id }

let init init_vs ~opts uri ~text =
  Vernacstate.unfreeze_full_state init_vs;
  let top = Coqargs.(dirpath_of_top (TopPhysical (DocumentUri.to_path uri))) in
  Coqinit.start_library ~top opts;
  let init_vs = Vernacstate.freeze_full_state () in 
  let document = Document.create_document init_vs.Vernacstate.synterp text in
  let execution_state, feedback = ExecutionManager.init init_vs in
  let st = { uri; opts; init_vs; document; execution_state; observe_id = None } in
  validate_document st, [inject_em_event feedback]

let reset { uri; opts; init_vs; document; execution_state } =
  let text = RawDocument.text @@ Document.raw_document document in
  Vernacstate.unfreeze_full_state init_vs;
  let document = Document.create_document init_vs.synterp text in
  ExecutionManager.destroy execution_state;
  let execution_state, feedback = ExecutionManager.init init_vs in
  let st = { uri; opts; init_vs; document; execution_state; observe_id = None } in
  validate_document st, [inject_em_event feedback]

let apply_text_edits state edits =
  let document = Document.apply_text_edits state.document edits in
  let shift_diagnostics_locs exec_st (range, new_text) =
    let edit_start = RawDocument.loc_of_position (Document.raw_document state.document) range.Range.start in
    let edit_stop = RawDocument.loc_of_position (Document.raw_document state.document) range.Range.end_ in
    let edit_length = edit_stop - edit_start in
    ExecutionManager.shift_diagnostics_locs exec_st ~start:edit_stop ~offset:(String.length new_text - edit_length)
  in
  let execution_state = List.fold_left shift_diagnostics_locs state.execution_state edits in
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
    (Some {st with execution_state}, inject_em_events events @ [event])
  | ExecutionManagerEvent ev ->
    let execution_state_update, events = ExecutionManager.handle_event ev st.execution_state in
    (Option.map (fun execution_state -> {st with execution_state}) execution_state_update, inject_em_events events)

let get_proof st diff_mode pos =
  let previous_st id =
    let oid = fst @@ Scheduler.task_for_sentence (Document.schedule st.document) id in
    Option.bind oid (ExecutionManager.get_vernac_state st.execution_state)
  in
  let oid = Option.cata (id_of_pos st) st.observe_id pos in
  let ost = Option.bind oid (ExecutionManager.get_vernac_state st.execution_state) in
  let previous = Option.bind oid previous_st in
  Option.bind ost (ProofState.get_proof ~previous diff_mode)

let get_context st pos =
  match id_of_pos st pos with
  | None -> Some (ExecutionManager.get_initial_context st.execution_state)
  | Some id -> ExecutionManager.get_context st.execution_state id

let get_completions st pos =
  match id_of_pos st pos with
  | None -> Error ("Can't get completions, no sentence found before the cursor")
  | Some id ->
    let ost = ExecutionManager.get_vernac_state st.execution_state id in
    let settings = ExecutionManager.get_options () in
    match Option.bind ost @@ CompletionSuggester.get_completions settings.completion_options with
    | None -> Error ("Can't get completions")
    | Some lemmas -> Ok (lemmas)

let parse_entry st pos entry pattern =
  let pa = Pcoq.Parsable.make (Gramlib.Stream.of_string pattern) in
  let st = match Document.find_sentence_before st.document pos with
  | None -> st.init_vs.Vernacstate.synterp.parsing
  | Some { synterp_state } -> synterp_state.Vernacstate.Synterp.parsing
  in
  Vernacstate.Parser.parse st entry pa

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

let hover st pos = 
  let opattern = RawDocument.word_at_position (Document.raw_document st.document) pos in
  match opattern with
  | None -> log "hover: no word found at cursor"; None
  | Some pattern ->
    log ("hover: found word at cursor: " ^ pattern);
    let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
    match get_context st pos with 
    | None -> log "hover: no context found"; None
    | Some (sigma, env) ->
      try
        let ref_or_by_not = parse_entry st loc (Pcoq.Prim.smart_global) pattern in
        Language.Hover.get_hover_contents env sigma ref_or_by_not
      with e ->
        let e, info = Exninfo.capture e in
        log ("Exception while handling hover: " ^ (Pp.string_of_ppcmds @@ CErrors.iprint (e, info)));
        None

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

let locate st pos ~pattern = 
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match parse_entry st loc (Pcoq.Prim.smart_global) pattern with
  | { v = AN qid } -> Ok (pp_of_coqpp @@ Prettyp.print_located_qualid qid)
  | { v = ByNotation (ntn, sc)} -> 
    match get_context st pos with
    | None -> Error("No context found")
    | Some (sigma, env) -> 
      Ok( pp_of_coqpp @@ Notation.locate_notation
        (Constrextern.without_symbols (Printer.pr_glob_constr_env env sigma)) ntn sc)

let print st pos ~pattern = 
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  match get_context st pos with 
  | None -> Error("No context found")
  | Some (sigma, env) -> 
    let qid = parse_entry st loc (Pcoq.Prim.smart_global) pattern in
    let udecl = None in (*TODO*)
    Ok ( pp_of_coqpp @@ Prettyp.print_name env sigma qid udecl )

module Internal = struct

  let document st =
    st.document

  let raw_document st = 
    Document.raw_document st.document

  let execution_state st =
    st.execution_state

  let observe_id st =
    st.observe_id

  let validate_document st =
    validate_document st

  let string_of_state st =
    let sentences = Document.sentences_sorted_by_loc st.document in
    let string_of_state id =
      if ExecutionManager.is_executed st.execution_state id then "(executed)"
      else if ExecutionManager.is_remotely_executed st.execution_state id then "(executed in worker)"
      else "(not executed)"
    in
    let string_of_sentence sentence =
      Document.Internal.string_of_sentence sentence ^ " " ^ string_of_state sentence.id
    in
    String.concat "\n" @@ List.map string_of_sentence sentences

end
