interface JQuery {
  colResizable(): JQuery;
  colResizable(settings: {
    resizeMode?: string;
    disable?: boolean;
    disabledColumns?: number[];
    liveDrag?: boolean;
    postbackSafe?: boolean;
    partialRefresh?: boolean;
    headerOnly?: boolean;
    innerGripHtml?: string;
    draggingClass?: string;
    minWidth?: number;
    hoverCursor?: string;
    dragCursor?: string;
    flush?: boolean;
    marginLeft?: string;
    marginRight?: string;
    onResize?: (e: JQueryEventObject) => void;
    onDrag?: () => void;
  }): JQuery;
}
