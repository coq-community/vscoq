(**************************************************************************)
(*                                                                        *)
(*                                 VSRocq                                 *)
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

[%%import "vsrocq_config.mlh"]

open Lsp.Types
open Protocol.LspWrapper
open Protocol.Printing
open Types

let Log log = Log.mk_log "documentManager"

type blocking_error = {
  last_range: Range.t;
  error_range: Range.t
}

type document_state =
| Parsing
| Parsed
(* | Executing of sentence_id TODO: ADD EXEDCUTING STATE
| Executed of sentence_id *)

type state = {
  uri : DocumentUri.t;
  init_vs : Vernacstate.t;
  opts : Coqargs.injection_command list;
  document : Document.document;
  document_state: document_state;
  folding_entries_cache : DocumentEntries.entries option ref;
  feedback_pipe : feedback_pipe;
  pending_feedback : feedback_data list;
  checking_state : CheckingManager.state;
}
type event =
  | ParseBegin
  | DocumentEvent of Document.event
  | InteractionManagerEvent of CheckingManager.event
  | LocalFeedback of feedback_data list

let pp_event fmt = function
  | ParseBegin -> Stdlib.Format.fprintf fmt "ParseBegin"
  | DocumentEvent event -> Stdlib.Format.fprintf fmt "DocumentEvent event: "; Document.pp_event fmt event
  | InteractionManagerEvent event -> Stdlib.Format.fprintf fmt "InteractionManagerEvent event: "; CheckingManager.pp_event fmt event
  | LocalFeedback _ -> Stdlib.Format.fprintf fmt "LocalFeedback"

let inject_im_event x = Sel.Event.map (fun e -> InteractionManagerEvent e) x
let inject_im_events events = List.map inject_im_event events

let inject_doc_event x = Sel.Event.map (fun e -> DocumentEvent e) x
let inject_doc_events events = List.map inject_doc_event events

let mk_parsing_begin_event () =
  Sel.now ~undup:(=) ~priority:PriorityManager.launch_parsing ParseBegin
  
type events = event Sel.Event.t list

let is_parsing st =  st.document_state = Parsing

[%%if lsp < (1,19,0) ]
let message_of_string x = x
[%%else]
let message_of_string x = `String x
[%%endif]

let make_diagnostic doc range oloc message severity code =
  let range =
    match oloc with
    | None -> range
    | Some loc ->
      RawDocument.range_of_loc (Document.raw_document doc) loc
  in
  let code, data =
    match code with
    | None -> None, None
    | Some (x,z) -> Some x, Some z in
  Diagnostic.create ?code ?data ~range ~message:(message_of_string message) ~severity ()

let mk_diag st (id,(lvl,oloc,qf,msg)) =
  let code = 
    match qf with
    | [] -> None
    | qf ->
      let code : Jsonrpc.Id.t * Lsp.Import.Json.t =
        let open Lsp.Import.Json in
        (`String "quickfix-replace",
        qf |> yojson_of_list
        (fun qf ->
            let s = Pp.string_of_ppcmds @@ Quickfix.pp qf in
            let loc = Quickfix.loc qf in
            let range = RawDocument.range_of_loc (Document.raw_document st.document) loc in
            QuickFixData.yojson_of_t (QuickFixData.{range; text = s})
        ))
        in
      Some code
    in
    let lvl = DiagnosticSeverity.of_feedback_level lvl in
    make_diagnostic st.document (Document.range_of_id st.document id) oloc (Pp.string_of_ppcmds msg) lvl code

