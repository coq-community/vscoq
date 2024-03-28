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
open Sexplib.Std
open Printing

module Position = struct

  include Lsp.Types.Position

  type t = [%import: Lsp.Types.Position.t] [@@deriving sexp]
 
  let compare pos1 pos2 =
    match Int.compare pos1.line pos2.line with
    | 0 -> Int.compare pos1.character pos2.character
    | x -> x

  let to_string pos = Format.sprintf "(%i,%i)" pos.line pos.character

end

module Range = struct

  include Lsp.Types.Range

  type t = [%import: Lsp.Types.Range.t] [@@deriving sexp]

  let included ~in_ { start; end_ } =
    let (<=) x y = Position.compare x y <= 0 in
    in_.start <= start && end_ <= in_.end_

  let to_string range = Format.sprintf ("Range (start: %s, end: %s)") (Position.to_string range.start) (Position.to_string range.end_)

end 

module DiagnosticSeverity = struct

  type t = [%import: Lsp.Types.DiagnosticSeverity.t] [@@deriving sexp]

  let yojson_of_t v = Lsp.Types.DiagnosticSeverity.yojson_of_t v
  let t_of_yojson v = Lsp.Types.DiagnosticSeverity.t_of_yojson v

  let of_feedback_level = let open DiagnosticSeverity in function
    | Feedback.Error -> Error
    | Feedback.Warning -> Warning
    | Feedback.(Info | Debug | Notice) -> Information

end

type query_result =
  { id : string;
    name : pp;
    statement : pp;
  } [@@deriving yojson]

type overview = {
  uri : DocumentUri.t;
  preparedRange: Range.t list;
  processingRange : Range.t list;
  processedRange : Range.t list;
} [@@deriving yojson]

type notification =
  | QueryResultNotification of query_result