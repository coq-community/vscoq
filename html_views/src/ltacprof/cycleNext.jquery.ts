// implement cycleNext
(function($) {
  $.fn.cycleNext = function(this: any) {
    const siblings = $(this)
      .parent()
      .children();
    return siblings.eq((siblings.index($(this)) + 1) % siblings.length);
  };
})(jQuery);

interface JQuery {
  cycleNext(): JQuery;
}