let mk_error_diag st (id,(oloc,msg,qf)) = (* mk_diag st (id,(Feedback.Error,oloc, msg)) *)
  let code = 
    match qf with
    | None -> None
    | Some qf ->
      let code : Jsonrpc.Id.t * Lsp.Import.Json.t =
        let open Lsp.Import.Json in
        (`String "quickfix-replace",
        qf |> yojson_of_list
        (fun qf ->
            let s = Pp.string_of_ppcmds @@ Quickfix.pp qf in
            let loc = Quickfix.loc qf in
            let range = RawDocument.range_of_loc (Document.raw_document st.document) loc in
            QuickFixData.yojson_of_t (QuickFixData.{range; text = s})
        ))
        in
      Some code
  in
  let lvl = DiagnosticSeverity.of_feedback_level Feedback.Error in
  make_diagnostic st.document (Document.range_of_id st.document id) oloc (Pp.string_of_ppcmds msg) lvl code


let mk_parsing_error_diag st Document.{ msg = (oloc,msg); start; stop; qf } =
  let doc = Document.raw_document st.document in
  let severity = DiagnosticSeverity.Error in
  let start = RawDocument.position_of_loc doc start in
  let end_ = RawDocument.position_of_loc doc stop in
  let range = Range.{ start; end_ } in
  let code = 
    match qf with
    | None -> None
    | Some qf ->
      let code : Jsonrpc.Id.t * Lsp.Import.Json.t =
        let open Lsp.Import.Json in
        (`String "quickfix-replace",
         qf |> yojson_of_list
         (fun qf ->
            let s = Pp.string_of_ppcmds @@ Quickfix.pp qf in
            let loc = Quickfix.loc qf in
            let range = RawDocument.range_of_loc (Document.raw_document st.document) loc in
            QuickFixData.yojson_of_t (QuickFixData.{range; text = s})
        ))
        in
      Some code
  in
  make_diagnostic st.document range oloc (Pp.string_of_ppcmds msg) severity code

let all_diagnostics st =
  let parse_errors = Document.parse_errors st.document in
  let all_exec_errors = Document.all_checking_errors st.document in
  let all_feedback = Document.all_feedback st.document in
  (* we are resilient to a state where invalidate was not called yet *)
  let exists (id,_) = Option.has_some (Document.get_sentence st.document id) in
  let not_info (_, (lvl, _, _, _)) = 
    match lvl with
    | Feedback.Info -> false
    | _ -> true
  in
  let exec_errors = all_exec_errors |> List.filter exists in
  let feedback = all_feedback |> List.filter not_info in
  List.map (mk_parsing_error_diag st) parse_errors @
    List.map (mk_error_diag st) exec_errors @
    List.map (mk_diag st) feedback


let get_info_messages st pos =
  match Option.append
    (Option.bind pos (Document.find_sentence_before_pos st.document) |> Option.map (fun ({ id } : Document.sentence) -> id))
    (CheckingManager.get_observe_id st.checking_state)
  with
  | None -> log (fun () -> "get_messages: Could not find id");[]
  | Some id -> log (fun () -> "get_messages: Found id");
    let info (lvl, _, _, _) = 
      match lvl with
      | Feedback.Info -> true
      | _ -> false
    in
    let feedback = Document.feedback st.document id in
    let feedback = feedback |> List.filter info in
    List.map (fun (lvl,_oloc,_,msg) -> DiagnosticSeverity.of_feedback_level lvl, pp_of_rocqpp msg) feedback


let entries_for_request st =
  if is_parsing st then
    DocumentEntries.entries st.document
  else
    match !(st.folding_entries_cache) with
    | Some entries -> entries
    | None ->
      let entries = DocumentEntries.entries st.document in
      st.folding_entries_cache := Some entries;
      entries

let get_document_proofs st =
  ProverThread.try_run ~doc_id:st.feedback_pipe.doc_id ~name:"get_document_proofs" ~timeout:10.0 (fun () ->
    DocumentEntries.proof_blocks st.document (entries_for_request st))
  |> get_interruptible_result

let get_document_symbols st =
  DocumentEntries.document_symbols (entries_for_request st)

let get_folding_ranges st =
  let folding_ranges = DocumentEntries.folding_ranges (entries_for_request st) in
  log (fun () -> "Folding ranges: " ^ (string_of_int @@ List.length folding_ranges));
  folding_ranges

let get_selection_range (st : state) (pos : Position.t) : SelectionRange.t =
  let document = st.document in
  let sentence = Document.find_sentence_at_pos document pos in
  let document_range = SelectionRange.create ~range:(Document.range_of_document document) () in
  match sentence with
  | None -> document_range
  | Some { id } ->
    let range = Document.range_of_id document id in
    SelectionRange.create ~range ~parent:document_range ()

let get_next_range st pos =
  match Document.find_sentence_before_pos st.document pos with
  | None -> None
  | Some { stop; id } ->
      match Document.find_sentence_after st.document (stop+1) with
      | None -> Some (Document.range_of_id st.document id)
      | Some { id } -> Some (Document.range_of_id st.document id)

