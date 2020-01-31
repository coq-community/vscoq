/// <reference path="../../typings/colResizable.jquery.d.ts" />
/// <reference path="../../typings/tbltree.jquery.d.ts" />
import * as $ from "jquery";

interface LtacProfTactic {
  name: string;
  statistics: {
    total: number;
    local: number;
    num_calls: number;
    max_total: number;
  };
  tactics: LtacProfTactic[];
}

interface LtacProfResults {
  total_time: number;
  tactics: LtacProfTactic[];
}

declare var acquireVsCodeApi: any;

export var vscode: any = null;

function ltacProfLoad() {
  if (parent.parent === parent) document.body.style.backgroundColor = "black";

  vscode = acquireVsCodeApi();

  window.addEventListener("message", event => {
    const results = <LtacProfResults>JSON.parse(event.data);
    addResults(results);
  });
}

function loadResultsTable(results: LtacProfResults, tbody: JQuery) {
  let currentId = 0;
  let totalTime = results.total_time;

  function buildTime(time: number, total: number, name: string) {
    if (time == 0) return $(document.createElement("td")).text("");
    else {
      const seconds = time.toFixed(3);
      const minutes = (time / 60).toFixed(1);
      const hh = Math.floor(time / 3600);
      const mm = Math.floor((time - hh * 3600) / 60);
      const ss = time - mm * 60;
      const hhmmss = `${hh}:${mm}:${ss.toFixed(1)}`;
      const percent = ((time / totalTime) * 100).toFixed(1) + "%";
      return $(document.createElement("td"))
        .append(
          $(document.createElement("span"))
            .addClass(name)
            .addClass("seconds")
            .text(seconds)
            .hide()
        )
        .append(
          $(document.createElement("span"))
            .addClass(name)
            .addClass("minutes")
            .text(minutes)
            .hide()
        )
        .append(
          $(document.createElement("span"))
            .addClass(name)
            .addClass("hhmmss")
            .text(hhmmss)
            .hide()
        )
        .append(
          $(document.createElement("span"))
            .addClass(name)
            .addClass("percent")
            .text(percent)
            .show()
        );
      // return $(document.createElement('td')).text(time);
      // const percent = ((0.0+time) / (0.0 + totalTime)).toFixed(3);
      // return $(document.createElement('td')).text(percent);
    }
  }

  function* buildTacticResultRow(
    parentId: number,
    tactic: LtacProfTactic
  ): IterableIterator<JQuery> {
    ++currentId;
    yield $(document.createElement("tr"))
      // .addClass('treegrid-'+ this.currentId)
      // .addClass(`treegrid-${currentId}` + (parentId > 0 ? ` treegrid-parent-${parentId}` : ''))
      .attr("row-id", currentId)
      // .map(() => { if(parentId>0) return $(this).attr('parent-id', parentId); else return $(this); })
      .map((idx, elm) =>
        parentId > 0
          ? $(elm)
              .attr("parent-id", parentId)
              .get()
          : elm
      )
      // .attr('parent-id',parentId)
      .attr("tabindex", currentId)
      // .map((idx,element) => parentId > 0 ? $(element).addClass('treegrid-parent-'+parentId) : $(element))
      .append($(document.createElement("td")).text(tactic.name))
      .append(buildTime(tactic.statistics.local, totalTime, "local"))
      .append(buildTime(tactic.statistics.total, totalTime, "total"))
      .append($(document.createElement("td")).text(tactic.statistics.num_calls))
      .append(
        $(document.createElement("td")).text(
          tactic.statistics.max_total.toFixed(3)
        )
      );
    yield* buildTacticsResults(currentId, tactic.tactics);
  }

  function* buildTacticsResults(
    parentId: number,
    tactics: LtacProfTactic[]
  ): IterableIterator<JQuery> {
    for (let tactic of tactics) {
      yield* buildTacticResultRow(parentId, tactic);
    }
  }

  console.time("load");
  for (let entry of buildTacticsResults(0, results.tactics))
    tbody.append(entry);
  console.timeEnd("load");

  // setTimeout(() => {
  // for(let entry of buildResults(0,result.results)) {
  //   setTimeout(() => {
  //     tbody.append(entry);
  //     // sleepFor(100);
  //   }, 100);
  // }
  // }, 10);
}

function getDescendants(node: JQuery): JQuery {
  const level = node.attr("level");
  return node.nextUntil(`[level=${level}]`, "tr");
}

function expandNode(node: JQuery, recursive: boolean): JQuery {
  // node.treegrid(recursive ? 'expandRecursive' : 'expand');
  if (recursive) {
    getDescendants(node)
      .removeClass("tbltree-collapsed")
      .addClass("tbltree-expanded");
  }
  return $("#results").tbltree("expand", node, 1);
}

function collapseNode(node: JQuery, recursive: boolean): JQuery {
  // node.treegrid(recursive ? 'collapseRecursive' : 'collapse');
  if (recursive) {
    getDescendants(node)
      .addClass("tbltree-collapsed")
      .removeClass("tbltree-expanded");
  }
  return $("#results").tbltree("collapse", node, 1);
}

