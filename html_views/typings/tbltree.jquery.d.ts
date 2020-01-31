interface TblTreeSettings {
  rowAttr?: string; // 'row-id'
  parentAttr?: string; // 'parent-id'
  initState?: string; // 'collapsed'
  treeColumn?: string; // 0
  saveState?: boolean; // false
  saveStateName?: string; // 'tbltree-state'
  levelPicker?: string; // ''
  expanderTemplate?: string; // '<span class="tbltree-expander"></span>'
  levelPickerTemplate?: string; // '<div class="tbltree-level-pickers">\n<span id="0" class="tbltree-level-item">[1]</span>&nbsp;\n<span id="1" class="tbltree-level-item">[2]</span>&nbsp;\n<span id="2" class="tbltree-level-item">[3]</span>&nbsp;\n<span id="3" class="tbltree-level-item">[4]</span>&nbsp;\n</div>'
  indentTemplate?: string; // '<span class="tbltree-indent"></span>'
  expanderExpandedClass?: string; // 'tbltree-expander-expanded'
  expanderCollapsedClass?: string; // 'tbltree-expander-collapsed'
  change?: () => any;
  expand?: () => any;
  collapse?: () => any;
  showlevel?: () => any;
}

interface JQuery {
  tbltree(): JQuery;
  tbltree(settings: TblTreeSettings): JQuery;
  tbltree(methodName: "expand", id: JQuery | string, user?: number): JQuery;
  tbltree(methodName: "collapse", id: JQuery | string, user?: number): JQuery;
  tbltree(methodName: "toggle", id: JQuery | string): JQuery;
  tbltree(methodName: "getRow", id: string): JQuery;
  tbltree(methodName: "getId", row: JQuery): string;
  tbltree(methodName: "getParentID", row: JQuery): string;
  tbltree(methodName: "getTreeCell", row: JQuery): JQuery;
  tbltree(methodName: "_getChildren", row: JQuery): JQuery;
  tbltree(methodName: "isLeaf", row: JQuery): boolean;
  tbltree(methodName: "isExpanded", row: JQuery): boolean;
  tbltree(methodName: "isCollapsed", row: JQuery): boolean;
  tbltree(methodName: string, param: JQuery | string): any;
  tbltree(methodName: "getRootNodes"): JQuery;
}