let get_previous_range st pos =
  match Document.find_sentence_before_pos st.document pos with
  | None -> None
  | Some { start; id } ->
      match Document.find_sentence_before st.document (start) with
      | None -> Some (Document.range_of_id st.document id)
      | Some { id } -> Some (Document.range_of_id st.document id)

let validate_document state (Document.{unchanged_id; invalid_ids; previous_document; parsed_document}) =
  let state = {state with document=parsed_document; folding_entries_cache = ref None} in
  (* this should be made in Document *)
  let old_schedule = Document.schedule previous_document in
  let rec invalidate_checked id state =
    let checking_state = CheckingManager.invalidate state.checking_state id in
    let document = Document.set_unchecked state.document id in
    let state = { state with document; checking_state } in
    let deps = Scheduler.dependents old_schedule id in
    Stateid.Set.fold invalidate_checked deps state in
  let state = Stateid.Set.fold invalidate_checked invalid_ids state in
  let checking_state = CheckingManager.reset_overview state.checking_state previous_document unchanged_id in
  { state with checking_state; document_state = Parsed }

[%%if rocq ="8.18" || rocq ="8.19" || rocq ="8.20"]
let dirpath_of_top = Coqargs.dirpath_of_top
[%%else]
let dirpath_of_top = Coqinit.dirpath_of_top
[%%endif]

[%%if rocq ="8.18" || rocq ="8.19"]
let start_library ~doc_id uri ~opts init_vs =
  ProverThread.run ~doc_id ~name:"start_library" (fun () -> 
    Vernacstate.unfreeze_full_state init_vs;
    let top = dirpath_of_top (TopPhysical (DocumentUri.to_path uri)) in
    Coqinit.start_library ~top opts;
    Vernacstate.freeze_full_state ()) |> Result.fold ~ok:(fun x -> x) ~error:(fun x -> CErrors.user_err x)
[%%else]
let start_library ~doc_id uri ~opts init_vs =
  ProverThread.run ~doc_id ~name:"start_library" (fun () -> 
    Vernacstate.unfreeze_full_state init_vs;
    let top = dirpath_of_top (TopPhysical (DocumentUri.to_path uri)) in
    let intern = Vernacinterp.fs_intern in
    Coqinit.start_library ~intern ~top opts;
    Vernacstate.freeze_full_state ()) |> Result.fold ~ok:(fun x -> x) ~error:(fun x -> CErrors.user_err x)
[%%endif]

let local_feedback feedback_queue : event Sel.Event.t =
  Sel.On.queue_all ~name:"feedback" ~priority:PriorityManager.feedback feedback_queue
    (fun x xs -> LocalFeedback(x :: xs))

let install_feedback_listener doc_id send =
  Log.feedback_add_feeder_on_Message (fun route span doc lvl loc qf msg ->
    if lvl != Feedback.Debug && doc = doc_id then send (route,span,(lvl,loc, qf, msg)))

let interrupt_execution st = CheckingManager.interrupt_execution st.checking_state

let init_feedback_pipe ~doc_id =
  let sel_feedback_queue = Queue.create () in
  let rocq_feeder = install_feedback_listener doc_id (fun x -> Queue.push x sel_feedback_queue) in
  let feedback = local_feedback sel_feedback_queue in
  let sel_cancellation_handle = Sel.Event.get_cancellation_handle feedback in
  let feedback_pipe = {doc_id;sel_feedback_queue;rocq_feeder;sel_cancellation_handle;} in
  feedback_pipe, feedback

let init init_vs ~opts uri ~text =
  let doc_id = Utilities.fresh_doc_id () in
  let init_vs = start_library ~doc_id uri ~opts init_vs in
  let document = Document.create_document ~doc_id init_vs.Vernacstate.synterp text in
  let feedback_pipe, feedback_event = init_feedback_pipe ~doc_id in
  let checking_state = CheckingManager.init init_vs ~feedback_pipe in
  let parsebegin_event = mk_parsing_begin_event () in
  let state = { uri; opts; init_vs; document; document_state = Parsing; folding_entries_cache = ref None; feedback_pipe; pending_feedback = []; checking_state } in
  state, [parsebegin_event;feedback_event]