function isExpanded(node: JQuery): boolean {
  // node.treegrid(recursive ? 'collapseRecursive' : 'collapse');
  return $("#results").tbltree("isExpanded", node);
}

function getParentNode(node: JQuery): JQuery {
  // return node.treegrid)'getParentNode');
  return $("#results").tbltree(
    "getRow",
    $("#results").tbltree("getParentID", node)
  );
}

let updateResultsAlternatingBackgroundTimer: number;
function updateResultsAlternatingBackground(delay?: number) {
  if (updateResultsAlternatingBackgroundTimer)
    clearTimeout(updateResultsAlternatingBackgroundTimer);
  if (delay)
    updateResultsAlternatingBackgroundTimer = window.setTimeout(
      () => updateResultsAlternatingBackground(),
      delay
    );
  else {
    $("#results tr:visible:even").removeClass("result-odd");
    $("#results tr:visible:odd").addClass("result-odd");
  }
}

const currentResults: LtacProfResults = { total_time: 0, tactics: [] };

function addResults(results: LtacProfResults) {
  if (results.total_time === 0) {
    // This could be 0 because of a bug in Coq 8.6 :/
    // Recompute the total by hand...
    currentResults.total_time = results.tactics
      .map(x => x.statistics.total)
      .reduce((s, v) => s + v, 0);
  }
  currentResults.total_time += results.total_time;
  currentResults.tactics = currentResults.tactics.concat(results.tactics);
  updateResults();
}

function onKeyDown(e: JQueryKeyEventObject) {
  const f = $(":focus");
  switch (e.which) {
    case 39: // right
      expandNode(f, e.shiftKey);
      break;
    case 37: // left
      if (isExpanded(f)) collapseNode(f, e.shiftKey);
      else {
        getParentNode(f).focus();
        collapseNode(getParentNode(f), e.shiftKey);
      }
      break;
    case 38: // up
      f.prevAll("tr:visible")
        .first()
        .focus();
      break;
    case 40: //down
      f.nextAll("tr:visible")
        .first()
        .focus();
      break;
    default:
      return;
  }
  e.preventDefault();
}

function updateResults() {
  let tbody = $("#results tbody");
  if (tbody.length > 0) tbody.empty();
  else {
    // Set up the table
    tbody = $("<tbody>");
    $("#results").append(tbody);
    $("#results").on("keydown", onKeyDown);

    $("#local-unit").on("change", (ev: JQueryEventObject) => {
      const tag = $("#local-unit option:selected").val();
      $("#results span.local")
        .not("." + tag)
        .hide();
      $("#results span.local")
        .filter("." + tag)
        .show();
    });
    $("#total-unit").on("change", (ev: JQueryEventObject) => {
      const tag = $("#total-unit option:selected").val();
      $("#results span.total")
        .not("." + tag)
        .hide();
      $("#results span.total")
        .filter("." + tag)
        .show();
    });
    $("#local-column").on("click", (ev: JQueryEventObject) => {
      if (ev.target === $("#local-column").get(0))
        $("#local-unit option:selected")
          .prop("selected", false)
          .cycleNext()
          .prop("selected", true);
      $("#local-unit").change();
    });
    $("#total-column").on("click", (ev: JQueryEventObject) => {
      if (ev.target === $("#total-column").get(0))
        $("#total-unit option:selected")
          .prop("selected", false)
          .cycleNext()
          .prop("selected", true);
      $("#total-unit").change();
    });
  }
  loadResultsTable(currentResults, tbody);

  // time('treegrid', () => {
  // $('#results').treegrid({
  //   initialState: 'collapsed',
  //   saveState: false,
  //   onChange: () => {
  //     $('#results tr:visible:even').removeClass('result-odd');
  //     $('#results tr:visible:odd').addClass('result-odd');
  //   }
  // });
  // });

  console.time("tbltree");
  $("#results").tbltree({
    initState: "collapsed",
    saveState: false,
    change: () => updateResultsAlternatingBackground(50)
  });
  console.timeEnd("tbltree");

  // time('resizable', () => {
  // $('#results')
  //   .css('table-layout','auto')
  //   .resizableColumns()
  //   .css('table-layout','fixed');
  // });

  // time('resizable', () => {
  // $('#results')
  //   .css('table-layout','auto')
  //   .colResizable({
  //     resizeMode: 'fit', liveDrag: true,
  //     // onResize: (e:JQueryEventObject) => {
  //     //   console.log('resize');
  //     //   // $('#sticky-results-header').remove('thead'); //.append($('results thead'));
  //     // }
  //   })
  //   .css('table-layout','fixed');

  // });

  // $('#results').floatThead('reflow');
  // time('floatThead', () => {
  //   $('#results').floatThead({})
  // });

  // time('sticky', () => {
  //   $('#results thead').sticky({topSpacing: 0, getWidthFrom: '#results'});
  //   $('#results thead').sticky('update');
  // });

  // $('#results tr:visible:even').removeClass('result-odd');
  // $('#results tr:visible:odd').addClass('result-odd');
  updateResultsAlternatingBackground(0);
}

addEventListener("load", ltacProfLoad);
