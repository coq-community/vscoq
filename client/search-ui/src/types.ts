import { integer } from "vscode-languageclient";

import { PpString } from "pp-display";

type Nullable<T> = T | null;

export enum QueryType {
    search = "search", 
    about = "about", 
    check = "check",
    locate = "locate", 
    print = "print"
}
export interface QueryResultBase {
    statement: Nullable<PpString>;
}
export interface SearchResult extends QueryResultBase {
    name: PpString;
}
export interface CollapsibleSearchResult extends SearchResult {
    collapsed: boolean;
}
export interface SearchResultType {
    type: QueryType.search;
    data : CollapsibleSearchResult[]
};
export interface SearchNotification extends SearchResult {
    id: string; 
};
export interface QueryNotification extends QueryResultBase {
    id: string;
}
export interface CheckResultType extends QueryResultBase {
    type: QueryType.check;
}
export interface AboutResultType extends QueryResultBase {
    type: QueryType.about;
}
export interface LocateResultType extends QueryResultBase {
    type: QueryType.locate;
}
export interface PrintResultType extends QueryResultBase {
    type: QueryType.print;
}
export interface QueryError {
    code: integer; 
    message: string;
}
export type QueryResultType = 
    SearchResultType
    | CheckResultType
    | AboutResultType
    | LocateResultType
    | PrintResultType;
export interface Query {
    pattern: string; 
    type: QueryType; 
};
export interface QueryTab {
    id: string, 
    title: string, 
    pattern: string, 
    type: QueryType, 
    result: QueryResultType,
    error?: QueryError,
    expanded?: boolean
};
export type QueryPanelState = {
    currentTab: number;
    tabs: QueryTab[];
};
export type VsCodeState = {
    state?: QueryPanelState,
    history?: string[],
    historyIndex?: number, 
};