let reset { uri; opts; init_vs; document; checking_state; feedback_pipe } =
  Utilities.feedback_pipe_cleanup feedback_pipe;
  let text = RawDocument.text @@ Document.raw_document document in
  let doc_id = Utilities.fresh_doc_id () in
  let document = Document.create_document ~doc_id init_vs.synterp text in
  let feedback_pipe, feedback_event = init_feedback_pipe ~doc_id in
  let checking_state = CheckingManager.reset checking_state init_vs ~feedback_pipe in
  let state = { uri; opts; init_vs; document; checking_state; document_state = Parsing; folding_entries_cache = ref None; feedback_pipe; pending_feedback = [] } in
  let parsebegin_event = mk_parsing_begin_event () in
  state, [parsebegin_event;feedback_event]

let apply_text_edits state edits =
  (* Until we fix https://github.com/rocq-prover/rocq/issues/22041, this should stay commented:
     CheckingManager.interrupt_execution state.checking_state; *)
  let apply_edit_and_shift_diagnostics_locs_and_overview state (range, new_text as edit) =
    let document = Document.apply_text_edit state.document edit in
    let edit_start = RawDocument.loc_of_position (Document.raw_document state.document) range.Range.start in
    let edit_stop = RawDocument.loc_of_position (Document.raw_document state.document) range.Range.end_ in
    let edit_length = edit_stop - edit_start in
    let start = edit_stop in
    let offset = String.length new_text - edit_length in
    let document = Document.shift_feedbacks_and_checking_errors ~start ~offset document in
    let checking_state = CheckingManager.shift_overview state.checking_state ~before:state.document ~after:document ~start:edit_stop ~offset:(String.length new_text - edit_length) in
    {state with checking_state; document; document_state = Parsing; folding_entries_cache = ref None; pending_feedback = []}
  in
  let state = List.fold_left apply_edit_and_shift_diagnostics_locs_and_overview state edits in
  let sel_event = mk_parsing_begin_event () in
  state, [sel_event]

let handle_feedback_event state (_, id, msg) =
  { state with document = Document.append_feedback state.document id msg }

let handle_feedback_events state feedback =
  match state.document_state with
  | Parsing -> { state with pending_feedback = state.pending_feedback @ feedback }
  | Parsed -> List.fold_left handle_feedback_event state feedback

let handle_event ev st =
  match ev with
  | LocalFeedback l ->
     let state = handle_feedback_events st l in
     make_handled_event ~state ~update_view:true ~events:[local_feedback state.feedback_pipe.sel_feedback_queue] ()
  | ParseBegin ->
    let document, events = Document.validate_document st.document in
    let state = {st with document; document_state = Parsing; folding_entries_cache = ref None} in
    let events = inject_doc_events events in
    make_handled_event ~state ~update_view:true ~events ()
  | DocumentEvent ev ->
    let document, events, parsing_end_info = Document.handle_event st.document ev in
    begin match parsing_end_info with
    | None ->
      let state = {st with document} in
      let events = inject_doc_events events in
      make_handled_event ~state ~update_view:false ~events ()
    | Some parsing_end_info ->
      let st = validate_document st parsing_end_info in
      let checking_state, events = CheckingManager.validate_document st.document st.checking_state in
      let state = handle_feedback_events { st with checking_state; pending_feedback = [] } st.pending_feedback in
      make_handled_event ~state ~events:(inject_im_events events) ~update_view:true ()
    end
  | InteractionManagerEvent ev ->
    let updates, he = CheckingManager.handle_event ~uri:st.uri st.document st.checking_state ev in
    let st = { st with document = List.fold_left Document.update_checked st.document updates } in
    lift_handled_event (function None -> Some st | Some checking_state -> Some { st with checking_state })
      inject_im_events he

let rocq_state_for st pos =
  let loc = RawDocument.loc_of_position (Document.raw_document st.document) pos in
  let sentence = Document.find_sentence_before st.document loc in
  let vs = Option.map (fun x -> Utilities.get_vernac_state x.Document.checked) sentence in
  let vs = Option.default st.init_vs @@ Option.flatten vs in
  vs

let print st pos ~pattern =
  let vs = rocq_state_for st pos in
  QueryManager.print ~doc_id:(Document.id st.document) ~vs ~pattern

