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
open Gramlib
open Types
open Lsp.Types
open Scheduler

let Log log = Log.mk_log "document"

module LM = Map.Make (Int)

module SM = Map.Make (Stateid)

type parsed_ast = {
  ast: Synterp.vernac_control_entry;
  classification: Vernacextend.vernac_classification;
  tokens: Tok.t list
}

type pre_sentence = {
  parsing_start : int;
  start : int;
  stop : int;
  synterp_state : Vernacstate.Synterp.t; (* synterp state after this sentence's synterp phase *)
  ast : parsed_ast;
}

(* Example:                        *)
(* "  Check 3. "                   *)
(* ^  ^       ^---- end            *)
(* |  |------------ start          *)
(* |---------------- parsing_start *)
type sentence = {
  parsing_start : int;
  start : int;
  stop : int;
  synterp_state : Vernacstate.Synterp.t; (* synterp state after this sentence's synterp phase *)
  scheduler_state_before : Scheduler.state;
  scheduler_state_after : Scheduler.state;
  ast : parsed_ast;
  id : sentence_id;
}

type comment = {
  start: int;
  stop: int;
  content: string;
}

type parsing_error = {
  start: int;
  stop: int;
  msg: string Loc.located;
  qf: Quickfix.t list option;
}

type document = {
  sentences_by_id : sentence SM.t;
  sentences_by_end : sentence LM.t;
  parsing_errors_by_end : parsing_error LM.t;
  comments_by_end : comment LM.t;
  schedule : Scheduler.schedule;
  parsed_loc : int;
  raw_doc : RawDocument.t;
  init_synterp_state : Vernacstate.Synterp.t;
}

let schedule doc = doc.schedule

let raw_document doc = doc.raw_doc

let range_of_sentence raw (sentence : sentence) =
  let start = RawDocument.position_of_loc raw sentence.start in
  let end_ = RawDocument.position_of_loc raw sentence.stop in
  Range.{ start; end_ }

let range_of_sentence_with_blank_space raw (sentence : sentence) =
  let start = RawDocument.position_of_loc raw sentence.parsing_start in
  let end_ = RawDocument.position_of_loc raw sentence.stop in
  Range.{ start; end_ }

let range_of_id document id =
  match SM.find_opt id document.sentences_by_id with
  | None -> CErrors.anomaly Pp.(str"Trying to get range of non-existing sentence " ++ Stateid.print id)
  | Some sentence -> range_of_sentence document.raw_doc sentence

let range_of_id_with_blank_space document id =
  match SM.find_opt id document.sentences_by_id with
  | None -> CErrors.anomaly Pp.(str"Trying to get range of non-existing sentence " ++ Stateid.print id)
  | Some sentence -> range_of_sentence_with_blank_space document.raw_doc sentence

let parse_errors parsed =
  List.map snd (LM.bindings parsed.parsing_errors_by_end)

let add_sentence parsed parsing_start start stop (ast: parsed_ast) synterp_state scheduler_state_before =
  let id = Stateid.fresh () in
  let ast' = (ast.ast, ast.classification, synterp_state) in
  let scheduler_state_after, schedule =
    Scheduler.schedule_sentence (id, ast') scheduler_state_before parsed.schedule
  in
  (* FIXME may invalidate scheduler_state_XXX for following sentences -> propagate? *)
  let sentence = { parsing_start; start; stop; ast; id; synterp_state; scheduler_state_before; scheduler_state_after } in
  { parsed with sentences_by_end = LM.add stop sentence parsed.sentences_by_end;
    sentences_by_id = SM.add id sentence parsed.sentences_by_id;
    schedule
  }, scheduler_state_after

let remove_sentence parsed id =
  match SM.find_opt id parsed.sentences_by_id with
  | None -> parsed
  | Some sentence ->
    let sentences_by_id = SM.remove id parsed.sentences_by_id in
    let sentences_by_end = LM.remove sentence.stop parsed.sentences_by_end in
    (* TODO clean up the schedule and free cached states *)
    { parsed with sentences_by_id; sentences_by_end; }

let sentences parsed =
  List.map snd @@ SM.bindings parsed.sentences_by_id
  
type code_line =
  | Sentence of sentence
  | ParsingError of parsing_error
  | Comment of comment
  
let start_of_code_line = function
  | Sentence { start = x } -> x
  | ParsingError  { start = x } -> x
  | Comment { start = x } -> x

let compare_code_line x y =
  let s1 = start_of_code_line x in
  let s2 = start_of_code_line y in
  s1 - s2

let code_lines_sorted_by_loc parsed =
  List.sort compare_code_line @@ List.concat [
    (List.map (fun (_,x) -> Sentence x) @@ SM.bindings parsed.sentences_by_id) ;
    (List.map (fun (_,x) -> ParsingError x) @@ LM.bindings parsed.parsing_errors_by_end) ;
    []  (* todo comments *)
   ]

let sentences_sorted_by_loc parsed =
  List.sort (fun ({start = s1} : sentence) {start = s2} -> s1 - s2) @@ List.map snd @@ SM.bindings parsed.sentences_by_id

let sentences_before parsed loc =
  let (before,ov,_after) = LM.split loc parsed.sentences_by_end in
  let before = Option.cata (fun v -> LM.add loc v before) before ov in
  List.map (fun (_id,s) -> s) @@ LM.bindings before

let sentences_after parsed loc =
  let (_before,ov,after) = LM.split loc parsed.sentences_by_end in
  let after = Option.cata (fun v -> LM.add loc v after) after ov in
  List.map (fun (_id,s) -> s) @@ LM.bindings after

let parsing_errors_before parsed loc =
  LM.filter (fun stop _v -> stop <= loc) parsed.parsing_errors_by_end

let comments_before parsed loc =
  LM.filter (fun stop _v -> stop <= loc) parsed.comments_by_end
let get_sentence parsed id =
  SM.find_opt id parsed.sentences_by_id

let find_sentence parsed loc =
  match LM.find_first_opt (fun k -> loc <= k) parsed.sentences_by_end with
  | Some (_, sentence) when sentence.start <= loc -> Some sentence
  | _ -> None

let find_sentence_before parsed loc =
  match LM.find_last_opt (fun k -> k <= loc) parsed.sentences_by_end with
  | Some (_, sentence) -> Some sentence
  | _ -> None

let find_sentence_strictly_before parsed loc =
  match LM.find_last_opt (fun k -> k < loc) parsed.sentences_by_end with
  | Some (_, sentence) -> Some sentence
  | _ -> None

let find_sentence_after parsed loc = 
  match LM.find_first_opt (fun k -> loc <= k) parsed.sentences_by_end with
  | Some (_, sentence) -> Some sentence
  | _ -> None

let find_next_qed parsed loc =
  let exception Found of sentence in
  let f k sentence =
    if loc <= k then
    match sentence.ast.classification with
    | VtQed _ -> raise (Found sentence)
    | _ -> () in
  (* We can't use find_first since f isn't monotone *)
  match LM.iter f parsed.sentences_by_end with
  | () -> None
  | exception (Found n) -> Some n

let get_first_sentence parsed = 
  Option.map snd @@ LM.find_first_opt (fun _ -> true) parsed.sentences_by_end

let get_last_sentence parsed = 
  Option.map snd @@ LM.find_last_opt (fun _ -> true) parsed.sentences_by_end

let state_after_sentence parsed = function
  | Some (stop, { synterp_state; scheduler_state_after }) ->
    (stop, synterp_state, scheduler_state_after)
  | None -> (-1, parsed.init_synterp_state, Scheduler.initial_state)

let state_at_pos parsed pos =
  state_after_sentence parsed @@
    LM.find_last_opt (fun stop -> stop <= pos) parsed.sentences_by_end

let state_strictly_before parsed pos =
  state_after_sentence parsed @@
    LM.find_last_opt (fun stop -> stop < pos) parsed.sentences_by_end

let pos_at_end parsed =
  match LM.max_binding_opt parsed.sentences_by_end with
  | Some (stop, _) -> stop
  | None -> -1

let patch_sentence parsed scheduler_state_before id ({ parsing_start; ast; start; stop; synterp_state } : pre_sentence) =
  log @@ "Patching sentence " ^ Stateid.to_string id;
  let old_sentence = SM.find id parsed.sentences_by_id in
  let scheduler_state_after, schedule =
    let ast = (ast.ast, ast.classification, synterp_state) in
    Scheduler.schedule_sentence (id,ast) scheduler_state_before parsed.schedule
  in
  let new_sentence = { old_sentence with ast; parsing_start; start; stop; scheduler_state_before; scheduler_state_after } in
  let sentences_by_id = SM.add id new_sentence parsed.sentences_by_id in
  let sentences_by_end = LM.remove old_sentence.stop parsed.sentences_by_end in
  let sentences_by_end = LM.add new_sentence.stop new_sentence sentences_by_end in
  { parsed with sentences_by_end; sentences_by_id; schedule }, scheduler_state_after

type diff =
  | Deleted of sentence_id list
  | Added of pre_sentence list
  | Equal of (sentence_id * pre_sentence) list

let same_tokens (s1 : sentence) (s2 : pre_sentence) =
    CList.equal Tok.equal s1.ast.tokens s2.ast.tokens

(* TODO improve diff strategy (insertions,etc) *)
let rec diff old_sentences new_sentences =
  match old_sentences, new_sentences with
  | [], [] -> []
  | [], new_sentences -> [Added new_sentences]
  | old_sentences, [] -> [Deleted (List.map (fun s -> s.id) old_sentences)]
    (* FIXME something special should be done when `Deleted` is applied to a parsing effect *)
  | old_sentence::old_sentences, new_sentence::new_sentences ->
    if same_tokens old_sentence new_sentence then
      Equal [(old_sentence.id,new_sentence)] :: diff old_sentences new_sentences
    else Deleted [old_sentence.id] :: Added [new_sentence] :: diff old_sentences new_sentences

let string_of_parsed_ast { tokens } = 
  (* TODO implement printer for vernac_entry *)
  "[" ^ String.concat "--" (List.map (Tok.extract_string false) tokens) ^ "]" 

let string_of_diff_item doc = function
  | Deleted ids ->
       ids |> List.map (fun id -> Printf.sprintf "- (id: %d) %s" (Stateid.to_int id) (string_of_parsed_ast (Option.get (get_sentence doc id)).ast))
  | Added sentences ->
       sentences |> List.map (fun (s : pre_sentence) -> Printf.sprintf "+ %s" (string_of_parsed_ast s.ast))
  | Equal l ->
       l |> List.map (fun (id, (s : pre_sentence)) -> Printf.sprintf "= (id: %d) %s" (Stateid.to_int id) (string_of_parsed_ast s.ast))

let string_of_diff doc l =
  String.concat "\n" (List.flatten (List.map (string_of_diff_item doc) l))

let rec stream_tok n_tok acc str begin_line begin_char =
  let e = LStream.next (Pcoq.get_keyword_state ()) str in
  if Tok.(equal e EOI) then
    List.rev acc
  else
    stream_tok (n_tok+1) (e::acc) str begin_line begin_char

    (*
let parse_one_sentence stream ~st =
  let pa = Pcoq.Parsable.make stream in
  Vernacstate.Parser.parse st (Pvernac.main_entry (Some (Vernacinterp.get_default_proof_mode ()))) pa
  (* FIXME: handle proof mode correctly *)
  *)


[%%if coq = "8.18" || coq = "8.19"]
let parse_one_sentence stream ~st =
  Vernacstate.Synterp.unfreeze st;
  let entry = Pvernac.main_entry (Some (Synterp.get_default_proof_mode ())) in
  let pa = Pcoq.Parsable.make stream in
  let sentence = Pcoq.Entry.parse entry pa in
  (sentence, [])
[%%else]
let parse_one_sentence stream ~st =
  Vernacstate.Synterp.unfreeze st;
  Flags.record_comments := true;
  let entry = Pvernac.main_entry (Some (Synterp.get_default_proof_mode ())) in
  let pa = Pcoq.Parsable.make stream in
  let sentence = Pcoq.Entry.parse entry pa in
  let comments = Pcoq.Parsable.comments pa in
  (sentence, comments)
[%%endif]

let rec junk_sentence_end stream =
  match Stream.npeek () 2 stream with
  | ['.'; (' ' | '\t' | '\n' |'\r')] -> Stream.junk () stream
  | [] -> ()
  | _ ->  Stream.junk () stream; junk_sentence_end stream

[%%if coq = "8.18"]
exception E = Stream.Error
[%%else]
exception E = Grammar.Error
[%%endif]

[%%if coq = "8.18" || coq = "8.19"]
let get_loc_from_info_or_exn e info =
  match e with
  | Synterp.UnmappedLibrary (_, qid) -> qid.loc
  | Synterp.NotFoundLibrary (_, qid) -> qid.loc
  | _ -> Loc.get_loc @@ info
[%%else]
let get_loc_from_info_or_exn _ info =
  Loc.get_loc info

(* let get_qf_from_info info = Quickfix.get_qf info *)
[%%endif]

[%%if coq = "8.18" || coq = "8.19"]
let get_entry ast = Synterp.synterp_control ast
[%%else]
let get_entry ast =
  let intern = Vernacinterp.fs_intern in
  Synterp.synterp_control ~intern ast
[%%endif]


let rec parse_more synterp_state stream raw parsed parsed_comments errors =
  let handle_parse_error start msg qf =
    log @@ "handling parse error at " ^ string_of_int start;
    let stop = Stream.count stream in
    let parsing_error = { msg; start; stop; qf} in
    let errors = parsing_error :: errors in
    parse_more synterp_state stream raw parsed parsed_comments errors
  in
  let start = Stream.count stream in
  log @@ "Start of parse is: " ^ (string_of_int start);
  begin
    (* FIXME should we save lexer state? *)
    match parse_one_sentence stream ~st:synterp_state with
    | None, _ (* EOI *) -> List.rev parsed, errors, List.rev parsed_comments
    | Some ast, comments ->
      let stop = Stream.count stream in
      log @@ "Parsed: " ^ (Pp.string_of_ppcmds @@ Ppvernac.pr_vernac ast);
      let begin_line, begin_char, end_char =
              match ast.loc with
              | Some lc -> lc.line_nb, lc.bp, lc.ep
              | None -> assert false
      in
      let str = String.sub (RawDocument.text raw) begin_char (end_char - begin_char) in
      let sstr = Stream.of_string str in
      let lex = CLexer.Lexer.tok_func sstr in
      let tokens = stream_tok 0 [] lex begin_line begin_char in
      begin
        try
          let entry = get_entry ast in
          let classification = Vernac_classifier.classify_vernac ast in
          let synterp_state = Vernacstate.Synterp.freeze () in
          let sentence = { parsing_start = start; ast = { ast = entry; classification; tokens }; start = begin_char; stop; synterp_state } in
          let parsed = sentence :: parsed in
          let comments = List.map (fun ((start, stop), content) -> {start; stop; content}) comments in
          let parsed_comments = List.append comments parsed_comments in
          parse_more synterp_state stream raw parsed parsed_comments errors
        with exn ->
          let e, info = Exninfo.capture exn in
          let loc = get_loc_from_info_or_exn e info in
          let qf = Result.value ~default:[] @@ Quickfix.from_exception e in
          handle_parse_error start (loc, Pp.string_of_ppcmds @@ CErrors.iprint_no_report (e,info)) (Some qf)
        end
    | exception (E msg as exn) ->
      let loc = Loc.get_loc @@ Exninfo.info exn in
      let qf = Result.value ~default:[] @@ Quickfix.from_exception exn in
      junk_sentence_end stream;
      handle_parse_error start (loc,msg) (Some qf)
    | exception (CLexer.Error.E e as exn) -> (* May be more problematic to handle for the diff *)
      let loc = Loc.get_loc @@ Exninfo.info exn in
      let qf = Result.value ~default:[] @@ Quickfix.from_exception exn in
      junk_sentence_end stream;
      handle_parse_error start (loc,CLexer.Error.to_string e) (Some qf)
    | exception exn ->
      let e, info = Exninfo.capture exn in
      let loc = Loc.get_loc @@ info in
      let qf = Result.value ~default:[] @@ Quickfix.from_exception exn in
      junk_sentence_end stream;
      handle_parse_error start (loc, "Unexpected parse error: " ^ Pp.string_of_ppcmds @@ CErrors.iprint_no_report (e,info)) (Some qf)
  end

let parse_more synterp_state stream raw =
  parse_more synterp_state stream raw [] [] []

let rec unchanged_id id = function
  | [] -> id
  | Equal s :: diffs ->
    unchanged_id (List.fold_left (fun _ (id,_) -> Some id) id s) diffs
  | (Added _ | Deleted _) :: _ -> id

let invalidate top_edit top_id parsed_doc new_sentences =
  let rec invalidate_diff parsed_doc scheduler_state invalid_ids = function
    | [] -> invalid_ids, parsed_doc
    | Equal s :: diffs ->
      let patch_sentence (parsed_doc,scheduler_state) (id,new_s) =
        patch_sentence parsed_doc scheduler_state id new_s
      in
      let parsed_doc, scheduler_state = List.fold_left patch_sentence (parsed_doc, scheduler_state) s in
      invalidate_diff parsed_doc scheduler_state invalid_ids diffs
    | Deleted ids :: diffs ->
      let invalid_ids = List.fold_left (fun ids id -> Stateid.Set.add id ids) invalid_ids ids in
      let parsed_doc = List.fold_left remove_sentence parsed_doc ids in
      (* FIXME update scheduler state, maybe invalidate after diff zone *)
      invalidate_diff parsed_doc scheduler_state invalid_ids diffs
    | Added new_sentences :: diffs ->
    (* FIXME could have side effect on the following, unchanged sentences *)
      let add_sentence (parsed_doc,scheduler_state) ({ parsing_start; start; stop; ast; synterp_state } : pre_sentence) =
        add_sentence parsed_doc parsing_start start stop ast synterp_state scheduler_state
      in
      let parsed_doc, scheduler_state = List.fold_left add_sentence (parsed_doc,scheduler_state) new_sentences in
      invalidate_diff parsed_doc scheduler_state invalid_ids diffs
  in
  let (_,_synterp_state,scheduler_state) = state_at_pos parsed_doc top_edit in
  let old_sentences = sentences_after parsed_doc top_edit in
  let diff = diff old_sentences new_sentences in
  let unchanged_id = unchanged_id top_id diff in
  log @@ "diff:\n" ^ string_of_diff parsed_doc diff;
  let invalid_ids, doc = invalidate_diff parsed_doc scheduler_state Stateid.Set.empty diff in
  unchanged_id, invalid_ids, doc

(** Validate document when raw text has changed *)
let validate_document ({ parsed_loc; raw_doc; } as document) =
  (* We take the state strictly before parsed_loc to cover the case when the
  end of the sentence is editted *)
  let (stop, synterp_state, _scheduler_state) = state_strictly_before document parsed_loc in
  (* let top_id = find_sentence_strictly_before document parsed_loc with None -> Top | Some sentence -> Id sentence.id in *)
  let top_id = Option.map (fun sentence -> sentence.id) (find_sentence_strictly_before document parsed_loc) in
  let text = RawDocument.text raw_doc in
  let stream = Stream.of_string text in
  while Stream.count stream < stop do Stream.junk () stream done;
  log @@ Format.sprintf "Parsing more from pos %i" stop;
  let errors = parsing_errors_before document stop in
  let comments = comments_before document stop in
  let new_sentences, new_errors, new_comments = parse_more synterp_state stream raw_doc (* TODO invalidate first *) in
  log @@ Format.sprintf "%i new sentences" (List.length new_sentences);
  log @@ Format.sprintf "%i new comments" (List.length new_comments);
  let unchanged_id, invalid_ids, document = invalidate (stop+1) top_id document new_sentences in
  let parsing_errors_by_end =
    List.fold_left (fun acc (error : parsing_error) -> LM.add error.stop error acc) errors new_errors
  in
  let comments_by_end =
    List.fold_left (fun acc (comment : comment) -> LM.add comment.stop comment acc) comments new_comments
  in
  let parsed_loc = pos_at_end document in
  unchanged_id, invalid_ids, { document with parsed_loc; parsing_errors_by_end; comments_by_end}

let create_document init_synterp_state text =
  let raw_doc = RawDocument.create text in
    { parsed_loc = -1;
      raw_doc;
      sentences_by_id = SM.empty;
      sentences_by_end = LM.empty;
      parsing_errors_by_end = LM.empty;
      comments_by_end = LM.empty;
      schedule = initial_schedule;
      init_synterp_state;
    }

let apply_text_edit document edit =
  let raw_doc, start = RawDocument.apply_text_edit document.raw_doc edit in
  let parsed_loc = min document.parsed_loc start in
  { document with raw_doc; parsed_loc }

let apply_text_edits document edits =
  let doc' = { document with raw_doc = document.raw_doc } in
  List.fold_left apply_text_edit doc' edits

module Internal = struct

  let string_of_sentence sentence =
    Format.sprintf "[%s] %s (%i -> %i)" (Stateid.to_string sentence.id)
    (string_of_parsed_ast sentence.ast)
    sentence.start
    sentence.stop

  let string_of_error error =
    let (_, str) = error.msg in
    Format.sprintf "[parsing error] [%s] (%i -> %i)"
    str
    error.start
    error.stop

  let string_of_item = function
    | Sentence sentence -> string_of_sentence sentence
    | Comment _ -> "(* comment *)"
    | ParsingError error -> string_of_error error
  
end