let search st ~id pos s =
  let vs = rocq_state_for st pos in
  QueryManager.search ~doc_id:(Document.id st.document) ~vs ~id s

let locate st pos ~pattern =
  let vs = rocq_state_for st pos in
  QueryManager.locate ~doc_id:(Document.id st.document) ~vs ~pattern

let check st pos ~pattern =
  let vs = rocq_state_for st pos in
  QueryManager.check ~doc_id:(Document.id st.document) ~vs ~pattern

let jump_to_definition st pos =
  let vs = rocq_state_for st pos in
  QueryManager.jump_to_definition st.document vs pos

let hover st pos =
  QueryManager.hover st.document pos

let highlight st pos =
  QueryManager.highlight st.document pos

let about st pos ~pattern =
  let vs = rocq_state_for st pos in
  QueryManager.about ~doc_id:(Document.id st.document) ~vs ~pattern

let get_completions st pos =
  let vs = rocq_state_for st pos in
  QueryManager.get_completions ~doc_id:(Document.id st.document) ~vs

(* Ignore nested proofs option (lives in STM) instead of failing with
   anomaly when it is set in a .vo we Require.
   cf #1060 *)

let warn_nested_proofs_opt =
  CWarnings.create ~name:"vsrocq-nested-proofs-flag"
    Pp.(fun () -> str "Flag \"Nested Proofs Allowed\" is ignored by VsRocq.")

let () =
  Goptions.declare_bool_option
    { optstage = Summary.Stage.Interp;
      optdepr  = None;
      optkey   = Vernac_classifier.stm_allow_nested_proofs_option_name;
      optread  = (fun () -> false);
      optwrite = (fun b -> if b then warn_nested_proofs_opt ()) }


let interpret_to_position pos =
  CheckingManager.interpret_to_position pos |> inject_im_events

let interpret_to_previous () = CheckingManager.interpret_to_previous () |> inject_im_events
let interpret_to_next () = CheckingManager.interpret_to_next () |> inject_im_events
let interpret_to_end () = CheckingManager.interpret_to_end () |> inject_im_events

let interpret_in_background st =
  let checking_state, events =
    CheckingManager.interpret_in_background st.document st.checking_state in
  {st with checking_state}, inject_im_events events

let executed_ranges st =
  CheckingManager.executed_ranges st.document st.checking_state

let observe_id_range st = CheckingManager.observe_id_range st.document st.checking_state

let get_messages st id = CheckingManager.get_messages st.document id
let reset_to_top st =
  { st with checking_state = CheckingManager.reset_to_top st.checking_state }

module Internal = struct
          
  let document st = st.document

  let get_proof st id = CheckingManager.Internal.get_proof st.document st.checking_state id
          
  let raw_document st = 
    Document.raw_document st.document

  let observe_id st = CheckingManager.get_observe_id st.checking_state

  let folding_entries st = !(st.folding_entries_cache)

  let validate_document st parsing_end_info = validate_document st parsing_end_info

  let is_locally_executed st id =
    match Document.get_sentence st.document id with
    | Some { checked = Some (Success (Some _) | Failure (_,_,Some _)) } -> true
    | _ -> false

  let string_of_state st =
    let code_lines_by_id = Document.code_lines_sorted_by_loc st.document in
    let code_lines_by_end = Document.code_lines_by_end_sorted_by_loc st.document in
    let string_of_state id =
      if is_locally_executed st id then "(executed)"
      else if CheckingManager.Internal.is_remotely_executed st.checking_state id then "(executed in worker)"
      else "(not executed)"
    in
    let string_of_item item =
      Document.Internal.string_of_item item ^ " " ^
        match item with
        | Sentence { id } -> string_of_state id
        | ParsingError _ -> "(error)"
        | Comment _ -> "(comment)"
    in
    let string_by_id = String.concat "\n" @@ List.map string_of_item code_lines_by_id in
    let string_by_end = String.concat "\n" @@ List.map string_of_item code_lines_by_end in
    String.concat "\n" ["Document using sentences_by_id map\n"; string_by_id; "\nDocument using sentences_by_end map\n"; string_by_end]
    let inject_doc_events = inject_doc_events

end
