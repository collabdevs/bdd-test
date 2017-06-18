// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// This is CodeMirror (http://codemirror.net), a code editor
// implemented in JavaScript on top of the browser's DOM.
//
// You can find some technical background for some of the code below
// at http://marijnhaverbeke.nl/blog/#cm-internals .

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    module.exports = mod();
  else if (typeof define == "function" && define.amd) // AMD
    return define([], mod);
  else // Plain browser env
    this.CodeMirror = mod();
})(function() {
  "use strict";

  // BROWSER SNIFFING

  // Kludges for bugs and behavior differences that can't be feature
  // detected are enabled based on userAgent etc sniffing.

  var gecko = /gecko\/\d/i.test(navigator.userAgent);
  // ie_uptoN means Internet Explorer version N or lower
  var ie_upto10 = /MSIE \d/.test(navigator.userAgent);
  var ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent);
  var ie = ie_upto10 || ie_11up;
  var ie_version = ie && (ie_upto10 ? document.documentMode || 6 : ie_11up[1]);
  var webkit = /WebKit\//.test(navigator.userAgent);
  var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(navigator.userAgent);
  var chrome = /Chrome\//.test(navigator.userAgent);
  var presto = /Opera\//.test(navigator.userAgent);
  var safari = /Apple Computer/.test(navigator.vendor);
  var khtml = /KHTML\//.test(navigator.userAgent);
  var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(navigator.userAgent);
  var phantom = /PhantomJS/.test(navigator.userAgent);

  var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);
  // This is woefully incomplete. Suggestions for alternative methods welcome.
  var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(navigator.userAgent);
  var mac = ios || /Mac/.test(navigator.platform);
  var windows = /win/i.test(navigator.platform);

  var presto_version = presto && navigator.userAgent.match(/Version\/(\d*\.\d*)/);
  if (presto_version) presto_version = Number(presto_version[1]);
  if (presto_version && presto_version >= 15) { presto = false; webkit = true; }
  // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
  var flipCtrlCmd = mac && (qtwebkit || presto && (presto_version == null || presto_version < 12.11));
  var captureRightClick = gecko || (ie && ie_version >= 9);

  // Optimize some code when these features are not used.
  var sawReadOnlySpans = false, sawCollapsedSpans = false;

  // EDITOR CONSTRUCTOR

  // A CodeMirror instance represents an editor. This is the object
  // that user code is usually dealing with.

  function CodeMirror(place, options) {
    if (!(this instanceof CodeMirror)) return new CodeMirror(place, options);

    this.options = options = options ? copyObj(options) : {};
    // Determine effective options based on given values and defaults.
    copyObj(defaults, options, false);
    setGuttersForLineNumbers(options);

    var doc = options.value;
    if (typeof doc == "string") doc = new Doc(doc, options.mode);
    this.doc = doc;

    var display = this.display = new Display(place, doc);
    display.wrapper.CodeMirror = this;
    updateGutters(this);
    themeChanged(this);
    if (options.lineWrapping)
      this.display.wrapper.className += " CodeMirror-wrap";
    if (options.autofocus && !mobile) focusInput(this);

    this.state = {
      keyMaps: [],  // stores maps added by addKeyMap
      overlays: [], // highlighting overlays, as added by addOverlay
      modeGen: 0,   // bumped when mode/overlay changes, used to invalidate highlighting info
      overwrite: false, focused: false,
      suppressEdits: false, // used to disable editing during key handlers when in readOnly mode
      pasteIncoming: false, cutIncoming: false, // help recognize paste/cut edits in readInput
      draggingText: false,
      highlight: new Delayed() // stores highlight worker timeout
    };

    // Override magic textarea content restore that IE sometimes does
    // on our hidden textarea on reload
    if (ie && ie_version < 11) setTimeout(bind(resetInput, this, true), 20);

    registerEventHandlers(this);
    ensureGlobalHandlers();

    startOperation(this);
    this.curOp.forceUpdate = true;
    attachDoc(this, doc);

    if ((options.autofocus && !mobile) || activeElt() == display.input)
      setTimeout(bind(onFocus, this), 20);
    else
      onBlur(this);

    for (var opt in optionHandlers) if (optionHandlers.hasOwnProperty(opt))
      optionHandlers[opt](this, options[opt], Init);
    maybeUpdateLineNumberWidth(this);
    for (var i = 0; i < initHooks.length; ++i) initHooks[i](this);
    endOperation(this);
  }

  // DISPLAY CONSTRUCTOR

  // The display handles the DOM integration, both for input reading
  // and content drawing. It holds references to DOM nodes and
  // display-related state.

  function Display(place, doc) {
    var d = this;

    // The semihidden textarea that is focused when the editor is
    // focused, and receives input.
    var input = d.input = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none");
    // The textarea is kept positioned near the cursor to prevent the
    // fact that it'll be scrolled into view on input from scrolling
    // our fake cursor out of view. On webkit, when wrap=off, paste is
    // very slow. So make the area wide instead.
    if (webkit) input.style.width = "1000px";
    else input.setAttribute("wrap", "off");
    // If border: 0; -- iOS fails to open keyboard (issue #1287)
    if (ios) input.style.border = "1px solid black";
    input.setAttribute("autocorrect", "off"); input.setAttribute("autocapitalize", "off"); input.setAttribute("spellcheck", "false");

    // Wraps and hides input textarea
    d.inputDiv = elt("div", [input], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
    // The fake scrollbar elements.
    d.scrollbarH = elt("div", [elt("div", null, null, "height: 100%; min-height: 1px")], "CodeMirror-hscrollbar");
    d.scrollbarV = elt("div", [elt("div", null, null, "min-width: 1px")], "CodeMirror-vscrollbar");
    // Covers bottom-right square when both scrollbars are present.
    d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
    // Covers bottom of gutter when coverGutterNextToScrollbar is on
    // and h scrollbar is present.
    d.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
    // Will contain the actual code, positioned to cover the viewport.
    d.lineDiv = elt("div", null, "CodeMirror-code");
    // Elements are added to these to represent selection and cursors.
    d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
    d.cursorDiv = elt("div", null, "CodeMirror-cursors");
    // A visibility: hidden element used to find the size of things.
    d.measure = elt("div", null, "CodeMirror-measure");
    // When lines outside of the viewport are measured, they are drawn in this.
    d.lineMeasure = elt("div", null, "CodeMirror-measure");
    // Wraps everything that needs to exist inside the vertically-padded coordinate system
    d.lineSpace = elt("div", [d.measure, d.lineMeasure, d.selectionDiv, d.cursorDiv, d.lineDiv],
                      null, "position: relative; outline: none");
    // Moved around its parent to cover visible view.
    d.mover = elt("div", [elt("div", [d.lineSpace], "CodeMirror-lines")], null, "position: relative");
    // Set to the height of the document, allowing scrolling.
    d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
    // Behavior of elts with overflow: auto and padding is
    // inconsistent across browsers. This is used to ensure the
    // scrollable area is big enough.
    d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerCutOff + "px; width: 1px;");
    // Will contain the gutters, if any.
    d.gutters = elt("div", null, "CodeMirror-gutters");
    d.lineGutter = null;
    // Actual scrollable element.
    d.scroller = elt("div", [d.sizer, d.heightForcer, d.gutters], "CodeMirror-scroll");
    d.scroller.setAttribute("tabIndex", "-1");
    // The element in which the editor lives.
    d.wrapper = elt("div", [d.inputDiv, d.scrollbarH, d.scrollbarV,
                            d.scrollbarFiller, d.gutterFiller, d.scroller], "CodeMirror");

    // Work around IE7 z-index bug (not perfect, hence IE7 not really being supported)
    if (ie && ie_version < 8) { d.gutters.style.zIndex = -1; d.scroller.style.paddingRight = 0; }
    // Needed to hide big blue blinking cursor on Mobile Safari
    if (ios) input.style.width = "0px";
    if (!webkit) d.scroller.draggable = true;
    // Needed to handle Tab key in KHTML
    if (khtml) { d.inputDiv.style.height = "1px"; d.inputDiv.style.position = "absolute"; }
    // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
    if (ie && ie_version < 8) d.scrollbarH.style.minHeight = d.scrollbarV.style.minWidth = "18px";

    if (place.appendChild) place.appendChild(d.wrapper);
    else place(d.wrapper);

    // Current rendered range (may be bigger than the view window).
    d.viewFrom = d.viewTo = doc.first;
    // Information about the rendered lines.
    d.view = [];
    // Holds info about a single rendered line when it was rendered
    // for measurement, while not in view.
    d.externalMeasured = null;
    // Empty space (in pixels) above the view
    d.viewOffset = 0;
    d.lastSizeC = 0;
    d.updateLineNumbers = null;

    // Used to only resize the line number gutter when necessary (when
    // the amount of lines crosses a boundary that makes its width change)
    d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
    // See readInput and resetInput
    d.prevInput = "";
    // Set to true when a non-horizontal-scrolling line widget is
    // added. As an optimization, line widget aligning is skipped when
    // this is false.
    d.alignWidgets = false;
    // Flag that indicates whether we expect input to appear real soon
    // now (after some event like 'keypress' or 'input') and are
    // polling intensively.
    d.pollingFast = false;
    // Self-resetting timeout for the poller
    d.poll = new Delayed();

    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;

    // Tracks when resetInput has punted to just putting a short
    // string into the textarea instead of the full selection.
    d.inaccurateSelection = false;

    // Tracks the maximum line length so that the horizontal scrollbar
    // can be kept static when scrolling.
    d.maxLine = null;
    d.maxLineLength = 0;
    d.maxLineChanged = false;

    // Used for measuring wheel scrolling granularity
    d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

    // True when shift is held down.
    d.shift = false;

    // Used to track whether anything happened since the context menu
    // was opened.
    d.selForContextMenu = null;
  }

  // STATE UPDATES

  // Used to get the editor into a consistent state again when options change.

  function loadMode(cm) {
    cm.doc.mode = CodeMirror.getMode(cm.options, cm.doc.modeOption);
    resetModeState(cm);
  }

  function resetModeState(cm) {
    cm.doc.iter(function(line) {
      if (line.stateAfter) line.stateAfter = null;
      if (line.styles) line.styles = null;
    });
    cm.doc.frontier = cm.doc.first;
    startWorker(cm, 100);
    cm.state.modeGen++;
    if (cm.curOp) regChange(cm);
  }

  function wrappingChanged(cm) {
    if (cm.options.lineWrapping) {
      addClass(cm.display.wrapper, "CodeMirror-wrap");
      cm.display.sizer.style.minWidth = "";
    } else {
      rmClass(cm.display.wrapper, "CodeMirror-wrap");
      findMaxLine(cm);
    }
    estimateLineHeights(cm);
    regChange(cm);
    clearCaches(cm);
    setTimeout(function(){updateScrollbars(cm);}, 100);
  }

  // Returns a function that estimates the height of a line, to use as
  // first approximation until the line becomes visible (and is thus
  // properly measurable).
  function estimateHeight(cm) {
    var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
    var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
    return function(line) {
      if (lineIsHidden(cm.doc, line)) return 0;

      var widgetsHeight = 0;
      if (line.widgets) for (var i = 0; i < line.widgets.length; i++) {
        if (line.widgets[i].height) widgetsHeight += line.widgets[i].height;
      }

      if (wrapping)
        return widgetsHeight + (Math.ceil(line.text.length / perLine) || 1) * th;
      else
        return widgetsHeight + th;
    };
  }

  function estimateLineHeights(cm) {
    var doc = cm.doc, est = estimateHeight(cm);
    doc.iter(function(line) {
      var estHeight = est(line);
      if (estHeight != line.height) updateLineHeight(line, estHeight);
    });
  }

  function keyMapChanged(cm) {
    var map = keyMap[cm.options.keyMap], style = map.style;
    cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-keymap-\S+/g, "") +
      (style ? " cm-keymap-" + style : "");
  }

  function themeChanged(cm) {
    cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
      cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
    clearCaches(cm);
  }

  function guttersChanged(cm) {
    updateGutters(cm);
    regChange(cm);
    setTimeout(function(){alignHorizontally(cm);}, 20);
  }

  // Rebuild the gutter elements, ensure the margin to the left of the
  // code matches their width.
  function updateGutters(cm) {
    var gutters = cm.display.gutters, specs = cm.options.gutters;
    removeChildren(gutters);
    for (var i = 0; i < specs.length; ++i) {
      var gutterClass = specs[i];
      var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + gutterClass));
      if (gutterClass == "CodeMirror-linenumbers") {
        cm.display.lineGutter = gElt;
        gElt.style.width = (cm.display.lineNumWidth || 1) + "px";
      }
    }
    gutters.style.display = i ? "" : "none";
    updateGutterSpace(cm);
  }

  function updateGutterSpace(cm) {
    var width = cm.display.gutters.offsetWidth;
    cm.display.sizer.style.marginLeft = width + "px";
    cm.display.scrollbarH.style.left = cm.options.fixedGutter ? width + "px" : 0;
  }

  // Compute the character length of a line, taking into account
  // collapsed ranges (see markText) that might hide parts, and join
  // other lines onto it.
  function lineLength(line) {
    if (line.height == 0) return 0;
    var len = line.text.length, merged, cur = line;
    while (merged = collapsedSpanAtStart(cur)) {
      var found = merged.find(0, true);
      cur = found.from.line;
      len += found.from.ch - found.to.ch;
    }
    cur = line;
    while (merged = collapsedSpanAtEnd(cur)) {
      var found = merged.find(0, true);
      len -= cur.text.length - found.from.ch;
      cur = found.to.line;
      len += cur.text.length - found.to.ch;
    }
    return len;
  }

  // Find the longest line in the document.
  function findMaxLine(cm) {
    var d = cm.display, doc = cm.doc;
    d.maxLine = getLine(doc, doc.first);
    d.maxLineLength = lineLength(d.maxLine);
    d.maxLineChanged = true;
    doc.iter(function(line) {
      var len = lineLength(line);
      if (len > d.maxLineLength) {
        d.maxLineLength = len;
        d.maxLine = line;
      }
    });
  }

  // Make sure the gutters options contains the element
  // "CodeMirror-linenumbers" when the lineNumbers option is true.
  function setGuttersForLineNumbers(options) {
    var found = indexOf(options.gutters, "CodeMirror-linenumbers");
    if (found == -1 && options.lineNumbers) {
      options.gutters = options.gutters.concat(["CodeMirror-linenumbers"]);
    } else if (found > -1 && !options.lineNumbers) {
      options.gutters = options.gutters.slice(0);
      options.gutters.splice(found, 1);
    }
  }

  // SCROLLBARS

  function hScrollbarTakesSpace(cm) {
    return cm.display.scroller.clientHeight - cm.display.wrapper.clientHeight < scrollerCutOff - 3;
  }

  // Prepare DOM reads needed to update the scrollbars. Done in one
  // shot to minimize update/measure roundtrips.
  function measureForScrollbars(cm) {
    var scroll = cm.display.scroller;
    return {
      clientHeight: scroll.clientHeight,
      barHeight: cm.display.scrollbarV.clientHeight,
      scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
      hScrollbarTakesSpace: hScrollbarTakesSpace(cm),
      barWidth: cm.display.scrollbarH.clientWidth,
      docHeight: Math.round(cm.doc.height + paddingVert(cm.display))
    };
  }

  // Re-synchronize the fake scrollbars with the actual size of the
  // content.
  function updateScrollbars(cm, measure) {
    if (!measure) measure = measureForScrollbars(cm);
    var d = cm.display, sWidth = scrollbarWidth(d.measure);
    var scrollHeight = measure.docHeight + scrollerCutOff;
    var needsH = measure.scrollWidth > measure.clientWidth;
    if (needsH && measure.scrollWidth <= measure.clientWidth + 1 &&
        sWidth > 0 && !measure.hScrollbarTakesSpace)
      needsH = false; // (Issue #2562)
    var needsV = scrollHeight > measure.clientHeight;

    if (needsV) {
      d.scrollbarV.style.display = "block";
      d.scrollbarV.style.bottom = needsH ? sWidth + "px" : "0";
      // A bug in IE8 can cause this value to be negative, so guard it.
      d.scrollbarV.firstChild.style.height =
        Math.max(0, scrollHeight - measure.clientHeight + (measure.barHeight || d.scrollbarV.clientHeight)) + "px";
    } else {
      d.scrollbarV.style.display = "";
      d.scrollbarV.firstChild.style.height = "0";
    }
    if (needsH) {
      d.scrollbarH.style.display = "block";
      d.scrollbarH.style.right = needsV ? sWidth + "px" : "0";
      d.scrollbarH.firstChild.style.width =
        (measure.scrollWidth - measure.clientWidth + (measure.barWidth || d.scrollbarH.clientWidth)) + "px";
    } else {
      d.scrollbarH.style.display = "";
      d.scrollbarH.firstChild.style.width = "0";
    }
    if (needsH && needsV) {
      d.scrollbarFiller.style.display = "block";
      d.scrollbarFiller.style.height = d.scrollbarFiller.style.width = sWidth + "px";
    } else d.scrollbarFiller.style.display = "";
    if (needsH && cm.options.coverGutterNextToScrollbar && cm.options.fixedGutter) {
      d.gutterFiller.style.display = "block";
      d.gutterFiller.style.height = sWidth + "px";
      d.gutterFiller.style.width = d.gutters.offsetWidth + "px";
    } else d.gutterFiller.style.display = "";

    if (!cm.state.checkedOverlayScrollbar && measure.clientHeight > 0) {
      if (sWidth === 0) {
        var w = mac && !mac_geMountainLion ? "12px" : "18px";
        d.scrollbarV.style.minWidth = d.scrollbarH.style.minHeight = w;
        var barMouseDown = function(e) {
          if (e_target(e) != d.scrollbarV && e_target(e) != d.scrollbarH)
            operation(cm, onMouseDown)(e);
        };
        on(d.scrollbarV, "mousedown", barMouseDown);
        on(d.scrollbarH, "mousedown", barMouseDown);
      }
      cm.state.checkedOverlayScrollbar = true;
    }
  }

  // Compute the lines that are visible in a given viewport (defaults
  // the the current scroll position). viewport may contain top,
  // height, and ensure (see op.scrollToPos) properties.
  function visibleLines(display, doc, viewport) {
    var top = viewport && viewport.top != null ? Math.max(0, viewport.top) : display.scroller.scrollTop;
    top = Math.floor(top - paddingTop(display));
    var bottom = viewport && viewport.bottom != null ? viewport.bottom : top + display.wrapper.clientHeight;

    var from = lineAtHeight(doc, top), to = lineAtHeight(doc, bottom);
    // Ensure is a {from: {line, ch}, to: {line, ch}} object, and
    // forces those lines into the viewport (if possible).
    if (viewport && viewport.ensure) {
      var ensureFrom = viewport.ensure.from.line, ensureTo = viewport.ensure.to.line;
      if (ensureFrom < from)
        return {from: ensureFrom,
                to: lineAtHeight(doc, heightAtLine(getLine(doc, ensureFrom)) + display.wrapper.clientHeight)};
      if (Math.min(ensureTo, doc.lastLine()) >= to)
        return {from: lineAtHeight(doc, heightAtLine(getLine(doc, ensureTo)) - display.wrapper.clientHeight),
                to: ensureTo};
    }
    return {from: from, to: Math.max(to, from + 1)};
  }

  // LINE NUMBERS

  // Re-align line numbers and gutter marks to compensate for
  // horizontal scrolling.
  function alignHorizontally(cm) {
    var display = cm.display, view = display.view;
    if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter)) return;
    var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
    var gutterW = display.gutters.offsetWidth, left = comp + "px";
    for (var i = 0; i < view.length; i++) if (!view[i].hidden) {
      if (cm.options.fixedGutter && view[i].gutter)
        view[i].gutter.style.left = left;
      var align = view[i].alignable;
      if (align) for (var j = 0; j < align.length; j++)
        align[j].style.left = left;
    }
    if (cm.options.fixedGutter)
      display.gutters.style.left = (comp + gutterW) + "px";
  }

  // Used to ensure that the line number gutter is still the right
  // size for the current document size. Returns true when an update
  // is needed.
  function maybeUpdateLineNumberWidth(cm) {
    if (!cm.options.lineNumbers) return false;
    var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
    if (last.length != display.lineNumChars) {
      var test = display.measure.appendChild(elt("div", [elt("div", last)],
                                                 "CodeMirror-linenumber CodeMirror-gutter-elt"));
      var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
      display.lineGutter.style.width = "";
      display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding);
      display.lineNumWidth = display.lineNumInnerWidth + padding;
      display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
      display.lineGutter.style.width = display.lineNumWidth + "px";
      updateGutterSpace(cm);
      return true;
    }
    return false;
  }

  function lineNumberFor(options, i) {
    return String(options.lineNumberFormatter(i + options.firstLineNumber));
  }

  // Computes display.scroller.scrollLeft + display.gutters.offsetWidth,
  // but using getBoundingClientRect to get a sub-pixel-accurate
  // result.
  function compensateForHScroll(display) {
    return display.scroller.getBoundingClientRect().left - display.sizer.getBoundingClientRect().left;
  }

  // DISPLAY DRAWING

  function DisplayUpdate(cm, viewport, force) {
    var display = cm.display;

    this.viewport = viewport;
    // Store some values that we'll need later (but don't want to force a relayout for)
    this.visible = visibleLines(display, cm.doc, viewport);
    this.editorIsHidden = !display.wrapper.offsetWidth;
    this.wrapperHeight = display.wrapper.clientHeight;
    this.oldViewFrom = display.viewFrom; this.oldViewTo = display.viewTo;
    this.oldScrollerWidth = display.scroller.clientWidth;
    this.force = force;
    this.dims = getDimensions(cm);
  }

  // Does the actual updating of the line display. Bails out
  // (returning false) when there is nothing to be done and forced is
  // false.
  function updateDisplayIfNeeded(cm, update) {
    var display = cm.display, doc = cm.doc;
    if (update.editorIsHidden) {
      resetView(cm);
      return false;
    }

    // Bail out if the visible area is already rendered and nothing changed.
    if (!update.force &&
        update.visible.from >= display.viewFrom && update.visible.to <= display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo) &&
        countDirtyView(cm) == 0)
      return false;

    if (maybeUpdateLineNumberWidth(cm)) {
      resetView(cm);
      update.dims = getDimensions(cm);
    }

    // Compute a suitable new viewport (from & to)
    var end = doc.first + doc.size;
    var from = Math.max(update.visible.from - cm.options.viewportMargin, doc.first);
    var to = Math.min(end, update.visible.to + cm.options.viewportMargin);
    if (display.viewFrom < from && from - display.viewFrom < 20) from = Math.max(doc.first, display.viewFrom);
    if (display.viewTo > to && display.viewTo - to < 20) to = Math.min(end, display.viewTo);
    if (sawCollapsedSpans) {
      from = visualLineNo(cm.doc, from);
      to = visualLineEndNo(cm.doc, to);
    }

    var different = from != display.viewFrom || to != display.viewTo ||
      display.lastSizeC != update.wrapperHeight;
    adjustView(cm, from, to);

    display.viewOffset = heightAtLine(getLine(cm.doc, display.viewFrom));
    // Position the mover div to align with the current scroll position
    cm.display.mover.style.top = display.viewOffset + "px";

    var toUpdate = countDirtyView(cm);
    if (!different && toUpdate == 0 && !update.force &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo))
      return false;

    // For big changes, we hide the enclosing element during the
    // update, since that speeds up the operations on most browsers.
    var focused = activeElt();
    if (toUpdate > 4) display.lineDiv.style.display = "none";
    patchDisplay(cm, display.updateLineNumbers, update.dims);
    if (toUpdate > 4) display.lineDiv.style.display = "";
    // There might have been a widget with a focused element that got
    // hidden or updated, if so re-focus it.
    if (focused && activeElt() != focused && focused.offsetHeight) focused.focus();

    // Prevent selection and cursors from interfering with the scroll
    // width.
    removeChildren(display.cursorDiv);
    removeChildren(display.selectionDiv);

    if (different) {
      display.lastSizeC = update.wrapperHeight;
      startWorker(cm, 400);
    }

    display.updateLineNumbers = null;

    return true;
  }

  function postUpdateDisplay(cm, update) {
    var force = update.force, viewport = update.viewport;
    for (var first = true;; first = false) {
      if (first && cm.options.lineWrapping && update.oldScrollerWidth != cm.display.scroller.clientWidth) {
        force = true;
      } else {
        force = false;
        // Clip forced viewport to actual scrollable area.
        if (viewport && viewport.top != null)
          viewport = {top: Math.min(cm.doc.height + paddingVert(cm.display) - scrollerCutOff -
                                    cm.display.scroller.clientHeight, viewport.top)};
        // Updated line heights might result in the drawn area not
        // actually covering the viewport. Keep looping until it does.
        update.visible = visibleLines(cm.display, cm.doc, viewport);
        if (update.visible.from >= cm.display.viewFrom && update.visible.to <= cm.display.viewTo)
          break;
      }
      if (!updateDisplayIfNeeded(cm, update)) break;
      updateHeightsInViewport(cm);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
    }

    signalLater(cm, "update", cm);
    if (cm.display.viewFrom != update.oldViewFrom || cm.display.viewTo != update.oldViewTo)
      signalLater(cm, "viewportChange", cm, cm.display.viewFrom, cm.display.viewTo);
  }

  function updateDisplaySimple(cm, viewport) {
    var update = new DisplayUpdate(cm, viewport);
    if (updateDisplayIfNeeded(cm, update)) {
      updateHeightsInViewport(cm);
      postUpdateDisplay(cm, update);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
    }
  }

  function setDocumentHeight(cm, measure) {
    cm.display.sizer.style.minHeight = cm.display.heightForcer.style.top = measure.docHeight + "px";
    cm.display.gutters.style.height = Math.max(measure.docHeight, measure.clientHeight - scrollerCutOff) + "px";
  }

  function checkForWebkitWidthBug(cm, measure) {
    // Work around Webkit bug where it sometimes reserves space for a
    // non-existing phantom scrollbar in the scroller (Issue #2420)
    if (cm.display.sizer.offsetWidth + cm.display.gutters.offsetWidth < cm.display.scroller.clientWidth - 1) {
      cm.display.sizer.style.minHeight = cm.display.heightForcer.style.top = "0px";
      cm.display.gutters.style.height = measure.docHeight + "px";
    }
  }

  // Read the actual heights of the rendered lines, and update their
  // stored heights to match.
  function updateHeightsInViewport(cm) {
    var display = cm.display;
    var prevBottom = display.lineDiv.offsetTop;
    for (var i = 0; i < display.view.length; i++) {
      var cur = display.view[i], height;
      if (cur.hidden) continue;
      if (ie && ie_version < 8) {
        var bot = cur.node.offsetTop + cur.node.offsetHeight;
        height = bot - prevBottom;
        prevBottom = bot;
      } else {
        var box = cur.node.getBoundingClientRect();
        height = box.bottom - box.top;
      }
      var diff = cur.line.height - height;
      if (height < 2) height = textHeight(display);
      if (diff > .001 || diff < -.001) {
        updateLineHeight(cur.line, height);
        updateWidgetHeight(cur.line);
        if (cur.rest) for (var j = 0; j < cur.rest.length; j++)
          updateWidgetHeight(cur.rest[j]);
      }
    }
  }

  // Read and store the height of line widgets associated with the
  // given line.
  function updateWidgetHeight(line) {
    if (line.widgets) for (var i = 0; i < line.widgets.length; ++i)
      line.widgets[i].height = line.widgets[i].node.offsetHeight;
  }

  // Do a bulk-read of the DOM positions and sizes needed to draw the
  // view, so that we don't interleave reading and writing to the DOM.
  function getDimensions(cm) {
    var d = cm.display, left = {}, width = {};
    var gutterLeft = d.gutters.clientLeft;
    for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
      left[cm.options.gutters[i]] = n.offsetLeft + n.clientLeft + gutterLeft;
      width[cm.options.gutters[i]] = n.clientWidth;
    }
    return {fixedPos: compensateForHScroll(d),
            gutterTotalWidth: d.gutters.offsetWidth,
            gutterLeft: left,
            gutterWidth: width,
            wrapperWidth: d.wrapper.clientWidth};
  }

  // Sync the actual display DOM structure with display.view, removing
  // nodes for lines that are no longer in view, and creating the ones
  // that are not there yet, and updating the ones that are out of
  // date.
  function patchDisplay(cm, updateNumbersFrom, dims) {
    var display = cm.display, lineNumbers = cm.options.lineNumbers;
    var container = display.lineDiv, cur = container.firstChild;

    function rm(node) {
      var next = node.nextSibling;
      // Works around a throw-scroll bug in OS X Webkit
      if (webkit && mac && cm.display.currentWheelTarget == node)
        node.style.display = "none";
      else
        node.parentNode.removeChild(node);
      return next;
    }

    var view = display.view, lineN = display.viewFrom;
    // Loop over the elements in the view, syncing cur (the DOM nodes
    // in display.lineDiv) with the view as we go.
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (lineView.hidden) {
      } else if (!lineView.node) { // Not drawn yet
        var node = buildLineElement(cm, lineView, lineN, dims);
        container.insertBefore(node, cur);
      } else { // Already drawn
        while (cur != lineView.node) cur = rm(cur);
        var updateNumber = lineNumbers && updateNumbersFrom != null &&
          updateNumbersFrom <= lineN && lineView.lineNumber;
        if (lineView.changes) {
          if (indexOf(lineView.changes, "gutter") > -1) updateNumber = false;
          updateLineForChanges(cm, lineView, lineN, dims);
        }
        if (updateNumber) {
          removeChildren(lineView.lineNumber);
          lineView.lineNumber.appendChild(document.createTextNode(lineNumberFor(cm.options, lineN)));
        }
        cur = lineView.node.nextSibling;
      }
      lineN += lineView.size;
    }
    while (cur) cur = rm(cur);
  }

  // When an aspect of a line changes, a string is added to
  // lineView.changes. This updates the relevant part of the line's
  // DOM structure.
  function updateLineForChanges(cm, lineView, lineN, dims) {
    for (var j = 0; j < lineView.changes.length; j++) {
      var type = lineView.changes[j];
      if (type == "text") updateLineText(cm, lineView);
      else if (type == "gutter") updateLineGutter(cm, lineView, lineN, dims);
      else if (type == "class") updateLineClasses(lineView);
      else if (type == "widget") updateLineWidgets(lineView, dims);
    }
    lineView.changes = null;
  }

  // Lines with gutter elements, widgets or a background class need to
  // be wrapped, and have the extra elements added to the wrapper div
  function ensureLineWrapped(lineView) {
    if (lineView.node == lineView.text) {
      lineView.node = elt("div", null, null, "position: relative");
      if (lineView.text.parentNode)
        lineView.text.parentNode.replaceChild(lineView.node, lineView.text);
      lineView.node.appendChild(lineView.text);
      if (ie && ie_version < 8) lineView.node.style.zIndex = 2;
    }
    return lineView.node;
  }

  function updateLineBackground(lineView) {
    var cls = lineView.bgClass ? lineView.bgClass + " " + (lineView.line.bgClass || "") : lineView.line.bgClass;
    if (cls) cls += " CodeMirror-linebackground";
    if (lineView.background) {
      if (cls) lineView.background.className = cls;
      else { lineView.background.parentNode.removeChild(lineView.background); lineView.background = null; }
    } else if (cls) {
      var wrap = ensureLineWrapped(lineView);
      lineView.background = wrap.insertBefore(elt("div", null, cls), wrap.firstChild);
    }
  }

  // Wrapper around buildLineContent which will reuse the structure
  // in display.externalMeasured when possible.
  function getLineContent(cm, lineView) {
    var ext = cm.display.externalMeasured;
    if (ext && ext.line == lineView.line) {
      cm.display.externalMeasured = null;
      lineView.measure = ext.measure;
      return ext.built;
    }
    return buildLineContent(cm, lineView);
  }

  // Redraw the line's text. Interacts with the background and text
  // classes because the mode may output tokens that influence these
  // classes.
  function updateLineText(cm, lineView) {
    var cls = lineView.text.className;
    var built = getLineContent(cm, lineView);
    if (lineView.text == lineView.node) lineView.node = built.pre;
    lineView.text.parentNode.replaceChild(built.pre, lineView.text);
    lineView.text = built.pre;
    if (built.bgClass != lineView.bgClass || built.textClass != lineView.textClass) {
      lineView.bgClass = built.bgClass;
      lineView.textClass = built.textClass;
      updateLineClasses(lineView);
    } else if (cls) {
      lineView.text.className = cls;
    }
  }

  function updateLineClasses(lineView) {
    updateLineBackground(lineView);
    if (lineView.line.wrapClass)
      ensureLineWrapped(lineView).className = lineView.line.wrapClass;
    else if (lineView.node != lineView.text)
      lineView.node.className = "";
    var textClass = lineView.textClass ? lineView.textClass + " " + (lineView.line.textClass || "") : lineView.line.textClass;
    lineView.text.className = textClass || "";
  }

  function updateLineGutter(cm, lineView, lineN, dims) {
    if (lineView.gutter) {
      lineView.node.removeChild(lineView.gutter);
      lineView.gutter = null;
    }
    var markers = lineView.line.gutterMarkers;
    if (cm.options.lineNumbers || markers) {
      var wrap = ensureLineWrapped(lineView);
      var gutterWrap = lineView.gutter =
        wrap.insertBefore(elt("div", null, "CodeMirror-gutter-wrapper", "position: absolute; left: " +
                              (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px"),
                          lineView.text);
      if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
        lineView.lineNumber = gutterWrap.appendChild(
          elt("div", lineNumberFor(cm.options, lineN),
              "CodeMirror-linenumber CodeMirror-gutter-elt",
              "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
              + cm.display.lineNumInnerWidth + "px"));
      if (markers) for (var k = 0; k < cm.options.gutters.length; ++k) {
        var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
        if (found)
          gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                                     dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
      }
    }
  }

  function updateLineWidgets(lineView, dims) {
    if (lineView.alignable) lineView.alignable = null;
    for (var node = lineView.node.firstChild, next; node; node = next) {
      var next = node.nextSibling;
      if (node.className == "CodeMirror-linewidget")
        lineView.node.removeChild(node);
    }
    insertLineWidgets(lineView, dims);
  }

  // Build a line's DOM representation from scratch
  function buildLineElement(cm, lineView, lineN, dims) {
    var built = getLineContent(cm, lineView);
    lineView.text = lineView.node = built.pre;
    if (built.bgClass) lineView.bgClass = built.bgClass;
    if (built.textClass) lineView.textClass = built.textClass;

    updateLineClasses(lineView);
    updateLineGutter(cm, lineView, lineN, dims);
    insertLineWidgets(lineView, dims);
    return lineView.node;
  }

  // A lineView may contain multiple logical lines (when merged by
  // collapsed spans). The widgets for all of them need to be drawn.
  function insertLineWidgets(lineView, dims) {
    insertLineWidgetsFor(lineView.line, lineView, dims, true);
    if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
      insertLineWidgetsFor(lineView.rest[i], lineView, dims, false);
  }

  function insertLineWidgetsFor(line, lineView, dims, allowAbove) {
    if (!line.widgets) return;
    var wrap = ensureLineWrapped(lineView);
    for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
      var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
      if (!widget.handleMouseEvents) node.ignoreEvents = true;
      positionLineWidget(widget, node, lineView, dims);
      if (allowAbove && widget.above)
        wrap.insertBefore(node, lineView.gutter || lineView.text);
      else
        wrap.appendChild(node);
      signalLater(widget, "redraw");
    }
  }

  function positionLineWidget(widget, node, lineView, dims) {
    if (widget.noHScroll) {
      (lineView.alignable || (lineView.alignable = [])).push(node);
      var width = dims.wrapperWidth;
      node.style.left = dims.fixedPos + "px";
      if (!widget.coverGutter) {
        width -= dims.gutterTotalWidth;
        node.style.paddingLeft = dims.gutterTotalWidth + "px";
      }
      node.style.width = width + "px";
    }
    if (widget.coverGutter) {
      node.style.zIndex = 5;
      node.style.position = "relative";
      if (!widget.noHScroll) node.style.marginLeft = -dims.gutterTotalWidth + "px";
    }
  }

  // POSITION OBJECT

  // A Pos instance represents a position within the text.
  var Pos = CodeMirror.Pos = function(line, ch) {
    if (!(this instanceof Pos)) return new Pos(line, ch);
    this.line = line; this.ch = ch;
  };

  // Compare two positions, return 0 if they are the same, a negative
  // number when a is less, and a positive number otherwise.
  var cmp = CodeMirror.cmpPos = function(a, b) { return a.line - b.line || a.ch - b.ch; };

  function copyPos(x) {return Pos(x.line, x.ch);}
  function maxPos(a, b) { return cmp(a, b) < 0 ? b : a; }
  function minPos(a, b) { return cmp(a, b) < 0 ? a : b; }

  // SELECTION / CURSOR

  // Selection objects are immutable. A new one is created every time
  // the selection changes. A selection is one or more non-overlapping
  // (and non-touching) ranges, sorted, and an integer that indicates
  // which one is the primary selection (the one that's scrolled into
  // view, that getCursor returns, etc).
  function Selection(ranges, primIndex) {
    this.ranges = ranges;
    this.primIndex = primIndex;
  }

  Selection.prototype = {
    primary: function() { return this.ranges[this.primIndex]; },
    equals: function(other) {
      if (other == this) return true;
      if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length) return false;
      for (var i = 0; i < this.ranges.length; i++) {
        var here = this.ranges[i], there = other.ranges[i];
        if (cmp(here.anchor, there.anchor) != 0 || cmp(here.head, there.head) != 0) return false;
      }
      return true;
    },
    deepCopy: function() {
      for (var out = [], i = 0; i < this.ranges.length; i++)
        out[i] = new Range(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head));
      return new Selection(out, this.primIndex);
    },
    somethingSelected: function() {
      for (var i = 0; i < this.ranges.length; i++)
        if (!this.ranges[i].empty()) return true;
      return false;
    },
    contains: function(pos, end) {
      if (!end) end = pos;
      for (var i = 0; i < this.ranges.length; i++) {
        var range = this.ranges[i];
        if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0)
          return i;
      }
      return -1;
    }
  };

  function Range(anchor, head) {
    this.anchor = anchor; this.head = head;
  }

  Range.prototype = {
    from: function() { return minPos(this.anchor, this.head); },
    to: function() { return maxPos(this.anchor, this.head); },
    empty: function() {
      return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch;
    }
  };

  // Take an unsorted, potentially overlapping set of ranges, and
  // build a selection out of it. 'Consumes' ranges array (modifying
  // it).
  function normalizeSelection(ranges, primIndex) {
    var prim = ranges[primIndex];
    ranges.sort(function(a, b) { return cmp(a.from(), b.from()); });
    primIndex = indexOf(ranges, prim);
    for (var i = 1; i < ranges.length; i++) {
      var cur = ranges[i], prev = ranges[i - 1];
      if (cmp(prev.to(), cur.from()) >= 0) {
        var from = minPos(prev.from(), cur.from()), to = maxPos(prev.to(), cur.to());
        var inv = prev.empty() ? cur.from() == cur.head : prev.from() == prev.head;
        if (i <= primIndex) --primIndex;
        ranges.splice(--i, 2, new Range(inv ? to : from, inv ? from : to));
      }
    }
    return new Selection(ranges, primIndex);
  }

  function simpleSelection(anchor, head) {
    return new Selection([new Range(anchor, head || anchor)], 0);
  }

  // Most of the external API clips given positions to make sure they
  // actually exist within the document.
  function clipLine(doc, n) {return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1));}
  function clipPos(doc, pos) {
    if (pos.line < doc.first) return Pos(doc.first, 0);
    var last = doc.first + doc.size - 1;
    if (pos.line > last) return Pos(last, getLine(doc, last).text.length);
    return clipToLen(pos, getLine(doc, pos.line).text.length);
  }
  function clipToLen(pos, linelen) {
    var ch = pos.ch;
    if (ch == null || ch > linelen) return Pos(pos.line, linelen);
    else if (ch < 0) return Pos(pos.line, 0);
    else return pos;
  }
  function isLine(doc, l) {return l >= doc.first && l < doc.first + doc.size;}
  function clipPosArray(doc, array) {
    for (var out = [], i = 0; i < array.length; i++) out[i] = clipPos(doc, array[i]);
    return out;
  }

  // SELECTION UPDATES

  // The 'scroll' parameter given to many of these indicated whether
  // the new cursor position should be scrolled into view after
  // modifying the selection.

  // If shift is held or the extend flag is set, extends a range to
  // include a given position (and optionally a second position).
  // Otherwise, simply returns the range between the given positions.
  // Used for cursor motion and such.
  function extendRange(doc, range, head, other) {
    if (doc.cm && doc.cm.display.shift || doc.extend) {
      var anchor = range.anchor;
      if (other) {
        var posBefore = cmp(head, anchor) < 0;
        if (posBefore != (cmp(other, anchor) < 0)) {
          anchor = head;
          head = other;
        } else if (posBefore != (cmp(head, other) < 0)) {
          head = other;
        }
      }
      return new Range(anchor, head);
    } else {
      return new Range(other || head, head);
    }
  }

  // Extend the primary selection range, discard the rest.
  function extendSelection(doc, head, other, options) {
    setSelection(doc, new Selection([extendRange(doc, doc.sel.primary(), head, other)], 0), options);
  }

  // Extend all selections (pos is an array of selections with length
  // equal the number of selections)
  function extendSelections(doc, heads, options) {
    for (var out = [], i = 0; i < doc.sel.ranges.length; i++)
      out[i] = extendRange(doc, doc.sel.ranges[i], heads[i], null);
    var newSel = normalizeSelection(out, doc.sel.primIndex);
    setSelection(doc, newSel, options);
  }

  // Updates a single range in the selection.
  function replaceOneSelection(doc, i, range, options) {
    var ranges = doc.sel.ranges.slice(0);
    ranges[i] = range;
    setSelection(doc, normalizeSelection(ranges, doc.sel.primIndex), options);
  }

  // Reset the selection to a single range.
  function setSimpleSelection(doc, anchor, head, options) {
    setSelection(doc, simpleSelection(anchor, head), options);
  }

  // Give beforeSelectionChange handlers a change to influence a
  // selection update.
  function filterSelectionChange(doc, sel) {
    var obj = {
      ranges: sel.ranges,
      update: function(ranges) {
        this.ranges = [];
        for (var i = 0; i < ranges.length; i++)
          this.ranges[i] = new Range(clipPos(doc, ranges[i].anchor),
                                     clipPos(doc, ranges[i].head));
      }
    };
    signal(doc, "beforeSelectionChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
    if (obj.ranges != sel.ranges) return normalizeSelection(obj.ranges, obj.ranges.length - 1);
    else return sel;
  }

  function setSelectionReplaceHistory(doc, sel, options) {
    var done = doc.history.done, last = lst(done);
    if (last && last.ranges) {
      done[done.length - 1] = sel;
      setSelectionNoUndo(doc, sel, options);
    } else {
      setSelection(doc, sel, options);
    }
  }

  // Set a new selection.
  function setSelection(doc, sel, options) {
    setSelectionNoUndo(doc, sel, options);
    addSelectionToHistory(doc, doc.sel, doc.cm ? doc.cm.curOp.id : NaN, options);
  }

  function setSelectionNoUndo(doc, sel, options) {
    if (hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange"))
      sel = filterSelectionChange(doc, sel);

    var bias = options && options.bias ||
      (cmp(sel.primary().head, doc.sel.primary().head) < 0 ? -1 : 1);
    setSelectionInner(doc, skipAtomicInSelection(doc, sel, bias, true));

    if (!(options && options.scroll === false) && doc.cm)
      ensureCursorVisible(doc.cm);
  }

  function setSelectionInner(doc, sel) {
    if (sel.equals(doc.sel)) return;

    doc.sel = sel;

    if (doc.cm) {
      doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged = true;
      signalCursorActivity(doc.cm);
    }
    signalLater(doc, "cursorActivity", doc);
  }

  // Verify that the selection does not partially select any atomic
  // marked ranges.
  function reCheckSelection(doc) {
    setSelectionInner(doc, skipAtomicInSelection(doc, doc.sel, null, false), sel_dontScroll);
  }

  // Return a selection that does not partially select any atomic
  // ranges.
  function skipAtomicInSelection(doc, sel, bias, mayClear) {
    var out;
    for (var i = 0; i < sel.ranges.length; i++) {
      var range = sel.ranges[i];
      var newAnchor = skipAtomic(doc, range.anchor, bias, mayClear);
      var newHead = skipAtomic(doc, range.head, bias, mayClear);
      if (out || newAnchor != range.anchor || newHead != range.head) {
        if (!out) out = sel.ranges.slice(0, i);
        out[i] = new Range(newAnchor, newHead);
      }
    }
    return out ? normalizeSelection(out, sel.primIndex) : sel;
  }

  // Ensure a given position is not inside an atomic range.
  function skipAtomic(doc, pos, bias, mayClear) {
    var flipped = false, curPos = pos;
    var dir = bias || 1;
    doc.cantEdit = false;
    search: for (;;) {
      var line = getLine(doc, curPos.line);
      if (line.markedSpans) {
        for (var i = 0; i < line.markedSpans.length; ++i) {
          var sp = line.markedSpans[i], m = sp.marker;
          if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
              (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
            if (mayClear) {
              signal(m, "beforeCursorEnter");
              if (m.explicitlyCleared) {
                if (!line.markedSpans) break;
                else {--i; continue;}
              }
            }
            if (!m.atomic) continue;
            var newPos = m.find(dir < 0 ? -1 : 1);
            if (cmp(newPos, curPos) == 0) {
              newPos.ch += dir;
              if (newPos.ch < 0) {
                if (newPos.line > doc.first) newPos = clipPos(doc, Pos(newPos.line - 1));
                else newPos = null;
              } else if (newPos.ch > line.text.length) {
                if (newPos.line < doc.first + doc.size - 1) newPos = Pos(newPos.line + 1, 0);
                else newPos = null;
              }
              if (!newPos) {
                if (flipped) {
                  // Driven in a corner -- no valid cursor position found at all
                  // -- try again *with* clearing, if we didn't already
                  if (!mayClear) return skipAtomic(doc, pos, bias, true);
                  // Otherwise, turn off editing until further notice, and return the start of the doc
                  doc.cantEdit = true;
                  return Pos(doc.first, 0);
                }
                flipped = true; newPos = pos; dir = -dir;
              }
            }
            curPos = newPos;
            continue search;
          }
        }
      }
      return curPos;
    }
  }

  // SELECTION DRAWING

  // Redraw the selection and/or cursor
  function drawSelection(cm) {
    var display = cm.display, doc = cm.doc, result = {};
    var curFragment = result.cursors = document.createDocumentFragment();
    var selFragment = result.selection = document.createDocumentFragment();

    for (var i = 0; i < doc.sel.ranges.length; i++) {
      var range = doc.sel.ranges[i];
      var collapsed = range.empty();
      if (collapsed || cm.options.showCursorWhenSelecting)
        drawSelectionCursor(cm, range, curFragment);
      if (!collapsed)
        drawSelectionRange(cm, range, selFragment);
    }

    // Move the hidden textarea near the cursor to prevent scrolling artifacts
    if (cm.options.moveInputWithCursor) {
      var headPos = cursorCoords(cm, doc.sel.primary().head, "div");
      var wrapOff = display.wrapper.getBoundingClientRect(), lineOff = display.lineDiv.getBoundingClientRect();
      result.teTop = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                                          headPos.top + lineOff.top - wrapOff.top));
      result.teLeft = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                                           headPos.left + lineOff.left - wrapOff.left));
    }

    return result;
  }

  function showSelection(cm, drawn) {
    removeChildrenAndAdd(cm.display.cursorDiv, drawn.cursors);
    removeChildrenAndAdd(cm.display.selectionDiv, drawn.selection);
    if (drawn.teTop != null) {
      cm.display.inputDiv.style.top = drawn.teTop + "px";
      cm.display.inputDiv.style.left = drawn.teLeft + "px";
    }
  }

  function updateSelection(cm) {
    showSelection(cm, drawSelection(cm));
  }

  // Draws a cursor for the given range
  function drawSelectionCursor(cm, range, output) {
    var pos = cursorCoords(cm, range.head, "div", null, null, !cm.options.singleCursorHeightPerLine);

    var cursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor"));
    cursor.style.left = pos.left + "px";
    cursor.style.top = pos.top + "px";
    cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";

    if (pos.other) {
      // Secondary cursor, shown when on a 'jump' in bi-directional text
      var otherCursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor"));
      otherCursor.style.display = "";
      otherCursor.style.left = pos.other.left + "px";
      otherCursor.style.top = pos.other.top + "px";
      otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
    }
  }

  // Draws the given range as a highlighted selection
  function drawSelectionRange(cm, range, output) {
    var display = cm.display, doc = cm.doc;
    var fragment = document.createDocumentFragment();
    var padding = paddingH(cm.display), leftSide = padding.left, rightSide = display.lineSpace.offsetWidth - padding.right;

    function add(left, top, width, bottom) {
      if (top < 0) top = 0;
      top = Math.round(top);
      bottom = Math.round(bottom);
      fragment.appendChild(elt("div", null, "CodeMirror-selected", "position: absolute; left: " + left +
                               "px; top: " + top + "px; width: " + (width == null ? rightSide - left : width) +
                               "px; height: " + (bottom - top) + "px"));
    }

    function drawForLine(line, fromArg, toArg) {
      var lineObj = getLine(doc, line);
      var lineLen = lineObj.text.length;
      var start, end;
      function coords(ch, bias) {
        return charCoords(cm, Pos(line, ch), "div", lineObj, bias);
      }

      iterateBidiSections(getOrder(lineObj), fromArg || 0, toArg == null ? lineLen : toArg, function(from, to, dir) {
        var leftPos = coords(from, "left"), rightPos, left, right;
        if (from == to) {
          rightPos = leftPos;
          left = right = leftPos.left;
        } else {
          rightPos = coords(to - 1, "right");
          if (dir == "rtl") { var tmp = leftPos; leftPos = rightPos; rightPos = tmp; }
          left = leftPos.left;
          right = rightPos.right;
        }
        if (fromArg == null && from == 0) left = leftSide;
        if (rightPos.top - leftPos.top > 3) { // Different lines, draw top part
          add(left, leftPos.top, null, leftPos.bottom);
          left = leftSide;
          if (leftPos.bottom < rightPos.top) add(left, leftPos.bottom, null, rightPos.top);
        }
        if (toArg == null && to == lineLen) right = rightSide;
        if (!start || leftPos.top < start.top || leftPos.top == start.top && leftPos.left < start.left)
          start = leftPos;
        if (!end || rightPos.bottom > end.bottom || rightPos.bottom == end.bottom && rightPos.right > end.right)
          end = rightPos;
        if (left < leftSide + 1) left = leftSide;
        add(left, rightPos.top, right - left, rightPos.bottom);
      });
      return {start: start, end: end};
    }

    var sFrom = range.from(), sTo = range.to();
    if (sFrom.line == sTo.line) {
      drawForLine(sFrom.line, sFrom.ch, sTo.ch);
    } else {
      var fromLine = getLine(doc, sFrom.line), toLine = getLine(doc, sTo.line);
      var singleVLine = visualLine(fromLine) == visualLine(toLine);
      var leftEnd = drawForLine(sFrom.line, sFrom.ch, singleVLine ? fromLine.text.length + 1 : null).end;
      var rightStart = drawForLine(sTo.line, singleVLine ? 0 : null, sTo.ch).start;
      if (singleVLine) {
        if (leftEnd.top < rightStart.top - 2) {
          add(leftEnd.right, leftEnd.top, null, leftEnd.bottom);
          add(leftSide, rightStart.top, rightStart.left, rightStart.bottom);
        } else {
          add(leftEnd.right, leftEnd.top, rightStart.left - leftEnd.right, leftEnd.bottom);
        }
      }
      if (leftEnd.bottom < rightStart.top)
        add(leftSide, leftEnd.bottom, null, rightStart.top);
    }

    output.appendChild(fragment);
  }

  // Cursor-blinking
  function restartBlink(cm) {
    if (!cm.state.focused) return;
    var display = cm.display;
    clearInterval(display.blinker);
    var on = true;
    display.cursorDiv.style.visibility = "";
    if (cm.options.cursorBlinkRate > 0)
      display.blinker = setInterval(function() {
        display.cursorDiv.style.visibility = (on = !on) ? "" : "hidden";
      }, cm.options.cursorBlinkRate);
    else if (cm.options.cursorBlinkRate < 0)
      display.cursorDiv.style.visibility = "hidden";
  }

  // HIGHLIGHT WORKER

  function startWorker(cm, time) {
    if (cm.doc.mode.startState && cm.doc.frontier < cm.display.viewTo)
      cm.state.highlight.set(time, bind(highlightWorker, cm));
  }

  function highlightWorker(cm) {
    var doc = cm.doc;
    if (doc.frontier < doc.first) doc.frontier = doc.first;
    if (doc.frontier >= cm.display.viewTo) return;
    var end = +new Date + cm.options.workTime;
    var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));
    var changedLines = [];

    doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.viewTo + 500), function(line) {
      if (doc.frontier >= cm.display.viewFrom) { // Visible
        var oldStyles = line.styles;
        var highlighted = highlightLine(cm, line, state, true);
        line.styles = highlighted.styles;
        var oldCls = line.styleClasses, newCls = highlighted.classes;
        if (newCls) line.styleClasses = newCls;
        else if (oldCls) line.styleClasses = null;
        var ischange = !oldStyles || oldStyles.length != line.styles.length ||
          oldCls != newCls && (!oldCls || !newCls || oldCls.bgClass != newCls.bgClass || oldCls.textClass != newCls.textClass);
        for (var i = 0; !ischange && i < oldStyles.length; ++i) ischange = oldStyles[i] != line.styles[i];
        if (ischange) changedLines.push(doc.frontier);
        line.stateAfter = copyState(doc.mode, state);
      } else {
        processLine(cm, line.text, state);
        line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
      }
      ++doc.frontier;
      if (+new Date > end) {
        startWorker(cm, cm.options.workDelay);
        return true;
      }
    });
    if (changedLines.length) runInOp(cm, function() {
      for (var i = 0; i < changedLines.length; i++)
        regLineChange(cm, changedLines[i], "text");
    });
  }

  // Finds the line to start with when starting a parse. Tries to
  // find a line with a stateAfter, so that it can start with a
  // valid state. If that fails, it returns the line with the
  // smallest indentation, which tends to need the least context to
  // parse correctly.
  function findStartLine(cm, n, precise) {
    var minindent, minline, doc = cm.doc;
    var lim = precise ? -1 : n - (cm.doc.mode.innerMode ? 1000 : 100);
    for (var search = n; search > lim; --search) {
      if (search <= doc.first) return doc.first;
      var line = getLine(doc, search - 1);
      if (line.stateAfter && (!precise || search <= doc.frontier)) return search;
      var indented = countColumn(line.text, null, cm.options.tabSize);
      if (minline == null || minindent > indented) {
        minline = search - 1;
        minindent = indented;
      }
    }
    return minline;
  }

  function getStateBefore(cm, n, precise) {
    var doc = cm.doc, display = cm.display;
    if (!doc.mode.startState) return true;
    var pos = findStartLine(cm, n, precise), state = pos > doc.first && getLine(doc, pos-1).stateAfter;
    if (!state) state = startState(doc.mode);
    else state = copyState(doc.mode, state);
    doc.iter(pos, n, function(line) {
      processLine(cm, line.text, state);
      var save = pos == n - 1 || pos % 5 == 0 || pos >= display.viewFrom && pos < display.viewTo;
      line.stateAfter = save ? copyState(doc.mode, state) : null;
      ++pos;
    });
    if (precise) doc.frontier = pos;
    return state;
  }

  // POSITION MEASUREMENT

  function paddingTop(display) {return display.lineSpace.offsetTop;}
  function paddingVert(display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight;}
  function paddingH(display) {
    if (display.cachedPaddingH) return display.cachedPaddingH;
    var e = removeChildrenAndAdd(display.measure, elt("pre", "x"));
    var style = window.getComputedStyle ? window.getComputedStyle(e) : e.currentStyle;
    var data = {left: parseInt(style.paddingLeft), right: parseInt(style.paddingRight)};
    if (!isNaN(data.left) && !isNaN(data.right)) display.cachedPaddingH = data;
    return data;
  }

  // Ensure the lineView.wrapping.heights array is populated. This is
  // an array of bottom offsets for the lines that make up a drawn
  // line. When lineWrapping is on, there might be more than one
  // height.
  function ensureLineHeights(cm, lineView, rect) {
    var wrapping = cm.options.lineWrapping;
    var curWidth = wrapping && cm.display.scroller.clientWidth;
    if (!lineView.measure.heights || wrapping && lineView.measure.width != curWidth) {
      var heights = lineView.measure.heights = [];
      if (wrapping) {
        lineView.measure.width = curWidth;
        var rects = lineView.text.firstChild.getClientRects();
        for (var i = 0; i < rects.length - 1; i++) {
          var cur = rects[i], next = rects[i + 1];
          if (Math.abs(cur.bottom - next.bottom) > 2)
            heights.push((cur.bottom + next.top) / 2 - rect.top);
        }
      }
      heights.push(rect.bottom - rect.top);
    }
  }

  // Find a line map (mapping character offsets to text nodes) and a
  // measurement cache for the given line number. (A line view might
  // contain multiple lines when collapsed ranges are present.)
  function mapFromLineView(lineView, line, lineN) {
    if (lineView.line == line)
      return {map: lineView.measure.map, cache: lineView.measure.cache};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineView.rest[i] == line)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i]};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineNo(lineView.rest[i]) > lineN)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i], before: true};
  }

  // Render a line into the hidden node display.externalMeasured. Used
  // when measurement is needed for a line that's not in the viewport.
  function updateExternalMeasurement(cm, line) {
    line = visualLine(line);
    var lineN = lineNo(line);
    var view = cm.display.externalMeasured = new LineView(cm.doc, line, lineN);
    view.lineN = lineN;
    var built = view.built = buildLineContent(cm, view);
    view.text = built.pre;
    removeChildrenAndAdd(cm.display.lineMeasure, built.pre);
    return view;
  }

  // Get a {top, bottom, left, right} box (in line-local coordinates)
  // for a given character.
  function measureChar(cm, line, ch, bias) {
    return measureCharPrepared(cm, prepareMeasureForLine(cm, line), ch, bias);
  }

  // Find a line view that corresponds to the given line number.
  function findViewForLine(cm, lineN) {
    if (lineN >= cm.display.viewFrom && lineN < cm.display.viewTo)
      return cm.display.view[findViewIndex(cm, lineN)];
    var ext = cm.display.externalMeasured;
    if (ext && lineN >= ext.lineN && lineN < ext.lineN + ext.size)
      return ext;
  }

  // Measurement can be split in two steps, the set-up work that
  // applies to the whole line, and the measurement of the actual
  // character. Functions like coordsChar, that need to do a lot of
  // measurements in a row, can thus ensure that the set-up work is
  // only done once.
  function prepareMeasureForLine(cm, line) {
    var lineN = lineNo(line);
    var view = findViewForLine(cm, lineN);
    if (view && !view.text)
      view = null;
    else if (view && view.changes)
      updateLineForChanges(cm, view, lineN, getDimensions(cm));
    if (!view)
      view = updateExternalMeasurement(cm, line);

    var info = mapFromLineView(view, line, lineN);
    return {
      line: line, view: view, rect: null,
      map: info.map, cache: info.cache, before: info.before,
      hasHeights: false
    };
  }

  // Given a prepared measurement object, measures the position of an
  // actual character (or fetches it from the cache).
  function measureCharPrepared(cm, prepared, ch, bias, varHeight) {
    if (prepared.before) ch = -1;
    var key = ch + (bias || ""), found;
    if (prepared.cache.hasOwnProperty(key)) {
      found = prepared.cache[key];
    } else {
      if (!prepared.rect)
        prepared.rect = prepared.view.text.getBoundingClientRect();
      if (!prepared.hasHeights) {
        ensureLineHeights(cm, prepared.view, prepared.rect);
        prepared.hasHeights = true;
      }
      found = measureCharInner(cm, prepared, ch, bias);
      if (!found.bogus) prepared.cache[key] = found;
    }
    return {left: found.left, right: found.right,
            top: varHeight ? found.rtop : found.top,
            bottom: varHeight ? found.rbottom : found.bottom};
  }

  var nullRect = {left: 0, right: 0, top: 0, bottom: 0};

  function measureCharInner(cm, prepared, ch, bias) {
    var map = prepared.map;

    var node, start, end, collapse;
    // First, search the line map for the text node corresponding to,
    // or closest to, the target character.
    for (var i = 0; i < map.length; i += 3) {
      var mStart = map[i], mEnd = map[i + 1];
      if (ch < mStart) {
        start = 0; end = 1;
        collapse = "left";
      } else if (ch < mEnd) {
        start = ch - mStart;
        end = start + 1;
      } else if (i == map.length - 3 || ch == mEnd && map[i + 3] > ch) {
        end = mEnd - mStart;
        start = end - 1;
        if (ch >= mEnd) collapse = "right";
      }
      if (start != null) {
        node = map[i + 2];
        if (mStart == mEnd && bias == (node.insertLeft ? "left" : "right"))
          collapse = bias;
        if (bias == "left" && start == 0)
          while (i && map[i - 2] == map[i - 3] && map[i - 1].insertLeft) {
            node = map[(i -= 3) + 2];
            collapse = "left";
          }
        if (bias == "right" && start == mEnd - mStart)
          while (i < map.length - 3 && map[i + 3] == map[i + 4] && !map[i + 5].insertLeft) {
            node = map[(i += 3) + 2];
            collapse = "right";
          }
        break;
      }
    }

    var rect;
    if (node.nodeType == 3) { // If it is a text node, use a range to retrieve the coordinates.
      for (var i = 0; i < 4; i++) { // Retry a maximum of 4 times when nonsense rectangles are returned
        while (start && isExtendingChar(prepared.line.text.charAt(mStart + start))) --start;
        while (mStart + end < mEnd && isExtendingChar(prepared.line.text.charAt(mStart + end))) ++end;
        if (ie && ie_version < 9 && start == 0 && end == mEnd - mStart) {
          rect = node.parentNode.getBoundingClientRect();
        } else if (ie && cm.options.lineWrapping) {
          var rects = range(node, start, end).getClientRects();
          if (rects.length)
            rect = rects[bias == "right" ? rects.length - 1 : 0];
          else
            rect = nullRect;
        } else {
          rect = range(node, start, end).getBoundingClientRect() || nullRect;
        }
        if (rect.left || rect.right || start == 0) break;
        end = start;
        start = start - 1;
        collapse = "right";
      }
      if (ie && ie_version < 11) rect = maybeUpdateRectForZooming(cm.display.measure, rect);
    } else { // If it is a widget, simply get the box for the whole widget.
      if (start > 0) collapse = bias = "right";
      var rects;
      if (cm.options.lineWrapping && (rects = node.getClientRects()).length > 1)
        rect = rects[bias == "right" ? rects.length - 1 : 0];
      else
        rect = node.getBoundingClientRect();
    }
    if (ie && ie_version < 9 && !start && (!rect || !rect.left && !rect.right)) {
      var rSpan = node.parentNode.getClientRects()[0];
      if (rSpan)
        rect = {left: rSpan.left, right: rSpan.left + charWidth(cm.display), top: rSpan.top, bottom: rSpan.bottom};
      else
        rect = nullRect;
    }

    var rtop = rect.top - prepared.rect.top, rbot = rect.bottom - prepared.rect.top;
    var mid = (rtop + rbot) / 2;
    var heights = prepared.view.measure.heights;
    for (var i = 0; i < heights.length - 1; i++)
      if (mid < heights[i]) break;
    var top = i ? heights[i - 1] : 0, bot = heights[i];
    var result = {left: (collapse == "right" ? rect.right : rect.left) - prepared.rect.left,
                  right: (collapse == "left" ? rect.left : rect.right) - prepared.rect.left,
                  top: top, bottom: bot};
    if (!rect.left && !rect.right) result.bogus = true;
    if (!cm.options.singleCursorHeightPerLine) { result.rtop = rtop; result.rbottom = rbot; }

    return result;
  }

  // Work around problem with bounding client rects on ranges being
  // returned incorrectly when zoomed on IE10 and below.
  function maybeUpdateRectForZooming(measure, rect) {
    if (!window.screen || screen.logicalXDPI == null ||
        screen.logicalXDPI == screen.deviceXDPI || !hasBadZoomedRects(measure))
      return rect;
    var scaleX = screen.logicalXDPI / screen.deviceXDPI;
    var scaleY = screen.logicalYDPI / screen.deviceYDPI;
    return {left: rect.left * scaleX, right: rect.right * scaleX,
            top: rect.top * scaleY, bottom: rect.bottom * scaleY};
  }

  function clearLineMeasurementCacheFor(lineView) {
    if (lineView.measure) {
      lineView.measure.cache = {};
      lineView.measure.heights = null;
      if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
        lineView.measure.caches[i] = {};
    }
  }

  function clearLineMeasurementCache(cm) {
    cm.display.externalMeasure = null;
    removeChildren(cm.display.lineMeasure);
    for (var i = 0; i < cm.display.view.length; i++)
      clearLineMeasurementCacheFor(cm.display.view[i]);
  }

  function clearCaches(cm) {
    clearLineMeasurementCache(cm);
    cm.display.cachedCharWidth = cm.display.cachedTextHeight = cm.display.cachedPaddingH = null;
    if (!cm.options.lineWrapping) cm.display.maxLineChanged = true;
    cm.display.lineNumChars = null;
  }

  function pageScrollX() { return window.pageXOffset || (document.documentElement || document.body).scrollLeft; }
  function pageScrollY() { return window.pageYOffset || (document.documentElement || document.body).scrollTop; }

  // Converts a {top, bottom, left, right} box from line-local
  // coordinates into another coordinate system. Context may be one of
  // "line", "div" (display.lineDiv), "local"/null (editor), or "page".
  function intoCoordSystem(cm, lineObj, rect, context) {
    if (lineObj.widgets) for (var i = 0; i < lineObj.widgets.length; ++i) if (lineObj.widgets[i].above) {
      var size = widgetHeight(lineObj.widgets[i]);
      rect.top += size; rect.bottom += size;
    }
    if (context == "line") return rect;
    if (!context) context = "local";
    var yOff = heightAtLine(lineObj);
    if (context == "local") yOff += paddingTop(cm.display);
    else yOff -= cm.display.viewOffset;
    if (context == "page" || context == "window") {
      var lOff = cm.display.lineSpace.getBoundingClientRect();
      yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
      var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
      rect.left += xOff; rect.right += xOff;
    }
    rect.top += yOff; rect.bottom += yOff;
    return rect;
  }

  // Coverts a box from "div" coords to another coordinate system.
  // Context may be "window", "page", "div", or "local"/null.
  function fromCoordSystem(cm, coords, context) {
    if (context == "div") return coords;
    var left = coords.left, top = coords.top;
    // First move into "page" coordinate system
    if (context == "page") {
      left -= pageScrollX();
      top -= pageScrollY();
    } else if (context == "local" || !context) {
      var localBox = cm.display.sizer.getBoundingClientRect();
      left += localBox.left;
      top += localBox.top;
    }

    var lineSpaceBox = cm.display.lineSpace.getBoundingClientRect();
    return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top};
  }

  function charCoords(cm, pos, context, lineObj, bias) {
    if (!lineObj) lineObj = getLine(cm.doc, pos.line);
    return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, bias), context);
  }

  // Returns a box for a given cursor position, which may have an
  // 'other' property containing the position of the secondary cursor
  // on a bidi boundary.
  function cursorCoords(cm, pos, context, lineObj, preparedMeasure, varHeight) {
    lineObj = lineObj || getLine(cm.doc, pos.line);
    if (!preparedMeasure) preparedMeasure = prepareMeasureForLine(cm, lineObj);
    function get(ch, right) {
      var m = measureCharPrepared(cm, preparedMeasure, ch, right ? "right" : "left", varHeight);
      if (right) m.left = m.right; else m.right = m.left;
      return intoCoordSystem(cm, lineObj, m, context);
    }
    function getBidi(ch, partPos) {
      var part = order[partPos], right = part.level % 2;
      if (ch == bidiLeft(part) && partPos && part.level < order[partPos - 1].level) {
        part = order[--partPos];
        ch = bidiRight(part) - (part.level % 2 ? 0 : 1);
        right = true;
      } else if (ch == bidiRight(part) && partPos < order.length - 1 && part.level < order[partPos + 1].level) {
        part = order[++partPos];
        ch = bidiLeft(part) - part.level % 2;
        right = false;
      }
      if (right && ch == part.to && ch > part.from) return get(ch - 1);
      return get(ch, right);
    }
    var order = getOrder(lineObj), ch = pos.ch;
    if (!order) return get(ch);
    var partPos = getBidiPartAt(order, ch);
    var val = getBidi(ch, partPos);
    if (bidiOther != null) val.other = getBidi(ch, bidiOther);
    return val;
  }

  // Used to cheaply estimate the coordinates for a position. Used for
  // intermediate scroll updates.
  function estimateCoords(cm, pos) {
    var left = 0, pos = clipPos(cm.doc, pos);
    if (!cm.options.lineWrapping) left = charWidth(cm.display) * pos.ch;
    var lineObj = getLine(cm.doc, pos.line);
    var top = heightAtLine(lineObj) + paddingTop(cm.display);
    return {left: left, right: left, top: top, bottom: top + lineObj.height};
  }

  // Positions returned by coordsChar contain some extra information.
  // xRel is the relative x position of the input coordinates compared
  // to the found position (so xRel > 0 means the coordinates are to
  // the right of the character position, for example). When outside
  // is true, that means the coordinates lie outside the line's
  // vertical range.
  function PosWithInfo(line, ch, outside, xRel) {
    var pos = Pos(line, ch);
    pos.xRel = xRel;
    if (outside) pos.outside = true;
    return pos;
  }

  // Compute the character position closest to the given coordinates.
  // Input must be lineSpace-local ("div" coordinate system).
  function coordsChar(cm, x, y) {
    var doc = cm.doc;
    y += cm.display.viewOffset;
    if (y < 0) return PosWithInfo(doc.first, 0, true, -1);
    var lineN = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
    if (lineN > last)
      return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).text.length, true, 1);
    if (x < 0) x = 0;

    var lineObj = getLine(doc, lineN);
    for (;;) {
      var found = coordsCharInner(cm, lineObj, lineN, x, y);
      var merged = collapsedSpanAtEnd(lineObj);
      var mergedPos = merged && merged.find(0, true);
      if (merged && (found.ch > mergedPos.from.ch || found.ch == mergedPos.from.ch && found.xRel > 0))
        lineN = lineNo(lineObj = mergedPos.to.line);
      else
        return found;
    }
  }

  function coordsCharInner(cm, lineObj, lineNo, x, y) {
    var innerOff = y - heightAtLine(lineObj);
    var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
    var preparedMeasure = prepareMeasureForLine(cm, lineObj);

    function getX(ch) {
      var sp = cursorCoords(cm, Pos(lineNo, ch), "line", lineObj, preparedMeasure);
      wrongLine = true;
      if (innerOff > sp.bottom) return sp.left - adjust;
      else if (innerOff < sp.top) return sp.left + adjust;
      else wrongLine = false;
      return sp.left;
    }

    var bidi = getOrder(lineObj), dist = lineObj.text.length;
    var from = lineLeft(lineObj), to = lineRight(lineObj);
    var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

    if (x > toX) return PosWithInfo(lineNo, to, toOutside, 1);
    // Do a binary search between these bounds.
    for (;;) {
      if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
        var ch = x < fromX || x - fromX <= toX - x ? from : to;
        var xDiff = x - (ch == from ? fromX : toX);
        while (isExtendingChar(lineObj.text.charAt(ch))) ++ch;
        var pos = PosWithInfo(lineNo, ch, ch == from ? fromOutside : toOutside,
                              xDiff < -1 ? -1 : xDiff > 1 ? 1 : 0);
        return pos;
      }
      var step = Math.ceil(dist / 2), middle = from + step;
      if (bidi) {
        middle = from;
        for (var i = 0; i < step; ++i) middle = moveVisually(lineObj, middle, 1);
      }
      var middleX = getX(middle);
      if (middleX > x) {to = middle; toX = middleX; if (toOutside = wrongLine) toX += 1000; dist = step;}
      else {from = middle; fromX = middleX; fromOutside = wrongLine; dist -= step;}
    }
  }

  var measureText;
  // Compute the default text height.
  function textHeight(display) {
    if (display.cachedTextHeight != null) return display.cachedTextHeight;
    if (measureText == null) {
      measureText = elt("pre");
      // Measure a bunch of lines, for browsers that compute
      // fractional heights.
      for (var i = 0; i < 49; ++i) {
        measureText.appendChild(document.createTextNode("x"));
        measureText.appendChild(elt("br"));
      }
      measureText.appendChild(document.createTextNode("x"));
    }
    removeChildrenAndAdd(display.measure, measureText);
    var height = measureText.offsetHeight / 50;
    if (height > 3) display.cachedTextHeight = height;
    removeChildren(display.measure);
    return height || 1;
  }

  // Compute the default character width.
  function charWidth(display) {
    if (display.cachedCharWidth != null) return display.cachedCharWidth;
    var anchor = elt("span", "xxxxxxxxxx");
    var pre = elt("pre", [anchor]);
    removeChildrenAndAdd(display.measure, pre);
    var rect = anchor.getBoundingClientRect(), width = (rect.right - rect.left) / 10;
    if (width > 2) display.cachedCharWidth = width;
    return width || 10;
  }

  // OPERATIONS

  // Operations are used to wrap a series of changes to the editor
  // state in such a way that each change won't have to update the
  // cursor and display (which would be awkward, slow, and
  // error-prone). Instead, display updates are batched and then all
  // combined and executed at once.

  var operationGroup = null;

  var nextOpId = 0;
  // Start a new operation.
  function startOperation(cm) {
    cm.curOp = {
      cm: cm,
      viewChanged: false,      // Flag that indicates that lines might need to be redrawn
      startHeight: cm.doc.height, // Used to detect need to update scrollbar
      forceUpdate: false,      // Used to force a redraw
      updateInput: null,       // Whether to reset the input textarea
      typing: false,           // Whether this reset should be careful to leave existing text (for compositing)
      changeObjs: null,        // Accumulated changes, for firing change events
      cursorActivityHandlers: null, // Set of handlers to fire cursorActivity on
      cursorActivityCalled: 0, // Tracks which cursorActivity handlers have been called already
      selectionChanged: false, // Whether the selection needs to be redrawn
      updateMaxLine: false,    // Set when the widest line needs to be determined anew
      scrollLeft: null, scrollTop: null, // Intermediate scroll position, not pushed to DOM yet
      scrollToPos: null,       // Used to scroll to a specific position
      id: ++nextOpId           // Unique ID
    };
    if (operationGroup) {
      operationGroup.ops.push(cm.curOp);
    } else {
      cm.curOp.ownsGroup = operationGroup = {
        ops: [cm.curOp],
        delayedCallbacks: []
      };
    }
  }

  function fireCallbacksForOps(group) {
    // Calls delayed callbacks and cursorActivity handlers until no
    // new ones appear
    var callbacks = group.delayedCallbacks, i = 0;
    do {
      for (; i < callbacks.length; i++)
        callbacks[i]();
      for (var j = 0; j < group.ops.length; j++) {
        var op = group.ops[j];
        if (op.cursorActivityHandlers)
          while (op.cursorActivityCalled < op.cursorActivityHandlers.length)
            op.cursorActivityHandlers[op.cursorActivityCalled++](op.cm);
      }
    } while (i < callbacks.length);
  }

  // Finish an operation, updating the display and signalling delayed events
  function endOperation(cm) {
    var op = cm.curOp, group = op.ownsGroup;
    if (!group) return;

    try { fireCallbacksForOps(group); }
    finally {
      operationGroup = null;
      for (var i = 0; i < group.ops.length; i++)
        group.ops[i].cm.curOp = null;
      endOperations(group);
    }
  }

  // The DOM updates done when an operation finishes are batched so
  // that the minimum number of relayouts are required.
  function endOperations(group) {
    var ops = group.ops;
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_finish(ops[i]);
  }

  function endOperation_R1(op) {
    var cm = op.cm, display = cm.display;
    if (op.updateMaxLine) findMaxLine(cm);

    op.mustUpdate = op.viewChanged || op.forceUpdate || op.scrollTop != null ||
      op.scrollToPos && (op.scrollToPos.from.line < display.viewFrom ||
                         op.scrollToPos.to.line >= display.viewTo) ||
      display.maxLineChanged && cm.options.lineWrapping;
    op.update = op.mustUpdate &&
      new DisplayUpdate(cm, op.mustUpdate && {top: op.scrollTop, ensure: op.scrollToPos}, op.forceUpdate);
  }

  function endOperation_W1(op) {
    op.updatedDisplay = op.mustUpdate && updateDisplayIfNeeded(op.cm, op.update);
  }

  function endOperation_R2(op) {
    var cm = op.cm, display = cm.display;
    if (op.updatedDisplay) updateHeightsInViewport(cm);

    op.barMeasure = measureForScrollbars(cm);

    // If the max line changed since it was last measured, measure it,
    // and ensure the document's width matches it.
    // updateDisplay_W2 will use these properties to do the actual resizing
    if (display.maxLineChanged && !cm.options.lineWrapping) {
      op.adjustWidthTo = measureChar(cm, display.maxLine, display.maxLine.text.length).left + 3;
      op.maxScrollLeft = Math.max(0, display.sizer.offsetLeft + op.adjustWidthTo +
                                  scrollerCutOff - display.scroller.clientWidth);
    }

    if (op.updatedDisplay || op.selectionChanged)
      op.newSelectionNodes = drawSelection(cm);
  }

  function endOperation_W2(op) {
    var cm = op.cm;

    if (op.adjustWidthTo != null) {
      cm.display.sizer.style.minWidth = op.adjustWidthTo + "px";
      if (op.maxScrollLeft < cm.doc.scrollLeft)
        setScrollLeft(cm, Math.min(cm.display.scroller.scrollLeft, op.maxScrollLeft), true);
      cm.display.maxLineChanged = false;
    }

    if (op.newSelectionNodes)
      showSelection(cm, op.newSelectionNodes);
    if (op.updatedDisplay)
      setDocumentHeight(cm, op.barMeasure);
    if (op.updatedDisplay || op.startHeight != cm.doc.height)
      updateScrollbars(cm, op.barMeasure);

    if (op.selectionChanged) restartBlink(cm);

    if (cm.state.focused && op.updateInput)
      resetInput(cm, op.typing);
  }

  function endOperation_finish(op) {
    var cm = op.cm, display = cm.display, doc = cm.doc;

    if (op.adjustWidthTo != null && Math.abs(op.barMeasure.scrollWidth - cm.display.scroller.scrollWidth) > 1)
      updateScrollbars(cm);

    if (op.updatedDisplay) postUpdateDisplay(cm, op.update);

    // Abort mouse wheel delta measurement, when scrolling explicitly
    if (display.wheelStartX != null && (op.scrollTop != null || op.scrollLeft != null || op.scrollToPos))
      display.wheelStartX = display.wheelStartY = null;

    // Propagate the scroll position to the actual DOM scroller
    if (op.scrollTop != null && (display.scroller.scrollTop != op.scrollTop || op.forceScroll)) {
      var top = Math.max(0, Math.min(display.scroller.scrollHeight - display.scroller.clientHeight, op.scrollTop));
      display.scroller.scrollTop = display.scrollbarV.scrollTop = doc.scrollTop = top;
    }
    if (op.scrollLeft != null && (display.scroller.scrollLeft != op.scrollLeft || op.forceScroll)) {
      var left = Math.max(0, Math.min(display.scroller.scrollWidth - display.scroller.clientWidth, op.scrollLeft));
      display.scroller.scrollLeft = display.scrollbarH.scrollLeft = doc.scrollLeft = left;
      alignHorizontally(cm);
    }
    // If we need to scroll a specific position into view, do so.
    if (op.scrollToPos) {
      var coords = scrollPosIntoView(cm, clipPos(doc, op.scrollToPos.from),
                                     clipPos(doc, op.scrollToPos.to), op.scrollToPos.margin);
      if (op.scrollToPos.isCursor && cm.state.focused) maybeScrollWindow(cm, coords);
    }

    // Fire events for markers that are hidden/unidden by editing or
    // undoing
    var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
    if (hidden) for (var i = 0; i < hidden.length; ++i)
      if (!hidden[i].lines.length) signal(hidden[i], "hide");
    if (unhidden) for (var i = 0; i < unhidden.length; ++i)
      if (unhidden[i].lines.length) signal(unhidden[i], "unhide");

    if (display.wrapper.offsetHeight)
      doc.scrollTop = cm.display.scroller.scrollTop;

    // Apply workaround for two webkit bugs
    if (op.updatedDisplay && webkit) {
      if (cm.options.lineWrapping)
        checkForWebkitWidthBug(cm, op.barMeasure); // (Issue #2420)
      if (op.barMeasure.scrollWidth > op.barMeasure.clientWidth &&
          op.barMeasure.scrollWidth < op.barMeasure.clientWidth + 1 &&
          !hScrollbarTakesSpace(cm))
        updateScrollbars(cm); // (Issue #2562)
    }

    // Fire change events, and delayed event handlers
    if (op.changeObjs)
      signal(cm, "changes", cm, op.changeObjs);
  }

  // Run the given function in an operation
  function runInOp(cm, f) {
    if (cm.curOp) return f();
    startOperation(cm);
    try { return f(); }
    finally { endOperation(cm); }
  }
  // Wraps a function in an operation. Returns the wrapped function.
  function operation(cm, f) {
    return function() {
      if (cm.curOp) return f.apply(cm, arguments);
      startOperation(cm);
      try { return f.apply(cm, arguments); }
      finally { endOperation(cm); }
    };
  }
  // Used to add methods to editor and doc instances, wrapping them in
  // operations.
  function methodOp(f) {
    return function() {
      if (this.curOp) return f.apply(this, arguments);
      startOperation(this);
      try { return f.apply(this, arguments); }
      finally { endOperation(this); }
    };
  }
  function docMethodOp(f) {
    return function() {
      var cm = this.cm;
      if (!cm || cm.curOp) return f.apply(this, arguments);
      startOperation(cm);
      try { return f.apply(this, arguments); }
      finally { endOperation(cm); }
    };
  }

  // VIEW TRACKING

  // These objects are used to represent the visible (currently drawn)
  // part of the document. A LineView may correspond to multiple
  // logical lines, if those are connected by collapsed ranges.
  function LineView(doc, line, lineN) {
    // The starting line
    this.line = line;
    // Continuing lines, if any
    this.rest = visualLineContinued(line);
    // Number of logical lines in this visual line
    this.size = this.rest ? lineNo(lst(this.rest)) - lineN + 1 : 1;
    this.node = this.text = null;
    this.hidden = lineIsHidden(doc, line);
  }

  // Create a range of LineView objects for the given lines.
  function buildViewArray(cm, from, to) {
    var array = [], nextPos;
    for (var pos = from; pos < to; pos = nextPos) {
      var view = new LineView(cm.doc, getLine(cm.doc, pos), pos);
      nextPos = pos + view.size;
      array.push(view);
    }
    return array;
  }

  // Updates the display.view data structure for a given change to the
  // document. From and to are in pre-change coordinates. Lendiff is
  // the amount of lines added or subtracted by the change. This is
  // used for changes that span multiple lines, or change the way
  // lines are divided into visual lines. regLineChange (below)
  // registers single-line changes.
  function regChange(cm, from, to, lendiff) {
    if (from == null) from = cm.doc.first;
    if (to == null) to = cm.doc.first + cm.doc.size;
    if (!lendiff) lendiff = 0;

    var display = cm.display;
    if (lendiff && to < display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers > from))
      display.updateLineNumbers = from;

    cm.curOp.viewChanged = true;

    if (from >= display.viewTo) { // Change after
      if (sawCollapsedSpans && visualLineNo(cm.doc, from) < display.viewTo)
        resetView(cm);
    } else if (to <= display.viewFrom) { // Change before
      if (sawCollapsedSpans && visualLineEndNo(cm.doc, to + lendiff) > display.viewFrom) {
        resetView(cm);
      } else {
        display.viewFrom += lendiff;
        display.viewTo += lendiff;
      }
    } else if (from <= display.viewFrom && to >= display.viewTo) { // Full overlap
      resetView(cm);
    } else if (from <= display.viewFrom) { // Top overlap
      var cut = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cut) {
        display.view = display.view.slice(cut.index);
        display.viewFrom = cut.lineN;
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    } else if (to >= display.viewTo) { // Bottom overlap
      var cut = viewCuttingPoint(cm, from, from, -1);
      if (cut) {
        display.view = display.view.slice(0, cut.index);
        display.viewTo = cut.lineN;
      } else {
        resetView(cm);
      }
    } else { // Gap in the middle
      var cutTop = viewCuttingPoint(cm, from, from, -1);
      var cutBot = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cutTop && cutBot) {
        display.view = display.view.slice(0, cutTop.index)
          .concat(buildViewArray(cm, cutTop.lineN, cutBot.lineN))
          .concat(display.view.slice(cutBot.index));
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    }

    var ext = display.externalMeasured;
    if (ext) {
      if (to < ext.lineN)
        ext.lineN += lendiff;
      else if (from < ext.lineN + ext.size)
        display.externalMeasured = null;
    }
  }

  // Register a change to a single line. Type must be one of "text",
  // "gutter", "class", "widget"
  function regLineChange(cm, line, type) {
    cm.curOp.viewChanged = true;
    var display = cm.display, ext = cm.display.externalMeasured;
    if (ext && line >= ext.lineN && line < ext.lineN + ext.size)
      display.externalMeasured = null;

    if (line < display.viewFrom || line >= display.viewTo) return;
    var lineView = display.view[findViewIndex(cm, line)];
    if (lineView.node == null) return;
    var arr = lineView.changes || (lineView.changes = []);
    if (indexOf(arr, type) == -1) arr.push(type);
  }

  // Clear the view.
  function resetView(cm) {
    cm.display.viewFrom = cm.display.viewTo = cm.doc.first;
    cm.display.view = [];
    cm.display.viewOffset = 0;
  }

  // Find the view element corresponding to a given line. Return null
  // when the line isn't visible.
  function findViewIndex(cm, n) {
    if (n >= cm.display.viewTo) return null;
    n -= cm.display.viewFrom;
    if (n < 0) return null;
    var view = cm.display.view;
    for (var i = 0; i < view.length; i++) {
      n -= view[i].size;
      if (n < 0) return i;
    }
  }

  function viewCuttingPoint(cm, oldN, newN, dir) {
    var index = findViewIndex(cm, oldN), diff, view = cm.display.view;
    if (!sawCollapsedSpans || newN == cm.doc.first + cm.doc.size)
      return {index: index, lineN: newN};
    for (var i = 0, n = cm.display.viewFrom; i < index; i++)
      n += view[i].size;
    if (n != oldN) {
      if (dir > 0) {
        if (index == view.length - 1) return null;
        diff = (n + view[index].size) - oldN;
        index++;
      } else {
        diff = n - oldN;
      }
      oldN += diff; newN += diff;
    }
    while (visualLineNo(cm.doc, newN) != newN) {
      if (index == (dir < 0 ? 0 : view.length - 1)) return null;
      newN += dir * view[index - (dir < 0 ? 1 : 0)].size;
      index += dir;
    }
    return {index: index, lineN: newN};
  }

  // Force the view to cover a given range, adding empty view element
  // or clipping off existing ones as needed.
  function adjustView(cm, from, to) {
    var display = cm.display, view = display.view;
    if (view.length == 0 || from >= display.viewTo || to <= display.viewFrom) {
      display.view = buildViewArray(cm, from, to);
      display.viewFrom = from;
    } else {
      if (display.viewFrom > from)
        display.view = buildViewArray(cm, from, display.viewFrom).concat(display.view);
      else if (display.viewFrom < from)
        display.view = display.view.slice(findViewIndex(cm, from));
      display.viewFrom = from;
      if (display.viewTo < to)
        display.view = display.view.concat(buildViewArray(cm, display.viewTo, to));
      else if (display.viewTo > to)
        display.view = display.view.slice(0, findViewIndex(cm, to));
    }
    display.viewTo = to;
  }

  // Count the number of lines in the view whose DOM representation is
  // out of date (or nonexistent).
  function countDirtyView(cm) {
    var view = cm.display.view, dirty = 0;
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (!lineView.hidden && (!lineView.node || lineView.changes)) ++dirty;
    }
    return dirty;
  }

  // INPUT HANDLING

  // Poll for input changes, using the normal rate of polling. This
  // runs as long as the editor is focused.
  function slowPoll(cm) {
    if (cm.display.pollingFast) return;
    cm.display.poll.set(cm.options.pollInterval, function() {
      readInput(cm);
      if (cm.state.focused) slowPoll(cm);
    });
  }

  // When an event has just come in that is likely to add or change
  // something in the input textarea, we poll faster, to ensure that
  // the change appears on the screen quickly.
  function fastPoll(cm) {
    var missed = false;
    cm.display.pollingFast = true;
    function p() {
      var changed = readInput(cm);
      if (!changed && !missed) {missed = true; cm.display.poll.set(60, p);}
      else {cm.display.pollingFast = false; slowPoll(cm);}
    }
    cm.display.poll.set(20, p);
  }

  // This will be set to an array of strings when copying, so that,
  // when pasting, we know what kind of selections the copied text
  // was made out of.
  var lastCopied = null;

  // Read input from the textarea, and update the document to match.
  // When something is selected, it is present in the textarea, and
  // selected (unless it is huge, in which case a placeholder is
  // used). When nothing is selected, the cursor sits after previously
  // seen text (can be empty), which is stored in prevInput (we must
  // not reset the textarea when typing, because that breaks IME).
  function readInput(cm) {
    var input = cm.display.input, prevInput = cm.display.prevInput, doc = cm.doc;
    // Since this is called a *lot*, try to bail out as cheaply as
    // possible when it is clear that nothing happened. hasSelection
    // will be the case when there is a lot of text in the textarea,
    // in which case reading its value would be expensive.
    if (!cm.state.focused || (hasSelection(input) && !prevInput) || isReadOnly(cm) || cm.options.disableInput)
      return false;
    // See paste handler for more on the fakedLastChar kludge
    if (cm.state.pasteIncoming && cm.state.fakedLastChar) {
      input.value = input.value.substring(0, input.value.length - 1);
      cm.state.fakedLastChar = false;
    }
    var text = input.value;
    // If nothing changed, bail.
    if (text == prevInput && !cm.somethingSelected()) return false;
    // Work around nonsensical selection resetting in IE9/10, and
    // inexplicable appearance of private area unicode characters on
    // some key combos in Mac (#2689).
    if (ie && ie_version >= 9 && cm.display.inputHasSelection === text ||
        mac && /[\uf700-\uf7ff]/.test(text)) {
      resetInput(cm);
      return false;
    }

    var withOp = !cm.curOp;
    if (withOp) startOperation(cm);
    cm.display.shift = false;

    if (text.charCodeAt(0) == 0x200b && doc.sel == cm.display.selForContextMenu && !prevInput)
      prevInput = "\u200b";
    // Find the part of the input that is actually new
    var same = 0, l = Math.min(prevInput.length, text.length);
    while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) ++same;
    var inserted = text.slice(same), textLines = splitLines(inserted);

    // When pasing N lines into N selections, insert one line per selection
    var multiPaste = null;
    if (cm.state.pasteIncoming && doc.sel.ranges.length > 1) {
      if (lastCopied && lastCopied.join("\n") == inserted)
        multiPaste = doc.sel.ranges.length % lastCopied.length == 0 && map(lastCopied, splitLines);
      else if (textLines.length == doc.sel.ranges.length)
        multiPaste = map(textLines, function(l) { return [l]; });
    }

    // Normal behavior is to insert the new text into every selection
    for (var i = doc.sel.ranges.length - 1; i >= 0; i--) {
      var range = doc.sel.ranges[i];
      var from = range.from(), to = range.to();
      // Handle deletion
      if (same < prevInput.length)
        from = Pos(from.line, from.ch - (prevInput.length - same));
      // Handle overwrite
      else if (cm.state.overwrite && range.empty() && !cm.state.pasteIncoming)
        to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + lst(textLines).length));
      var updateInput = cm.curOp.updateInput;
      var changeEvent = {from: from, to: to, text: multiPaste ? multiPaste[i % multiPaste.length] : textLines,
                         origin: cm.state.pasteIncoming ? "paste" : cm.state.cutIncoming ? "cut" : "+input"};
      makeChange(cm.doc, changeEvent);
      signalLater(cm, "inputRead", cm, changeEvent);
      // When an 'electric' character is inserted, immediately trigger a reindent
      if (inserted && !cm.state.pasteIncoming && cm.options.electricChars &&
          cm.options.smartIndent && range.head.ch < 100 &&
          (!i || doc.sel.ranges[i - 1].head.line != range.head.line)) {
        var mode = cm.getModeAt(range.head);
        var end = changeEnd(changeEvent);
        if (mode.electricChars) {
          for (var j = 0; j < mode.electricChars.length; j++)
            if (inserted.indexOf(mode.electricChars.charAt(j)) > -1) {
              indentLine(cm, end.line, "smart");
              break;
            }
        } else if (mode.electricInput) {
          if (mode.electricInput.test(getLine(doc, end.line).text.slice(0, end.ch)))
            indentLine(cm, end.line, "smart");
        }
      }
    }
    ensureCursorVisible(cm);
    cm.curOp.updateInput = updateInput;
    cm.curOp.typing = true;

    // Don't leave long text in the textarea, since it makes further polling slow
    if (text.length > 1000 || text.indexOf("\n") > -1) input.value = cm.display.prevInput = "";
    else cm.display.prevInput = text;
    if (withOp) endOperation(cm);
    cm.state.pasteIncoming = cm.state.cutIncoming = false;
    return true;
  }

  // Reset the input to correspond to the selection (or to be empty,
  // when not typing and nothing is selected)
  function resetInput(cm, typing) {
    var minimal, selected, doc = cm.doc;
    if (cm.somethingSelected()) {
      cm.display.prevInput = "";
      var range = doc.sel.primary();
      minimal = hasCopyEvent &&
        (range.to().line - range.from().line > 100 || (selected = cm.getSelection()).length > 1000);
      var content = minimal ? "-" : selected || cm.getSelection();
      cm.display.input.value = content;
      if (cm.state.focused) selectInput(cm.display.input);
      if (ie && ie_version >= 9) cm.display.inputHasSelection = content;
    } else if (!typing) {
      cm.display.prevInput = cm.display.input.value = "";
      if (ie && ie_version >= 9) cm.display.inputHasSelection = null;
    }
    cm.display.inaccurateSelection = minimal;
  }

  function focusInput(cm) {
    if (cm.options.readOnly != "nocursor" && (!mobile || activeElt() != cm.display.input))
      cm.display.input.focus();
  }

  function ensureFocus(cm) {
    if (!cm.state.focused) { focusInput(cm); onFocus(cm); }
  }

  function isReadOnly(cm) {
    return cm.options.readOnly || cm.doc.cantEdit;
  }

  // EVENT HANDLERS

  // Attach the necessary event handlers when initializing the editor
  function registerEventHandlers(cm) {
    var d = cm.display;
    on(d.scroller, "mousedown", operation(cm, onMouseDown));
    // Older IE's will not fire a second mousedown for a double click
    if (ie && ie_version < 11)
      on(d.scroller, "dblclick", operation(cm, function(e) {
        if (signalDOMEvent(cm, e)) return;
        var pos = posFromMouse(cm, e);
        if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) return;
        e_preventDefault(e);
        var word = cm.findWordAt(pos);
        extendSelection(cm.doc, word.anchor, word.head);
      }));
    else
      on(d.scroller, "dblclick", function(e) { signalDOMEvent(cm, e) || e_preventDefault(e); });
    // Prevent normal selection in the editor (we handle our own)
    on(d.lineSpace, "selectstart", function(e) {
      if (!eventInWidget(d, e)) e_preventDefault(e);
    });
    // Some browsers fire contextmenu *after* opening the menu, at
    // which point we can't mess with it anymore. Context menu is
    // handled in onMouseDown for these browsers.
    if (!captureRightClick) on(d.scroller, "contextmenu", function(e) {onContextMenu(cm, e);});

    // Sync scrolling between fake scrollbars and real scrollable
    // area, ensure viewport is updated when scrolling.
    on(d.scroller, "scroll", function() {
      if (d.scroller.clientHeight) {
        setScrollTop(cm, d.scroller.scrollTop);
        setScrollLeft(cm, d.scroller.scrollLeft, true);
        signal(cm, "scroll", cm);
      }
    });
    on(d.scrollbarV, "scroll", function() {
      if (d.scroller.clientHeight) setScrollTop(cm, d.scrollbarV.scrollTop);
    });
    on(d.scrollbarH, "scroll", function() {
      if (d.scroller.clientHeight) setScrollLeft(cm, d.scrollbarH.scrollLeft);
    });

    // Listen to wheel events in order to try and update the viewport on time.
    on(d.scroller, "mousewheel", function(e){onScrollWheel(cm, e);});
    on(d.scroller, "DOMMouseScroll", function(e){onScrollWheel(cm, e);});

    // Prevent clicks in the scrollbars from killing focus
    function reFocus() { if (cm.state.focused) setTimeout(bind(focusInput, cm), 0); }
    on(d.scrollbarH, "mousedown", reFocus);
    on(d.scrollbarV, "mousedown", reFocus);
    // Prevent wrapper from ever scrolling
    on(d.wrapper, "scroll", function() { d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

    on(d.input, "keyup", function(e) { onKeyUp.call(cm, e); });
    on(d.input, "input", function() {
      if (ie && ie_version >= 9 && cm.display.inputHasSelection) cm.display.inputHasSelection = null;
      fastPoll(cm);
    });
    on(d.input, "keydown", operation(cm, onKeyDown));
    on(d.input, "keypress", operation(cm, onKeyPress));
    on(d.input, "focus", bind(onFocus, cm));
    on(d.input, "blur", bind(onBlur, cm));

    function drag_(e) {
      if (!signalDOMEvent(cm, e)) e_stop(e);
    }
    if (cm.options.dragDrop) {
      on(d.scroller, "dragstart", function(e){onDragStart(cm, e);});
      on(d.scroller, "dragenter", drag_);
      on(d.scroller, "dragover", drag_);
      on(d.scroller, "drop", operation(cm, onDrop));
    }
    on(d.scroller, "paste", function(e) {
      if (eventInWidget(d, e)) return;
      cm.state.pasteIncoming = true;
      focusInput(cm);
      fastPoll(cm);
    });
    on(d.input, "paste", function() {
      // Workaround for webkit bug https://bugs.webkit.org/show_bug.cgi?id=90206
      // Add a char to the end of textarea before paste occur so that
      // selection doesn't span to the end of textarea.
      if (webkit && !cm.state.fakedLastChar && !(new Date - cm.state.lastMiddleDown < 200)) {
        var start = d.input.selectionStart, end = d.input.selectionEnd;
        d.input.value += "$";
        // The selection end needs to be set before the start, otherwise there
        // can be an intermediate non-empty selection between the two, which
        // can override the middle-click paste buffer on linux and cause the
        // wrong thing to get pasted.
        d.input.selectionEnd = end;
        d.input.selectionStart = start;
        cm.state.fakedLastChar = true;
      }
      cm.state.pasteIncoming = true;
      fastPoll(cm);
    });

    function prepareCopyCut(e) {
      if (cm.somethingSelected()) {
        lastCopied = cm.getSelections();
        if (d.inaccurateSelection) {
          d.prevInput = "";
          d.inaccurateSelection = false;
          d.input.value = lastCopied.join("\n");
          selectInput(d.input);
        }
      } else {
        var text = [], ranges = [];
        for (var i = 0; i < cm.doc.sel.ranges.length; i++) {
          var line = cm.doc.sel.ranges[i].head.line;
          var lineRange = {anchor: Pos(line, 0), head: Pos(line + 1, 0)};
          ranges.push(lineRange);
          text.push(cm.getRange(lineRange.anchor, lineRange.head));
        }
        if (e.type == "cut") {
          cm.setSelections(ranges, null, sel_dontScroll);
        } else {
          d.prevInput = "";
          d.input.value = text.join("\n");
          selectInput(d.input);
        }
        lastCopied = text;
      }
      if (e.type == "cut") cm.state.cutIncoming = true;
    }
    on(d.input, "cut", prepareCopyCut);
    on(d.input, "copy", prepareCopyCut);

    // Needed to handle Tab key in KHTML
    if (khtml) on(d.sizer, "mouseup", function() {
      if (activeElt() == d.input) d.input.blur();
      focusInput(cm);
    });
  }

  // Called when the window resizes
  function onResize(cm) {
    // Might be a text scaling operation, clear size caches.
    var d = cm.display;
    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;
    cm.setSize();
  }

  // MOUSE EVENTS

  // Return true when the given mouse event happened in a widget
  function eventInWidget(display, e) {
    for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
      if (!n || n.ignoreEvents || n.parentNode == display.sizer && n != display.mover) return true;
    }
  }

  // Given a mouse event, find the corresponding position. If liberal
  // is false, it checks whether a gutter or scrollbar was clicked,
  // and returns null if it was. forRect is used by rectangular
  // selections, and tries to estimate a character position even for
  // coordinates beyond the right of the text.
  function posFromMouse(cm, e, liberal, forRect) {
    var display = cm.display;
    if (!liberal) {
      var target = e_target(e);
      if (target == display.scrollbarH || target == display.scrollbarV ||
          target == display.scrollbarFiller || target == display.gutterFiller) return null;
    }
    var x, y, space = display.lineSpace.getBoundingClientRect();
    // Fails unpredictably on IE[67] when mouse is dragged around quickly.
    try { x = e.clientX - space.left; y = e.clientY - space.top; }
    catch (e) { return null; }
    var coords = coordsChar(cm, x, y), line;
    if (forRect && coords.xRel == 1 && (line = getLine(cm.doc, coords.line).text).length == coords.ch) {
      var colDiff = countColumn(line, line.length, cm.options.tabSize) - line.length;
      coords = Pos(coords.line, Math.max(0, Math.round((x - paddingH(cm.display).left) / charWidth(cm.display)) - colDiff));
    }
    return coords;
  }

  // A mouse down can be a single click, double click, triple click,
  // start of selection drag, start of text drag, new cursor
  // (ctrl-click), rectangle drag (alt-drag), or xwin
  // middle-click-paste. Or it might be a click on something we should
  // not interfere with, such as a scrollbar or widget.
  function onMouseDown(e) {
    if (signalDOMEvent(this, e)) return;
    var cm = this, display = cm.display;
    display.shift = e.shiftKey;

    if (eventInWidget(display, e)) {
      if (!webkit) {
        // Briefly turn off draggability, to allow widgets to do
        // normal dragging things.
        display.scroller.draggable = false;
        setTimeout(function(){display.scroller.draggable = true;}, 100);
      }
      return;
    }
    if (clickInGutter(cm, e)) return;
    var start = posFromMouse(cm, e);
    window.focus();

    switch (e_button(e)) {
    case 1:
      if (start)
        leftButtonDown(cm, e, start);
      else if (e_target(e) == display.scroller)
        e_preventDefault(e);
      break;
    case 2:
      if (webkit) cm.state.lastMiddleDown = +new Date;
      if (start) extendSelection(cm.doc, start);
      setTimeout(bind(focusInput, cm), 20);
      e_preventDefault(e);
      break;
    case 3:
      if (captureRightClick) onContextMenu(cm, e);
      break;
    }
  }

  var lastClick, lastDoubleClick;
  function leftButtonDown(cm, e, start) {
    setTimeout(bind(ensureFocus, cm), 0);

    var now = +new Date, type;
    if (lastDoubleClick && lastDoubleClick.time > now - 400 && cmp(lastDoubleClick.pos, start) == 0) {
      type = "triple";
    } else if (lastClick && lastClick.time > now - 400 && cmp(lastClick.pos, start) == 0) {
      type = "double";
      lastDoubleClick = {time: now, pos: start};
    } else {
      type = "single";
      lastClick = {time: now, pos: start};
    }

    var sel = cm.doc.sel, modifier = mac ? e.metaKey : e.ctrlKey;
    if (cm.options.dragDrop && dragAndDrop && !isReadOnly(cm) &&
        type == "single" && sel.contains(start) > -1 && sel.somethingSelected())
      leftButtonStartDrag(cm, e, start, modifier);
    else
      leftButtonSelect(cm, e, start, type, modifier);
  }

  // Start a text drag. When it ends, see if any dragging actually
  // happen, and treat as a click if it didn't.
  function leftButtonStartDrag(cm, e, start, modifier) {
    var display = cm.display;
    var dragEnd = operation(cm, function(e2) {
      if (webkit) display.scroller.draggable = false;
      cm.state.draggingText = false;
      off(document, "mouseup", dragEnd);
      off(display.scroller, "drop", dragEnd);
      if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
        e_preventDefault(e2);
        if (!modifier)
          extendSelection(cm.doc, start);
        focusInput(cm);
        // Work around unexplainable focus problem in IE9 (#2127)
        if (ie && ie_version == 9)
          setTimeout(function() {document.body.focus(); focusInput(cm);}, 20);
      }
    });
    // Let the drag handler handle this.
    if (webkit) display.scroller.draggable = true;
    cm.state.draggingText = dragEnd;
    // IE's approach to draggable
    if (display.scroller.dragDrop) display.scroller.dragDrop();
    on(document, "mouseup", dragEnd);
    on(display.scroller, "drop", dragEnd);
  }

  // Normal selection, as opposed to text dragging.
  function leftButtonSelect(cm, e, start, type, addNew) {
    var display = cm.display, doc = cm.doc;
    e_preventDefault(e);

    var ourRange, ourIndex, startSel = doc.sel;
    if (addNew && !e.shiftKey) {
      ourIndex = doc.sel.contains(start);
      if (ourIndex > -1)
        ourRange = doc.sel.ranges[ourIndex];
      else
        ourRange = new Range(start, start);
    } else {
      ourRange = doc.sel.primary();
    }

    if (e.altKey) {
      type = "rect";
      if (!addNew) ourRange = new Range(start, start);
      start = posFromMouse(cm, e, true, true);
      ourIndex = -1;
    } else if (type == "double") {
      var word = cm.findWordAt(start);
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, word.anchor, word.head);
      else
        ourRange = word;
    } else if (type == "triple") {
      var line = new Range(Pos(start.line, 0), clipPos(doc, Pos(start.line + 1, 0)));
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, line.anchor, line.head);
      else
        ourRange = line;
    } else {
      ourRange = extendRange(doc, ourRange, start);
    }

    if (!addNew) {
      ourIndex = 0;
      setSelection(doc, new Selection([ourRange], 0), sel_mouse);
      startSel = doc.sel;
    } else if (ourIndex > -1) {
      replaceOneSelection(doc, ourIndex, ourRange, sel_mouse);
    } else {
      ourIndex = doc.sel.ranges.length;
      setSelection(doc, normalizeSelection(doc.sel.ranges.concat([ourRange]), ourIndex),
                   {scroll: false, origin: "*mouse"});
    }

    var lastPos = start;
    function extendTo(pos) {
      if (cmp(lastPos, pos) == 0) return;
      lastPos = pos;

      if (type == "rect") {
        var ranges = [], tabSize = cm.options.tabSize;
        var startCol = countColumn(getLine(doc, start.line).text, start.ch, tabSize);
        var posCol = countColumn(getLine(doc, pos.line).text, pos.ch, tabSize);
        var left = Math.min(startCol, posCol), right = Math.max(startCol, posCol);
        for (var line = Math.min(start.line, pos.line), end = Math.min(cm.lastLine(), Math.max(start.line, pos.line));
             line <= end; line++) {
          var text = getLine(doc, line).text, leftPos = findColumn(text, left, tabSize);
          if (left == right)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, leftPos)));
          else if (text.length > leftPos)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, findColumn(text, right, tabSize))));
        }
        if (!ranges.length) ranges.push(new Range(start, start));
        setSelection(doc, normalizeSelection(startSel.ranges.slice(0, ourIndex).concat(ranges), ourIndex),
                     {origin: "*mouse", scroll: false});
        cm.scrollIntoView(pos);
      } else {
        var oldRange = ourRange;
        var anchor = oldRange.anchor, head = pos;
        if (type != "single") {
          if (type == "double")
            var range = cm.findWordAt(pos);
          else
            var range = new Range(Pos(pos.line, 0), clipPos(doc, Pos(pos.line + 1, 0)));
          if (cmp(range.anchor, anchor) > 0) {
            head = range.head;
            anchor = minPos(oldRange.from(), range.anchor);
          } else {
            head = range.anchor;
            anchor = maxPos(oldRange.to(), range.head);
          }
        }
        var ranges = startSel.ranges.slice(0);
        ranges[ourIndex] = new Range(clipPos(doc, anchor), head);
        setSelection(doc, normalizeSelection(ranges, ourIndex), sel_mouse);
      }
    }

    var editorSize = display.wrapper.getBoundingClientRect();
    // Used to ensure timeout re-tries don't fire when another extend
    // happened in the meantime (clearTimeout isn't reliable -- at
    // least on Chrome, the timeouts still happen even when cleared,
    // if the clear happens after their scheduled firing time).
    var counter = 0;

    function extend(e) {
      var curCount = ++counter;
      var cur = posFromMouse(cm, e, true, type == "rect");
      if (!cur) return;
      if (cmp(cur, lastPos) != 0) {
        ensureFocus(cm);
        extendTo(cur);
        var visible = visibleLines(display, doc);
        if (cur.line >= visible.to || cur.line < visible.from)
          setTimeout(operation(cm, function(){if (counter == curCount) extend(e);}), 150);
      } else {
        var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
        if (outside) setTimeout(operation(cm, function() {
          if (counter != curCount) return;
          display.scroller.scrollTop += outside;
          extend(e);
        }), 50);
      }
    }

    function done(e) {
      counter = Infinity;
      e_preventDefault(e);
      focusInput(cm);
      off(document, "mousemove", move);
      off(document, "mouseup", up);
      doc.history.lastSelOrigin = null;
    }

    var move = operation(cm, function(e) {
      if (!e_button(e)) done(e);
      else extend(e);
    });
    var up = operation(cm, done);
    on(document, "mousemove", move);
    on(document, "mouseup", up);
  }

  // Determines whether an event happened in the gutter, and fires the
  // handlers for the corresponding event.
  function gutterEvent(cm, e, type, prevent, signalfn) {
    try { var mX = e.clientX, mY = e.clientY; }
    catch(e) { return false; }
    if (mX >= Math.floor(cm.display.gutters.getBoundingClientRect().right)) return false;
    if (prevent) e_preventDefault(e);

    var display = cm.display;
    var lineBox = display.lineDiv.getBoundingClientRect();

    if (mY > lineBox.bottom || !hasHandler(cm, type)) return e_defaultPrevented(e);
    mY -= lineBox.top - display.viewOffset;

    for (var i = 0; i < cm.options.gutters.length; ++i) {
      var g = display.gutters.childNodes[i];
      if (g && g.getBoundingClientRect().right >= mX) {
        var line = lineAtHeight(cm.doc, mY);
        var gutter = cm.options.gutters[i];
        signalfn(cm, type, cm, line, gutter, e);
        return e_defaultPrevented(e);
      }
    }
  }

  function clickInGutter(cm, e) {
    return gutterEvent(cm, e, "gutterClick", true, signalLater);
  }

  // Kludge to work around strange IE behavior where it'll 
    , e)) rouso= wo comb   ) = d.cachedTextHeigh = mwo comb   ) = d.cached -1;
    } eltn(doc, or   for (vS
        v e) {
e5];
  s) {
   ingleount = +ent(this, e
    ec;
    e_preshift = evar displa });
    // Prevent normale_preventDefault(e);
       
   }
  }

   ourIndex, startSel = doc.sr displai no
   ingleoum.doc, start);
os || clickInGutter(cm, e) |type ==  }
l[ourIe. docTo= sf
  }
l[o.sr displa(cm.disp sel.contains(p += outside;
ize caches.
  }
l[  v eWhen nothing is scroimnoth doond eral, foride;
izedingfor (vait= true;
  }
l[ou   }
l[ow Range(      caseF
l[el.c  }

    caseF
l[i];
      if (ed.jo
l[ow Range,ndColumn (dispnddle-s(oldcm, functs) {
oadF
l[d.jo
      eo
l[Wheions.tabSize;
   l.c  }    seF
l[el.c   }
    }
  }.c  .on
oadutton(e)) done(e);
      e;
          didColter =  }.c  .e,  = ) {
            ++e-s(ol= n  anchor = minPo| cliction(docgutters[new Range(Pos(po: multiPaste tiPaste[i    ltiPa    ltengthines into Nt);
        }
 )= start;
  webkit}Range(Pos(po: Later(cm, "inputRead", cm Range(Pos(po: ourIndex), sRel_mouHove =     // Worimno   }
    }
    ltricChars) {
   > 0) {
        ges.slice(0) }
    }
  }.c  . }.cAsableeo
l[r(cm, e) {mousemove"++i) {
      var gnodes[i]
oadF
l[ }
l[oterWheis.length;
    ging.
  fun v eousemovce it makdoasteIl_mouiring ti v e)ndlers for lientiberal,ay.input. forRect        approach to draggable
nputHas-1)
        ourR  if , "smart");
    approach to draggabletion done(e) eveneen quic{
    if (cm   )}
    (ranges, oureventDefault(e);
      break;
    case 3:  += outside;
  ges.slic   cas.tabSize;
  dColumne. docTo= sf
  Def, sa("able"line < visible.tlineN += lend        approach to draggable
npu!(ns.dragDrop && dragAndDrop )
          else
  
      var conlision) {
          d.prev: ourIndex), sNoU ca    // Worimno   }
    }
    l  if0) {
            
    var ve"++i) {
      var g
    var.childNodes[i          elseIl_mouRcm, "inputRea""gSelected(hor:ge.head;elected(hor:ectirop", o
        lastCinpeIl_mou  }
    }
f (!ra" e)) r"or webkit        lastCainable focus problem in}ide;
  ges.slic.floor(c{{
    return gutterEventdragenter", drag_)   var cm =unctio(cm); }
  }to draggable
isp+        var
   ingle1].hetBut) {
      o += outss.getBoundi });
    // Prevent normale_preventDefault(e);
        += outsiourInd. docTo= sf
  sef, sa("able", content = minimal    if (khtUtripummy imag be bkiafakedction ce menu, atimag . if (khtAtH/ haSafari (~6.0.2))ndv.
        chen isegion ceet
  fuused  var nd ofweed in tdoaitempty = true;
  d. docTo= sf
  sef,o dImag bnpu!safarii];
      if (img &&e= d"img"       d     d" right o:jo
xe, lieftn(cmen pn(cm, lastPos) mg.srcow, pdoc:imag /gif;b is64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==art, start);
inpusplay.viewPos) mg.w= null; mg.hze();
  1e {
        v// Used to ensur  vardCentR( mgon done(e) eve emptysteIsedo  br"++m.sta
  in t triunctimag be"++ ie_vobscn qu }.s from = Ps) mg._tgleou mg.ottersTopside;
  ges.slicd. docTo= sf
  sef,o dImag ( mg,h);
   case 3:t);
inpuspla mg.over) retupeI  //CentR( mgon doneresponding pSCROLLe event happenal scn reFocus(cters tiondingFocus() { ,creen quicwheel", fu
.
  fun {douicwheef (curChar && llingFast)});
    on(d.scrvf (target bs(e.clientY tHas-1)
     }), -rvf (t< 2pollInterval, func-1)
     }), =rvf .sr displa(geckplar, "moD/ UsedSimno d.scr{n pn(vf }c.sr displange = extendd(e);
        }), !=rvf (tnge = extendd(e);
        }), =rvf .sr displange = extendd(e); "scroll", fun !=rvf (tnge = extendd(e); "scroll", fun =rvf .sr displageckplar, "moD/ UsedSimno d.sc.sr dindex]9 (#tterClickInGutt}happenal scdd(e);
 ndingFocus() {,creen quicwhlfn(cm, neededsrChahappenal});lay.pollingFast)  });

    // Lisif (cisSreak;
     var cm =usSreak;
 dravaut)
     -1)
     ion(e: .clientY tHas-1)
     ion(e-rvf (t< 2pollInterval, vaut) pos.line)if (cnge = extendd(e);
         = nul-cnge = extendd(e);
   if (m = nu)rval, func-1)
     ion(e) vf .sr dial});Hstaz    ltains(.sr displange = extendd(e);
        ion(e!=rvf (tnge = extendd(e);
        ion(e) vf .sr displange = extendd(e); "sH       ion(e!=rvf (tnge = extendd(e); "sH       ion(e) vf .sr onding pSas chea
    tafocusecm  , fu vaox = e.cliewport on tiChahappenu bkdinardizto e the mi menu, atdings aft menu,   {documsich case a grs rnput.heariickl around quicd,
      eturndex]s estmrom |d.wrap  funct       effecMath.miteIncx, lif   = e.cliewport on tindv. used by r,o match.aa *letdget
    /ayclickagle nv (va   ta     p
xer scrolotters countewaH(cm scro
 the star }.s ffweewa it is  //     ame(cm,aliewport on e clic      
scrollbath.mintctionies of "texc'll 
hing is seley.lineDcan be an used byit dicrollable
 d  var ndounucte.foect ir, typ
  s) {iewpoSamno clic0,{iewpoP
xersPerUnitfunction(e)y new  //ion. menu, -letdgeedrndex]te.ft(d.inomi menu, at.cachew used b  // o, "cl(d.scd in tndv.
      value = tille(cm,,  = tiberalmused bbes a sectio || (hj "widgea sle();
oect ir.pasteIncx, liiewpoused b       (cm, e,the ntDecreoughe) {
splai noiewpoP
xersPerUnitfun-.53n(e)anges.pusgeckplaiewpoP
xersPerUnitfun15n(e)anges.puscearednoiewpoP
xersPerUnitfun-.7n(e)anges.pussafarii]iewpoP
xersPerUnitfun-1/3t = +ent(this, e in the scrollbars;
    e_prevpace.tiewpoD  taX *lyace.tiewpoD  taY.sr displadxges || (bnpud. op i(bnpud.axthe=ce.tHORIZONTAL_AXIS)evpace.t op i(.sr displadyges || (bnpud. op i(bnpud.axthe=ce.tVERTICAL_AXIS)evyace.t op i(.sr di.view = diyges || ()*lyace.tiewpoD  taBox = display.lineDiv.getBoundipos);
   e);
      break;
 side;
izeQu e,tfempty 'sm, typingn is);
   pty selecspla(adxgtart);
          = nul>rt);
    if (m = nuer || target =lyatart);
         ize();
>rt);
    if (mLeft);
  += outsiourIn IE9i?id=90menu, atis,OS X ab funmoededumrt);
  sget
  funcentDefourIn IEiberal,a      e on e(cm    //do match.
 Focus(cters needed. if (khtTuused ck  
 e  eltn(do eturareaflooD/ Used)th > 10en quicw if (kht null
  usekept, e)) r.sr displadyg (texsetInility, to allow o  er:ve"++i) {
");
  e.entDef 0 || from >= display.
");
!=rFocus(;
");
  (ope|| n.parentNode == d   var lineView = view[i];
      if (!lineView.hr displadir > 0)neturn t) {
 anchor = minPonge = exten) { n.pe scrTlay.scro) {Range(Pos(po: Click o  erstartSel.ranges.slice(0);
     = Infinity;
n fo, such90menu, a,.heaaz    lcrollable
  clicd.
   ounraw    ity;
n f happencan be an ilfn(cm,nge
be miis u});la,cd.
 .state   ity;
n fwtatecurCh)) roiion. I liu beemckl/ay  // hatstarv.
 if (ie &&oordinatd p
xers/   tafocusetext
j "wi.draggaheaaz    lf (ie &&rollable
 n.pir!cm.pty = ITextH    le();cklyffo matcnaocus, bufourIn IEe t
     aglglart) cm.dut= true;
  dxgtar(geckp   // FiuspetIniewpoP
xersPerUnitf!s || ()* extend(e);
dyi         )});
    on(d.scray).left) / charWlastL);
         }), 5=lya*niewpoP
xersPerUnit,rt);
         ize();
-rt);
    if (mLeft);
 ;
      e_pr});

    // Lisay).left) / charWlastL);
         ion(e+evpa*niewpoP
xersPerUnit,rt);
          = nul-ct);
    if (m = nu
 ;
      e    off(document, "mousemov// Used tewpoSdex]Xfunctione clib funmrom |eether cm, elecog, cmousemoveturn;
    varourIn IE'Projdge'uicwheef (cureel", funment
  //    ationth.min(pbes af (ie &&rollab for men || f(cm,xt
  // reough// coordinateit).sr displadyg (tiewpoP
xersPerUnitf!s || ()* extend(os ||
xersfromya*niewpoP
xersPerUnitm, functs) {tgleoufunc-1)
     }),, bo   cm), 5=l/ Used to ensur if (mLeft); case 3:t);
i
xersf<To(ctgleouay).left) / m), 5=i
xersf-     counter.viewbo   cpos.line));
var meges.lebo  5=i
xersf+     counterr, "moD/ UsedSimno d.scr{n pn(t),, bo tte[ibo ion extendTo(po;
   ewpoSamno clonSt)* extend(e);
d/ Used tewpoSdex]Xfus || ()* extend(ov// Used tewpoSdex]XfunL);
         ion(;v// Used tewpoSdex]YfunL);
         Topside;
  ov// Used tewpoDXfundx;v// Used tewpoDYfromy;         )})cusInput(cm);}, 20);eView.hr displad/ Used tewpoSdex]Xfus || ()*+= outside;
      if (!e_bdXfunL);
         ion( < cm.optiotewpoSdex]Xside;
      if (!e_bdYfunL);
         Top < cm.optiotewpoSdex]Yside;
      if (samno fun(!e_bdYftype/ Used tewpoDYf (tee_bdYf/pe/ Used tewpoDY)er || target = n(!e_bdXftype/ Used tewpoDXf (tee_bdXf/pe/ Used tewpoDX        lastC// Used tewpoSdex]Xfun// Used tewpoSdex]Yfunput, "keydowr displa!samno )*+= outside;
      iewpoP
xersPerUnitfun(iewpoP
xersPerUnitf*{iewpoSamno cl+ samno )*/   ewpoSamno cl+  }
    varrrrr++ ewpoSamno cproblem in},nStarside;
  gtorSize.top ? -2e/ Used tewpoDXf+undx;v// Used tewpoDYf+romy;       {
    return guwherEYe event happeneuion.scrollerth.mi forb)) rogingseupy.pollingFastdoe);
  Biline d.scrb)) r,i v eSRang    var cm =defaibeb)) rol.somate.f    var ranb)) rolion m);
s[b)) right >= mX) {!b)) rault(e);

    var di}f (ie &&neen quch is stbe emptnge
be miis dnd of sel/    scrollerbees af (ie &&consate ttn || fiberal,s whethesr displange = exten cm.display.c.seut, prevInpu(tnge = exten cm.display.poll.setx = displch iSplay, enge = extendRang
    o.poll.setx = d   cas.tabSicm =usel.contains(p m); }
  }supinputhe nsfroon prepareCospladv eSRang  nge = extendRangend);
      off(   o.pob)) rins(s!s Passs.lengthfinnput.as.tabSinge = extendRangendch iSplay;s.tabSinge }
  }supinputhe nsfro
    var di}f (ielt(e);
   o.sr onding pClab d eral,) { n.pothifocusseupmapsy.pollingFastnpuKeyMapsler, "mousedownmaps ue;
  }

  keyMapsge(clipPos(doc,ReadOnly(cm) && doonKeys)nmaps.head));
y(cm) && doonKeys)

    faps.head));
y(cm) &&keyMap)

    lt(e);
faps.sr ondindownmaybeTo= sght on(e)y nwrite &gseupo match.
 .input,revent, signalfn) {scrollKeyBiline d.scrntNode ==y nwrite &gutteaoccseupmap to= sght osmousedownndex]Mapumn(teKeyMap));
y(cm) &&keyMap)    xrue;
    Map.guttrval, f on Chrome,(maybeTo= sght oos(doc,Readnble
npu!isMart);
 Key   vamaybeTo= sght oue;
})cusInput(cm);}, 20);eView.h.pusgeeKeyMap));
y(cm) &&keyMap)ol.s
    Mapmart");
    appy(cm) &&keyMapfun(nd = tnpu ? nd = tnpu(     der, : nd =}
    varrrkeyMapr(cm, d(roll", function()       cmousedownnlengthkeyNlen(|type ==    if (!c=

    var displa!nr inslt(e);

    var didowneupmapsc=
npuKeyMapsler, if (!webkits(start);
      if y new, li when inpuolussf| (bnleng(inclue, pr'Splay-').draggs af (ieap  funaa * treat / in which -drag)-moEvent(n m);
  setTile
  cthf (ieap  f'go')rb)) roginh.
 .innleng cthme, 'Splay-'Rect      if (!c=
lookupKey "Splay-"l+ nlen,neupmapse);
      eb
  lt(e);
  e);
  Biline d.scrbtype == }i          elsormalookupKey nlen,neupmapse);
      eb
            elsoiew.h.pusdefaibebol.somate.f  ? /^go[A-Zreturn fb, : b.moEven)          elsoiew.hielt(e);
  e);
  Biline d.scrb    var text = g e(0) }
   gtorSize.top ?   if (!c=
lookupKey nlen,neupmapse);
      eb
  elt(e);
  e);
  Biline d.scrb  rt the new text .pus  if (!
             off(document, "mousemovFiustTiBgs k(roll", func;
      // When aeupe);
  ric' chanlen,n  on(d.scrollelt(e);
  if (!.sr onding pwrite &gseupo match.
 .ininputrevent signalfn) {scrollds.xBiline d.scrn ltr, "mousedown  if (!c=
lookupKey "'"l+ eInpu"'",
npuKeyMapsler,asteIncoming ? "paste" : cm  );
      eb
  elt(e);
  e);
  Biline d.scrbtype ==  }c.sr displa  if (!
             off(document, "mousemovFiustTiBgs k(roll", func;
      // When aeupe);
  ric' cha"'"l+ eInpu"'",
  on(d.scrollelt(e);
  if (!.sr ondins) {
   St),ped&& dunput, "keent(this, eion(cm, ec;
    e_preshift = evar di   var visible = visiundi });
    // Prevent np += outside;
izeIEf (weouso= wo false;led inescap = true;
  dblclick", operation(bnpud.eupCeturn t27) upeI outV(d.inpu
    var didowncoentY > eupCeturval, func= extendRangendceturn t16ormal) {
      iousedown  if (!c=
scrollKeyBiline d.scrnt= visiundiinpusplay.viewPo
   St),ped&& dun  if (!c?dcetur:nput, "keydown fo.sta
nge
no -dtrevent,..,xt
 when iatven wheoordsCh.
 .int(n bdisplay.spla!  if (!c, cooturn t88
npu!nge.from().line (ns.dragDrop && dragAndDrop )
         inpeIl_mou  }
    }
""       d on(d.
    varourIn IETe);
f e.cli men   sshairget
  Almin(phelvaox Mac= true;
  ceturn t18
npu!/\bCetuMirrg)-   sshair\beturn ffunc= exten> lineBoc
  sNf (cm", func;howC  ssHairble = virn gutterEvent;howC  ssHairble ;
    e_pre> lineB, enge = exten> lineB.sr diaddC
  s(> lineB d CetuMirrg)-   sshair")t = ++counter;
 upelse extend(e);
d.eupCeturn t18
ventddNew) ourRange = lelmC
  s(> lineB d CetuMirrg)-   sshair")t nge = lery.lastSelOrigi;
    onup)t nge = lery.lastSelOrigif e.cperatioup)t nge = urOp.updateIines whether a;
    onup)t nge ines whether an eveperatioup)t ngrn gutterEventdr", fu;
    var cm =d.eupCeturn t16)able =s-1)
   dRangend);
      of this, display = cm.dist ngrn gutterEventdr", s, cm ec;
    e_preshift = evar displa });
    // Prevent normalAndDrop ontainsNew) oormaexsetIngDrop && ;
    window.focuseupCeturn > eupCetu ltrirCeturn > trirCetu= visiundiinpuspetIneupCeturn t
   St),ped&& c;

   St),ped&& dunput, al selection in the ed    win.getBoundi(iinpuspetIn(!.tiethinrmalAiethin if (norma    if tInscrollKeyBiline d.scrntplay;
    display.sull;Sate.fctionCrirCetu(trirCeturns || (b?neupCetur:ltrirCetuc.sr displa  if (ds.xBiline d.scrn ltr,play;
    disp;
  dblclick", operat  }
    cm.display.inaccurateSelection = minimapyCut(e) {
     onding pFOCUS/BLURe event haptterEventdrsInput(cm); onFocus(  // EVENT HANDLERS
=.display.inpplay;
    disp;
  cm); }
  }

  functi", func;
    When ablur", broll", funcm); }
  }

  funfroon prepareCoaddC
  s(  v// Used to ensu d CetuMirrg)-

  fun")t nge = he start.join("\nurn ientX, ms
      matcion extantime // whic nge = he se brow f elect(sas chea
 ected, doco || (h.sta      d.inpter posit-npu letdgen) {scckm", func;
  cm); textinputHasSelecti poFor var lastCl.focus()-1)
  urRange = lelcted, doc = line < visible.ility, toureventDefault(lcted, docc' chape ==  us);izeIss.in#1730 nge = urOp.updateIOf("t(e) {
      iFiustTiBgs k(roll", }haptterEventdr (!st(cm); onFocus(  / }
  }

  functi", func;
    When a(e) {
 roll", funcm); }
  }

  funfro);
      off(lmC
  s(  v// Used to ensu d CetuMirrg)-

  fun")t nge }val, f on I    v  Whev// Used bgs ktart, typ
})cusInput(cm);}, 20);;
  cm); }
  }

  functnge = extendRangend);
   }e.clientY onding pCONTEXT MENUndlersINGnding pToth > ent(cm,or these br    text
here
    s to dounhd causeding pselection(nsk.state aed aobpe scussaedp ss (cu(ctgventauseding p for       /t > eeffecMa.linDOMEvent(this, e var lastClick, la   var cm = this, display 

  // Ke);});

    tplay;
    display.   var target = e_target(e);
 e_target(e); n != display.out(var lastClromMouse(cm, e);
    wind display.| clickInGutter(cm, e) ||,rt);
      if = extendd(e);
        }),  disp;
  ccm.dispinpuspla+= outssn fo.sta
ientifficn t.rourIn IERctederal,) { n.p   var ateSelectoERS
ring timerag(cs(   o.e.clientiberal,ay.inpioif (ie &&);
 'lctedrateSelecOe var lastCl' / EVENllbate =) {
      lcted, type, cm, lilctedrateSelecOe var lastCl  disp;
  lcted,nputHas-1)
        ourR  if ==ex];
      on(e)) done(e)tedrateSelec)    // Worimno   }
    }
   ) d.prevInput = "";
 {
      oldCSS if = extene.fakedtyl> tssable  disp = extene.fakneBodtyl>  right of.diabsolut;
    }
 = extene.fakedtyl> tssablef.di right o:jo
xe, lw= nu: 30px; meges.: 30px; n pn("l+ eventDefault(5) +
      "px; ieftn("l+ eventDefaXlt(5) + "px; z-itorS:ickI0; bcckgh)) rn("l+
       dbl? "rgba(255, 255, 255, .05)"r:l"to= s|| n.p") +
      ";.e.c> lioc.sne; b
    -w= nu: 0;.e.c> lioc.sne; peraff(": hd detssopacity: .05;jo
l er:valpha(opacity=5);"  disp;
  ility, t    oldut = "Yfun   case      Y;n IE9 (#2127)
  learedllbs.in(#2712;
    ainable focus proble;
  ility, t   case      To(     doldut = "Y      iFiued, doc = line < aste os "  }
  
npu"nment
or these bron FF disp;
  cm); .getSelections();
   = extene.faket(d.inpu = exten .join("\n"); 
    }
 = exten poFor var lastCl.ocus()-1)
  rval, f on Chrome,( = extenletdgenlectionsA "";
 {
  g pSposit-npu  clicbe grey vaoue,tfempty 'sm, typingn ispositnd o {
  g p     a os a zero-w= nuect();
 of sel/s
     ltn(rcked,
 fires t {
  g pntctotg
    var.= ++counter;
  key inctionsA "HcckrollLeft(cm, d.s= extene.fakedLastChar = tru!s || ()* extend(lse
  
      var con .getSelections();
;extend(lse
   lavaut)  = extene.faket(d.inpu"\u200b"l+ e
      va?  = extene.faket(d.in:l"")t nge = le = exten .join("\n")
      va? ""r:l"\u200b"t nge = le = extene.fakedLastChar = true;1;e = extene.fakedLastChartart;
 lavauection(doc.sel.In IERc-tederacm.dinng is  ie_voes thscrollertou          d.input.se   on(d.lineSpace   // le
        setTimeoutpoFor var lastCl.ocus()-1)
  rval, = urOp.updateItTimeout(bihd crollLeft(cm = extene.fakneBodtyl>  right of.di eltncus"t nge =  = extene.fakedtyl> tssablef.doldCSSrepareCospladblclick", operatio9t, "mouseup", dr "scroll", fun =r = extendd(e);
        }), =rt);
     l", func;f("t(e) {
    nge = he swhen iletdgeSpaceus(rckeoo .sta posit-npuLeft(cm, d.s= extene.fakedLastChar = tru!s || ()* extend(ls;
  cdblispadblclick", operatio9t)  key inctionsA "Hcckro;extend(lse
  ilic0,{p
   e)(cm);}, 20);eView.hr displad/ Used tpoFor var lastCl.oocus()-1)
  ftype/ Used e.fakedLastChar = truedTo(eView.hr di  on(e)) done(e)on m);
sedLastCA "" = line < visidi.view = di++  if (! = extenletdgenlectionsA "ue;
})cusInputp
      0line < visidi.viewlcted, doc = line < visi}t nge = le = extenletdgenlectionsA "ue;
})cusInputp
    2kInGutter(cm, e))w text .pusdblclick", operat  }
   key inctionsA "Hcckro;exteni     break;
    }
  }
          
      on(d.s  if (!eevent e)(cm);}, 20);eView.hr ry.l   casr an event han eventon(ranges, ourcusInputbihd cndler handle t handle , 2   casr an event han eventon(ranggtorSize.top ? ourcusInputbihd cnd    countreturn gutterEvent(var lastClromMouse(cm, e)   var cm =ted(e);
    mY -Kludge tvar lastCl"fault(e);

    var di, signalLater);
  }

  // Kludge tvar lastCl",stPos =  this,entY onding pUPDATINGnding pComdoc ent(c right ofiberal,e.fakedatiPaste ( nsf'to'lecon(etn't.
  ref{douiinh.
  ke-iPaste ange
   multiPastetart;
CetuMirrg).iPastetart;
(cm);}, 2 {
   >   var cm =t {
   ff = c a single{
   ffovar di, signa(docgh{
       or, anch {
   ff = w Range(- 1asteIncoming ? "pln ff{
   ff = cw Range(+ ( {
   ff = w Range(text)? gh{
       ochon(c ;
   };uble clidj "wiac right ofn inpfeo that
   rit-iPaste  right ofiberalble clslengf (!raEvent(ce.fakedL timPaste iedL timPaste un {dounDOMEvent(this,adj "wFor (cm, "    ltricChm); onFocus(  p"    ltricChction(f<To(c, signa  if (typcus(  p"    ltricChcspla<type == "reltricChars) {
   >;
 {
      gutter nchor, anch {
   ff = w Range(- ( {
   ffoor, an- gh{
       or, a)(- 1a.sull;(start= visiundiichor, anoocu{
   ffoor, a) eInp=ltricChars) {
   >ocho-cu{
   ffoort= visi, signa(docventedchst ngrn gutterEventcomdoc ctiAunte (cm, "utRead", cm ;
    e_preoui < cmminimapvar lineView = viewine = cm.doc.sel.ranges[i].head.lineos(doc, Pos(neRange = {anchor handle ,utlection(doc, noradj "wFor (cm, " = range.head;d", cm asteIncoming ? "paste" : cmadj "wFor (cm, " = ranectiro {
   > 0) {
  crollelt(e);
se);
      }
    }
o  br
      type itorSit ngrn gutterEventdttersge.anch dold, nwm); onFocus(ichor, anoocoldor, a)   off(l signa(docnwline++) {
 cho-coldoeInpunwlcu)rval, s.line, 0),l signa(docnwline+(+ (ichor, an-coldor, a)+) {
 chentY onding pU to estiml_mou  }
    }sgging thinmove = faart, otherwithat
 
rag, new curr2127)
  ea
 ecl_moudnurn . Hintamaycbe "new c"urr2" e)) r". gutterEventcomdoc Rel_mou(cm)"utRead", cma,.hint ;
    e_preoui < cmminima    oldlick - padd
   cx, l      n(dlick - oldlickminimapvar lineView = viewd", cmael.ranges[i].head.lineos(diPaste tid", cmahor handle os(d matc=tdttersge.agh{
       , oldlick  n(dlick on(d.s  if (tha=tdttersge.agh{
  ars) {
   >, oldlick  n(dlick on(d.s  oldlick - e{
   ffovar di  n(dlick - fovar di  spla inta=.di e)) r"ions.tabSize;
       os(neRange = {anchor.dinB, engp" = ranectiro head = rangef<Tot nge = lerulter = n(doc, norinB,?(tha:     , inB,?( matcn(t)rside;
  gtorSize.top ? -2rulter = n(doc, nor    , tion(rval, = urOp.updateIlt(e);
s  startSel = o  br
      type itorSit ngrn gu cli thin"can be (cm, "  // handn guttethainfd.incedatiPaste gutterEvento
l er (cm, "utRead", cm,rr, "mo ;
    e_preobj = e.top ? cexc'ledastPos =.top ? aste[igh{
       ,.top ? tiPae{
   ffo,.top ? tength {
   ff = ,.top ? start;
  {
   fstart;,.top ? cexc'l:)(cm);}, 20);able =cexc'ledfroon pr urOp.up= visiundir, "mo ;obj.hing is.jo
      eo   , fo,gf (!raEvart;ollLeft(cm, d.tion(fble = matc=ttion(doc, nortion(rval, = .pusdo(fble =tha=ttion(doc, nort)rside;
  ble.tlineNble =tblef.dtate.cutIncon() {(cm, f!=.d) ref, adeNble =o(cm, funo(cm, ;rOp.up= visi;
    WutRea"can be (cm, "br
  ,;objo;exteni   
   (cm);
    WutR.hen a(an be (cm, "br
  .hen objo;eexteni   obj.cexc'ledsplay.lineSpace.getlay.linPaste[iobj.o   , fo[iobj.fo,gf (![iobj.f (!raEvart;[iobj.Evart;}t ngrn gu clipnothatiPaste gingss whether );
 addate   eral,s whethe'wo combmove = r );
 econagat.state   ng t gs ktd,s whethesy.pollingFastLater(cm, "utRead", cm,r && n el.contam); onFocus(
   (cm)lLeft(cm, d.!
   (c; textsplay.linon(e)) don
  .hen Later(cm, )"utRead", cm,r && n el.contam.cutIncon() 
   (c; }
  }supinputhe nsplay;
    dispw text .pus  (e);
    utRea"can be (cm, ")e(doc, ocm tInsc(e);
    utR.hen a(an be (cm, "turn off driPaste tio
l er (cm, "utRead", cm,rpe == "doublecm =t {
   play;
    dispw text ombP ss (cyhines ull iupinputSpaceuing isb isd.pasteIninpuincetext ombkedHAND-oERS
spantbe   nsf head     e_preines u=lslwel.contaSpantbnpu!i&& n el.conta.c.seuee_bel.contac, nos"utRead", cm.o   , tricChcsplvar displa nes urn off drpvar lineView nes w Range(- 1= vi>ew = --[i         Later(cm, Inn   utReaPaste[i nes > 0)o   , fo[i nes > 0)fo,gf (![ii,?([""] th {
   ff = 0) }
   gtorSize.top ? Later(cm, Inn   utRead", cm Range(return gutterEventLater(cm, Inn   utRead", cm ); onFocus( {
   ff = w Range(text)nput{
   ff = [0]a=.di"ype = "dd", cm.o   , tricChcspl (type == "rect") {e
  
  Aunteolion doc ctiAunte (cm, "utRead", cm ct") {addC", cmToHove =  utRead", cm,r
  Auntebr
  .hea?     (c; text.id thNaNo;eextenLater(cm, S     Doc utRead", cm,r
  Auntebrst== chSpantOvte (cm, "utRead", cm ocument, "mreb isd.< cmmiumentgs ktdDococ, nort
      e// Worh schHovem)lLeft(cm, d.!rh schHovelclictorSOf(reb isd, var move = f ==ex];rRange = lelcb isHove(var move = ead", cm Range(Pos(reb isdlectiovar move = frval, = urOp.uenLater(cm, S     Doc utRead", cm,r     dst== chSpantOvte (cm, "utRead", cm ocument}it ngrn gu clRev (vaatiPaste ve =eroiion.s whethe'wbmove = y.pollingFastLater(cm, GuttHove =  utRea doc =  thirateSelecOetam); onFocus(
   (cftype   (c; }
  }supinputhe nsplay;
    ument, "mmoveos(neRamove = eatX, mY =  Aunteoli)-1)
  rval, e
  
oumpty=   if (cmp) ro  ? move.   o.: move.) roe++)deveos(  if (cmp) ro  ? move.) roe+.: move.   o.stext ombVerifyf sel/   n which usecters // ha( of sel/in
  z
  in text ombherelputta.me).
 t, otherwitX, ms;
    ai++i) {
      var g
oumptel.ranges[i].head.line // ha=g
oumpt.right >= mX) {  thirateSelecOetadragvent,nges[ountainvent,equPos,
      , : !gvent,nges[oi         Click;
  functit .pusdol.s
oumptel.range == "rect") {move.
   n(cm, funmove.
   tion(cm, function(
    ai++i;;.head.line // ha=g
oumpt.p   on(disp(e);
 e_tar,nges[oirRange = leectirateSelecToHove =  tX, mY develine < visible.  thirateSelecOetadntainvent,equPos,
      ,0);eView.hr diourIndex), sel_moutX, mY {me).
Redo    } else {
        += outside;
  anges.slice(=  AunteolitX, mrval, = urOp.uen.viewblick;
  functext ombBuildmoussteI {dotimPaste objdgeSpo adda  eral,onSeli ismove = text omb }
ck  =erotantim) ro   r );
 vipty {doae) {
       // r(cm, s < cmminimaectirateSelecToHove =  
  Auntebr
eveline < 
evelectio{d", cma:  // r(cm, s, grs rnht o:jmove.grs rnht olse {
  move.grs rnht oolitX, m.grs rnht ooisp++move.maxGrs rnht o  ument, "mo
l erdun  (e);
    utRea"can be (cm, ")e(doc, ocm tInsc(e);
    utR.hen a(an be (cm, "t.length; ++i) {
    tX, m.d", cmael.rang(- 1= vi>ew = --[ihead.lineos(diPaste titX, m.d", cma.right >= m {
   fstart;os(  ifn(disp(e);
 o
l erdntaio
l er (cm, "utRead", cm,r  } e,0);eView.hr 
oumptel.rang =Tot nge = le+= outside;
  geide;
   // r(cm, slectiomove = r(cm, Gutt (cm, "utRead", cm ocuad.lineos(daunteoliic?dcemdoc ctiAunte (cm, "utRead", cm ;:pln f
oumptse {
    Later(cm, S     Doc utRead", cm,rauntebrmergeOldSpant"utRead", cm ocumentls;
  cdftype   (c)pe   (c; r oldRange = o{aste[igh{
       , tiPae{
   ars) {
   >} on(d.s  if (reb isd.< cmmiumentt ombPconagatea  eral,gs ktd,s whethesumentt gs ktdDococ, nort
      e// Worh schHovem)lLeft(cmcm, d.!rh schHovelclictorSOf(reb isd, var move = f ==ex];rRange = lelelcb isHove(var move = ead", cm Range(Pos(s(reb isdlectiovar move = frval, = anges.slice(Later(cm, S     Doc utRead", cm,r     dmergeOldSpant"utRead", cm ocumentls} Range(return gug pSub- || s
here
 = 0;
r, annumbuttedRangre
et
  fblef   a oecase a abe_bu ++bel//    mineSpace|| n.p,s whethey.pollingFast)RangDoc utReadibkdicm ); onFocus(dibkdicm (type == "rect") {
   cx, lf+romibkdicmct") {
   s
    s  startSel = map,
             ort
      er, cm ); onFoeIlt(e);
s  sline + 1,  head = rangline+(+ mibkdicmro head = rang cheasteIncoming ? "paste" :  1,  head ectiline+(+ mibkdicmro head ectiltr,pcument}ibr
      type itorSit ngFocus(
   (cm)lLeft(cmreg (cm, "utR.);
     cx, l  
   cx, lf- mibkdicmrodibkdicm cumentls; ++i) {
doli)-1).getBoundipout)  splayGutt;out<  splayTo;oui]. nge = le+=ginto (cm, "utR.);
 l/ Kludge " Range(return gug pM be l//er-ltX,ldiPaste t
          if  cm.dnothat      ,s whethesr g p(not,gs ktd,  os)y.pollingFastLater(cm, S     Doc utRead", cm,r
  Auntebrspantm); onFocus(
   (cftyp!
   (c; texts onFoeIlt(e);
on(e)) don
  .hen Later(cm, S     Doc) utRead", cm,r
  Auntebrspantm;eexteni    {
   ffoor, an< 
   cx, lcti", func;RangDoc utRea {
   ff = w Range(- 1(- ( {
   ffoor, an- gh{
       or, a)"mousemovFi;
    dispw xteni    {
   f    or, an> 
               += outsiourIn IEClipdL timPaste   eral,s;
  kedL cs(  c xteni    {
   f    or, an< 
   cx, lcti", funce
  
Rangendc{
   ff = w Range(- 1(- (
   cx, lf- gh{
       or, a);", func;RangDoc utRea;Rang)ght >= m {
    tiPaste[ipadd
   cx, l      tiPage.agh{
   foor, an+ dRang
 u{
   ffoorteasteIncoming ? "paf (![i[ln ff{
   ff = c], start;
  {
   fstart;}  dispw xtens) {
   oli)-1)          ;exteni    {
   ffoor, an>{
   urn off driPaste ti{aste[igh{
       , tiPa(docva l  (text, left, t   uff = w RangeeasteIncoming ? "paf (![i[t{
   ff = [0]], start;
  {
   fstart;}  dispw 
f driPaste.    //domn(teB the m"utRead", cm.o   , tricChcsplvaexteni   !
  Aunte) 
  Aunteolion doc ctiAunte (cm, "utRead", cm ct") {cus(
   (cm)Later(cm, S     DocInE   ifn
  .hen d", cm,r
pantm;e") {.viewr, "moDoc utRead", cm,r
pantm;e") {ourIndex), sNoU ca utRea;  AuntebrsprevInput = "";
r onding pwrite &ral,i    arEventdthatiPaste gingss whetheled inic{
    if
ap  funaadL cs(  cull
  usepw curfy.pollingFastLater(cm, S     DocInE   ifnhen d", cm,r
pantm;
    e_prevoc.ocus()-1,lay.lineDiv.getBoundipo matc=tth{
       , ti - e{
   ffovaument, "mreon doc MaxL.rang =TtPos = ked,
 = nu = true;    or, act") {cus(!ype, cm, lir, aWo en   urn off driPd,
 = nu = true;r, aNo(visuPoxt, l(text, left,     or, a)""mousemov/  .iuse(cPd,
 = nu = tr, tior, anchor)t
      er, a) lLeft(cmcm, d.r, anooc = extenmaxL, a) lLeft(cmcm mreon doc MaxL.rang =Ton prepareCoFoeIlt(e);
on prepareCoFo0);
      the new text .pus
      t     ourRd", cm.o   , tricChcspl >ex];
      ;
    Cay.inAfocuity {
    nge r, "moDoc utRead", cm,r
pant,coordinatptions.gu)lvaexteni   !ype, cm, lir, aWo en   urn off dr/  .iuse(cPd,
 = nu = tr,     or, anch {
   ff = w Ranger)t
      er, a) lLeft(cmcm= Mathnue;r, aL.rang(r, a);", funccm, d.rhnu>c = extenmaxL, aL.range lLeft(cmcm m = extenmaxL, aue;r, a;Left(cmcm m = extenmaxL, aL.rang =Trhn;Left(cmcm m = extenmaxL, ar(cm, nfroon prepareCocm mreon doc MaxL.rang =T);
      off(Fo0);
      the nesp;
  lcon doc MaxL.rangctnge text.r, "moMaxL, aue;on preparenctext ombidj "wi   // tebrs    funr     t {
  
   c  // te  cpos.line)
   c  // te,     or, a);e") {odex]9 (#tterCli40   cmousedownrhntiffendc{
   ff = w Range(- (foor, an-     or, a)(- 1;text ombRemembutf sel/   sl,gs esdc{
   r,o or r, "me = faar = exteexteni       or, an== tior, annput{
   ff = w Range(text)npu!isWho= visiU, "mo"inputRead", cm s onFoeIltginto (cm, "cm,     or, a/ Ktble"line < s.line, 0),l g (cm, "cm,     or, a/ tior, anchor)rhntiff  cmousedownd", cmae);
   dun  (e);
    hen ad", cma")ead", cme);
   dun  (e);
    hen ad", cm" ;exteni    {
   e);
   dout(", cmae);
   cti", funce
  obj = e.top ? ? aste[i    , tiPafo,.top ? ? tength {
   ff = ,.top ?  m    //d:riPaste.    //d,.top ?  mstart;
  {
   fstart;);
     the nesp;
   {
   e);
   )c;
      // When ad", cm"c' chaobjo;extensp;
   {
   ae);
   ct(nge text. {
   Obj.disp(nge text. {
   Obj.d< cm))lectioobjo;exten}val, fHasSelecti poFor var lastCl.ion = minirn gutterEventeIl_mouRcm, "utReadetu lo   , fo,gEvart;ollLeft(i   !do(fboue;    ;exteni    mp(fo,gtion(f<To(catch(etmp - fovfboue;    ;o matc=ttmpss.getBoundidefaibeceturn tomate.f   coentY ines into Ncetuc.sr diLater(cm, "utRea{aste[i    , tiPafo, tength etu lEvart;[iotart;}";
r onding pSCROLLING THINGS INTO VIEWnding pIfhe
     if s nsfpasteInm),  ++bultPrekedL ti   casr pw cinput
ie &&rollab fooui kedplay,
        varsf sel/    lay.in usecm, func.pollingFastLaybe in the  casne(e)onordtm;
    e_prevy.lineDiv.getBoundipob

    if (mY s;
 ure timeout re-tries don'  
 S);
   e)eSpace.get;
  ceordt.m), 5=b= 0; i <To(c
 S);
   e)on prepareanges.pusceordt.bultPre5=b= 0; i > 2   cas.inn  ize();
(doc, hetheyc, hetheEneeded. if (mLeft);
  
 S);
   e)
    var displa
 S);
   !s || (bnpu!p(cmtomcti", funce
  
);
  Neturn >= d"div"or \u200b" d     d" right o:jabsolut;; n pn("l+steIncoming ? "paste" :      ceordt.m), < cm.options.gutters < padut ron(d.setBoundi)) + "px; meges.: "l+steIncoming ? "paste" :      ceordt.bultPre- ceordt.m), 5=dd(e);
 Cututt) + "px; ieftn("l+steIncoming ? "paste" :     ceordt.lon(e+e"px; w= nu: 2px;")t nge = nge = exten> liSt();r  vardCentR(
);
  Netu);", func;);
  Netu; r oldRange = o
 S);
  )t nge = nge = exten> liSt();reI  //CentR(
);
  Netu);", fureturn gug pS);
   actionn  right ofr men || f(cmm    //ly'  verifye = faaesr g pte ait dilycbeclengeef (cur(as
r, anmeges.tiCha value = ut
ie &&mrom |ed,ent(c right ofibe .getSeleamayc'drift' d |d.w
   w   uy.pollingFast));
     Range = oe(e)nch de r,imarrt;ollLeft(i   marrt;fus || ()*marrt;fuTot nge ; ++i) {
lims u=l0;
lims u< 5;
lims i].head.lineos(diPasted =TtPos = keordt = lay.inCeordtoe(e)nch on(d.s  if (ardCeordt = !e.farmal rol.scm.d? keordt : lay.inCeordtoe(e)ange;", funce
  
);
      ifcalcultn(S);
     / Lisay).lene))eordt.lon(,(ardCeordt.lon(,asteIncoming ? "paste" : cm  ))))))))))))))ay).lene))eordt.t),, ardCeordt.t),)(- marrt;asteIncoming ? "paste" : cm  ))))))))))))))ay).leax))eordt.lon(,(ardCeordt.lon(,asteIncoming ? "paste" : cm  ))))))))))))))ay).leax))eordt.bultPr,(ardCeordt.bultPr) + marrt;o;", funce
  
dex]Tgleoufunc-1)
     }),, 
dex]ion(e) func-1)
     ion(;extensp;
  
);
     roll", fun !=r|| ()* extend(ls)});
    on(d.scr
);
     roll", fun);", funccm, d..clientY tHas-1)
     }), -r
dex]Tgll >e1)diPasted =Ton prepareCo}extensp;
  
);
     roll", ion(e!=r|| ()* extend(ls)});
       // Lis
);
     roll", ion();", funccm, d..clientY tHas-1)
     ion( < 
dex]ion(l >e1)diPasted =Ton prepareCo}extensp;
  t {
   dsplay.lin)eordt;", fureturn gug pS);
   actionn ers ibeceordintn(sfr men || f(cmm    //ly'y.pollingFast));
  Range = oe(e)xor)yor)x2r)y2m;
    e_pre
);
      ifcalcultn(S);
     / Lisxor)yor)x2r)y2mvar displa
);
     roll", fun !=r|| ()*)});
    on(d.scr
);
     roll", fun);", fu;
  
);
     roll", ion(e!=r|| ()*)});
       // Lis
);
     roll", ion();", onding pCalcultn( acs  sa       right ofherere
   a      an ilionn
t.
  recta    ,r men || .bRey.liatdi objdgeSed inoll", fun h case a oll", ion(eecon(eties  // ha   sl,Cha ) ref, ad,at
 
rag, v (vical/heaaz    lc right of (weonot,here
    emadj "wlay.pollingFastcalcultn(S);
     / Lisxor)yor)x2r)y2m;
    e_prevy.lineDiv.getBoundiposnapMarrt;fuTtengptions.guttBoundi);", fu;
  y1 <To(cy1 uTot nge _pre
);e (mgleoufun textinputHa text.oll", fun !=r|| (d? kHa text.oll", fun :f = extendd(e);
        }),  disp_pre
);e ( =r = extendd(e);
   if (mLeft);l-ct);
  
 Cututt,m,,  = t= ep= visiundiy2l-cy1 >e
);e ((cy2t= y1 +e
);e (  disp_pres-1BultPre) func-1)hze();
+ padut rV (v(tBoundi);", fuos(da]Tgleouy1 <TsnapMarrt;,da]BultPre) y2t>es-1BultPre-TsnapMarrt;;", fu;
  y1 <T
);e (mglm)lLeft(cmre  =        }), =ra]Tgle? 0 :fy1;text }eanges.pusy2t>e
);e (mgle+e
);e ((cead.lineos(dnayToleouay).lene)yor)(a]BultPre?es-1BultPre:)y2m;-e
);e ((;extensp;
  nayTole!=rFoce (mglm)re  =        }), =rnayTolreparenctext _pre
);e (lon(e) fun textinputHa text.oll", ion(e!=r|| (d? kHa text.oll", ion(e:  = extendd(e);
        ion(  disp_pre
);e (w =r = extendd(e);
   if (m = nul-ct);
  
 Cututt < cm.optioludge s.otters = nu  disp_pretooWiturn x2l-cx1 >e
);e (w;", fu;
  tooWitu) x2l=cx1 +e
);e (w;", fu;
  x1  if (Left(cmre  =        ion(e) 0repareanges.pusx1 <T
);e (lon(,Left(cmre  =        ion(e) ay).left) / x1(- (fooWitur? 0 :f10))repareanges.pusx2t>e
);e (w +e
);e (lon( < 3,Left(cmre  =        ion(e) x2t+ (fooWitur? 0 :f10);-e
);e (w cmouselay.line,  = ) {
rn gug pSe =eysteIseocussadj "wll
    eral,s       right ofneSpace) { n.p gug pon(e)) do (fo  emappif dget
  funcon(e)) do f, ishos)y.pollingFastaduToS);
     / Lislon(,(mglm)lLeft(, d.rhn(e!=r|| (drmatun !=r|| ()*npuolus;
    on   / L);", fu;
  rhn(e!=r|| (,Left(cmkHa text.oll", ion(e=p(nge text.oll", ion(e==r|| (d? kHas-1)
     ion( :mkHa text.oll", ion() + lon(  disp;
  tope!=r|| (,Left(cmkHa text.oll", }), =r(nge text.oll", }), ==r|| (d? kHas-1)
     fun :fnge text.oll", }),) + tolreparn gug pM > een quicat el/    e.fakedL tion(e)) do ral,) { n.p lay.in usase a ohowny.pollingFast   varCay.inVef (cut(cm); onFonpuolus;
    on   / L);", fu) {
");
  contenCay.inn'   matc=ttur, ti - e {Range(i   !ype, cm, lir, aWo en   urn off dr matc=tturoeIn?age.aguror, a/ turoeIn-e1)d:o) {Range(Poti - ge.aguror, a/ turoeIn+  }
    v}val, fHa text.oll", })    if{aste[i    , tiPafo, marrt;:type, cm, lilay.in;
    Marrt;,disCay.in:Ton p}t ngrn gu cl// haa;
on(e)) do
nge
 nsfoll", })    econ(etn*)})r );
 anoes t {
d b       arEvent   appif dgcan be an ie.fakedL tion(e)) do,
     {
d b'simultn(s'&rollable
 icat  right ofr men || fiion.cheapl/aynd o {
  funaadL  eeffecMa.f,i    m    //b       on m);
st   not,i&& n ay.pollingFastnpuolus;
    on   / L);
    e_pre     os(fHa text.oll", })   Range(i   r, cm ); onFoeIfHa text.oll", })    ifput, "keydowos(d matc=toordinatCeordtoe(e)r, cm.o   ), ti - oordinatCeordtoe(e)r, cm.t)rside;
  _pre
    ifcalcultn(S);
     / Lisay).lene)    oron(,(mg.lon(,asteIncoming ? "paste" : cm  )))))))))ay).lene)    ot),, mg.t),)(- r, cm.marrt;asteIncoming ? "paste" : cm  )))))))))ay).left)    orges.lemg.rges.,asteIncoming ? "paste" : cm  )))))))))ay).left)    obultPr,(mg.bultPr) + r, cm.marrt;ll", funcm);      To(s   roll", ion(, s   roll", fun);", fureturn gug pAPI UTILITIEt happenitornt an ilionn
r, a"cl(d how pw amen(rckancbe "nmw c" used b"adu"/     d"subt arE"raEve" .jo"  // haagg, cmcuss    a.line,g p(typicalln*)})   ern p ; ++femptdt      -r, anitornt ) demptn't.
  gs esdCha not,itorntad,a);
 e_mouat.cachepace eturrey.liatPass't.
  Cha rhn(ealo, ".pollingFastitorntxt, l chan,.hew,aagg, cmcusm;
    e_prevoc.ocus()-1,l }
  Range(i   how us || ()*how ub"adu"Range(i   how us "nmw c"
      if y neg t bcck   e" .jo"get
  func etur (wein tndv.
astitorntapioif (ieie &&mrthod
       , d.!
    etu.itornt)*how ub" .jo"l", funcanges }
  omn(teS}
  Ban bel chan)reparenctext _pretabS;
   type, cm, litabS;
 ;", fu) {
gutter (text, left, n)/ turSt();olionuntColum er, a.f (!ra     dtabS;
 );", fu;
  r, a. }
  Aunte) r, a. }
  Aunte ifput, "keyd) {
");St();Sate.fue;r, aff = wmords(/^\s*/)[0r.dinorntapioiRange(i   !agg, cmcussnpu!/\Seturn fr, aff = ,0);eView.hinorntapioi =Tot nge = how ub"not";text }eanges.pushow us "nmw c"
      if inorntapioi =T
    etu.itornt( }
  ,;r, aff = we(clip");St();Sate.fw Rangeea;r, aff = (;extensp;
  inorntapioi =s Passdrmainorntapioi >.clie)lLeft(cmcm, d.!agg, cmcusm;+= outside;
  anhow ub" .jo"l", funcurOp.updateI.pushow us " .jo"m)lLeft(cm, d.nn> 
   cx, lctinorntapioi =TonuntColum e(text, left, n-1).f (!ra     dtabS;
 );", fureanges.norntapioi =Tot nge }eanges.pushow us "adu"
      if inorntapioi =TturSt();o+type, cm, liinorntUnitm, fun}eanges.pushow us "nubt arE"
      if inorntapioi =TturSt();o-type, cm, liinorntUnitm, fun}eanges.pusdefaibehow us "numbut"
      if inorntapioi =TturSt();o+thow
    v}val, inorntapioi =Tay).left) / inorntapioi  cmousedowninorntSate.fue;""  | clic0;exteni    me, cm, liinorntWithTaboi       ; ++i) {
    ay).lfleor inorntapioi /dtabS;
 ); i= --[ihe| cl+=dtabS;
 ;ninorntSate.fu+pu"\t";pdateI.pus| cl< inorntapioi ninorntSate.fu+pust();Sat inorntapioi -)nch ondateI.pusinorntSate.fu!=
");St();Sate.fm)lLeft(cmrel_mouRcm, "utReainorntSate.f,a(docn      (docn  ");St();Sate.fw Rangeea;"+e.fak" Range(rtorSize.top ?  &&neen quunaa *iedL timay.in  forneSpacewhiurnt();oaadL  e
dex].top ?  &&kedL tir, a/  e,the  //do  eral,e.fakedL aadnt();.       ; ++i) {
     = viewine = cm.doc.sel.ranges[i].head.lineneos(doc, Pos(neRange = {anchor handle e(i   r, cm ectiline+(us |.c.sehead ectiltriewd);St();Sate.fw Rangee lLeft(cmcm mlay.| clic(docn  ");St();Sate.fw RangeerepareCocm mrel_mouOneIndex), sel_moui,
s  sline +nch dnch erepareCocm mblick;
  fu   v}val, ncurOp.updateIr, a. }
  Aunte ifput, "keonding pUtilitn*; ++appiye = atiPaste gingsine+(byi.dragga ++numbut,
t.
  re oute = faarnumbuta);
 , cm, alln*regate re = faarine+(as't.
   {
   dy.pollingFastc{
   xt, left, .draggead", cmTdoc =glm)lLeft(os(dno = .draggeagutter .dragg  disp;
  tefaibehdraggaus "numbut"
 gutter (text, left, tionxt, left, .dragg))repareangesno = r, aNo(.dragg)  disp;
  no =s || ()*+= out)eSpace.get;
  opcventedno)ftype   (c)p+=ginto (cm, "utR.);
 noead", cmTdoc      iFi out)r, a;Lefonding pweln(e*; ++dndeme = fblefn).
 faart, otherw( ) d funfthaimno ethesr g pbccknt();,+dndeme,a);
 simils(d lingFasalitny.pollingFastdndemeN).
Index), see(e)on doc );
    e_pre     se) func-1)
         or.sta < cmminimaombBuildmoussters ibe     setha.sta cx, l  merg cm.dverl en   inimaomb.doc.se
    ; ++i) {
     = view.doc.sel.ranges[i].head.lineos(dtoKsta < on doc (= {anchorerepareCowhicur(.staw Range(pe = "dtoKsta.o   , ln f.sta)cspla<type ead.lineneos(docl_moudn=a.sta.p   on(disp(eeni    mp(ocl_moud     , tiKsta.o   (f<To(caepareCocm mtiKsta.o   n=aocl_moud     repareCocm mblick;
  fu   v}val, ncurOp.u a.sta.pctiotiKsta}
    v}val, ombN (!raeI  // faosl,Cit dib.doc.se
    runInO(d.scr(cm);}, 20);eView.h; ++i) {
    .staw Range(- 1= vi>ew = i--. nge = le+=l_mouRcm, "us()-1,l""  .sta> 0)o   , .sta> 0)fo, "+dndeme")t nge =    varCay.inVef (cut(cm
    v}entY onding pU to ; ++heaaz    lceIseocussmoEven. Din use-1a ++1  rhn(eif
ap  frges.,a unitfkancbe "d", {
 "colum "  r,ktimPar, bufr (wein 't.
     sssine+(bmeouarie ) d"word"  a   sssnble
word)raEve"gh))p"  to {
  fune new curfsnble
gh))purfsworda ++non-word-non-whiurnt();'t.
   {
rs)"cl(d visuPoln*pw amt(varrols fires t.dinn for  to-rhn(
ing psele,layrotherwi1e   /setha  // fowardt faarnblef torSrneSpac {
d b ate.f,aEvenowardt faar {
rCiteo that
   for akedL tim { n.p gug p right o"cl(d e,  =  cm. right of clicndv.
a hiuSide=rn p gug p con(etn*i  itflic        ie.fakedL tis whethey.pollingFastf to(doHleft, nch dayra unit, visuPoln ;
    e_pre> li r nchor, aa.sull;(start lEvarDin =r =r;", fu) {
guttObj = (text, left, t, a);e") {lay.| cf (cur=Ton preparellingFastf toN (!      head.lineos(dl = r, a(+ mi{Range(Po;
  rn< 
   cx, lormali>ew
   cx, lf+(neRan;
 )iFi out)(| cf (cur=T  } e,Range(Po> li r , "keydowFi out)r, aObj = (text, left, t}
    v}val, llingFastL //OnlipbmeouToL, a) lLeft(cmos(dnalef.d(visuPoln*?tL //VisuPoln*:tL //Logicalln)(r, aObja.su dayra pe == "doublecm =nalef.s || ()* extend(ls;
  cbmeouToL, a(pe f toN (!      0);eView.hr displavisuPoln ;sull;(ayrf<To*?tr, a;
   ;:pl, aL.ft)(r, aObjline < visidi.viewsull;ayrf<To*?tr, aObj.f (!w Range(:Tot nge = le}i.viewlc out)(| cf (cur=T  } e,Range(Po}i.viewsull;nate.cutIncolt(e);
on preparew text .pusunitfus "d", {)tL //Onlip)repareanges.pusunitfus "dolum ")tL //Onlippe == "doubanges.pusunitfus "word" rmaunitfus "gh))p"cti", funce
  
awT if (a     dgh))pu=aunitfus "gh))p"side;
  _preheln(e*li)-1).gftype   (c;(teweln(e+nch d"wordC{
rs")t nge = ; ++i) {
cx, lf=Ton pr;
cx, lf=T  } e,* extend(ls;
  ayrf<To*npu!L //Onlip!cx, lc)mblick;
  fu   v) {
");
  r, aObj.f (!wd", A ff{)e(do"\n";
  fu   v) {
  if ( usWordC{
r(tur, heln(e)a? "w"ne < visidi:dgh))pupe =);
 =o"\n"a? "n"ne < visidi:d!gh))pu(do/\seturn ffue)a?     ne < visidi:d"p";
  fu   v;
  gh))pupe !cx, lupe !  if)
  if ( "s";
  fu   v;
  
awT if pe 
awT if !s(  if0);eView.hr displad/rf<To(cadin =r1= L //Onlip)r}eView.hr diblick;
  fu   v}v
  fu   v;
    if0)
awT if (a  ifn(disp(edisplad/rf>To*npu!L //Onlip!cx, lc)mblick;
  fu  urOp.updateI    lct = t= skipAtomic utRea(docventedchs lEvarDina pe == "doubi
  ccm.s (cu(cre  =  hiuSider=Ton preparelay.line,  = ) {
rn gug pForceIseocussv (vical L //ethey Din maycbe -1a ++1. Unitfkancbe gug p"pa, " Eve"vent""cl(d e,  =  cm. right of clicndv.
a hiuSide=rn p gug p con(etn*i  itflic        ie.fakedL tis whethey.pollingFastf to(doVoe(e)nch dayra unitm;
    e_prevoc.ocus()-1,lx r nchoron(, arget(e);
 unitfus "pa, "cti", funce
  pa, S;
   tay).lene)) v// Used to ensu  if (mLeft);,    cas.inn  ize();
(doc, hetheyc, hetheEneeded. if (mLeft);
;
  fu  y r nchomgle+ed/rf*)(|a, S;
  -;(ayrf<To*?t1.5i:d.5)f*)tengptions.guttBoundi) Range(rtorSiz);
 unitfus "vent"cti", funcyll;ayrf>To*?tnchobultPre5=3i:dnchomgle- 3
    v}val, li++i;;.head.line_pretarged, tyeordtC{
r(tLisx, aocumentls;
  ctarged.e.clien)mblick;
  fu  ;
  ayrf<To*?cyl<type:)yi>ew
   hze();0);abarged.hiuSider=Ton prmblick;curOp.u ayf+romirf*)5
    v}val, lt(e);
oarged) {
rn gug pEDITOR METHODt happenstartublicln*eef (curAPI. Notquicat mrthodO(df)e   /shappen'to e ffiionnion(e)) do,
n(eli+msd.pas nsf`    ` pw amen(r'. happenstist   not,nt(cm,mno //b rs ibe    if mrthods. Mostfiberalble clmrthods ref, adfpasteInDoc.  if Cha vlshainj    var me
ing pCotuMirrg). coto doc =li++bcckwardt m,mn)) bilitn*h case a (vaveniince. hapCotuMirrg). coto doc = e.top (va atuctin:TCotuMirrg),val, licus:)(cm);}, 20{   cas.licusp)r ainable foc    )r ayCut(e)     )r},v
  fu rsOpht o:jocm);}, 2, cm, , v(d.icti", funce
  o cm, l =Nble =o cm, l, old =No cm, l[o cm, ight >= mX) {o cm, l[o cm, ifus t(d.innpu/ EVENl!s(" etu"m;+= outside;
  o cm, l[o cm, ifu t(d.ight >= mX) {o cm, e);
   s.hasOwnPcon(etn{o cm, )
         on(e)) donracm.do cm, e);
   s[o cm, i)nracm.dt(d.i, old Range(r,v
  fugrsOpht o:jocm);}, 2, cm, ctilt(e);
ole =o cm, l[o cm, ig},
  fugrsDoc:)(cm);}, 20);lt(e);
ole =
  r},v
  fuaddKeyMap:)(cm);}, 2map, bultPr) i", funcole = }
  }keyMaps[bultPre?e"pcti"r:l"undRang"]2map Range(r,val, ltL //KeyMap:)(cm);}, 2mapcti", funce
  maps =Nble = }
  }keyMapst nge = ; ++i) {
     = viewmapsel.ranges++[i         i   mapster ==wmapdisp(tefaibemapster ! tomate.f nnpumapster.nlen ==wmap 0);eView.hr dimapseineslipi,  }
    vvvvvvvlt(e);
on prepareCoFo0);
  },v
  fuaddOverl y: mrthodO(dfcm);}, 2spec.do cm, scti", funce
  moentY inecomgkene?einec :TCotuMirrg);(teMetu(ble =o cm, l, inecocumentls;
   etu.new cS}
  eNblrow
s  sErrg)("Overl ys maycnot,bes }
  ful.")t nge = ble = }
  }overl yslectio{ etu: moen, moenSnec: spec.do aquu: o cm, l npu/ EVEN =o aquu})t nge = ble = }
  }moenGen++.cutIncoltg (cm, "    )r    v}e,val, ltL //Overl y: mrthodO(dfcm);}, 2speccti", funce
  overl ys = ble = }
  }overl yst nge = ; ++i) {
     = viewoverl ysll.ranges++[i ead.lineneos(d");
  overl yster.moenSnecn(disp(eeni    );
 =oinec rmatefaibeinec = tomate.f nnputuronlen ==wspeccti", func    overl yslineslipi,  }
    vvvvvvvble = }
  }moenGen++.cutIncoIncoltg (cm, "    )r    vvvvvvvlt(e);;
  fu   v}val, ncurOp.up),v
  fuitorntxt, : mrthodO(dfcm);}, 2n dayra agg, cmcusm;
    esp;
  tefaibemirf! tomate.f nnputefaibemirf! tonumbut"
      if   ;
  ayrf.s || ()*din =rble =o cm, l.nmw citornt ? "nmw c"i:d"p.jo"l", funcubangesdin =r =r ? "adu"i:d"nubt arE";
  fu  urOp.ueI.pusis     ole =
  , n))titorntxt, lracm.dn dayra agg, cmcusmr    v}e,val, inorntSndex), s: mrthodO(dfcm);}, 2howcti", funce
       se) ble =s-1)
         orl rol -1t nge = ; ++i) {
     = view.doc.sel.ranges[i].head.lineneos(doc, Pos(= {anchor handle e(i   !ehead emptn  0);eView.hr dios(d matc=tr, cm.o   (), ti - r, cm.t)()r    vvvvvvve
  
dex] =Tay).left)e r,i    or, a);", funcncuba rol ay).lene)ble =          / tior, an- (fooeIn?a0 :f1)) + 1;", funcncub; ++i) {
j = 
dex];
j <ba res++j(eView.hr di  itorntxt, lracm.dj,.hew)r    vvvvvvve
  s  R    se) ble =s-1)
         r    vvvvvvvi       oce(tex0.c.seheadsw Range(texs  R    sw Range(pe s  R    s> 0)o   (>ocho>To(eView.hr di  rel_mouOneIndex), seole =
  , i,
s  sline +o   , s  R    s> 0)t)()) d.prevInput = "";
.hr di  rtorSiz);
 r, cm ectiline+(>)ange);eView.hr distorntxt, lracm.dr, cm ectiline+,.hew,ape == "doublencuba rol r, cm ectiline+r    vvvvvvvi   dol.sble =s-1)
   ype itorSi    varCay.inVef (cut    )r    vvvvv}val, ncurOp.up),v
  fug pF= chSpace|| seo thkene; ++ailionn
 {
rCiteo.pU tful ; ++hcckn
  fug p sel/sa
    einspect func etur }
  o(sdipo  ++m,mno /m, c.
  fugrsThkenAt:)(cm);}, 2nch dnrecisicti", funce
  voc.ocole =
  r", func| cliction(doc, nornch on(d.s  if ( }
  omn(teS}
  Ban belracm.dnchor, aa.nrecisic, moentY ble =s-1)moenon(d.s  if (gutter (text, left, nchor, a on(d.s  if ( }licm   s  state.fS}licmer, a.f (!rable =o cm, l.tabS;
 );", furewhicur( }licm.| cl<  {
 chonpu! }licm.eol  0);eView.hr  }licm.
dex] =T }licm.| c;
  fu   v) {
dtyl>n=aocadThken(moen,  }licm,l }
  frval, = urOp.uenlay.linP
dex]:  }licm.
dex]asteIncoming ? "e rn( }licm.| casteIncoming ? "mate.fn( }licm.m { n.p(,asteIncoming ? "tefa:
dtyl>nrma     steIncoming ? "ma
  :"ma
  }  dispw,v
  fugrsThkenT ifAt:)(cm);}, 2nch0);eView.h| cliction(docole =
  , nch on(d.s  if ( }yl>ser (text, S}yl>slracm.d(text, lole =
  , nchor, a)"mousemovif (can be ic0,{aunteoli( }yl>sw Range(- 1) / 2a.sull;(start= visi v) {
  ifcumentls;
  ce(tex0)
  if (  }yl>s[2r handle orSizli++i;;.head.linence
  mirol (can be +{aunte) >> 1;", funcnc;
  (miro?  }yl>s[miro* 2l-c1]on(c i>ewf{)eaunteolimirl", funcubanges;
  
}yl>s[miro* 2l+c1]o<wf{)ecan be icmiro+ 1;", funcncorSize
  if (  }yl>s[miro* 2l+c2r mblick;curOp.u a} visi v) {
cueos(  if ?(  if.ctorSOf("cm-overl y ")d:o-1t nge = lay.lin)utf<To*?c  if :
cueos=To*?c|| (d:(  if.e(clip0,
cueo-  }
    v},v
  fugrsMetuAt:)(cm);}, 2nch0);eView.he
  moentY ble =s-1)moenon(d.s  i   ! etu.itnerMetu)iFi out)moenon(d.s  Fi out)CotuMirrg);itnerMetu(moen, ble =grsThkenAt2nch0= }
  ))moenon(d.s},v
  fugrsweln(e:)(cm);}, 2nch d  if0);eView.hlt(e);
ole =grsweln(es2nch d  if0[0]on(d.s},v
  fugrsweln(es:)(cm);}, 2nch d  if0);eView.hos(d 7)
  < cmminima  i   !heln(es.hasOwnPcon(etn{  if0)iFi out)heln(esside;
  _prehelner .eln(es[  if], moentY ble =grsMetuAt(nch on(d.s  ;
  tefaibemoen[  if]rn tomate.f        if   ;
  .eln[moen[  if]])d 7)
 lectiomeln[moen[  if]])Range(Po}i.view;
   etu[  if]       if   ; ++i) {
     = viewmetu[  if]el.ranges[i].head.linene  _prevaut) meln[moen[  if]> 0r handle e(displaval)d 7)
 lectioval)r    vvvvv}val, ncui.view;
   etu..eln(eT if pe meln[moen..eln(eT if]       if   ; )
 lectiomeln[moen..eln(eT if] Range(Po}i.view;
  meln[moen.nlen]       if   ; )
 lectiomeln[moen.nlen] rval, = urOp.uen; ++i) {
     = viewmeln._globauection(ds[i].head.lineneos(d");
  meln._globauhor handle e(i   turonred(moen, ble )lclictorSOf(; )
 / turoval)d==ex];", funcncub; )
 lectioturoval)rval, = urOp.uenlay.lin; )
 on(d.s},v
  fugrsS}
  Aunte:)t
      er, a dnrecisicti", funce
  voc.ocole =
  r", funcgutter tionxt, left, ine+(us || (d? 
   cx, lf+(neRan;
 o-  : r, a on(d.s  , signalteS}
  Ban belracm.dr, anchor)nrecisicon(d.s},v
  fulay.inCeordt:)t
      e
dex]awmetucti", funce
  pom.dr, cme) ble =s-1)
   ype ary on(disp(e);
 s= truedT|| ()*| clicr, cm ecti handle orSiz;
  tefaibes= truedT"objdge")h| cliction(docole =
  , s= tr);", fureanges| clics= tru?tr, cm.o   ()d:(r, cm.t)()r    vvvlay.lin)uy.inCeordtoracm.dnch, moent(do"pa, "con(d.s},v
  ful{
rCeordt:)t
      ench, moen0);eView.hlt(e);
l{
rCeordtoracm.dtion(docole =
  , nch , moent(do"pa, "con(d.s},v
  fuleordtC{
r:)t
      eleordt, moen0);eView.hkeordt = o   CeordSystemoracm.dteordt, moent(do"pa, "con(d.s.hlt(e);
leordtC{
r(racm.dteordtoron(, )eordt.t),con(d.s},v
  fur, aAgptions:)t
      eheft);, moen0);eView.hhze();
= o   CeordSystemoracm.d{n pn(heft);, ieftn(0}, moent(do"pa, "c.tolrepareowFi out)r, aAgptionscole =
  , hze();
+ ole =
m.options.gutters Range(r,val, hze();Atxt, : t
      er, a dmetucti", funce
  a rol tPos = 
   olible =s-1)cx, lf+(ble =s-1)
;
 o-  n(disp(e);
 r, an< ble =s-1)cx, l
 gutter ble =s-1)cx, l handle orSiz;
  r, an>{
   urno> li r ,   ; a rol on pr urOp.ufu) {
guttObj = (text, lole =
  , r, a on(d.s  , signar meCeordSystemoracm.dr, aObja.{n pn(0, ieftn(0}, moent(do"pa, "c.toll+steIncomi)e r*?c le =s-1)heft);l-chze();Atxt, (r, aObjlon(c on(d.s},v
  fudefaultTengptions:)(cm);}, 20);alt(e);
oengptions.ole =
m.opti);(r,val, defaultC{
rW= nu: (cm);}, 20);alt(e);
c{
rW= nu.ole =
m.opti);(r,vval, ersmMouseMa(#tt: mrthodO(dfcm);}, 2r, a dludge ID, v(d.icti", func== "reltricChxt, lole =
  , r, a/ Kludge "r)t
      er, a) lLeft(cmcm= Mama(#ttsue;r, afgMouseMa(#tt.disp(r, afgMouseMa(#tt.d= ep)r    vvvvvma(#tts[ludge IDifu t(d.ight >= m  i   !t(d.innpuisEmptn ma(#tts));r, afgMouseMa(#tt.difput, "keydowvvlt(e);
on prepareCo  the new),v
  fume).
mMouse: mrthodO(dfcm);}, 2ludge ID.head.lineos(dimer ble ,evoc.ocus()-1,li ew
   cx, lrepareCo/  .iuse(t
      er, a) lLeft(cmcm, d.r, afgMouseMa(#tt.dnpur, afgMouseMa(#tt.[ludge IDi.head.linene  r, afgMouseMa(#tt.[ludge IDidifput, "keydowvveIltginto (cm, "cm, i/ Kludge " Range(t(cmcm, d.isEmptn r, afgMouseMa(#tt.));r, afgMouseMa(#tt.difput, "keydowvv}eView.hr ++irepareCo  the new),v
  fuaddintoW= (te: mrthodO(dfcm);}, 2hdraggeanetu lE cm, scti", funclt(e);
addintoW= (teoracm.dhdraggeanetu lE cm, scthe new),v
  fultL //intoW= (te: fcm);}, 2w= (te0);aw= (te.me).
();(r,vval, r, aInfo:)t
      er, a) lLeft(cm;
  tefaibeine+(us onumbut"
      if   ;
  !is     ole =
  , r, a)"*+= out)eSpace.getlineos(dnue;r, ace.getlinegutter (text, lole =
  , r, a on(d.s    ;
  !r, a) += out)eSpace.getligtorSize.top ? -2os(dnue;r, aNo(r, a);", funccm, d.n =s || ()*+= out)eSpace.get= urOp.uenlay.linPlt, :      if e: r, a/ tengthr, a.f (!ragMouseMa(#tt.:;r, afgMouseMa(#tt.asteIncoming ? "t (!C,  sthr, a.f (!C,  s, bgC,  sthr, a.bgC,  s, to eC,  sthr, a.to eC,  sasteIncoming ? "w= (testhr, a.t= (tes}  dispw,v
  fugrse = pors:)(cm);}, 20);alt(e);
{aste[iole =
m.options.gF   , tiPafle =
m.options.gTo}r},v
  fuaddW= (te: fcm);}, 2nch, netu loll",   vert,+heaazcti", funce
  vy.lineDivfle =
m.optir", func| clictuy.inCeordtoracm.dtion(docole =
  , nch "mousemovif (mgleounchobultPr, ieft r nchoron(mousemovnetu.neylt.p ight ofs "absolut;";
  fu   if (mY s;
 ur  vardCentR(netu);", funcsplavetruedT"ovut"
      if   mgleounchotolrepareow}i.view;
  vetruedT"abe_b" rmavetruedT"n).
"ions.tabSize;
  vst();oliay).left)// Used to ensu  if (mLeft);,  le =s-1)heft);,asteIncomihst();oliay).left)// Used s;
 ur if (m = nu,lay.linen> liSt();r if (m = nu);", funccm// Default   ep ight oe = abe_bu(ibeineciff dg);
 em.s (cu(; oes twigesdefault   ep ight oe = bel//", funcnc;
  (vetruedT'abe_b' rmanchobultPre5=netu.ottersize();
> vst();)lclinchomgle>=netu.ottersize();;", funcncubmgleounchotoll-cnetu.ottersize();l", funcubanges;
  nchobultPre5=netu.ottersize();
<= vst();)", funcncubmgleounchobultPr;", funccm, d.lon(e+enetu.otters = nul>ihst();)", funcncubieft r hst();o-enetu.otters = nuce.get= urOp.uennetu.neylt.mgleoumgle+e"px"mousemovnetu.neylt.ieft r netu.neylt.re();
= "";", funcsplaheaazuedT"re();"ions.tabSizeieft r // Used s;
 ur if (m = nuo-enetu.otters = nuce.get=   netu.neylt.re();
= "0px"mousemovgtorSize.top ? -2splaheaazuedT"ieft"
 gon(e) 0reparencubanges;
  heaazuedT"midf e"
 gon(e) )// Used s;
 ur if (m = nuo-enetu.otters = nu) / 2ce.get=   netu.neylt.gon(e) lon(e+e"px";
  fu  urOp.ueI.pusoll", )", funcnc));
  Range = oracm.dron(,(mgl, lon(e+enetu.otters = nu,umgle+enetu.ottersize();;  dispw,v
  futre(gerOnKeyDows: mrthodO(donKeyDows,asteIntre(gerOnKeyP, cm: mrthodO(donKeyP, cm,asteIntre(gerOnKeyUpn(onKeyUp,v
  fuexecCn m);
:)t
      elmd) lLeft(cm;
  on m);
s.hasOwnPcon(etn{lmd). nge = le+=(e);
le m);
s[lmd]"    )r    v},v
  fuf to(doH:)t
      eo   , amnunta unit, visuPoln ;
    ence
  vyn =r1=Left(cm;
  amnuntf<To(catvyn =r-1; amnunt =r-amnunt; urOp.uen; ++i) {
     ,
");
  cion(docole =
  , o   (= viewamnunt; ++[i ead.linene");
  f to(doHlole =
  , tur, ayra unit, visuPoln  handle e(i   turohiuSide)mblick;
  fu  urOp.uvvlay.lin)uyr    v},v
  fuL //H: mrthodO(dfcm);}, 2ayra unitm;
    eneos(dimer ble ;
  fu  us( (!ardIndex), ssBydfcm);}, 2r, cm ); onFoeIeni    me// Used sRangeout(unc-1) (!ardeoutehead emptn  0"keydowvveIlty.lin; to(doHlus()-1,lr, cm ecti, ayra unit,  me, cm, lirtlM //VisuPoln)reparencubange"keydowvveIlty.linayrf<To*?cr, cm.o   ()d:(r, cm.t)()r    vvv} d.preL //cthe new),v
  fudndemeH: mrthodO(dfcm);}, 2ayra unitm;
    eneos(ds
    ble =s-1)
  , voc.ocole =
  r", func.pusoel. .getSeleIndex)ed  0"keydowvvs-1)rel_mouIndex), se"" d     d"+dndeme")t nge =  nge"keydowvvdndemeN).
Index), seracm.dfcm);}, 2r, cm ); onFoeIennce
  oes t
  f to(doHl)-1,lr, cm ecti, ayra unit,   } e,Range(PovveIlty.linayrf<To*?c{aste[ioes t.dtiPar, cm ecti}d:({aste[ir, cm ecti, tiPaoes t}Range(Povv  the new),v
  fuf to(doV:)t
      eo   , amnunta unit, goalColum  ;
    ence
  vyn =r1,lx r goalColum =Left(cm;
  amnuntf<To(catvyn =r-1; amnunt =r-amnunt; urOp.uen; ++i) {
     ,
");
  cion(docole =
  , o   (= viewamnunt; ++[i ead.lineneos(dieordt = lay.inCeordtoracm.dtur, "div"  handle e(i   x =s || ()*x, tyeordtoron(mousemovdi.viewseordt.lon(e= x;ad.linene");
  f to(doVoracm.dteordt, ayra unitm handle e(i   turohiuSide)mblick;
  fu  urOp.uvvlay.lin)uyr    v},v
  fuL //V: mrthodO(dfcm);}, 2ayra unitm;
    eneos(dimer ble , voc.ocole =
  , goals < cmminimaneos(diellaps;oli! me// Used sRangetyp!
    (!ardetype   oel. .getSeleIndex)ed  repareCo/  . (!ardIndex), ssBydfcm);}, 2r, cm ); onFoeIeni    ellaps;0"keydowvveIlty.linayrf<To*?cr, cm.o   ()d:(r, cm.t)()r    vvv  _preheadP clictuy.inCeordtoe(e)r, cm.ecti, "div"  handle e(i   r, cm.goalColum  !=r|| ()*headP c.lon(e= r, cm.goalColum  handle e(goalslectiomeadP c.lon()r    vvv  _pre| clicf to(doVoe(e)meadP c, ayra unitm handle e(i   unitfus "pa, ".c.seheadnooc -1)
   ype ary o0"keydowvveIaduToS);
     / Lis     dl{
rCeordtoe(e)nch d"div" otoll-cmeadP c.tun);", funccmlty.lin| c;
  fu  } d.preL //cthe ne v;
  goalsl Rangee ; ++i) {
     = viewine = cm.doc.sel.ranges[i]."keydowvvs-1)nge = {anchor.goalColum  r goalchor handlp),v
  fug pF toSpacewordaat an ilionn
p ight of(as
lty.li dgcy
leordtC{
rc.
  fuf toWordAt:)(cm);}, 2nch0);eView.he
  voc.ocole =
  , gutter (text, left, nchor, a .f (!minimaneos(d
dex] =T(start la rol (start= visi v, d.r, ai ead.lineneos(dheln(e*liole =grsweln(e+nch d"wordC{
rs")t nge = nc;
  ((staxRelf<To*rmal rol.sr, a. Rangee pe 
= tr) --
dex];
.view++endr    vvv  _pre
dex]C{
rue;r, afd", A fs= tr);", fureneos(diPeck ( usWordC{
r(
dex]C{
r, heln(e)"keydowvveI?)t
      elh0);alt(e);
usWordC{
r(th, heln(e); }eView.hr di:o/\seturn f
dex]C{
r)I?)t
      elh0);lt(e);
/\seturn ffh)r}eView.hr di:)t
      elh0);lt(e);
!/\seturn ffh))npu!isWordC{
r(th)r};", furenewhicur( }ex] >To*npuiPeck(r, afd", A fs= tro-  })) --
dex];", furenewhicur(l ro<sr, a. Range*npuiPeck(r, afd", A fange)) ++endr    vvvurOp.uvvlay.lins  sline + 1, nchor, aa.s= tr)ea(docnchor, aa.ange)  dispw,v
  futoggl/Overwrit : t
      ev(d.icti", funcsplavalue !s || (bnpuvalue == ble = }
  }overwrit m;+= outside;
  ;
  tle = }
  }overwrit oli!ble = }
  }overwrit m", fureneaduC,  s.ole =
m.optiilay.inDiv d"CotuMirrg)-overwrit ")t nge =  nge"keydowvvrmC,  s.ole =
m.optiilay.inDiv d"CotuMirrg)-overwrit ")t "keydow;
    oracm.d"overwrit Toggl/", ble , ble = }
  }overwrit mRange(r,val, hasFicus:)(cm);}, 20);alt(e);
arEvveElt()ol.sble =sm.optiie.fak;(r,vval, ell", fu: mrthodO(dfcm);}, 2x, aoti", funcsplaxe!=r|| (drmay !=r|| ()*npuolus;
    on   /    )r    vvvsplaxe!=r|| ()sble = text.oll", ion(e=pxr    vvvsplaye!=r|| ()sble = text.oll", Tgleouy handlp),vandlg});
    Info:)t
      ecti", funce
  
);
  (e*liole = = extendd(e);
 .dte =ct);
  
 Cututton(d.s  , signa{ieftn(dd(e);
        ion(, n pn(dd(e);
        }),asteIncoming ? "meges.: dd(e);
        Left);l-cco, w= nu: dd(e);
         = nuo-ecoasteIncoming ? " if (mLeft);: dd(e);
   if (mLeft);l-cco,  if (m = nu: dd(e);
   if (m = nuo-eco}  dispw,v
  fu));
  Range = : mrthodO(dfcm);}, 2r, cm,rmarrt;ollLeft(e(i   r, cmf.s || ()* extend(lsr, cme) {aste[iole =
-1)
   ype ary o ecti, tiPa|| (}t nge = nc;
  marrt;fus || ()*marrt;fuTble =o cm, l.lay.in;
    Marrt;repareow}i.view;
  tefaiber, cmf.s onumbut"
      if   r, cme) {aste[iP1,  head      tiPa|| (}t nge = rtorSiz);
 r, cm  matc=s || ()* extend(lsr, cme) {aste[i head  tiPa|| (}t nge = rLeft(e(i   !r, cm.t)r(r, cm.t)c=tr, cm.o   on(d.s  ,, cm.marrt; icmarrt; rma0t "keydow);
 r, cm  matline+(!=r|| ()* extend(lsnpuolus;
    on   /    )r    vvv sble = text.oll", TgP clicr, cmce.getligtorSize.top ? -2os(d
    ifcalcultn(S);
     /ble , ay).lene)r, cm  matlion(, r, cm.t).lon(,asteIncoming ? "paste" : cm  )))))))))))ay).lene)r, cm  matlmgl, r, cm.t).t),)(- r, cm.marrt;asteIncoming ? "paste" : cm  )))))))))))ay).left)r, cm  matlrges.ler, cm.t).rges.,asteIncoming ? "paste" : cm  )))))))))))ay).left)r, cm  matlbultPr, r, cm.t).bultPr) + r, cm.marrt;ll", funcvvble =      To(s   roll", ion(, s   roll", fun);", funcurOp.up),v
  fu)});iz : mrthodO(dfcm);}, 2w= nu,uhze();0);    eneos(dimer ble ;
  fu  llingFastitterp, saval)d extend(lsnp(e);
oefaibevaut)s onumbut"u(do/^\d+$eturn ftate.faval))I?)vaut+e"px"i:)vaut nge = rLeft(e(i   w= nu(!=r|| ()*) v// Used to ensu neylt.w= nu(=titterp, saw= nu);", func;
  meft);l!=r|| ()*) v// Used to ensu neylt.hze();
= itterp, saheft);
;
  fu  i    me, cm, liine+Wo en   urme).
xt, Mrom |eededCc   /    )r    vvv) {
guttNo iv.getBoundions.gF   ;
  fu  us(/  .iuse(guttNo,v.getBoundions.gTor)t
      er, a) lLeft(cmcm, d.r, a.t= (tese ; ++i) {
     = viewr, a.t= (tesel.ranges[i]."keydowvvcm, d.r, a.t= (tester.noHut = "");altginto (cm, "cm, guttNo,v"t= (te")tmblick;curOp.u ar ++guttNorepareCo  the neeIfHa text.femptU, "mool on pr"keydow;
    ohen arefnpuh", ble  the new),v
  fuon(e)) do:)t
      eo);lt(e);
runInO(dracm.df)r},v
  furefnpuh: mrthodO(dfcm);}, 2cti", funce
  oldHze();
= ole =
m.optiilc    Tengptionson(d.s  , g (cm, "    )r    vvvble = text.femptU, "mool on pr"keydowme).
Cc   s"    )r    vvvble =      To(ole =
-1)
     ion(, nle =
-1)
     fun);", funcr, "momMouseSt();/    )r    vvvsplaoldHze();
==r|| (drma.clientY oldHze();
-
oengptions.ole =
m.opti)l >e.5."keydowvvoordinatintoptionss"    )r    vvv;
    oracm.d"refnpuh", ble  the new),v
  fuswapDoc:)mrthodO(dfcm);}, 2aoccti", funce
  old =Nole =
  r", funcold.imer eSpace.get= attc  Doc ble , voc)r"keydowme).
Cc   s"    )r    vvvnpuetle foc    )r    vvvble =      To(
-1)
     ion(, 
-1)
     fun);", funcble = text.femptS);
   e)on pr"keydow;
      // Wracm.d"swapDoc", ble , old Range(lsnp(e);
oldthe new),v
  fugetle foField:)(cm);}, 20{lt(e);
ole =
m.optiie.fak;},
  fugrsWo ensuEneeded:)(cm);}, 20{lt(e);
ole =
m.optiito ensu;},
  fugrsSd(e);
 Eneeded:)(cm);}, 20{lt(e);
ole =
m.optiidd(e);
 ;},
  fugrsmMouseEneeded:)(cm);}, 20{lt(e);
ole =
m.optiiludge sr}eVi}t ngevdedMixne)CotuMirrg))t "ke// OPTION DEFAULTt happenstardefault configue)) do
, cm, li
.he
  vefault  ifCotuMirrg);vefault  ifep= vig pFcm);}, setharunget
  o cm, l Cha  {
   dy.poe
  o cm, e);
   s ifCotuMirrg);o cm, e);
   s ifep= 
  llingFasto cm, (nlen,+dnflt.dhdraggeanetOnInitm;
    eCotuMirrg);vefault [nlen] r /nfltthe ne;
  mdragg)do cm, e);
   s[nlen] range(lsnetOnInitI?)t
      elm, v(d, old  {splaoldl!=rInitm;mdraggelm, v(d, old ;}d:(.dragg  dirn gug pPassunftha/ EVENlh);
   s et
  funret   no old valuey.poe
  InitIifCotuMirrg);InitIif{toSate.fn((cm);}, 20{lt(e);
"CotuMirrg);Init";}}; happenstaSiztwo Cha,.pas nit,  aab fo matcnt(cm,a atuctincbeclushepacn't.
  ndv.
fo  em nitializ dgcan be an ie   if kancs= troat elly.poo cm, ("value",l""  t
      elm, v(dm;
    em); etValueoval)r   },ape == "doo cm, (" etu"is     dt
      elm, v(dm;
    em);s-1)moenOpht ofu t(dthe neloadMetu((cm
   },ape == ""doo cm, ("inorntUnit"is2,eloadMetu,ape == "doo cm, ("inorntWithTabo",   } e,Rango cm, ("nmw citornt",ape == "doo cm, ("tabS;
 ",a4 dt
      elmm); onFonpursMetuS}
  t(cm
    vme).
Cc   s"(cm
    v, g (cm, "(cm
   },ape == "ngo cm, ("nnecialC{
rs", /[\t\u0000-\u0019\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g dt
      elm, v(dm;
    em);o cm, l.nnecialC{
rs   s  sRegExpoval.sour);o+toval.urn f"\t")a? ""i:d"|\t")/ Kl")t nge m);refnpuh(m
   },ape == "ngo cm, ("nnecialC{
rP_mouholde "r)vefaultSnecialC{
rP_mouholde  dt
      elmm);m);refnpuh(m
},ape == "ngo cm, ("ndex)ricC{
rs", pe == "ngo cm, ("rtlM //VisuPoln", !   cass= "ngo cm, ("wholtintoU, "moBan be",ape == ""doo cm, ("an me",l"vefault" dt
      elmm); onFoan me (cm, d"(cm
    vludge s (cm, d"(cm
   },ape == "ngo cm, ("keyMap",l"vefault" dkeyMap (cm, d= "ngo cm, ("nxtraKeys"is    = ""doo cm, ("ine+Wo en   ",   } e, to en    (cm, d,ape == "ngo cm, ("ludge s", [] dt
      elmm); onFoersmMousesFo
xt, Numbuts  me, cm, lm
    vludge s (cm, d"(cm
   },ape == "ngo cm, ("fixedGudge "r)pe = dt
      elm, v(dm;
    em);sm.optioludge s.neylt.gon(e) vaut?+m,mnens"moFo
Hut = ".guttBoundi)t+e"px"i:)"0"t nge m);refnpuh(m
   },ape == "ngo cm, ("coverGudge N (!ToS);
  b, {
   } e, r, "moS);
  b, s,ape == "ngo cm, ("lt, Numbuts{
   } e, t
      elmm); onFoersmMousesFo
xt, Numbuts  me, cm, lm
    vludge s (cm, d"(cm
   },ape == "ngo cm, ("fir      Numbut{
 1,vludge s (cm, d,ape == "ngo cm, ("lt, NumbutFo
inage "r)t
      eittegte) {lt(e);
ittegte
},aludge s (cm, d,ape == "ngo cm, ("ohowCay.in// hIndex),  ",   } e, r, "moSndex), s,ape == ""doo cm, ("npursSndex), sOnConoengMenu",ape == ""doo cm, ("ocadOnln",   } e, t
      elm, v(dm;
    esplavalt)s onolay.in"
      if onBlur"(cm
    v em);sm.optioe.fak.blur"m
    v em);sm.optiosm.abled =Ton preparegtorSize.top ? m);sm.optiosm.abled =T  } er    vvvspla!v(dm;npuetle foc(cm
    v}
Co  the o cm, ("sm.ablele fo",   } e, t
      elm, v(dm;
spla!v(dm;npuetle foc(cm
},ape == "ngo cm, ("dragDrop",ape == ""doo cm, ("lay.inBlt,kR"mo",a530= "ngo cm, ("cay.in;
    Marrt;", 0= "ngo cm, ("cay.inptions{
 1,vr, "moSndex), s,ape == "ngo cm, ("o     Cay.inptionsPe
xt, "r)pe = dr, "moSndex), s,ape == "ngo cm, ("workTime",l100= "ngo cm, ("workDepti",l100= "ngo cm, ("flnagenSt(ns"r)pe = dnpursMetuS}
  ,ape == "ngo cm, ("addMetuC,  s",   } e, npursMetuS}
  ,ape == "ngo cm, ("p
  Ranerv(d",l100= "ngo cm, ("u caDepth", 200, t
      elm, v(dm{func-1)his ify.u caDepthfu t(dt  the o cm, ("his ifyEvdedDepti",l1250= "ngo cm, ("v = porsMarrt;", 10, t
      elm);m);refnpuh(m
},ape == "ngo cm, ("maxHionlionsL.rang",l10000, npursMetuS}
  ,ape == "ngo cm, ("L //le foWithCay.in"r)pe = dt
      elm, v(dm;
    espla!v(dm;m);sm.optioe.fakDiv.neylt.mgleoum);sm.optioe.fakDiv.neylt.gon(e) 0repa}= ""doo cm, ("aabctorS"is     dt
      elm, v(dm;
    em);sm.optioe.fak.aabitorSe) vaut(do"";
Co  the o cm, ("autoainab"is    = ""dog pMODE DEFINITION AND QUERYING""dog pKnowt)moens, by nlen );
 by MIME
.he
  moens ifCotuMirrg);moens if{}, mimeMoens ifCotuMirrg);mimeMoens if{}; happenExtra Chghethel Cha s if dg)s func etu's revardencins, which usase a  funfby (legacy)e   {
 ismssinkeeloadmoen.jsethaautoinaicallnase a load ac etu. (Preferf dg   {
 ismt   t
   equire/ref, a  aabs.."keCotuMirrg);veft, MoentY fcm);}, 2nlen,+metucti", fuspla!CotuMirrg);vefault ;moen(pe slen ! tonull"
 CotuMirrg);vefault ;moen(= slenthe ne;
  Chghethel. Range*> 2."keydow etu.revardencins(= Arrtio coto doc.e(cli. aab Chghethel, 2m
    vmoens[nlen] r moenon(d}; hapCotuMirrg);veft, MIMEtY fcm);}, 2mime,wspeccti", fumimeMoens[mime] r snecn(di}; happenGionn
a MIME  doc =a {nlen,+..e, cm, l} config objdge,aEvea slen
{
d b ate.f,alt(e);
a moentconfig objdge.hapCotuMirrg);npuolusMoentY fcm);}, 2speccti", fu;
  tefaibesnec = tomate.f nnpumimeMoens.hasOwnPcon(etn{specc
      if snec =umimeMoens[snec]reparegtorSiz.pusonec nputefaibeineconlen ==womate.f nnpumimeMoens.hasOwnPcon(etn{speconlen)cti", funce
   7)
  < mimeMoens[snec.nlen]r    vvvsplatefaibe 7)
  < tomate.f    7)
  < {nlen:  7)
 }t nge = snec =ucocataObj(; )
 / inecocumentlsineconlen =b; )
 lslenthe ne}i.view;
  tefaibesnec = tomate.f nnpu/^[\w\-]+\/[\w\-]+\+xml$eturn fspecc
      if Fi out)CotuMirrg);npuolusMoen("appifc)) do/xml"m
    v}
Cofu;
  tefaibesnec = tomate.f )*+= out){nlen: snec}t nge .viewlc out)inec rma{nlen: onull"}n(di}; happenGionn
a  etur nec (anytSelep sel/npuolusMoentaccepth , f to*h case a  nitializ onniCit dib eturobjdge.hapCotuMirrg);grsMetutY fcm);}, 2o cm, l, ineco;
    e_presnec =uCotuMirrg);npuolusMoen(inecocumente
  mfactiny r moens[snec.nlen]r    vi   ! factiny) Fi out)CotuMirrg);(teMetu(o cm, l, "oeng/optt;"ocumente
  moenObj =  factiny2o cm, l, inecor    vi   moenE(!arsm, l.hasOwnPcon(etn{speconlen)cti", funce
  engs r moenE(!arsm, l[snec.nlen]r    vvv; ++i) {
 confiioengs
      if   ;
  !engs.hasOwnPcon(etn{ con)ct(varin.ight >= m  i   moenObj.hasOwnPcon(etn{ con)ctmoenObj["_"t+e con] r moenObj[ con]ght >= m  moenObj[ con] r engs[ con]ght >= murOp.updateImoenObj.nlen =bsnec.nlenr    vi   snec..eln(eT ifctmoenObj..eln(eT if =bsnec..eln(eT ifr    vi   snec.moenPconse ; ++i) {
 confiiosnec.moenPconse
>= m  moenObj[ con] r snec.moenPcons[ con]gh
 if Fi out)moenObjn(di}; happenM nimdibdefault  etu."keCotuMirrg);veft, Moen(onull"cr(cm);}, 20);eView+= out){thken:)t
      e
dlicm)nP
dlicm.
kipToEnd  r}};
Co  the CotuMirrg);veft, MIME("oeng/optt;",tonull"
; happenst   kancbe  funfthaattc  p con(etiesetha  turobjdgeso mathappene.clien t
  Cit dib eturveft,ght o"
.he
  moenE(!arsm, l ifCotuMirrg);moenE(!arsm, l ifep= viCotuMirrg); (!ardMetutY fcm);}, 2moen,  con(etieso;
    e_preengs r moenE(!arsm, l.hasOwnPcon(etn{metuct? moenE(!arsm, l[moen]on((moenE(!arsm, l[moen]o= ep)r    vcopyObj( con(eties,oengs
n(di}; happenEXTENSIONS hapCotuMirrg);veft, E(!arsm, tY fcm);}, 2nlen,+fcm)m;
    eCotuMirrg); coto doc[nlen] r fcm)n(di}; apCotuMirrg);veft, DocE(!arsm, tY fcm);}, 2nlen,+fcm)m;
    eDoc; coto doc[nlen] r fcm)n(di}; apCotuMirrg);veft, Opht ofu o cm, ; hapdowninitHooks < cmminiCotuMirrg);veft, InitHooktY fcm);}, 2fm;
snitHookslectiof)r};"
neos(dheln(el ifCotuMirrg);heln(el ifep= viCotuMirrg);regate rHeln(e*lifcm);}, 2 doc =nlen,+v(d.icti", fui   !heln(es.hasOwnPcon(etn{  if0)i.eln(es[  if] ifCotuMirrg)[  if] if{_globau: cm}t nge .eln(es[  if][nlen] r t(d.ight p= viCotuMirrg);regate rGlobauHeln(e*lifcm);}, 2 doc =nlen,+nredfc))n,+v(d.icti", fuCotuMirrg);regate rHeln(e2 doc =nlen,+v(d.ict nge .eln(es[  if]._globaueectio{nred:+nredfc))n,+v(d:+v(d.i}
n(di}; happenMODE STATE HANDLING""dog pUtilitn*;cm);}, se; ++workelepwith"ma
  .nExpors dgcaclushenrn ecase a moens neunfthado
ole e; ++t
 in utner moens."
neos(dcopyS}
  omnCotuMirrg);copyS}
  omnfcm);}, 2moen,  }
  )ti", fui    }
  om==Ton p) Fi out) }
  Range(i    etu.copyS}
  )iFi out)moen.copyS}
  ( }
  frval, os(dn }
  omn{}t nge ; ++i) {
nfiios}
  )ti", fu  _prevaut) s}
  [ ight >= mX) {vautin }
ncaibeArrti)evaut) val.(vac))([] rval, = ns}
  [ ifu t(dthe ne}val, lt(e);
n }
  Rang};"
neos(dnew cS}
  omnCotuMirrg);new cS}
  omnfcm);}, 2moen, a1, a20);eView+= out) etu.new cS}
  t? moen.new cS}
  (a1, a20):Ton prepa}; happenGionn
a  etur);
 ar }
  o(; ++t
at  etu , f to*t
  utner moen*h case a  }
  oat an ip ight oft
at une newtewlcf(el to."keCotuMirrg);itnerMetuomnfcm);}, 2moen,  }
  )ti", fuwhicur( etu.itnerMetu)ii", fu  _preinfo r moen;itnerMetu( }
  frval, = ;
  !info rmainfo;moen(==+metuctblick;
  fu   }
  omninfo; }
  Range(  moentY info;moenthe ne}val, lt(e);
info rma{ etu: moen, ma
  :"ma
  }  di}; happenSTANDARD COMMANDt happenCn m);
l Cha pw amen(r-less
arEv, set
at kancbe n(eli+msd.pasanhappene   if,+mestly  funf; ++keybctoeleli
.he
  le m);
somnCotuMirrg);co m);
somn; onFoerdex)All:dt
      elmm);m);ursSndex), s(   / L.fir        /     (doc L.          ) d.prevInput = "";},
  fuo     Sndex), s: t
      elmm); onFo em); etIndex), see(;(teCay.in("anchin"
,v.ge(teCay.in("ecti") d.prevInput = "";
.hr },
  fu.staxt, : t
      elmm); onFo edndemeN).
Index), see(e)fcm);}, 2r, cm ); onFoeIeni   ehead emptn  0);eView.hr dios(dlener (text, lus()-1,lr, cm ectior, a .f (!el.rangeeView.hr di);
 r, cm ectilce(texlenec.sehead ectilr, an<  L.          )eView.hr diew+= out){aste[ir, cm ecti, tiPaP1,  head ectilr, anchor)0)}eeView.hr diange"keydowvveIew+= out){aste[ir, cm ecti, tiPaP1,  head ectilr, a, lon)}eeView.hr gtorSize.top ? -2ew+= out){aste[ir, cm o   (), ti:(r, cm.t)()}eeView.hr ght >= mu";
.hr },
  fudndemext, : t
      elmm); onFo edndemeN).
Index), see(e)fcm);}, 2r, cm ); onFoeIen+= out){aste[iP1,  head o   (>or, a, 0,asteIncoming ? "pati:(cion(docus()-1,lP1,  head t)()lr, anchor)0))}eeView.hu";
.hr },
  fudndxt, Leftn(t
      elmm); onFo edndemeN).
Index), see(e)fcm);}, 2r, cm ); onFoeIen+= out){aste[iP1,  head o   (>or, a, 0,a ti:(r, cm.o   (>}eeView.hu";
.hr },
  fudndWo ensdxt, Leftn(t
      elmm); onFo edndemeN).
Index), see(e)fcm);}, 2r, cm ); onFoeIenif (mgleoufHa {
rCeordtor, cm.ecti, "div" omgle+e5; onFoeIenif (gon(    ifcHa eordtC{
r({ieftn(0, n pn(n p}, "div"  handle e(+= out){aste[igon(   a ti:(r, cm.o   (>}eeView.hu";
.hr },
  fudndWo ensdxt, Rions:)(cm);}, 2lmm); onFo edndemeN).
Index), see(e)fcm);}, 2r, cm ); onFoeIenif (mgleoufHa {
rCeordtor, cm.ecti, "div" omgle+e5; onFoeIenif (rges.    ifcHa eordtC{
r({ieftn(m);sm.optior, aDiv.otters = nul+l100, n pn(n p}, "div"  handle e(+= out){aste[ir, cm o   (), ti:(rges.    }eeView.hu";
.hr },
  fuu ca:dt
      elmm);m);u ca(";},
  fureda:dt
      elmm);m);reda(";},
  fuu caSndex), s: t
      elmm);m);u caIndex), se";},
  furedaSndex), s: t
      elmm);m);redaSndex), se";},
  fugoDocSdex]: t
      elmm);m); (!ardIndex), s(   / L.fir        /   ";},
  fugoDocE;
:)t
      elmm);m); (!ardIndex), s(   / L.          )";},
  fugoxt, S}ex]: t
      elmm); onFo em); (!ardIndex), ssBydfcm);}, 2r, cm );wFi out)r, aS}ex]oe(e)r, cm.ectior, a o },
  fuuuuuuuuuuuuuuuuuuuuuuuuu{Evaris: "+L //", bias: 1u";
.hr },
  fugoxt, S}ex]Smex]: t
      elmm); onFo em); (!ardIndex), ssBydfcm);}, 2r, cm );handle e(+= out)lt, S}ex]Smex]oe(e)r, cm.ecti)r    vvv} d{Evaris: "+L //", bias: 1u";
.hr },
  fugoxt, E;
:)t
      elmm); onFo em); (!ardIndex), ssBydfcm);}, 2r, cm );wFi out)r, aEnd e(e)r, cm.ectior, a o },
  fuuuuuuuuuuuuuuuuuuuuuuuuu{Evaris: "+L //", bias: -1u";
.hr },
  fugoxt, Rions:)(cm);}, 2lmm); onFo em); (!ardIndex), ssBydfcm);}, 2r, cm );handle e(if (mgleoufHa {
rCeordtor, cm.ecti, "div" omgle+e5; onFoeIenlay.lin)Ha eordtC{
r({ieftn(m);sm.optior, aDiv.otters = nul+l100, n pn(n p}, "div"  handle } d.preL //cthe new,
  fugoxt, Leftn(t
      elmm); onFo em); (!ardIndex), ssBydfcm);}, 2r, cm );handle e(if (mgleoufHa {
rCeordtor, cm.ecti, "div" omgle+e5; onFoeIenlay.lin)Ha eordtC{
r({ieftn(0, n pn(n p}, "div"  handle } d.preL //cthe new,
  fugoxt, LeftSmex]: t
      elmm); onFo em); (!ardIndex), ssBydfcm);}, 2r, cm );handle e(if (mgleoufHa {
rCeordtor, cm.ecti, "div" omgle+e5; onFoeIenif (p   ifcHa eordtC{
r({ieftn(0, n pn(n p}, "div"  handle e(;
  nchoce(<v.ge(te     nchor, a .s).
ch(/\S/)"*+= out)lt, S}ex]Smex]oe(e)r, cm.ecti)r    vvvcmlty.lin| c;
  fu  } d.preL //cthe new,
  fugoxt, Up:)t
      elmm);m);L //V(-or)"vent"c;},
  fugoxt, Dows: t
      elmm);m);L //V(or)"vent"c;},
  fugoPag Up:)t
      elmm);m);L //V(-or)"pa, "co},
  fugoPag Dows: t
      elmm);m);L //V(or)"pa, "co},
  fugoC{
rLeftn(t
      elmm);m);L //H(-or)"d", {)o},
  fugoC{
rRions:)(cm);}, 2lmm);m);L //H(or)"d", {)o},
  fugoColum Leftn(t
      elmm);m);L //H(-or)"dolum ")o},
  fugoColum Rions:)(cm);}, 2lmm);m);L //H(or)"dolum ")o},
  fugoWordLeftn(t
      elmm);m);L //H(-or)"word")o},
  fugoGh))pRions:)(cm);}, 2lmm);m);L //H(or)"gh))p"co},
  fugoGh))pLeftn(t
      elmm);m);L //H(-or)"gh))p"co},
  fugoWordRions:)(cm);}, 2lmm);m);L //H(or)"word")o},
  fudndC{
rBan be:)(cm);}, 2lmm);m);dndemeH(-or)"d", {)o},
  fudndC{
rAunte:)t
      elmm);m);dndemeH(or)"d", {)o},
  fudndWordBan be:)(cm);}, 2lmm);m);dndemeH(-or)"word")o},
  fudndWordAunte:)t
      elmm);m);dndemeH(or)"word")o},
  fudndGh))pBan be:)(cm);}, 2lmm);m);dndemeH(-or)"gh))p"co},
  fudndGh))pAunte:)t
      elmm);m);dndemeH(or)"gh))p"co},
  fuinorntAuta:dt
      elmm);m);inorntSndex), s("nmw c"co},
  fuinorntM be:)(cm);}, 2lmm);m);inorntSndex), s("adu"co},
  fuinorntL cm: t
      elmm);m);inorntSndex), s("nubt arE"co},
  fuinsertTab: t
      elmm);m);rel_mouIndex), se"\E"co},
  fuinsertSoftTab: t
      elmm);", fu  _prest();s < cm,      se)  L. istSndex), ss(), tabS;
 e)  L.o cm, l.tabS;
 r    vvv; ++i) {
     = view.doc.sel.ranges[i].head.lineneos(d| clicr, cms> 0)o   (>; onFoeIenif (dole)  nuntColum (.ge(te     nchor, a ,T(start ltabS;
 );", fure est();seectios  sArrti(tabS;
 e-(dole% tabS;
 e+l1).joise" " "mousemovght >= mm);rel_mouIndex), ss(st();s";
.hr },
  fudnfaultTab: t
      elmm);", fu  i    me .getSeleIndex)ed  0 m);inorntSndex), s("adu"co", fu  .views); (ecCn m);
("insertTab"";
.hr },
  fut ans(steC{
rs: t
      elmm);", fu  runInO(de(e)fcm);}, 2.head.lineneos(d     se)  L. istSndex), ss(), s  S
    []ght >= m  ; ++i) {
     = view.doc.sel.ranges[i].head.lineneneos(d");
  r, cms> 0)ecti, gutter (text, lus()-1,lturor, a .f (!minimanefu  i   r, a) lLeft(cmcmfu  i    uroce(texl, a. Rangee ");
  s  s   / uror, a,lturocho-  }
    vcmcmfu  i    uroce(>To(ca
  fuuuuuuuuuuu");
  s  s   / uror, a,lturocho+  }
    vcmcmfu   mm);rel_mouline +r, afd", A fturocho-  }o+ r, afd", A fturocho- 2,asteIncoming ? "paste" : cm  )))   / uror, a,lturocho- 2).dtur, "+t ans(ste"}
    vcmcmfu  }i.view;
   uror, a(>Tfunc-1)cx, l
 a
  fuuuuuuuuuuu) {
 cever (text, lus()-1,lturor, ao-  }.f (!minimanefu  fu  i    cev)steIncoming ? "pam);rel_mouline +r, afd", A f0)t+e"\n"t+e cevfd", A f cevf Range(- 1)asteIncoming ? "paste" : cm  )))))   / uror, a(- 1,  cevf Range(- 1)a)   / uror, a,l1)a)"+t ans(ste"}
    vcmcmfu  }
 vcmcmfu  }
 vcmcmfu  s  S
 eectios  sline +tur, tur)}
    vcmcm}
 vcmcmfum); etIndex), ss(s  S
 "mousemovg";
.hr },
  fus  r, aAnditornt: t
      elmm);", fu  runInO(de(e)fcm);}, 2.head.lineneos(dlener  L. istSndex), ss()el.rangeeView.hr ; ++i) {
     = viewrenes[i].head.lineneneos(dr, cme)  L. istSndex), ss()hor handle e(pam);rel_mouline +"\n"e)r, cm.anchine)r, cm.ecti, "+e.fak"}
    vcmcmfum);inorntxt, l head o   (>or, anchor)     dpe == "doublencuba  varCay.inVef (cut(cm
    v er ght >= mu";
.hr },
  futoggl/Overwrit : t
      elmm);m);toggl/Overwrit ()r}eVi}t 
appenSTANDARD KEYMAPS"
neos(dkeyMapomnCotuMirrg);keyMapomn{}t ngkeyMap.basicomn; onFo"Left":)"goC{
rLeft",toRions":)"goC{
rRions{
 "Up":)"goxt, Up{
 "Dows":)"goxt, Dows",
  fu"End":)"goxt, End"
 "H.ge":)"goxt, S}ex]Smex]"
 "Pag Up":)"goPag Up"
 "Pag Dows":)"goPag Dows",
  fu"Dndeme":l"vedC{
rAunte"
 "Bccknt();":l"vedC{
rBan be",a"SRang-Bccknt();":l"vedC{
rBan be",
  fu"Tab":l"vefaultTab",a"SRang-Tab":l"inorntAuta",
  fu"Ennte": on  r, aAnditornt",a"Insert": otoggl/Overwrit ",
  fu"Esc": oo     Sndex), s"
t p= vipenNoteft
at une ndv.
);
 f to-reltn(d le m);
soaren'trveft,unfby vipenvefault.pU t (doturoreadu, sekancref, a an m.pUnknowt)le m);
s vipenCha simply ignif d. ngkeyMap.pcDefault mn; onFo"Ctrl-A": oordex)All",a"Ctrl-D":l"vedemext, ",a"Ctrl-Z":l"u ca",a"SRang-Ctrl-Z":l"reda",a"Ctrl-Y":l"reda", onFo"Ctrl-H.ge":)"goDocSdex]",a"Ctrl-End":)"goDocE;
",a"Ctrl-Up":)"goxt, Up{
 "Ctrl-Dows":)"goxt, Dows",
  fu"Ctrl-Left":)"goGh))pLeft{
 "Ctrl-Rions":)"goGh))pRions{
 "Alt-Left":)"goxt, S}ex]{
 "Alt-Rions":)"goxt, End"

  fu"Ctrl-Bccknt();":l"vedGh))pBan be{
 "Ctrl-Dndeme":l"vedGh))pAunte{
 "Ctrl-S": ooave{
 "Ctrl-F": of to"

  fu"Ctrl-G": of toN (!",a"SRang-Ctrl-G": of toP.jo",a"SRang-Ctrl-F":l"rel_mou",a"SRang-Ctrl-R":l"rel_mouAll",
  fu"Ctrl-[":l"inorntL cm{
 "Ctrl-]":l"inorntM be",
  fu"Ctrl-U":l"u caSndex), s",a"SRang-Ctrl-U":l"redaSndex), s",a"Alt-U":l"redaSndex), s",
  fufallthh))gh:l"basic"
t p= vikeyMap.macDefault mn; onFo"Cmd-A": oordex)All",a"Cmd-D":l"vedemext, ",a"Cmd-Z":l"u ca",a"SRang-Cmd-Z":l"reda",a"Cmd-Y":l"reda", onFo"Cmd-H.ge":)"goDocSdex]",a"Cmd-Up":)"goDocSdex]",a"Cmd-End":)"goDocE;
",a"Cmd-Dows":)"goDocE;
",a"Alt-Left":)"goGh))pLeft{
 onFo"Alt-Rions":)"goGh))pRions{
 "Cmd-Left":)"goxt, Left{
 "Cmd-Rions":)"goxt, Rions{
 "Alt-Bccknt();":l"vedGh))pBan be{
 onFo"Ctrl-Alt-Bccknt();":l"vedGh))pAunte{
 "Alt-Dndeme":l"vedGh))pAunte{
 "Cmd-S": ooave{
 "Cmd-F": of to"

  fu"Cmd-G": of toN (!",a"SRang-Cmd-G": of toP.jo",a"Cmd-Alt-F":l"rel_mou",a"SRang-Cmd-Alt-F":l"rel_mouAll",
  fu"Cmd-[":l"inorntL cm{
 "Cmd-]":l"inorntM be", "Cmd-Bccknt();":l"vedWo ensdxt, Left",a"Cmd-Dndeme":l"vedWo ensdxt, Rions",
  fu"Cmd-U":l"u caSndex), s",a"SRang-Cmd-U":l"redaSndex), s",a"Ctrl-Up":)"goDocSdex]",a"Ctrl-Dows":)"goDocE;
",
  fufallthh))gh:l["basic",a"emacsy"]
t p= vipenVery basicoocadr, a/emacs-dtyl>nbctoelel, which Cha s );
ard.pasMac. ngkeyMap.emacsy mn; onFo"Ctrl-F":)"goC{
rRions{
 "Ctrl-B":)"goC{
rLeft",toCtrl-P":)"goxt, Up{
 "Ctrl-N":)"goxt, Dows",
  fu"Alt-F":l"goWordRions{
 "Alt-B":l"goWordLeft",toCtrl-A":)"goxt, S}ex]{
 "Ctrl-E":)"goxt, End"

  fu"Ctrl-V":)"goPag Dows",a"SRang-Ctrl-V":)"goPag Up{
 "Ctrl-D":l"vedC{
rAunte"
 "Ctrl-H":l"vedC{
rBan be",
  fu"Alt-D":l"vedWordAunte{
 "Alt-Bccknt();":l"vedWordBan be"
 "Ctrl-K":l".staxt, "
 "Ctrl-T": ot ans(steC{
rs"
t p= vikeyMap["vefault"] r mac ?ikeyMap.macDefault :gkeyMap.pcDefaultt 
appenKEYMAP DISPATCH 
  llingFast(teKeyMap(v(dm;
    esplaoefaibevaut)s omate.f )*+= out)keyMap[vaur handl.viewlc out)t(dthe } happenGionn
an
arrti ibekeymapsr);
 arkey=nlen,+ aablh);
  .pasany vipenbctoelel ; )
 / untilp sel/np outsr)dpe thy+v(d.i,oat which point vipenw(cm,a ide++t
 rkey=h);
  d. Impleethel tSelessinkeebctoele arkey vipento   } e s ien    llres t
h);
 ele a;
 keymapufallthh))ghi
.he
  lookupKeyomnCotuMirrg);lookupKeyomnfcm);}, 2nlen,+maps.dhdraggm;
    ellingFastlookup(map.head.linemapomn(teKeyMap(map.
    v ee
   7)
  < map[nlen]r    vvvspla 7)
  < =T  } e)*+= out)"s ie"r    vvvspla 7)
  !s || (bnpumdragge 7)
 )"*+= out)on pr"keydow;
  map.nofallthh))gh)*+= out)"s ie"r     v ee
   allthh))gh < map. allthh))ghr    vvvspla allthh))gh <s || ()*+= out)  } er    vvvsplaObjdge. coto doc.toSate.f. aab fallthh))gh)*! to[objdgesArrti]". nge = le+=(e);
lookup(fallthh))gh)r    vvv; ++i) {
     = viewfallthh))ghil.ranges++[i ead.lineneos(du, i r ,ookup(fallthh))gh[i]  handle e(;
  u, i)*+= out)u, imousemovght >= m+= out)  } er    v}v
  fuf ++i) {
     = viewmapsil.ranges++[i ead.lineos(du, i r ,ookup(maps[i]  handle ;
  u, i)*+= out)u, i*! tos ie"r    v}eVi}t 
appenModiff (dkey  cesses)u, 't  nuntg)s 'ocal'dkey  cesses); ++t
 
appenpur(ste ibekeymapufallthh))ghi
.he
  isModiff (KeyomnCotuMirrg);isModiff (Keyomnfcm);}, 2evdedo;
    e_prenlen =bkeyNlens[evded;keyCotu]r    vlt(e);
nlen ==woCtrl"u(donlen ==woAlt"u(donlen ==woSRang"u(donlen ==woMod"  di}; happenLooktup+t
 rnlen ibearkey=)s ctoectn(d by
an
evdedrobjdge.hapos(dkeyNlen =bCotuMirrg);keyNlen =bfcm);}, 2evdedeaneSRangm;
    espla cesto npuevded;keyCotu ==w34 npuevded["d", {])*+= out)  } er    v_prenlen =bkeyNlens[evded;keyCotu]r    v, d.nlen ==w|| (drmaevded;altGo ehKey)*+= out)  } er    v, d.evded;altKey)*nlen =b"Alt-"t+enlenr    vi   flipCtrlCmd ?ievded;metaKey :gevded;ctrlKey)*nlen =b"Ctrl-"t+enlenr    vi   flipCtrlCmd ?ievded;ctrlKey :gevded;metaKey)*nlen =b"Cmd-"t+enlenr    vi   !neSRang npuevded;sRangKey)*nlen =b"SRang-"t+enlenr    vlt(e);
nlen  di}; happenFROMTEXTAREA hapCotuMirrg);o   TengAoca*lifcm);}, 2 engChaa lE cm, scti", fui   !E cm, scto cm, l mn{}t nge o cm, l.value =  engChaa.t(d.ight >=i   !E cm, s.aabctorS nputengChaa.aabctorS. nge = E cm, s.aabctorS =utengChaa.aabctorSght >=i   !E cm, s.p_mouholde  nputengChaa.p_mouholde . nge = E cm, s.p_mouholde  =utengChaa.p_mouholde ght >=penSet autoainabnto on p=i  ole etengChaa e e; c fun,aEvei  it hasht >=penautoainabna;
 no oes t
eleethe e e; c fun.ht >=i   E cm, s.autoainabn=s || ()* extend(os(dhasFicus =uarEvveElt(); nge = E cm, s.autoainabn=dhasFicus ==utengChaadrmhandle e(tengChaa.(teAtatebute("autoainab") !s || (bnpumdsFicus ==udicuethe.bodyr    v}v
  fuflingFastoave2.he engChaa.t(d.ie)  L.getValueo)r}eViewsplaoengChaa.li+m
      if onaoengChaa.li+m.d"submit"isoave); nge = // Deplorableumdcketha akn t
  submit)mrthodado
ole(rges. tSele.handle ;
  !E cm, s.leaveSubmitMrthodAlo ai ead.lineneos(dli+m =utengChaa.li+m.docalSubmit =b; rm.submit handle e(try ead.lineneneos(dto ensdSubmit =b; rm.submit*lifcm);}, 2
 a
  fuuuuuuuuuoave2.
    vcmcmfu  ; rm.submit*liocalSubmit
    vcmcmfu  ; rm.submit2.
    vcmcmfu  ; rm.submit*lito ensdSubmit
    vcmcmfu}eeView.hr gtctnch(ai eght >= mu    v}v
  futengChaa.neylt.vy.lineDiv"no a"r    v_preimer CotuMirrg)dfcm);}, 2netu)ii", fu  tengChaa.parentNoen;itsertBan be(netu ltengChaa.nengSib ele";
.hr },lE cm, scthe nem); dv.
=uoavethe nem);getTengAoca*lifcm);}, 2));alt(e);
oengChaa;u}eeViewm);toTengAoca*lifcm);}, 2));", fu  m);toTengAoca*liisNaN;ug pPrevdedrole e;matcbeele  an twice"keydowoave2.
    vcmtengChaa.parentNoen;ltL //CentR(m);getWo ensuEneeded().
    vcmtengChaa.neylt.vy.lineDiv""r    vvvsplaoengChaa.li+m
      if f offaoengChaa.li+m.d"submit"isoave); nge =  esplaoefaibeoengChaa.li+m.submit*liv"fcm);}, ")", funcncubmengChaa.li+m.submit*liocalSubmit
    vcmu    v}r    vlt(e);
cm  di}; happenSTRINGnSTREAM happenFunfthafunc etu pw stt.a  coviens heln(e*;cm);}, setha akn
appenpw stt.c eha succinge.hhapos(dSate.fSdlicm =bCotuMirrg);Sate.fSdlicm =bt
      e
dle.f,atabS;
 )); onFoanis.| clicble = }
r(e) 0repareble = }le.ft) s}le.frepareble =tabS;
 e) tabS;
 erma8repareble =    Colum P clicble =    Colum V(d.ie) 0repareble =lt, S}ex]e) 0repa}; hapSate.fSdlicm. coto doc mn; onFoeol:dt
      e) {lt(e);
anis.| cl>=eble = }le.fil.range},
  fuool:dt
      e) {lt(e);
anis.| cll.sble =lt, S}ex]e},
  fupeek:dt
      e) {lt(e);
anis. }le.fid", A fanis.| c)erma)
 eft,un;},
  fus xs:)(cm);}, 20);    vvvsplaonis.| cl<eble = }le.fil.rang. nge = le+=(e);
anis. }le.fid", A fanis.| c++";
.hr },
  fueas:)(cm);}, 2mtnch)* extend(os(dce(t
anis. }le.fid", A fanis.| c)r    vvvsplaoefaibemtncht)s omate.f )*e
  oktY cht)s mtncho", fu  .viewe
  oktY chtnpu2mtnchturn t? mtnchturn ffh)): mtnchffh))r    vvvsplaok)* ++anis.| c;vlt(e);
chr}eView},
  fueasWhicu:)(cm);}, 2mtnch)* extend(os(d }
r(e) anis.| c;extend(whicur(anis.eas2mtnch)){ght >= m+= out)anis.| cl> 
dex];", fu},
  fueasSt();:)t
      ecti", funce
  
}
r(e) anis.| c;extend(whicur(/[\s\u00a0]eturn fanis. }le.fid", A fanis.| c))) ++anis.| c;extend(+= out)anis.| cl> 
dex];", fu},
  fu
kipToEnd:)t
      ectianis.| clicble = }le.fil.range},
  fuokipTo:)t
      elh0);    v ee
   7)
  < ble = }le.fictorSOf(th, anis.| c)r    vvvspla 7)
  > -1ctianis.| clic 7)
 ;*+= out)on pr}eView},
  fubdckUp:)t
      enctianis.| cl-s |e},
  fudolum :)(cm);}, 20);    vvvsplaonis.    Colum P cl<cble = }
r(
      if f ble =    Colum V(d.ie)  nuntColum (ble = }le.f,cble = }
r(,eble =tabS;
 ,eble =    Colum P c,eble =    Colum V(d.ict nge pareble =    Colum P clicble =
dex];", fureght >= m+= out)anis.    Colum V(d.ie-laonis. t, S}ex]e?  nuntColum (ble = }le.f,cble = t, S}ex],eble =tabS;
 )): 0";
.hr },
  fuinornt)) do:)t
      e
      if Fi out) nuntColum (ble = }le.f,c     dple =tabS;
 ))- nge pareaonis. t, S}ex]e?  nuntColum (ble = }le.f,cble = t, S}ex],eble =tabS;
 )): 0";
.hr },
  fumtnch:)(cm);}, 2nnage n,cm,a uen,+ aseInsenightvicti", funcsplaoefaibennage nt)s omate.f )*ead.lineneos(d ased =bt
      e
dl) {lt(e);
 aseInsenightvie? 
dl;toLowerCase()d:(
dlr};", furenee
  
ub
dl < ble = }le.fi
ub
dlfanis.| c,ennage nil.rang.; nge =  espla ased(
ub
dl)ol.s ased(nnage n 0);eView.hr dii    ea uen !s=T  } e)*anis.| cl+=ennage nil.rang
    vcmcmfu+= out)on pr"keydowr ght >= mutorSize.top ? -2os(dmtncht) ble = }le.fi
(clifanis.| c).mtnchfnnage n ; nge =  esplamtnchtnpumtnchtctorS >To(clt(e);
nSpace.get=  esplamtnchtnpu ea uen !s=T  } e)*anis.| cl+=emtnch[0]il.rang
    vcmcm+= out) tncho", fu  }eView},
  fucurrded:)(cm);}, 20{lt(e);
ole = }le.fi
(clifanis. }
r(,eble =| c)rr,val, hienFx, lC{
rs: t
      en,citner)ii", fu  tnis. t, S}ex]e+s |e", fu  try e lt(e);
inner(); }eView.hft,alln e tnis. t, S}ex]e-s |emurOp.updat}; happensEXTMARKERt happenCocatadpwith"markTengna;
 setBookmark)mrthods. A TengMarke  is a
t.
  nd;
  .t
at kancbe  funfthame).
aEvef to*h"markunfp ight ofin+t
 
appendicuethe. xt, robjdgesohold
arrtis  markunSt(nsct(varaine.f
appen{o   , to,"markur}robjdge pointelep o such"markurrobjdges,*h case a  noectnelep sel/such"a"markurris  cesdedrooft
at r, af Multipl 
appenr, a.c neDpointfthafuncslen markurret
  it*st(ns acrossnr, a..
appenstarst(ns wiablh)vie|| (b; ++t
 in o   /tha con(etieseet
  fun
appenmarkurr(varin.iscbeyoto*t
   }
r(/l roibeo
  r, af Markurslh)vi
appenr, ksubdckfthafuncr, a.cpacnucurrdedln touch.hhapos(dTengMarke  =bCotuMirrg);TengMarke  =bt
      e)-1,l  if0); onFoanis.r, a.c  []ght >=ble =tdoc mnt ifr    vole =
   =udicrepa}; ngevdedMixne)TengMarke 
; happenCe).
afunc arke .
apTengMarke . coto doc.me).
alifcm);}, 2));", fusplaonis.expifcidlnCe).
edm;+= outside;
os(dimer ble nc-1)e(e)withOleoufH)npu!fHa textght >=i   withOl)  }
r(On(e)) dot(cm
    v;
  mdse);
   Wracm.d"me).
")cti", funce
   7)
  < ble nf to()r    vvvspla 7)
 )w;
      // Wracm.d"me).
",b; )
 lo   , ; )
 ltom
    v}
Cofuos(dmt; ic     dmax r eSpace.getf ++i) {
     = viewanis.r, a.il.ranges++[i ead.lineos(dgutter anis.r, a.hor handle _prest(ner (teMarkunSt(nFoe(gutt.markunSt(ns, ble  the ne  i    m)npu!ble = ellaps;dm;+=ginto (cm, "cm, guttNo(r, a ,T"oeng"co", fu  .viewi    m ); onFoeIeni   st(n.t)c!s || ()*max r guttNo(r, a ; onFoeIeni   st(n.;matc!s || ()*mt; icguttNo(r, a ; onFoeI}eView.hgutt.markunSt(ns*liocL //MarkunSt(n(gutt.markunSt(ns, st(n the ne  i   st(n.;matc=s || (bnpuble = ellaps;d)npu!guttIsHidorn(ole =
-1, gutt))npu m  onFoeIenr, "mointoptions(r, a,loengptions.guttBoundi)m
    v}
Cofu;
   m)npuble = ellaps;d)npu! me, cm, liine+Wo en   urf ++i) {
     = viewanis.r, a.il.ranges++[i ead.lineos(dvisuPofu tisuPoxt, lanis.r, a.hor),dlener lt, Lerang(tisuPo the ne  i   lene>(m);sm.optiomaxLt, Lerang ); onFoeIenm);sm.optiomaxLt, fu tisuPo; onFoeIenm);sm.optiomaxLt, Lerang exlen; onFoeIenm);sm.optiomaxLt,  (cm, d e)on pr"keydowu    v}v
  fusplamin !s || (bnpu m)npuble = ellaps;d)v, g (cm, "(c, min dmax +  }
    vanis.r, a.il.range) 0repareble =expifcidlnCe).
ed e)on pr"keydsplaonis.atomic)npuble =c-1)eantEdit)ii", fu  tnis.c-1)eantEdit =T  } er    vvvspla m )r  (eckIndex), see(;voc)r"keyd}
Cofu;
   m)w;
      // When a arke Ce).
ed",v.g, ble  the nei   withOl) l rOn(e)) dot(cm
    v;
  ble =|arent)*anis.|arent.me).
(
n(di}; happenF toSpacep ight ofibeo
  markurri  funndicuethe. Rp outsr)d{o   ,
vipento}robjdge bynvefault.pSien kancbe nassunfthaget a snecific) ide
vipen-- 0 (bong , -1  len(,aaEve1  rges.,. // h lt, Obj e ete = dfun
appenP clobjdgesolty.li dg(varain a lt, robjdgee)r,es t
t
an a lt, 
appennumbut ( funfthaprevdedr,ookelepup+t
 rslen lt, rtwice).
apTengMarke . coto doc.f to*=bt
      e
itu llt, Obj)ti", fui    idec=s || (bnpuble =tdoc ms obookmark")  idec= 1side;
os(do   , toce.getf ++i) {
     = viewanis.r, a.il.ranges++[i ead.lineos(dgutter anis.r, a.hor handle _prest(ner (teMarkunSt(nFoe(gutt.markunSt(ns, ble  the ne  i   st(n.;matc!s || ()*; onFoeIen;matc=)   /lt, Obj ?dgutte: guttNo(r, a ,Tst(n.;mat ; onFoeIeni   sidec=s -1ct+= out)    ;
  fu  }he ne  i   st(n.t)c!s || ()*     if f boc=)   /lt, Obj ?dgutte: guttNo(r, a ,Tst(n.tom
    veIeni   sidec=s 1ct+= out)tor"keydowu    v}v   v+= out)    bnpu{aste[io   , ton(n }  di}; happenS
    sft
at une markur's wi (te  {
   d,na;
 surr )
 elepptiout vipenshouldgcav+=m,mnutun.ht TengMarke . coto doc.m(cm, d e)fcm);}, 2));", fuos(d| clicble nf to(-or)pe ==, wi (te = ble , imer ble nc-1)e(ght >=i   !| cl||u! mm;+= outside;
runInO(de(e)fcm);}, 2.head.lineos(dgutter nchor, a, guttN icguttNo(nchor, a  handle _prev =  e)f toe = Fo
xt, "cm, guttN the ne  i   v =  ); onFoeIenme).
xt, Mrom |eededCc   Foe(v =  ; onFoeIenm); text.ondex), s (cm, d e)fHa text.femptU, "mool on pr"keydowght >= mm); text.r, "moMaxLt, fu on pr"keydow;
  !guttIsHidorn(wi (te=
-1, gutt))npuwi (te=meft);l!=r|| ()*e.top ? -2os(doldHze();
= wi (te=meft);; onFoeIenwi (te=meft);l=
nSpace.get=  eos(duHze();
= wi (teptions.wi (te)(- oldHze();
    veIeni   dHze();)", funcncubr, "mointoptions(r, a,lgutt.meft);l+duHze(); ; onFoeI}eView}
n(di}; hapTengMarke . coto doc.attc  Lt, fu fcm);}, 2r, a) lLeft(;
  !anis.r, a.il.rangenpuble =c-1)emm);", fu  _pregleouble =c-1)ema textght >=e ;
  !E .maybeHidornMarkurslrmainorSOf(E .maybeHidornMarkurs, ble  c=s -1c", funcnc(E .maybeUnhidornMarkurslrma(E .maybeUnhidornMarkursl  []))eectioble  the new    vanis.r, a.iectior, a  han}  diTengMarke . coto doc.detc  Lt, fu fcm);}, 2r, a) lLeft(anis.r, a.isp(clifinorSOf(anis.r, a., gutt),  }
    v;
  !anis.r, a.il.rangenpuble =c-1)emm);", fu  _pregleouble =c-1)ema textght >=e (E .maybeHidornMarkurslrma(E .maybeHidornMarkursl  []))eectioble  the new   }; happenCellaps;d)markurslh)vi uniq p=ids,citaEvde++to  emableutha/vde+
vipenthem, which us neununf; ++uniq plynve// mine.f
an
outer markur
vipenet
  funy overlap  blny  neDnrn , butsnetnpw tially overlap).hapos(dnengMarke Ide) 0rehappenCocata"a"markur, wiret tpup+to
ole(rges. r, a., h caseflingFastmarkTenge)-1,lo   , to,"o cm, l,   if0); onFopenSh.
ed markursl(acrossnr, kunfdicuethe  cCha h);
  d sepw atelnaseFopen(markTengSh.
ed wiabl aablout+to
olis again donce n(easeFopendicuethe).ht >=i   E cm, senpuo cm, l.nh.
edm;+= out markTengSh.
ede)-1,lo   , to,"o cm, l,   if0;aseFopenE  varnw(cCha in
an
on(e)) do.ht >=i   c-1)em)npu!c-1)ema textm;+= out on(e)) do(c-1)e(e)markTeng)e)-1,lo   , to,"o cm, l,   if0;a
Cofuos(dmarke  =bs  sTengMarke e)-1,l  if0, diff e)fHp(o   , to}
    v;
  E cm, sctcopyObj(o cm, l, markur,   } e,Rang= // D, 't  nnndge emptn markurslunless
me).
// hEmptn e e;ange"keydi   ciff > 0 rmadiff e) 0tnpumtrke .me).
// hEmptn !s=T  } e)ht >=e += out marke ght >=splamtrke .rel_moudWithm);", fu  penShowelepup+asr)dwi (te impliese ellaps;d).wi (te rel_mou etenge
>= m  mtrke .mellaps;d)u on pr"keydowmtrke .wi (teNoentY elt("nnas",a[mtrke .rel_moudWith],
"CotuMirrg)-t= (te")tht >=e ;
  !E cm, l.h);
  Mo fuEvdeds)wmtrke .wi (teNoen.ignif Evdedsfu on pr"keydow;
  E cm, l.itsertLeft)wmtrke .wi (teNoen.itsertLeftfu on pr"keyd}ht >=splamtrke . ellaps;d)vi", funcsplaconf(clneleCellaps;dline +)-1,lo   or, a, o   , to,"markur)drmhandle e( lo   or, al!=rtoor, alnpu eaf(clneleCellaps;dline +)-1,ltoor, a, o   , to,"markur)c", funcncthh)wbs  sErrg)d"Insertelepcellaps;d)markurnpw tially overlappe.f
an
existelepone"}
    vcmsawCellaps;dSt(ns*lion pr"keyd}hht >=splamtrke .addToHis ifyc", funcadd (cm, ToHis ify+)-1,l{aste[io   , ton(n aaEvaris: "markTeng"}, 
-1)
el, NaN0;a
Cofuos(d teLt, fu f   or, a, imer c-1)e(e)r, "moMaxLt, r"keydc-1)i// WhteLt, ,ltoor, anchor)fcm);}, 2r, a) lLeft(fu;
   m)npumtrke .mellaps;d)npu! me, cm, liine+Wo en   )nputisuPoxt, lr, a) ==nm);sm.optiomaxLt,   onFoeIenr, "moMaxLt, fu on pr"keydow;
  mtrke .mellaps;d)npu teLt, f!u f   or, a)br, "mointoptions(r, a,l0}
    vcmaddMarkunSt(n(gutt, s   MarkunSt(n(markur,handle e( llllllllllllllllllllllllllllllll teLt, fuu f   or, aI?)t   och :c     handle e( llllllllllllllllllllllllllllllll teLt, fuu toor, an? tooch :c    ))r    vvv++ teLt, ;eView}
n(diappenr, aIsHidorn revardsrooft
e  cesdecefibeo
  st(ns, so neunsr)ds=m,;
 nassht >=splamtrke . ellaps;d)vc-1)i// Wf   or, a, toor, anchor)fcm);}, 2r, a) lLeft(fu;
  guttIsHidorn(
-1, gutt))br, "mointoptions(r, a,l0}
    v}0;a
Cofusplamtrke . e).
OnEnnte) on(markur, "can beCay.inEnnte"e)fcm);}, 2.heumtrke .me).
(); }0;a
Cofusplamtrke .ocadOnln) lLeft(fusawRcadOnlnSt(ns*lion pr"keyd>=i   c-1)his ify.u, iil.rangermad-1)his ify.u ca a. Rangeehandle e(c-1)ee).
His ify+)r"keyd}
Cofu;
  mtrke . ellaps;d)vi", funcmtrke .id)u ++nengMarke Idr"keydowmtrke .atomic)u on pr"keyd}ht >=splaemm);", fu  penSyncie   if ma
  "keyd>=i   r, "moMaxLt, )mm); text.r, "moMaxLt, fu on pr"keydow;
  mtrke . ellaps;d)handle e(, g (cm, "(c, f   or, a, toor, anchoco", fu  .viewi   mtrke .meassNlen rmamtrke .titln rmamtrke .new cS}yln rmamtrke .ardI}yln)handle e(f ++i) {
    f   or, a= vieu toor, aes[i].h+=ginto (cm, "cm, i,T"oeng"co", fu  splamtrke .atomic )r  (eckIndex), see(;voc)r"keyd w;
      // When a arke Adord",v.g, marke 
; keyd}ht >=+= out marke ght } happenSHAREDnsEXTMARKERt happenA sh.
ed markurrst(ns multipl nr, kunfdicuethe . It usase a impleethe dg)s a)mrta-markur-objdge (var = "   )multipl nno
inl
appenmarkurli
.he
  Sh.
edTengMarke  =bCotuMirrg);Sh.
edTengMarke  =b(cm);}, 2mtrkurs, primtry) lLeft(anis.markursl=nmarkurlrepareble =primtryer nrimtryce.getf ++i) {
     = viewmarkurlil.ranges++[i"keydowmtrke s> 0)|arenteouble repa}; ngevdedMixne)Sh.
edTengMarke 0;a
CoSh.
edTengMarke . coto doc.me).
alifcm);}, 2));", fusplaonis.expifcidlnCe).
edm;+= outside;
ble =expifcidlnCe).
ed e)on pr"keydf ++i) {
     = viewanis.markurlil.ranges++[i"keydowanis.markurl> 0)me).
(
n(di w;
      // Wracm.d"me).
"  han}  diSh.
edTengMarke . coto doc.f to*=bt
      e
itu llt, Obj)ti", fu+= out)anis.|rimtrynf to(
itu llt, Obj)n(di}; hapflingFastmarkTengSh.
ede)-1,lo   , to,"o cm, l,   if0ti", fuo cm, l mncopyObj(o cm, l
n(di wo cm, l.nh.
ed =T  } er    vos(dmarke sl  [markTenge)-1,lo   , to,"o cm, l,   if0], primtryl=nmarkurl[0]r    vos(dwi (te = o cm, l.wi (teNoenr    vr, kunDocse)-1,lo
      e)-1) lLeft(fu;
  wi (te)(o cm, l.wi (teNoen
= wi (te=clo aNoen(pe == "doublemarkurliectiomarkTenge)-1,lcion(doc)-1,lo   ),lcion(doc)-1,lto},"o cm, l,   if0)r    vvv; ++i) {
     = viewc-1)r, kunil.ranges++[i"keydow>=i   c-1)r, kun> 0)isParent)*+= outside;
  primtryl=nlst2mtrkurs}
    v}0;a, fu+= out)s   Sh.
edTengMarke 2mtrkurs, primtry)ght } hapflingFastf toSh.
edMarkurse)-1) lLeft(+= out)u,cnf toMarks((doc)-1)cx, l, 0,a c-1)eeon(doc(doc)-1)          )" handle e( llllllllllllllll(cm);}, 2m));alt(e);
m)|arent;w}
n(di} hapflingFastcopySh.
edMarkurse)-1, marke scti", fuf ++i) {
     = viewmarkurlil.ranges[i].head.lineos(dmarke  =bmarkurl> 0,d| clicmtrke .f to()r    vvvos(dmFmatc=)c-1)eeon(docnchoo   ),lmToc=)c-1)eeon(docnchotom
    veIsplaemp(mFmat,lmTo))*e.top ? -2os(dsubMarklicmtrkTenge)-1,lmFmat,lmTo, marke .|rimtry, marke .|rimtry.  if0;aseFoublemarkur.markurliectiosubMark);", fure esubMark)|arenteoumarke ght >=owu    v}v  } hapflingFastdetc  Sh.
edMarkursemarke scti", fuf ++i) {
     = viewmarkurlil.ranges[i].head.lineos(dmarke  =bmarkurl> 0,dr, kunf=a[mtrke .|rimtry.)-1];ght >=owr, kunDocsemtrke .|rimtry.)-1,lo
      e)));ar, kuniectiod);v}0;a, fufuf ++i) {
j    = jiewmarkur.markurlil.rangesji].head.lineneos(dsubMarke  =bmarkur.markurl>jr handle e(splainorSOf(r, kun,dsubMarke ;voc)c=s -1ct{handle e( lsubMarke ;|arenteounSpace.get=  elemarkur.markurlisp(clifj--,  }
    vcmcmght >= mu    v}vt } happensEXTMARKER SPANS hapflingFastMarkunSt(n(markur,lo   , to) lLeft(anis.markureoumarke ght >=ble nfmatc=)    ;uble =toc=)tor"ke} happenS).
ch
an
arrti ibest(ns fEvea st(ne tnchelep se gionn
markur.
  llingFast(teMarkunSt(nFoe(st(ns, markur)di", fui    t(nsctf ++i) {
     = view t(nsil.ranges++[i ead.lineos(dst(ner  t(nshor handle i   st(n.markureo= markur)dlc out)inanthe new   }happenRcL //ea st(nefmatcan
arrti,alt(e);elepu
 eft,un i  no*st(ns ari
appenreftf(we)u, 't s if 
arrtis f ++r, a.cwithout+ t(nsc.
  llingFastocL //MarkunSt(n(st(ns, st(n ti", fuf ++i) {
r,l     = view t(nsil.ranges++[ihandle i   st(nshorf!u st(n t(rlrma(rl  []))eectiost(nshor0;a, fu+= out) ght } appenAddea st(nethaalgutt.
  llingFastaddMarkunSt(n(gutt, st(n ti", fugutt.markunSt(ns*ligutt.markunSt(ns*?igutt.markunSt(ns.(vac))([st(n])d:([st(n]n(di w;t(n.markur.attc  Lt, or, a  han}""dog pUfunf; ++t
  Clgorithmft
at adjustsdmarke slfEvea m(cm, fin+t
 
appendicuethe. Theiew;cm);}, secut
an
arrti ibest(ns at a gionn
append", acter p ight o,alt(e);elepan
arrti ibeocLaine.fnd"u ksu(or
vipenu
 eft,un i  notSeleeocLainsc.
  llingFastmarkunSt(nsBan be(old,  }
r(Ch,l sInsert)di", fui   oldctf ++i) {
     , nw= viewoldil.ranges++[i ead.lineos(dst(ner old> 0,dmarkureou;t(n.markurr    vvvos(d }
r(sBan beeou;t(n.;matc=s || (brma(mtrke .inclusionLeftf?u;t(n.;matc<=  }
r(Chd:(
t(n.;matc<  }
r(Ch the ne  i   s}
r(sBan beerma;t(n.;matc=s  }
r(Chdnpumtrke .tdoc ms obookmark"tnpu2! sInsertl||u!;t(n.markur.itsertLeft).head.lineneos(dardsAunteeou;t(n.toc=s || (brma(mtrke .inclusionRionsf?u;t(n.toc>=  }
r(Chd:(
t(n.toc>  }
r(Ch the ne    (nwbrma(nwl  []))eectios   MarkunSt(n(markur,a;t(n.;mat,dardsAuntee? || (b:(
t(n.to "mousemovght >=}val, lt(e);
nwght } apllingFastmarkunSt(nsAunte(old, ardCh,l sInsert)di", fui   oldctf ++i) {
     , nw= viewoldil.ranges++[i ead.lineos(dst(ner old> 0,dmarkureou;t(n.markurr    vvvos(dardsAunteeou;t(n.toc=s || (brma(mtrke .inclusionRionsf?u;t(n.toc>= ardChd:(
t(n.toc> ardCh the ne  i   ardsAunteerma;t(n.;matc=s ardChdnpumtrke .tdoc ms obookmark"tnpu2! sInsertl||u;t(n.markur.itsertLeft).head.lineneos(d }
r(sBan beeou;t(n.;matc=s || (brma(mtrke .inclusionLeftf?u;t(n.;matc<= ardChd:(
t(n.;matc< ardCh the ne    (nwbrma(nwl  []))eectios   MarkunSt(n(markur,a;}
r(sBan bee? || (b:(
t(n.;matc- ardCh,handle e( lllllllllllllllllllllllllllllllllllll;t(n.toc=s || (b? || (b:(
t(n.toc- ardCh "mousemovght >=}val, lt(e);
nwght } 
appenGionn
a m(cm, fobjdgee)m,mnutu+t
 rn   ste ibemtrkurrst(ns t
at
appendoverafuncr, afin+which funcm(cm, ftooktl_mou.nRcL //srst(ns
appentheirplynwithi  funnm(cm, ,v+=m,nndgesrst(ns belo gelep o t
 
appenslen markurrt
at app).
aEn bong  idesfibeo
  m(cm, ,va;
 cutsfibf
appenst(ns pw tially withi  funnm(cm, . Rp outsr)n
arrti ibest(n
vipenChrtis with", i*eleethe f ++ec  pr, afin+(afnte) funnm(cm, . apllingFast
dlinchSt(nsOver (cm, ")-1,lch, cm );handlos(doldFx, l liisLt, o)-1,lch, cm.f   or, a)bnpu(text, l)-1,lch, cm.f   or, a).markunSt(ns;handlos(doldLa l liisLt, o)-1,lch, cm.toor, a)bnpu(text, l)-1,lch, cm.toor, a).markunSt(ns;handl;
  !EldFx, l npu!oldLa l(clt(e);
nSpacehandlos(d }
r(Chd=lch, cm.f   oth, ardChd=lch, cm.tooch,l sInsert e)fHp(ch, cm.f   ,lch, cm.to)c=s 0n(diappenGeteo
  st(nsrt
at 'sticklout'aEn bong  ideshandlos(dfx, l limarkunSt(nsBan be(oldFx, l,  }
r(Ch,l sInsert);handlos(dla l limarkunSt(nsAunte(oldLa l, ardCh,l sInsert)cehandlpenNeng,dmer, fthste twodardshandlos(d lenLt, fu ch, cm.t (!el.rangc=s 1, ottersl=nlst2ch, cm.t (!)el.rang +  slenLt, f?  }
r(Chd:(0}
    vspla x, l
 a
  fuuupenF xpup+.tha con(etieseibe x, l    vvv; ++i) {
     = view x, lil.ranges++[i ead.lineneos(dst(ner  x, lhor handle e(i   st(n.t)c=s || ()* extend(andlos(df7)
  < (teMarkunSt(nFoe(ga l, ;t(n.markur.
    vcmcmfu;
  ! 7)
 )w;t(n.t)c=  }
r(Ch
    vcmcmfu.viewi   slenLt, )w;t(n.t)c= ; )
 ltoc=s || (b? || (b:(; )
 ltoc+ otters
    vcmcmght >= mu    v}vt fu;
  ga l
 a
  fuuupenF xpup+.;matcin+la l (or L //ethemcinto  x, l i;
 ase ibeslenLt, )    vvv; ++i) {
     = viewla lil.ranges++[i ead.lineneos(dst(ner la lhor handle e(i   st(n.t)c!=r|| ()*st(n.t)c+= otters
    vcmcmi   st(n.;matc=s || ()* extend(andlos(df7)
  < (teMarkunSt(nFoe(cx, l, ;t(n.markur.
    vcmcmfu;
  ! 7)
 )w extend(andl u;t(n.;matc= otters
    vcmcmcmcmi   slenLt, )w(cx, lbrma(fx, l li[]))eectiost(n.
    vcmcmfu}
 vcmcmfugtorSize.top ? -2ew;t(n.;matc+= otters
    vcmcmcmi   slenLt, )w(cx, lbrma(fx, l li[]))eectiost(n.
    vcmcmght >= mu    v}vt fupenMakn  varnw(cdid 't  ocata"any zero-l.rang st(ns
ap vspla x, l
 fx, l lime).
EmptnSt(nsa x, l
;vt fu;
  ga l npuga l !r  x, l)dla l lime).
EmptnSt(nsaga l
cehandlos(dn  Marke sl  [ x, l]r    v, d.!slenLt, )wa
  fuuupenF  (bgap with"whole-r, a-st(ns
ap vdlos(dgapomnch, cm.t (!el.rangc- 2,dgapMarkurlrepare v, d.gapo> 0tnpu x, l)    vcmcm; ++i) {
     = view x, lil.ranges++[i    vcmcmcmi    x, lhor.t)c=s || ()    vcmcmcmcm(gapMarkurlbrma(gapMarkurlb  []))eectios   MarkunSt(n( x, lhor.markur,a     d    ))r    vvv; ++i) {
     = viewgapes++[i    vcmcmn  Marke seectiogapMarkurl)r    vvvn  Marke seectioga l
ce   v}vt fu+= out)s  Markurlrepa} 
appenRcL //est(nsrt
at Cha emptn a;
 u, 't h)vi a
me).
// hEmptn
appeno cm, eibe  } e. apllingFastme).
EmptnSt(nsa t(nscti", fuf ++i) {
     = view t(nsil.ranges++[i ead.lineos(dst(ner  t(nshor handle i   st(n.;matc!s || (tnpu;t(n.;matc=s  t(n.t)cnpu;t(n.mtrke .me).
// hEmptn !s=T  } e)ht >=e  w t(nsisp(clifi--,  }
    v}    v, d.!st(nsil.rang(clt(e);
nSpace.getlc out)inanlrepa} 
appenUfunf; ++un/re-doe.fnd"    se;matco
  his ify. Combi a.cpac
appenresult ibem,mnutelep se existelepst(nsrwith"o
  ste ibest(ns t
at
appenexistun inco
  his ify  sort
at vedemelepar )
 ea st(neatoSpacn
vipenu
 oe.fnbrelessbdckft
  st(nc.
  llingFastmer, OlnSt(ns")-1,lch, cm );handlos(dold < (teOlnSt(ns")-1,lch, cm ;handlos(d
dlinchunf=a
dlinchSt(nsOver (cm, ")-1,lch, cm ;handl;
  !Eld)dlc out)idlinchunr    v, d.!sdlinchunm;+= out old;v
  fuf ++i) {
     = viewoldil.ranges++[i ead.lineos(doldC);
  old> 0,dsdlinchC);
  sdlinchunhor handle i   oldC);
npu;dlinchC);)w extend(anst(ns:uf ++i) {
j    = jiew;dlinchC);il.ranges++j)* extend(andlos(dst(ner  dlinchC);>jr handle e(fuf ++i) {
k    = kiewoldC);il.ranges++k)    vcmcmcmcmi   oldC);[k].markureo= ;t(n.markur.r(varin.i)inanlrepaaaaaaaaaoldC);iectiost(n.
    vcmcmght >= muu.viewi   sdlinchC);)w extend(anold> 0er  dlinchC);mousemovght >=}val, lt(e);
old;vpa} 
appenUfunft)c'eeon'lout+ocadOnlnd     seet
  makele arm(cm, . apllingFastocL //RcadOnlnline se)-1,lo   , to );handlos(dmarke sl  nSpace.getc-1)i// Wf   or, a, toor, anchor)fcm);}, 2r, a) lLeft(fu;
  gutt.markunSt(nsctf ++i) {
     = viewgutt.markunSt(ns.l.ranges++[i ead.lineneos(dmarklicgutt.markunSt(nshor.markur
    vcmcmi   mark.ocadOnlntnpu2!markurlbrmainorSOf(mtrkurs, mtrk)c=s -1c)    vcmcmcm(markurlbrma(markurlb  []))eectiomark);", fure}eView}
n(di v, d.!marke sctlt(e);
nSpace.getos(d|
r(sb  [{aste[io   , ton(n }]r"keydf ++i) {
     = viewmarkurlil.ranges++[ihead.lineos(dmklicmtrkurl> 0,dtc= mk.f to(00;a, fufuf ++i) {
j    = jiew|
r(sil.ranges++j)* extend(anos(d|er n
r(s>jr handle e(splafHp(p.to,"moo   )iew0 rmafHp(p.o   , m.to)c>To(c(varin.i;extend(anos(ds  P
r(sb  [j,  0,dd;matc= fHp(p.o   , m.o   ),ldt)c= fHp(p.to,"motom
    veIeni   d;matc< 0 rma!mk.inclusionLeftfnpu!co   )    vcmcmcms  P
r(seectio{aste[ip.o   , ton(m.o   }m
    veIeni   dtoc> 0 rma!mk.inclusionRionsfnpu!ctom    vcmcmcms  P
r(seectio{aste[im.to,"ton(p.to}m
    veIen|
r(sisp(cli.apply(|
r(s,ms  P
r(sm
    veIenje+s |  P
r(se Range(- 1mousemovght >=}val, lt(e);
|
r(s;vpa} 
appenCnnndge  ++dis nnndge st(ns fmatcalgutt.
  llingFastdetc  MarkunSt(ns2r, a) lLeft(os(dst(ns*ligutt.markunSt(nsr    v, d.!st(nsct+= outside;
f ++i) {
     = view t(nsil.ranges++[iousemovst(nshor.markur.detc  Lt, (r, a ; onFogutt.markunSt(ns*linSpace.g} apllingFastattc  MarkunSt(ns2r, a,  t(nscti", fu, d.!st(nsct+= outside;
f ++i) {
     = view t(nsil.ranges++[iousemovst(nshor.markur.attc  Lt, or, a  hanFogutt.markunSt(ns*liinanlrepa} 
appenHeln(es  funfet
  m,mnutelepwhich overlappe.f
mellaps;d)st(n
vipen nuntsg)s funcrar, 
aEnt.
  llingFast (!raLeft(markur)di=+= out marke .inclusionLeftf?u-1d:(0;g} apllingFast (!raRions(markur)di=+= out marke .inclusionRionsf?u1d:(0;g} 
appenRc outsr)dnumbut  noectnelepwhich of twodoverlappe.f
mellaps;d
appenst(ns iscrar, 
a(atoSpaus ctcluda.cpac oes t). Fallsubdckfth
vipen nm|
re.f
idseet
  funnst(ns doveraexacdln t
 rslen rcm, . apllingFast nm|
reCellaps;dMarkursea, b) lLeft(os(dl.rDiff e)a.r, a.il.range- b.r, a.il.rangevt fu;
  g.rDiff !s o(clt(e);
g.rDiffce.getos(daP clica.f to(), bP clicb.f to()r    vos(do   Cmpc= fHp(aP c.o   , bP c.o   )erma (!raLeft(a)(-  (!raLeft(b}
    vspla    Cmp(clt(e);
-    Cmpr    vos(dtoCmpc= fHp(aP c.to,"bP c.to)erma (!raRions(a)(-  (!raRions(b}
    vsplatoCmpct+= out)toCmpr    v+= out)b.id)-ca.id;vpa} 
appenF toSout+et
es t
a lt, rardsro(d }
r(s in
a
mellaps;d)st(n. If
appenso,t+= out)t
  markurr; ++t
ae st(n. apllingFast nllaps;dSt(nAtSien2r, a,  }
r(
      ios(dsts*liiawCellaps;dSt(ns*npugutt.markunSt(ns,  7)
 ;    vsplastsctf ++i) {
sp,l     = view tlil.ranges++[ihead.linesp*liinshor handle i   st.mtrke .mellaps;d)npu s}
r(f?u;t.;matc:(
t.to)c=s || (tnp    vcmcmcm(! 7)
  rmafnm|
reCellaps;dMarkurse; )
 / st.mtrke )iew0))    vcmcm; )
  < st.mtrke ce   v}vt fu+= out) 7)
 ;   } apllingFast nllaps;dSt(nAtS}
r(2r, a) l Fi out) nllaps;dSt(nAtSien2r, a, pe ==  } apllingFast nllaps;dSt(nAtEto(r, a) l Fi out) nllaps;dSt(nAtSien2r, a,   } e,R } happensrn tet
es t
es te exists
a
mellaps;d)st(n+t
ae pw tially
appenoverlapslacov(es t
   }
r(ro(de
 / butsnetnbong  ibearn   st(n. appenSuch overlap us netnallowun.ht llingFast naf(clneleCellaps;dline +)-1,lguttNo, o   , to,"markur)dlLeft(os(dlitter (text, l)-1,lguttNo ;handlos(d
ts*liiawCellaps;dSt(ns*npugutt.markunSt(ns;    vsplastsctf ++i) {
     = view tlil.ranges++[ihead.lineos(d
t*liinshor handle i   !st.mtrke .mellaps;d(c(varin.i;extend(os(df7)
  < st.mtrke .f to(00;a, fufuos(do   Cmpc= fHp(; )
 lo   , ;   )erma (!raLeft(st.mtrke )i-t (!raLeft(markur);a, fufuos(dtoCmpc= fHp(; )
 lto, to )rma (!raRions(st.mtrke )i-t (!raRions(markur) handle i   o   Cmpc>) 0tnputoCmpc<= 0 rmao   Cmpc<) 0tnputoCmpc>=To(c(varin.i;extend(i   o   Cmpc<) 0tnpu(fHp(; )
 lto, ;   )e> 0 rma st.mtrke .inclusionRionsfnpumarke .inclusionLeft))drmhandle e( lo   Cmpc>) 0tnpu(fHp(; )
 lo   , to )< 0 rma st.mtrke .inclusionLeftfnpumtrke .inclusionRions)). nge = le+=(e);
an pr"keyd}ht } happenA visuPofr, afis
a lt, r)s drawnrooft
e screen. Folde.f,cfor
vipenexample, kancca fu multipl nrogectlcr, a.cpo app).
aEn t
 rslen
vipenvisuPofr, a. The e;irdsrt
   }
r(robeo
  visuPofr, aft
at une
vipengionn
r, afis
p
r(robe(usuPoln t
ae e efuncr, afitselfc.
  llingFasttisuPoxt, lr, a) ;handlos(dmer,  ;    vwhicur(mer,   mncollaps;dSt(nAtS}
r(2r, a). nge = litter mer,  nf to(-or)pe ==or, aevt fu+= out)r, aevt } 
appenRc outsr)n
arrti iberogectlcr, a.cp
at kvarin.i)o
  visuPofr, a
appens}
r((d by
t
  CrguetheaaEveu
 eft,un i  es te Cha no such"r, a.i
  llingFasttisuPoxt, Cvarin.idlr, a) ;handlos(dmer,  ,lgutts;    vwhicur(mer,   mncollaps;dSt(nAtEto(r, a)ihead.linelitter mer,  nf to(or)pe ==or, aevt fu   guttlbrma(guttlb  []))eectior, a  hanFo}vt fu+= out)r, alrepa} 
appenGeteo
  littenumbut ibeo
  s}
r(robeo
  visuPofr, aft
at une
vipengionn
r, afnumbut  s
p
r(robi
  llingFasttisuPoxt, Nol)-1,lguttN)dlLeft(os(dlitter (text, l)-1,lguttN), tis =ttisuPoxt, lr, a)evt fu;
  gt, fuu visctlt(e);
guttNevt fu+= out)r, aNolve  the }
appenGeteo
  littenumbut ibeo
  s}
r(robeo
  neng visuPofr, afafnte
vipenthengionn
r, ai
  llingFasttisuPoxt, EtoNol)-1,lguttN)dlLeft(;
  gt, Ne> )-1)          )tlt(e);
guttNevt fuos(dlitter (text, l)-1,lguttN), mer,  ;    v;
  !guttIsHidorn(
-1, gutt))blt(e);
guttNevt fuwhicur(mer,   mncollaps;dSt(nAtEto(r, a)iad.linelitter mer,  nf to(or)pe ==or, aevt fu+= out)r, aNolr, a) + 1mous} 
appenCnmnutu+et
es t
a lt, ris hidorn. xt, s  nuntg)s hidornnet
  funy
vipenCha p
r(robea visuPofr, aft
at  }
r(s with"anoes t
r, a, orret
 
vipenthey Cha eheirplyncov(e(d by
collaps;deanen-t= (te st(n. apllingFastguttIsHidorn(
-1, gutt)      ios(dsts*liiawCellaps;dSt(ns*npugutt.markunSt(ns;    vsplastsctf ++i) {
sp,l     = view tlil.ranges++[ihead.linesp*liinshor handle i   !st.mtrke .mellaps;d(c(varin.i;extend(i   st.;matc=s || ()*+= out)on pr"keydow;
  st.mtrke .wi (teNoen(c(varin.i;extend(i   st.;matc=s 0cnpu;t.mtrke .inclusionLeftfnpuguttIsHidornInner(
-1, gutt/ st). nge = le+=(e);
an pr"keyd}ht } apllingFastguttIsHidornInner(
-1, gutt/ st(n ti", fui   st(n.t)c=s || ()* extend(os(dardeou;t(n.markurnf to(or)pe ==;extend(+= out)r, aIsHidornInner(
-1, ardor, a, (teMarkunSt(nFoe(ardor, a.markunSt(ns, st(n.mtrke )}
    v}    v, d.;t(n.markur.itclusionRionsfnpust(n.t)c=s r, a.t (!el.rang)ht >=e += out on pr"keydf ++i) {
sp,l     = viewgutt.markunSt(ns.l.ranges++[i ead.linesp*ligutt.markunSt(nshor handle i   st.mtrke .mellaps;d)npu!st.mtrke .wi (teNoencnpu;t.;matc=s  t(n.t)cnp    vcmcmcm(
t.toc=s || (brma
t.toc!ou;t(n.;mat)cnp    vcmcmcm(
t.mtrke .inclusionLeftf||u;t(n.markur.itclusionRions)cnp    vcmcmcmguttIsHidornInner(
-1, gutt/ st).e+=(e);
an pr"keyd}ht } happenLINE WIDGETt happenLt, fwi (tes ari block*eleethes sm.opti dg)b //e ++belowcalgutt.

d(os(dLt, Wi (te = CotuMirrg);Lt, Wi (te = t
      elmeanetu lE cm, scti", fui   E cm, sctf ++i) {
E ccitaE cm, sct;
  E cm, l.hasOwnPcon(ety E c)i"keydowanis[E c] = o cm, l[E c]r"keydble = tc= fHr"keydble =noen
= noenr   }; ngevdedMixne)Lt, Wi (te); hapflingFastadjustSc = "// hAb //Visibl "cm, gutt, diffcti", fui   meft);Atxt, lr, a) < ((m); textbnpu m; text.oc = "Top) rmafH=c-1)oc = "Top)c", funcaddToSc = "(doclmean    ddiffcmous} 
apLt, Wi (te. coto doc.me).
alifcm);}, 2));", fuos(dimer ble ne(e)wclicble = utt.wi (tes,dgutter anis.r, aeane icguttNo(r, a ; onFoi   noc=s || (brma!wsct+= outside;
f ++i) {
     = viewws.l.ranges++[i ;
  wshorfl.sble )wws.sp(clifi--,  }
    vi   !wsil.rang(c utt.wi (tesl  nSpace.getos(dhze();
= wi (teptions.ble  the nerunInO(de(e)fcm);}, 2.head.lineadjustSc = "// hAb //Visibl "cm, gutt, -hze(); ; onFoeI+=ginto (cm, "cm, no, "t= (te")tht >=e r, "mointoptions(r, a,lMathomax(0,lgutt.meft);l-dhze();)}
    v}  han}  diLt, Wi (te. coto doc.m(cm, d e)fcm);}, 2));", fuos(doldHer anis.hze();,dimer ble ne(e)gutter anis.r, ar"keydble =meft);l=
nSpace.getos(duiff e)wi (teptions.ble  (- oldH
    vi   !diffct+= outside;
runInO(de(e)fcm);}, 2.head.linefHa text.femptU, "mool on pr"keydowadjustSc = "// hAb //Visibl "cm, gutt, diffctht >=e r, "mointoptions(r, a,lgutt.meft);l+ diffctht >=}
n(di}; hapflingFastwi (teptions.wi (te)(i", fui   wi (te=meft);l!=r|| ()*+=(e);
wi (te=meft);; onFoi   !(varainse)-1uethe.body, wi (te=noen)cti", funce
  |arentS}yln = "p ight o:*+=lahtvi;"r    vvvsplawi (te=cov(eGuage . nge = le|arentS}yln += a argin-reft: -"t+ewi (te=c);getGuage Eneeded().ottersWi ng + "px;"r    vvvltL //CentRrenAndAdd(wi (te=c);sm.optiomrom |e, elt("div",a[wi (te=noen]ean    d|arentS}yln)  hanFo}vt fu+= out)wi (te=meft);l=
wi (te=noen.ottersHze();
   } hapflingFastaddLt, Wi (te"cm, h);
  eanetu lE cm, scti", fuos(dwi (te = n   Lt, Wi (te"cm, netu lE cm, sc;", fui   wi (te=noHSc = ")nm);sm.optioalignWi (tesl  on pr"keydm(cm, xt, lfH=c-1, h);
  ea"t= (te"r)fcm);}, 2r, a) lLeft(fuos(dwi (tes*ligutt.wi (tes*rma(gutt.wi (tesl  []  handle ;
  wi (te=itsertAtc=s || ()*wi (teseectiowi (te); andle .viewwi (tesesp(clifMathomin(wi (tese Range(- 1,lMathomax(0,lwi (te=itsertAt)), 0,lwi (te); andle wi (te=gutter r, aevt fu  ;
  !guttIsHidorn(fH=c-1, r, a)ihead.lineetos(dab //Visibl er meft);Atxt, lr, a) < fH=c-1)oc = "Top
    veIenr, "mointoptions(r, a,lgutt.meft);l+ wi (teptions.wi (te)m
    veIeni   ab //Visibl )caddToSc = "(doclmean    dwi (te=meft); ; onFoeIenm); text.femptU, "mool on pr"keydowght >= m+=(e);
an pr"keyd}0;a, fu+= out)wi (temous} 
appenLINE DATAnSTRUCTURE happenLt, fobjdges. Theiewhold
ma
  *+=lahunft)ca gutt, ctclude.f
appenhft)lft);e.f
info  bln neylts
arrti).hapos(dLutter CotuMirrg);Lt,  e)fcm);}, 2teng,dmarkunSt(ns, estimahuHze();  lLeft(anis.teng =uteng;a, fuattc  MarkunSt(ns2racm.dmarkunSt(nscr"keydble =meft);l=
estimahuHze(); ?iestimahuHze();.ble  (: 1mous}; ngevdedMixne)Lt, )  diLt, . coto doc.guttNo e)fcm);}, 2));u+= out)r, aNolble  t }; happenC(cm, ftunnmvarthe 2teng,dmarku sctobea r, a. Automahectlly
appeninvali "mos cachunfinformagFastatoSpria.cpo re-estimahu une
vipenr, a's meft);. apllingFastr, "mointo(r, a,loeng,dmarkunSt(ns, estimahuHze();  lLeft(r, a.t (! =uteng;a, fu;
  gutt.ma
  Afnte) gutt.ma
  Afntel=
nSpace.get;
  gutt.maylts) gutt.maylts
=
nSpace.get;
  gutt.Evde++!=r|| ()*gutt.Evde++  nSpace.getcetc  MarkunSt(ns2r, a);a, fuattc  MarkunSt(ns2r, a,lmarkunSt(nscr"keydos(dastHeft);l=
estimahuHze(); ?iestimahuHze();.r, a) : 1mousemi   astHeft);l!=lgutt.meft);)br, "mointoptions(r, a,lastHeft);  han}""dog pDetc  
a lt, r;matco
  )-1uetheSpreetatoSitsdmarke s. apllingFastme).nUpxt, lr, a) lLeft(r, a.|arenteounSpace.getcetc  MarkunSt(ns2r, a);a, } hapflingFast (!ractxt, Ceassesaoefa,Soutpue)(i", fui     if0tf ++i;;.head.lineos(dguttCeass mnt if.mtnchf/(?:^|\s+)gutt-(bdckgr )
 -)?(\S+)/)evt fu  ;
  !guttCeass) breakevt fu  tdoc mnt ifi
(clif0,lguttCeasstctorS) + t ifi
(clifguttCeasstctorS + guttCeass[0]il.rang);a, fufuos(d coner r, aCeass[1] ?i"bgCeass" : "oengCeass"evt fu  ;
  outpue[ con]c=s || ()    vcmcmoutpue[ con]c= r, aCeass[2r handle .viewi   !os   RegExp("(?:^|\s)" + guttCeass[2] + "(?:$|\s)"))turn foutpue[ con]))    vcmcmoutpue[ con]c+= a " + guttCeass[2] hanFo}vt fu+= out)t ifr   } hapflingFastctllBlankxt, lmetu lma
  )(i", fui   metu.blankxt, m;+= out metu.blankxt, (ma
  ); onFoi   !moen.itnerMoen(c+= outside;
os(ditnerer CotuMirrg);itnerMoenlmetu lma
  ); onFoi   itner.metu.blankxt, m;+= out itner.metu.blankxt,  itner.ma
  ); on} hapflingFastocadTokrn(metu lmalicm lma
  )(i", fuf ++i) {
     = view10es[i].head.lineos(ds}yln = metu.tokrn(malicm lma
  ) handle i   sdlicm.  cl> 
dlicm. }
r(
 lc out)idyln hanFo}vt futhh)wbs  sErrg)d"Moen " + metu.nlen + " failunft)cadvaecef
dlicm."  han}""dog pRunp se gionn
metu'snpw stt overca gutt, ctlle.f
f f ++ec  ptokrn. apllingFastounMoenl.g, beng,dmetu lma
  r)f,lguttCeasses,  7mptToEndcti", fuos(dflnagenSt(ns*limetu.flnagenSt(ns; onFoi   flnagenSt(ns*l=r|| ()*flnagenSt(ns*li me, cm, liflnagenSt(ns; onFoos(d teS}ex]e) 0,d teS}yln = nSpace.getos(dsdlicm =bs   Sate.fSdlicm2teng,d me, cm, litabS;
 ),)idyln hanFoi     (! =iv"")t (!ractxt, CeassesactllBlankxt, lmetu lma
  ),lguttCeasses)evt fuwhicur(!
dlicm.eol()ihead.linei   sdlicm.  cl>  me, cm, limaxHft)lft);Lerang ); onFoeIenflnagenSt(ns*li  } er    vvvFoi   f7mptToEndct cocessxt, lfH, beng,dma
  r)sdlicm.  c);", fure esdlicm.  cl=utengil.rang
    vcmcms}yln = nSpace.getfugtorSize.top ? -2s}yln =  (!ractxt, CeassesaocadTokrn(metu lmalicm lma
  ),lguttCeasses)evt fu  }he ne  i    me, cm, liaddMetuCeass) ead.lineetos(dmNlen r CotuMirrg);itnerMoenlmetu lma
  ).metu.nlenr    vvvFoi   mNlen)2s}yln = "m-"t+e(s}yln ?dmNlen + a " + s}yln :dmNlen)evt fu  }he ne  i   !flnagenSt(ns*rmafteS}yln !ou;}yln)); onFoeIeni    teS}ex]e< 
dlicm. }
r(
 f(
dlicm. }
r(,d teS}yln ; onFoeIenmteS}ex]e) 
dlicm. }
r(;d teS}yln = idyln hanFo  }he ne  
dlicm. }
r(e) 
dlicm.| c;exten}vt fuwhicur( teS}ex]e< 
dlicm.| c)e; onFoeIg pWebkit*seem.cpo ref fu po rende++t (! netus lo g t
t
an 57444nd", acters
ap vdlos(d  cl=uMathomin(
dlicm.| c,nmteS}ex]e+ 500000;a, fufuf(| c,nmteS}yln ; onFoeImteS}ex]e) | c;exten}vt } 
appenCnmnutu+a s}yln arrti ()n
arrti  }
r(elepwith"aimetu gen(e)) do
vipen-- f ++invali "mFast-- f llowun by
pairseibeardep ight os*h case a s}yln  }le.fs), which us  funfthahft)lft);p se tokrnsrooft
e
vipenr, a. apllingFasthft)lft);xt, lfH, gutt/ sa
  r)f7mptToEndcti", fupenA seylts
arrti alwtis  }
r(s with"afnumbut  orntifyelep se", fupenmetu/overlay.cp
at ie e ebased ast(f ++ecsy+invali "mFas).ht >=os(dsdl  [cm.ma
  .metuGen],lguttCeassesl  {};", fupenCnmnutu+ se base
arrti ibeseyltsvt fu+unMoenl.g, r, a.t (!, fH=c-1)metu lma
  r)fcm);}, 2e
 / ;}yln)); onFoeIsteectioe
 / ;}yln);exten},lguttCeasses,  7mptToEndccehandlpenRunpoverlay.,wadjust s}yln arrti.", fuf ++i) {
o    = o < fH=ma
  .overlay..l.ranges++o.head.lineos(doverlay*li mema
  .overlay.[o],l    1, at s 0n(diapfu+unMoenl.g, r, a.t (!, overlay)metu lte = dfcm);}, 2e
 / ;}yln)); onFoeIdlos(d }
r( s i; onFoeIenpenE  varnes te's
a tokrneardeat une currded p ight o,aatoSpaat iDpoints at it onFoeIenwhicur(atc< ard)* extend(andlos(di_ardeou;lhor handle e(Foi   i_arde> ard)    vcmcmcmcmstesp(clifi, 1, e
 / ;}[i+ 0,di_ard.
    vcmcmfu;c+= 2
    vcmcmfuat s Mathomin(e
 / i_ard.
    vcmcm}
 vcmcmfu, d.!sdyln))+= outside;
    ;
  overlay)opaque)* extend(andlstesp(clif }
r(,di -  }
r(,de
 / "cm-overlay*" + s}yln.
    vcmcmfu;c=  }
r( + 2
    vcmcmgtorSize.top ? -2ewf ++i;  }
r( < i;  }
r( += 2)w extend(andl uos(d teeou;lh }
r(+ 0;    vcmcmcmcmsth }
r(+ 0eou( te ?d te + a " :v"")t+ "cm-overlay*" + s}yln;    vcmcmcm}    vcmcm}
 vcmcm},lguttCeasses)evt fu}hht >=lc out){seylts:(
d,lciasses:lguttCeasses.bgCeass*rmaguttCeasses.oengCeass*?iguttCeassesl:c    }; on} hapflingFast(text, S}ylnsl.g, r, acti", fu, d.!gutt.maylts
rmagutt.maylts[0] !oucm.ma
  .metuGen.head.lineos(dresult =thft)lft);xt, lfH, gutt/ gutt.ma
  Afntel=
(teSa
  Ban be(cm, guttNo(r, a )m
    veIgutt.maylts
=
result.maylts handle i   result.ciasses) gutt.mayltCeassesl  result.ciasses handle .viewi   gutt.mayltCeasses) gutt.mayltCeassesl  nSpace.get}vt fu+= out)r, a.maylts han} 
appenLft);weft);lform ibehft)lft);p--  coceed averafuisfr, afa case a r, "molma
  r)butsu, 't s)vi a
s}yln arrti.nUfunf; ++r, as t
at
appenaren't  urrdedln visibl . apllingFast cocessxt, lfH, beng,dma
  r)sdartAt) ;handlos(dmoen
= fH=c-1)metuce.getos(dsdlicm =bs   Sate.fSdlicm2teng,d me, cm, litabS;
 )ce.get
dlicm. }
r(e) 
dlicm.| cc=  }
r(Atf||u0 hanFoi     (! =iv"")tctllBlankxt, lmetu lma
  )evt fuwhicur(!
dlicm.eol()
npu;dlicm.| cc<=  me, cm, limaxHft)lft);Lerang ); onFoeIocadTokrn(metu lmalicm lma
  ) handle 
dlicm. }
r(e) 
dlicm.| c;exten}vt } 
appenCnnvert a
s}yln asolty.li dgby
aimetu (eies t
n    dEvea sate.f
vipen narainelepone or L rn neylts)ft)ca CSS neylt. The eis cachun,
vipenatoS } or,ooks f ++r, a-t= n neylts.hapos(dneyltToCeassCc   l  {},dneyltToCeassCc   WithMoen
= {};", llingFastinntepltyTokrnS}yln(s}yln lE cm, scti", fui   !sdylnf||u/^\s*$/turn fs}yln.ctlt(e);
nSpace.getos(dcc   l  , cm, liaddMetuCeassf?  }yltToCeassCc   WithMoen
:  }yltToCeassCc   ;a, fu+= out)cc   [ }ylt]drmhandle (cc   [ }ylt]d= idyln.rel_mou(/\S+/g/ "cm-$&")  han}""dog pRende++t  lDOM relcesdetaht ofibeo
    (! obea r, a. A} orbuildsase a r,ea 'r, afmap', which points at t  lDOM netus paat relcesdetase a snecific) dlinchusfibeoeng,datoSis  funfby
t
  mrom |e.f
mede. appenTle(rty.li dgobjdge (varains t  lDOM netu, ble fmap,fa case a informagFastabout+r, a-t= n neylts paat w te ste by
t
  mede. apllingFastbuildxt, Cvarthe(cm, guttV =  ); onFopenTle(padde.f-rft);lforca.cpac eleethe thah)vi a
'bEvde+', which onFopenus neununfastWebkit*to  emableutha(te r, a-level b )
 ele onFopenrdgeanglts f ++it  it mrom |o (cr).ht >=os(dmvarthe Y elt("nnas",a     d    , webkit*? "padde.f-rft);: .1px" :c    )ce.getos(dbuildtel=
{lce: elt("lce",a[mvarther),dmvarthe:dmvarthe,dmvl: 0,d| c: 0,dcm:dmm};", fuguttV = omrom |e
= {};" onFopenIt(e))e averafu nrogectlcr, a.cpaat makn up+t
us visuPofr, a.", fuf ++i) {
     = vie=  guttV = orrn t? guttV = orrn e Range(:(0}
s[i].head.lineos(dgutter it? guttV = orrn [i -  0e: guttV = ogutt/ Evde+ handle buildte.| cc= 0 handle buildte.addTokener buildToken handle penO cm, ally wiha in
soma h)ckscinto  se tokrn-rende+ele onFovipenalgorithm, to dePofwith"browstt quirks.handle i   (inf||uwebkit)bnpu m;(teO cm, ("guttWo en   "))    vcmcmbuildte.addTokener buildTokenSp(ctSpmou (buildte.addToken) handle i   hasBadBidiRdges(c);sm.optiomrom |e)bnpu(Evde++  (teOvde+(r, a )m    vcmcmbuildte.addTokener buildTokenBadBidi(buildte.addToken/ Evde+) handle buildte.mapomn[r handle itsertLt, Cvarthe(gutt/ buildte,t(text, S}ylnsl.g, r, ac) handle i   gutt.mayltCeasses) ; onFoeIeni   gutt.mayltCeasses.bgCeass)    vcmcmcmbuildte.bgCeass*= joinCeassesagutt.mayltCeasses.bgCeass,mbuildte.bgCeass*||u"".
    vcmcmi   gutt.mayltCeasses.oengCeass)    vcmcmcmbuildte.oengCeass*= joinCeassesagutt.mayltCeasses.oengCeass,mbuildte.oengCeass*||u"".
    vcm}hht >=enpenE  varnat lea l a singlt netu  s
pcesdet,  7m mrom |e.f.handle i   buildte.mapel.rangc=s 0m    vcmcmbuildte.mapeectio0, 0,lbuildte.mvarthe.appardChild(zeroWi ngEneeded(c);sm.optiomrom |e))ccehandlappenS if 
t
  mapnatoS dcc   lobjdge ; ++t
  currded rogectlcr, ahandle i   ic=s 0m ; onFoeIenguttV = omrom |e.mapomnbuildte.map; onFoeIenguttV = omrom |e.cc   l  {}ce.getfugtorSize.top ? -2(guttV = omrom |e.maps*rma(guttV = omrom |e.maps*  []))eectiobuildte.map the ne    (guttV = omrom |e.cc   s*rma(guttV = omrom |e.cc   s*  []))eectio{})evt fu  }he ne}hht >=;
    When arende+xt, ",v.g, guttV = ogutt/ buildte.|r ); onFoi   buildte.|r .meassNlen)handle buildte.oengCeass*= joinCeassesabuildte.|r .meassNlen,mbuildte.oengCeass*||u"".
    v+= out)buildte; on} hapflingFastdefaultSnecial (crP_mouhold/ Whh) ;handlos(dtokener elt("nnas",a"\u2022"/ "cm-invali d", ".
    vtokrn.titln iv"\\u" + ch.m(crCotuAt(0).toSate.f(16.
    v+= out)token han}""dog pBuild up+t
 lDOM relcesdetaht offEvea singlt token/ atoS doSitfth
vipeno
  littemape Takns caru po rende++snecialnd", acters sepw ateln. apllingFastbuildTokrn(buildte,tbeng,dmayln lnew cS}yln,de
 S}yln,dtitln) lLeft(;
  !a (!)c+= outside;
os(dsnecialnmnbuildte. me, cm, lisnecial (crm.dmustWo e*li  } er    vi   !stecialturn fa (!)m ; onFoeIbuildte.mvl += tengil.rang
    vcmos(dmvarthe Y )-1uethe. ocataTengNoen(p (!) handle buildte.mapeectiobuildte.| c,nbuildte.| cc+ tengil.rang,dmvarthe) handle i   incnpuie_v(esFast< 9)dmustWo e*lion pr"keydowbuildte.| cc+= tengil.rang
    vgtorSize.top ? os(dmvarthe Y )-1uethe. ocataD-1uetheFrageded(),d| clic0 handle whicur(pe ==w extend(anstecialt    ItorS ) | c;extenp ? os(dmeou;tecialtexec(p (!) handle ;
os(dskippadeoum ?dmtctorS -d| cl: tengil.rang -d| c
    vcmcmi   skippad)* extend(andlos(dtxe Y )-1uethe. ocataTengNoen(p (!i
(clif| c,n| cc+ skippad).
    vcmcmfu;
  incnpuie_v(esFast< 9)dmvarthe.appardChild(elt("nnas",a[txe]).
    vcmcmfuorSizmvarthe.appardChild(t(!) handle ;
e buildte.mapeectiobuildte.| c,nbuildte.| cc+ skippad, t(!) handle ;
e buildte.mvl += skippad handle ;
e buildte.| cc+= skippad handle ;
}
 vcmcmfu, d.!m) breakevt fu    | cc+= skippad + 1mouscmcmfu, d.m[0] =iv"\t")* extend(andlos(dtabS;
 nmnbuildte. me, cm, litabS;
 ,dtabWi ng =dtabS;
 n- buildte.mvl %dtabS;
 ;extend(andlos(dtxe Y mvarthe.appardChild(elt("nnas",aspmouSat(tabWi ng)/ "cm-tab")) handle ;
e buildte.mvl += tabWi ng
    vcmcmgtorSize.top ? -2ewos(dtxe Y buildte. me, cm, lisnecial (crP_mouhold/ Wm[0].
    vcmcmfu;
  incnpuie_v(esFast< 9)dmvarthe.appardChild(elt("nnas",a[txe]).
    vcmcmfuorSizmvarthe.appardChild(t(!) handle ;
e buildte.mvl += 1 handle ;
}
 vcmcmfubuildte.mapeectiobuildte.| c,nbuildte.| cc+ 1, t(!) handle ;
buildte.| c++evt fu  }he ne}hcmfu;
  sdylnf||unew cS}yln rmae
 S}yln rmamustWo e.head.lineos(df   S}yln = idyln*||u"" handle i   new cS}yln)df   S}yln +=unew cS}yln handle i   ardI}yln)df   S}yln +=uardI}yln
    vcmos(dtokener elt("nnas",a[mvarther,df   S}yln) handle i   titln) tokrn.titln ivtitlnn(diapfu+= out)buildte.mvarthe.appardChild(token) handl}hcmfubuildte.mvarthe.appardChild(mvarthe) han} hapflingFastbuildTokenSp(ctSpmou (itner)(i", fuflingFast
p(ct oldctead.lineos(doue Y " " handle f ++i) {
     = viewoldil.rangc- 2es++[i oue +r it% 2*? " " :v"\u00a0" handle oue +r " " handle lt(e);
outce.get}vt fu+= out)fcm);}, 2buildte,tbeng,dmayln lnew cS}yln,de
 S}yln,dtitln) lLeft(  itner2buildte,tbeng.rel_mou(/ {3,}/g/ 
p(ct),dmayln lnew cS}yln,de
 S}yln,dtitln)ce.get} han}""dog pWorkpar )
 en, le le diethst os*beeleeocpor((d for) dlinchusfib"dog prft);-to-refttbeng.hapflingFastbuildTokenBadBidi(itner/ Evde+) lLeft(+= out)fcm);}, 2buildte,tbeng,dmayln lnew cS}yln,de
 S}yln,dtitln) lLeft(  s}yln = idyln*?  }ylt + a cm-forca-bEvde+" :v"cm-forca-bEvde+"
    vcmos(d }
r(e) buildte.| c,nardeou;l
r( + tengil.rang
    vcmf ++i;;.head.lineappenF toSt
e  
r( paat overlapslwith"o
  s}
r(robeo
e efengad.lineapf ++i) {
     = viewovde+il.ranges[i].head.line vcmos(dp
r(e) ovde+hor handle e(Foi   p
r(.toc>  }
r(cnpup
r(.;matc<=  }
r() breakevt fu    }
 vcmcmfu, d.p
r(.toc>= ard)*+= out itner2buildte,tbeng,dmayln lnew cS}yln,de
 S}yln,dtitln)mouscmcmfu,tner2buildte,tbeng.
(clif0,lp
r(.toc-  }
r(),dmayln lnew cS}yln,d    , titln)mouscmcmfunew cS}yln ounSpace.get=  et (! =utengi
(clif|
r(.toc-  }
r()mouscmcmfunew c =lp
r(.toevt fu  }he ne} han} hapflingFastbuildCellaps;dSt(n2buildte,ts;
 ,dmarkur,a
  or Wi (te)ti", fuos(dwi (te = !
  or Wi (tefnpumtrke .wi (teNoenr    v;
  wi (tem ; onFoeIbuildte.mapeectiobuildte.| c,nbuildte.| cc+ s;
 ,dwi (te); andle buildte.mvarthe.appardChild(wi (te); andl}hcmfubuildte.| cc+= s;
 ;ext}""dog pOutpuesr)dnumbut ibest(ns to makn up+a gutt, takele hft)lft);e.f
vipenatoSmarkunet (! into ac nunt.hapflingFastitsertLt, Cvarthe(gutt/ buildte,tneylts)fi", fuos(dst(ns*ligutt.markunSt(ns,nallT (! =ur, a.t (!, at s 0n(diap, d.!st(nsct{    vcmf ++i) {
    1= view eylts.l.ranges[i=2m    vcmcmbuildte.addToken2buildte,tallT (!i
(clifa!, at s maylts[ir),dinntepltyTokrnS}yln(s}ylns[i+ 0,dbuildte. me, cm, l).
    vcm+= outside;
}ehandlos(dlener allT (!il.rang,d| clic0,l    1, t (! =u"",)idyln hanFoos(ds xtC(cm, fic0,lst(nS}yln,dst(nE
 S}yln,dst(nS}w cS}yln,dtitln,
collaps;d hanFof ++i;;.head.linei   n xtC(cm, fi) | c));upenU, "molcurrded mtrkurrsegad.lineapst(nS}yln =dst(nE
 S}yln =dst(nSew cS}yln outitln iv""mouscmcmfumellaps;d)ounSpacds xtC(cm, ficInfinity handle ;
os(d; )
 Bookmarksomn[r handle fuf ++i) {
j    = jiew t(nsil.ranges++j)* extend(andlos(dst r  t(nshj0,dtc= st.mtrke ce   vd.linei   ;t.;matc<) | c)npu st.toc=s || (brma
t.toc> | c))w extend(andl ui   ;t.t)c!=r|| ()npus xtC(cm, f>(
t.to)c{ds xtC(cm, fic
t.to;dst(nE
 S}yln =d""m }
 vcmcmfudl ui   m.meassNlen)pst(nS}yln += a " + m.meassNlen;
 vcmcmfudl ui   m.new cS}yln npu;t.;matc=s | c))st(nSew cS}yln += a " + m.new cS}yln handle fudl ui   m.e
 S}yln npu;t.toc=s | xtC(cm, )dst(nE
 S}yln += a " + m.ardI}yln
    vcmfudl ui   m.titln npu!titln) titln ivm.titln
    vcmfudl ui   m.mellaps;d)npu !mellaps;d)rmafnm|
reCellaps;dMarkursemellaps;d.markur,am)iew0))    vcmcmcmcmfumellaps;d)ousp
    vcmfudluu.viewi   st.;matc> | c)npus xtC(cm, f>(
t.;mat)c extend(andl us xtC(cm, fic
t.    ;    vcmfudlue   vd.linei   m.tdoc ms obookmark"tnpu;t.;matc=s | cfnpum.wi (teNoen(c; )
 Bookmarkseectiom.
    vcmcm}
 vcmcmfu, d.mellaps;d)npu mellaps;d.;matc||u0)fi) | c));handle ;
e buildCellaps;dSt(n2buildte,t mellaps;d.toc=s || (b? lene+u1d:(mellaps;d.to) -d| c,handle e( llllllllllllllllllllmellaps;d.markur,amellaps;d.;matcl=r|| ()ce   vd.linei   mellaps;d.toc=s || ())+= outside;
    }
 vcmcmfu, d.!mellaps;d)npu; )
 Bookmarksel.rang(cf ++i) {
j    = jiew; )
 Bookmarksel.ranges++j)handle ;
e buildCellaps;dSt(n2buildte,t0,w; )
 Bookmarkshj0)evt fu  }he ne  i     cl>= len) breakev    vcmos(dupt)c= Mathomin(len/ | xtC(cm, ) handle whicur(pe ==w extend(ani     (!)* extend(andlos(dardeou| cc+ tengil.rangce   vd.linei   !mellaps;d)w extend(andl uos(dtokenT (! =uarde> upt)c?tbeng.
(clif0,lupt)c- | c)):uteng;a, fudle ;
e buildte.addToken2buildte,ttokenT (!, idyln*?  }ylt + st(nS}yln :lst(nS}yln,handle e( llllllllllllllllllllst(nS}w cS}yln,d| cc+ tokenT (!el.rangc=s s xtC(cm, f?dst(nE
 S}yln :u"",)titln)mouscmcmfudlue   vd.linei   arde>=lupt))w t (! =utengi
(clifupt)c- | c);d| clicupt); breakeue   vd.line| clicend handle ;
e st(nSew cS}yln ou""mouscmcmfuue   vd.lit (! =uallT (!i
(clifa!, at s maylts[i++])mouscmcmfuneyln ouinntepltyTokrnS}yln(s}ylns[i++0,dbuildte. me, cm, l)evt fu  }he ne}hcm}""dog pDOCUMENT DATAnSTRUCTURE happenBytdefault, r, "mosft
at  }
r(natoSardeat une beg,tnelepobea r, a
vipenCha tocatadu;tecially,citaEvde++to makn t
  Cssociaht ofiber, a
vipenwi (tes atoSmarkur*eleethes with"o
  t (! beh)vi L rn innuihtvi.hapflingFastisWholeLt, U, "mo")-1,lch, cm );handl+= out)ch, cm.f   othc=s 0cnpuch, cm.toochc=s 0cnpulst2ch, cm.t (!) =iv""cnp    vcm(!c-1)ctc||uc-1)cte, cm, liwholeLt, U, "moBan be  han}""dog pPerform a m(cm, fonco
  )-1uetheS "ma satuct |e.
apllingFastr, "moDoc")-1,lch, cm,dmarkunSt(ns, estimahuHze();  lLeft(flingFast
p(nsFoe(n.he+= out markenSt(ns*?imarkunSt(nshn] :c    eue   vllingFastr, "mo(r, a,loeng,dst(nsct{    vcmr, "mointo(r, a,loeng,dst(ns, estimahuHze(); evt fu  ;
    Late+(r, a/ "ch, cm", gutt/ ch, cm ;handl}ehandlos(d;matc= fh, cm.f   ,lt)c= fh, cm.to, t (! =uch, cm.t (! hanFoos(d x, lLitter (text, l)-1,lf   or, a),         er (text, l)-1,ltoor, a) hanFoos(d    T (! =urn fa (!),     St(ns*liinanlFoe(tengil.rang -d1), nr, a.c= toor, an-lf   or, a;" onFopenAdjust o
  littesatuct |e(diap, d.isWholeLt, U, "mo")-1,lch, cm )e; onFoeIg pThe eis a"whole-r, a rel_mou. Tocatadu;tecially+to makn onFoeIg p varnr, a objdges L //ethe waynthey Cha sup| cunfth.handle f ++i) {
     , add;d)ou[r  viewtengil.rang -d1es++[i    vcmcmadd;deectios   xt, lteng> 0,dsnanlFoe(i), estimahuHze(); ctht >=e r, "mo(        ,         .t (!,     St(ns) handle i   nr, a.)uc-1)ltL //Wf   or, a, nr, a.) handle i   add;del.rang(cc-1)itsertWf   or, a, add;d ;handl}u.viewi    x, lLitter=         .head.linei   t (!el.rangc=s 1)w extend(anr, "mo( x, lLitt,d x, lLitt.beng.
(clif0,lf   oth)t+     T (! +d x, lLitt.beng.
(cliftooch),     St(ns) handle gtorSize.top ? -2f ++i) {
add;d)ou[r,
    1= viewtengil.rang -d1es++[i    vcmcmcmadd;deectios   xt, lteng> 0,dsnanlFoe(i), estimahuHze(); ctht >=e cmadd;deectios   xt, l    T (! +d x, lLitt.beng.
(cliftooch),     St(ns, estimahuHze(); ctht >=e cmr, "mo( x, lLitt,d x, lLitt.beng.
(clif0,lf   oth)t+ teng>00,dsnanlFoe(0 ctht >=e cmc-1)itsertWf   or, ac+ 1, add;d ;handl  }he ne}u.viewi   t (!el.rangc=s 1)w extend(r, "mo( x, lLitt,d x, lLitt.beng.
(clif0,lf   oth)t+ teng>00t+     Litt.beng.
(cliftooch), snanlFoe(0 ctht >=e c-1)ltL //Wf   or, ac+ 1, nr, a.) handlgtorSize.top ? r, "mo( x, lLitt,d x, lLitt.beng.
(clif0,lf   oth)t+ teng>00,dsnanlFoe(0 ctht >=e r, "mo(        ,     T (! +d    Litt.beng.
(cliftooch),     St(ns) handle f ++i) {
    1, add;d)ou[r  viewtengil.rang -d1es++[i    vcmcmadd;deectios   xt, lteng> 0,dsnanlFoe(i), estimahuHze(); ctht >=e i   nr, a.e> 1)uc-1)ltL //Wf   or, ac+ 1, nr, a. -d1)tht >=e c-1)itsertWf   or, ac+ 1, add;d ;handl}hht >=;
    Late+()-1,l"ch, cm", )-1,lch, cm ;han} happens
  )-1uetheSis relcesdet dg)s a"BTreetc, listelepibere)vis, withhappenchunkfiber, as inco
 m/ atoSbranchus, with up+towtenere)vis or
vipenoes t
branch netus belowco
 m. The+top netu  s
alwtis a
branch
vipennetu, atoSis o
  )-1uetheSobjdge itselfr(meanelepit h)sase a addecm, al methods atoS con(eties). appease a A (bnetus h)vi |arenter, ks. The+treetis  funfbong tha(olf   
vipenr, adnumbuts to r, a objdges,aatoSpha(olf    objdges phanumbuts. appenItS } orctorSus by hze();,datoSis  funfphacnnvert betweenehze();
vipenatoSr, a objdge,aatoSphaf toSt
e total meft);libeo
  )-1uethe. appease a Seeta} orhttp://marijnh)virbeke.nl/blog/medemirrg)-r, a-tree.html hapflingFastLeafChunk(r, a.)ue.top anis.r, as*liguttc
    vanis.|arenteounSpace.getf ++i) {
     , meft);l=
 = viewgutts.l.ranges++[i ead.lineguttshor.|arenteouanistht >=e meft);l+=eguttshor.meft);; onFo}    vanis.meft);l=
meft);; on} 
apLeafChunk. coto docl  {    vchunkS;
 :)fcm);}, 2));u+= out)anis.r, as.l.ranges}, onFopenRcL //eo
  ner, as at ottersl'at'.handl+=L //Inner:)fcm);}, 2a!, nct{    vcmf ++i) {
    a!, e   a!c+ n= viewees++[i ead.lineneos(dgutter anis.r, ashor handle e(anis.meft);l-=lgutt.meft);mouscmcmfume).nUpxt, lr, a)mouscmcmfun
    Late+(r, a/ "vedeme")evt fu  }he ne  anis.r, as.sp(clifa!, nc; onFo}, onFopenHeln(e  funfphacnllaps;ea small
branch into a singlt e).f.handlcnllaps;:)fcm);}, 2r, a.)ue.top neguttseecti.apply(gutts, anis.r, asc; onFo}, onFopenItsertp se gionn
arrti iber, as at ottersl'at',  nuntgthemcas onFopenh)velep se gionn
meft);. ape itsertInner:)fcm);}, 2a!, gutts, hze();  lLeft(e(anis.meft);l+=
meft);; ontop anis.r, as*lianis.r, as.s(clif0,lat).mvacat2r, a.).mvacat2anis.r, as.s(clifat))r    vvv; ++i) {
     = viewgutts.l.ranges++[i guttshor.|arenteouanistht >=}, onFopenUfunft)cit(e))e averaa p
r(robethe+tree. ape it(eN:)fcm);}, 2a!, n lE ct{    vcmf ++i) {
e   a!c+ n= atc< aes++al)    vcmcm;
  E 2anis.r, as[ae]).e+=(e);
an pr"keyd}ht }; hapflingFastBranchChunk(centRren)ue.top anis.centRren =uchntRren hanFoos(ds;
 nmn , meft);l=
 =e.getf ++i) {
     = viewchntRrenil.ranges++[ihead.lineos(dchc=wchntRrenhor handle s;
 n+= ch.m(unkS;
 (); meft);l+=ech.meft);; ontop ch.|arenteouanistht >=}.top anis.s;
 nmns;
 ;extenanis.meft);l=
meft);; on vanis.|arenteounSpace.g} 
apBranchChunk. coto docl  {    vchunkS;
 :)fcm);}, 2));u+= out)anis.s;
 ;=}, onFo+=L //Inner:)fcm);}, 2a!, nct{    vcmanis.s;
 n-=lnr    vvv; ++i) {
     = viewanis.centRren.l.ranges++[i ead.lineneos(dcentR*lianis.chntRrenhor,dszc=wchntR.m(unkS;
 ();    vcmcm;
  atc< sz)* extend(andlos(drmc= Mathomin(n,dszc-lat), oldHeft);l=
chntR.meft);mouscmcmfu 
chntR.+=L //Inner2a!, rm)mouscmcmfudlanis.meft);l-=loldHeft);l-
chntR.meft);mouscmcmfu 
i   szc=s rt)c wanis.centRren.sp(clifi--,  }

chntR.|arenteounSpaclue   vd.linei   (nl-=lrt)c=s 0m breakevt fu      at s 0n(diapfudlgtorSiza;l-=lszevt fu  }he ne  penIbethe+result is small t
t
an 25 gutts, e  varnesat ie e ea onFoeIg p inglt e).fbnetu.handle i   anis.s;
 n- st< 25 np    vcmcmcm(anis.centRren.l.range> 1brma!(anis.centRren>00titstaeceobeLeafChunk))ihead.lineetos(dr, as*li[r handle e(anis.cnllaps;(r, a.) handle p anis.centRren =u[s   xeafChunk(r, a.)r handle e(anis.centRren>00.|arenteouanistht >=e }ht >=}, onFocnllaps;:)fcm);}, 2r, a.)ue.top ne; ++i) {
     = viewanis.centRren.l.ranges++[i anis.chntRrenhor.cnllaps;(r, a.) handl}, onFoitsertInner:)fcm);}, 2a!, gutts, hze();  lLeft(e(anis.s;
 n+= gutts.l.rangeLeft(e(anis.meft);l+=
meft);; ontop ; ++i) {
     = viewanis.centRren.l.ranges++[i ead.lineneos(dcentR*lianis.chntRrenhor,dszc=wchntR.m(unkS;
 ();    vcmcm;
  atc<= sz)* extend(andlchntR.itsertInner2a!, gutts, hze(); ce   vd.linei   mhntR.r, as*npuchntR.r, as.l.range> 50)w extend(andl uwhicur( hntR.r, as.l.range> 50)w extend(andl udlos(dstill   mnchntR.r, as.sp(clif hntR.r, as.l.range- 25, 25 ce   vd.line udlos(ds  e).fb= n   LeafChunk(still   ce   vd.line udlchntR.meft);n-=ln  e).f.meft);mouscmcmfu 
e e(anis.centRren.sp(clific+ 1, 0,ln  e).f ce   vd.line udln  e).f.|arenteouanistht >=e       }
 vcmcmfudl uanis.maybeStill( ce   vd.line}
 vcmcmfudlbreakevt fu    }
 vcmcmfua;l-=lszevt fu  }he ne}, onFopen// hr)dnetu h)s grown,lcheck+et
es t
it*shoutR*be 
p(ct.handlmaybeStill:)fcm);}, 2));handle i   anis.centRren.l.range<= 10))+= outside;
  os(dmeeouanistht >=e do); onFoeIdlos(d till   mnme.centRren.sp(clifme.centRren.l.range- 5, 5 ce   vd.lios(ds;blelep= n   BranchChunk(still   ce   vd.li, d.!ma.|arent));upenBecoma t
e  
rentenetuextend(andlos(dcopyp= n   BranchChunk(me.centRren ce   vd.linecopy.|arenteouen;
 vcmcmfudlme.centRren =u[copy,ds;blele];
 vcmcmfudlme Y mvpy handle ;
gtorSize.top ? -2ewme.s;
 n-=ls;blele.s;
 ;extend(andlme.meft);n-=ls;blele.meft);mouscmcmfu 
os(dmyItorS ) ctorSOf(ma.|arent.centRren, me);extend(andlme.|arent.centRren.sp(clifmyItorS + 1, 0,ls;blele.
    vcmcm}
 vcmcmfus;blele.|arenteouen.|arent handle gtwhicur(me.centRren.l.range> 100;a, fufume.|arent.maybeStill( ce   v}, onFoit(eN:)fcm);}, 2a!, n lE ct{    vcmf ++i) {
     = viewanis.centRren.l.ranges++[i ead.lineneos(dcentR*lianis.chntRrenhor,dszc=wchntR.m(unkS;
 ();    vcmcm;
  atc< sz)* extend(andlos(dus;d)ouMathomin(n,dszc-lat)ce   vd.linei   mhntR.it(eN2a!, us;deaot).e+=(e);
an pr"keydd.linei   (nl-=lus;d)w=s 0m breakevt fu      at s 0n(diapfudlgtorSiza;l-=lszevt fu  }he ne}ht }; hapos(ds xtDocId s 0n(dios(dDoc r CotuMirrg);Doc r fcm);}, 2teng,dmetu,  x, lLitt) lLeft(;
  ! anistitstaeceobeDoc.ctlt(e);
n   Doc"teng,dmetu,  x, lLitt);Left(;
   x, lLitter= || ()*fx, lLitter 0;" onFoBranchChunk.ctll2racm.d[s   xeafChunk([s   xt, l"",a    )])])mouscmanis.fx, l r fx, lLittmouscmanis.oc = "Top*lianis.oc = "Leftfs 0n(diapanis.cantEdil r f } er    vanis.ce).nGen(e)) do = 1 handlanis.frvarie++  fx, lLittmouscmos(d }
r(e) (doc x, lLitt,d0)mouscmanis.selnmns;mpleSele);}, 2 }
r()mouscmanis.mistoryp= n   History(|| ()ce   vanis.id s ++s xtDocIdce   vanis.metuO cm,  limetu;" onFoi     ifibeoeng =iv"sate.f") t (! =u
p(ctLitts(p (!) handlr, "moDoc"racm.d{f   :  }
r(,dto:  }
r(,dt (!:uteng})evt fusetSele);}, 2racm.ds;mpleSele);}, 2 }
r().dsel_dvarSc = ");ht }; hapDoc. coto docl   ocataObj(BranchChunk. coto doc, {    vconsatuctor:)Doc, onFopenIt(e))e averafu n)-1uethe. Sup| r(s twolformsp-- with onlypone onFopenCrguetheaail ctllsft
at f ++ec  pgutteinafu n)-1uethe. Withhapvipeno
reeaail it(e))es averafu nrcm, fgionn
by
t
  fx, l twol(withhapvipeno
e stcond*beeleenen-itclusion). ape it(e:)fcm);}, 2o   , to,"E ct{    vcm;
  E i anis.it(eN2f    -manis.fx, l,lt)c- o   , op the ne  orSizanis.it(eN2anis.fx, l,ltnis.fx, l +(anis.s;
 , ;   )ce   v}, hapvipenNen-publecuinntefaceffEveadde.faatoS+=L /e.far, as. onFoitsert:)fcm);}, 2a!, guttsihead.lineos(dmeft);l=
 =e.getvv; ++i) {
     = viewgutts.l.ranges++[i meft);l+=eguttshor.meft);; onFo vanis.itsertInner2a! -manis.fx, l,lgutts, hze(); ce   v}, onFo+=L //:)fcm);}, 2a!, nct{manis.+=L //Inner2a! -manis.fx, l,ln);v}, hapvipenF    s te,
t
  mrthods aha p
r(robet
e  ublecuinnteface. Most onFopenCreta} oravailableuf    CotuMirrg) (edilor)titstaeces. hapvigetValu;:)fcm);}, 2r, aSee.head.lineos(dr, as*li(text, s2racm.danis.fx, l,ltnis.fx, l +(anis.s;
 ) handle i   guttSee =ir f } e)blt(e);
guttstht >=e lt(e);
gutts.join guttSee ||u"\n" ce   v}, onFosetValu;:))-1MrthodOp(t
      eloen(cead.lineos(dtop*li(docanis.fx, l,l0),     *lianis.fx, l +(anis.s;
  -d1ea, fufumako (cm, "racm.d{f   : top,dto: (doc    ,t(text, "racm.d    ).t (!el.rang),handle e( lllllllllllllllt (!:u
p(ctLitts(loen(/ Evigin:v"setValu;"}r)pe ==;extend(setSele);}, 2racm.ds;mpleSele);}, 2tot).ce   v}), onFo+=l_mouRcm, :)fcm);}, 2cetu,     , to,"Eviginct{    vcmfmatc= flip(docanis, ;   )ce   v lt)c= t)c?tflip(docanis, t))w:     ;    vcm+=l_mouRcm, canis, cetu,     , to,"Evigincce   v}, onFo(teRcm, :)fcm);}, 2    , to,"r, aSee.head.lineos(dr, as*li(teBetweencanis, clip(docanis, ;   ), clip(docanis, t))) handle i   guttSee =ir f } e)blt(e);
guttstht >=e lt(e);
gutts.join guttSee ||u"\n" ce   v},  onFo(teLitt:)fcm);}, 2r, a.heos(dr*lianis.(teLittH);
  lr, a)m lt(e);
gcnpul.t (! },  onFo(teLittH);
  :)fcm);}, 2r, a.he, d.isxt, "racm.d itt))blt(e);
(text, "racm.d , a)m}, onFo(text, Numbut:)fcm);}, 2r, a.he+= out)r, aNolr, a) },  onFo(teLittH);
  VisuPoSew c:)fcm);}, 2r, a.hehandle i   a ifibelitter= "numbut")dgutter (text, "racm.d , a)mht >=e lt(e);
tisuPoxt, lr, a)evt fu},  onFor, aCnunt:)fcm);}, 2));+= out)anis.s;
 ;}, onFo x, lLitt:)fcm);}, 2));+= out)anis. x, l;}, onFo    Litt:)fcm);}, 2));+= out)anis. x, l +(anis.s;
  -d1e},  onFoclip(do:)fcm);}, 2| c));+= out)clip(docanis, | c);},  onFo(teCursot:)fcm);}, 2 }
r() ead.lineos(drcm, ficanis.sel. cimary(),d| c handle i    }
r(e)s || (brma
}
r(e)s "head")d| clicrcm, .headthe ne  orSizi    }
r(e)s "anchor")d| clicrcm, .anchorthe ne  orSizi    }
r(e)s "end"brma
}
r(e)s "to"brma
}
r(e)sr f } e)b| clicrcm, .to( the ne  orSiz| clicrcm, .;   ()mht >=e lt(e);
| c;exten}, onFo istSele);}, s:)fcm);}, 2));u+= out)anis.sel.rcm, s;=}, onFosomaaningSele);ed:)fcm);}, 2));+= out)anis.sel.somaaningSele);ed();},  onFosteCursot:))-1MrthodOp(t
      er, a/ ch lE cm, scti", fud(setS;mpleSele);}, 2tnis, clip(docanis, a ifibelitter= "numbut"c?t(doc , a/ chc||u0)f: gutt),d    , , cm, l)evt fu}), onFosetSele);}, :))-1MrthodOp(t
      eanchor, hzad lE cm, scti", fud(setS;mpleSele);}, 2tnis, clip(docanis, anchor), clip(docanis, hzadc||uanchor), , cm, l)evt fu}), onFo (!ardIele);}, :))-1MrthodOp(t
      ehzad lEes t lE cm, scti", fud( (!ardIele);}, 2tnis, clip(docanis, hzad) lEes t*npuclip(docanis, Ees t), , cm, l)evt fu}), onFo (!ardIele);}, s:))-1MrthodOp(t
      ehzads lE cm, scti", fud( (!ardIele);}, s2tnis, clip(doArrticanis, hzads lE cm, sc)evt fu}), onFo (!ardIele);}, sBy:))-1MrthodOp(t
      ef lE cm, scti", fud( (!ardIele);}, s2tnis, ma 2anis.sel.rcm, s, ;), , cm, l)evt fu}), onFosetSele);}, s:))-1MrthodOp(t
      ercm, s,  cimary lE cm, scti", fud(;
  !rcm, sel.rang(c+= outside;
  f ++i) {
     , oue Y [r  viewrcm, sel.ranges[i].handle e(ouehorfl n   Rcm, cclip(docanis, rcm, shor.anchor),handle e( lllllllllllllllnFoclip(docanis, rcm, shor.hzad)) handle i    cimaryer= || ()* cimaryeruMathomin(rcm, sel.rang(- 1,lanis.sel. cimItorS=;extend(setSele);}, 2racm.dnormal;
 Sele);}, 2oue,  cimary), , cm, l)evt fu}), onFoaddSele);}, :))-1MrthodOp(t
      eanchor, hzad lE cm, scti", fud(os(drcm, sficanis.sel.rcm, ses(clif0)mht >=e lcm, seectios   Rcm, cclip(docanis, anchor), clip(docanis, hzadc||uanchor))=;extend(setSele);}, 2racm.dnormal;
 Sele);}, 2rcm, s, rcm, sel.rang(- 1), , cm, l)evt fu}),  onFo(teSele);}, :)fcm);}, 2r, aSee.head.lineos(drcm, sficanis.sel.rcm, s,
guttstht >=e ; ++i) {
     = viewrcm, sel.ranges[i].); onFoeIdlos(d elnmn(teBetweencanis, rcm, shor.;   (), rcm, shor.to( )ce   vd.lir, as*liguttct? gutts.mvacat2 el)f:  elevt fu  }he ne  i   guttSee =ir f } e)blt(e);
guttstht >=e orSizlt(e);
gutts.join guttSee ||u"\n" ce   v}, onFogetSele);}, s:)fcm);}, 2r, aSee.head.lineos(dp
r(s ou[r,
rcm, sficanis.sel.rcm, stht >=e ; ++i) {
     = viewrcm, sel.ranges[i].); onFoeIdlos(d elnmn(teBetweencanis, rcm, shor.;   (), rcm, shor.to( )ce   vd.lii   guttSee !ir f } e)bselnmnsel.join guttSee ||u"\n" ce   vvvvvp
r(shorfl  elevt fu  }he ne  lt(e);
|
r(sce   v}, onFo+=l_mouSele);}, :)fcm);}, 2cetu, cnllaps;,"Eviginct{    vcmos(duupomn[r handle f ++i) {
     = viewanis.sel.rcm, sel.ranges[i].handle e(uuphorfl coenr    v manis.+=l_mouSele);}, s(uup, cnllaps;,"Evigin ||u"+input" ce   v}, onFo+=l_mouSele);}, s:))-1MrthodOp(t
      eloen, cnllaps;,"Eviginct{    vcmos(dch, cms ou[r,
selnmnanis.sel handle f ++i) {
     = viewsel.rcm, sel.ranges[i].); onFoeIdlos(drcm, ficsel.rcm, shor handle e(ch, cmshorfl {f   : rcm, .;   (),dto: rcm, .to( ,lt (!:u
p(ctLitts(loen[ir),dEvigin:vEvigin}evt fu  }he ne  os(ds  Selnmncnllaps;enpucnllaps;e!s "end"bnpucnmnutuR=l_moudSel2tnis, chcm, s,
cnllaps;)r    vvv; ++i) {
    chcm, sil.rang -d1esie>=l = v--.handle e(mako (cm, "racm.dch, cmshorctht >=e i   n  Sel)(setSele);}, R=l_mouHistory(racm.dn  Sel)the ne  orSizi   anis.cm) e  varCursotVisibl "anis.cm)evt fu}), onFoundo:))-1MrthodOp(t
      e.);mako (cm, F   History(racm.d"undo" c}), onFo+=do:))-1MrthodOp(t
      e.);mako (cm, F   History(racm.d"+=do" c}), onFoundoSele);}, :))-1MrthodOp(t
      e.);mako (cm, F   History(racm.d"undo"r)pe ==;}), onFo+=doSele);}, :))-1MrthodOp(t
      e.);mako (cm, F   History(racm.d"+=do"r)pe ==;}),  onFosetE(!arding:)fcm);}, 2val)w tnis. (!ard   valm}, onFo(teE(!arding:)fcm);}, 2));+= out)anis. (!ard;},  onFomistoryS;
 :)fcm);}, 2));ad.lineos(dmi  *lianis.mistory, )-n nmn , undotter 0;"andle f ++i) {
     = viewmist.dottel.ranges[i].);
  !mist.dotthor.rcm, s) ++dott;"andle f ++i) {
     = viewmist.undottel.ranges[i].);
  !mist.undotthor.rcm, s) ++undottmht >=e lt(e);
{undo:))- a/ +=do:)undott}ce   v}, onFoce).rHistory:)fcm);}, 2));anis.mistoryp= n   History(anis.mistoryimaxGen(e)) do);},  onFomarkCe).n:)fcm);}, 2));ad.lineanis.ce).nGen(e)) do = anis.chcm, Gen(e)) do(pe ==;exten}, onFochcm, Gen(e)) do:)fcm);}, 2 orcaSp(ctcti", fud(;
   orcaSp(ctchandle e(anis.mistoryi    Op*lianis.mistoryi    SelOp*lianis.mistoryi    Ovigin ounSpace.get= += out)anis.mistoryigen(e)) doce   v}, onFoisCe).n:)fcm);},  (gen.head.line+= out)anis.mistoryigen(e)) doer= (gen ||uanis.ce).nGen(e)) do ce   v},  onFo(teHistory:)fcm);}, 2));ht >=e lt(e);
{dott: mvpyHistoryArrticanis.mistoryidott),handle e( lllllundott: mvpyHistoryArrticanis.mistoryiundott)}ce   v}, onFosteHistory:)fcm);}, 2mistData));ad.lineos(dmi  *lianis.mistoryp= n   History(anis.mistoryimaxGen(e)) do);ad.linemist.dott Y mvpyHistoryArrticmistData.dottes(clif0),d    , te ==;extend(mist.undott Y mvpyHistoryArrticmistData.undottes(clif0),d    , te ==;exten},  onFoaddLittCeass:))-1MrthodOp(t
      eh);
  , wh te,
cls));ht >=e lt(e);
chcm, xt, "racm.dh);
  , "meass",)fcm);}, 2r, a.hehandle fuos(d coner wh tee)s "t (!"c?t"oengCeass"f: wh tee)s "bdckgr )
 " ?i"bgCeass" : "wrapCeass"evt fu  fu, d.!gutt[ con]) gutt[ con]c= flstht >=e   orSizi   s   RegExp("(?:^|\\s)" + fls + "(?:$|\\s)")turn fgutt[ con]))blt(e);
  } er    vvvFoorSizgutt[ con]c+= a " + flstht >=e   +=(e);
an pr"keydd.})evt fu}), onFo+=L //LittCeass:))-1MrthodOp(t
      eh);
  , wh te,
cls));ht >=e lt(e);
chcm, xt, "racm.dh);
  , "meass",)fcm);}, 2r, a.hehandle fuos(d coner wh tee)s "t (!"c?t"oengCeass"f: wh tee)s "bdckgr )
 " ?i"bgCeass" : "wrapCeass"evt fu  fuos(d teeougutt[ con]evt fu  fu, d.! te)blt(e);
  } er    vvvFoorSizi   mls*l=r|| ()*gutt[ con]c= nSpace.get=  eorSize.top ? -2ewos(d; )
 c= fur.mtnchfs   RegExp("(?:^|\\s+)" + fls + "(?:$|\\s+)").
    vcmcmfu;
  !; )
 )blt(e);
  } er    vvvFodlos(dardeou; )
 tctorS + ; )
 [0]il.rangr    vvvFodlgutt[ con]c= fur.
(clif0,lf )
 tctorS)t+  !; )
 tctorS rmae
 *l=rfur.l.rang ?v""c: a ")t+ fur.
(clifard)*rmanSpace.get=  e}ht >=e   +=(e);
an pr"keydd.})evt fu}),  onFomarkT (!:ufcm);}, 2o   , to,"E cm, scti", fud(+= out markT (!canis, clip(docanis, ;   ), clip(docanis, t)),"E cm, s.d"+, cm" ce   v}, onFosetBookmark:)fcm);}, 2| c lE cm, scti", fud(os(drealOp(s ou{+=l_moudWith:lE cm, sbnpu(E cm, linetuTdoc ms || (b? , cm, liwi (tef:lE cm, s),handle e( lllllllllllllitsertLeft:lE cm, sbnpu, cm, liitsertLeft,handle e( lllllllllllllce).r// hEmpty:)f } e,
shared:)E cm, sbnpu, cm, lishared}evt fu  | clicclip(docanis, | c);", fud(+= out markT (!canis, | c,n| c,drealOp(s, obookmark" ce   v}, onFof toMarksAt:)fcm);}, 2| c));vt fu  | clicclip(docanis, | c);", fud(os(dmarkurs ou[r,
st(ns*li(text, "racm.d| cor, a).markunSt(ns handle i    t(nsctf ++i) {
     = viewst(nsil.ranges++[i ead.lineneos(dst(n r  t(nshi]evt fu  fu, d.  t(n.;matcl=r|| (brma
t(n.;matc<) | coth)tnp    vcmcmcm    t(n.toc=s || (brma
t(n.toc>) | coth)i    vcmcmcmmarkurseectio
t(n.mtrke .|arenterma
t(n.mtrke )evt fu  }he ne  += out markersce   v}, onFof toMarks:ufcm);}, 2o   , to,"filte+) lLeft(cmfmatc= flip(docanis, ;   )clt)c= flip(docanis, t));", fud(os(d; )
 c= [], guttNoeou;   or, a;", fud(anis.it(eWf   or, a, toor, an+ 1, fcm);}, 2r, a.hehandle fuos(dst(ns*ligutt.markunSt(nsevt fu  fu, d. t(nsctf ++i) {
     = viewst(nsil.ranges[i].head.line vcmos(dst(n r  t(nshi]evt fu  fut(;
  ! guttNoeoou;   or, a)npu;   othc>a
t(n.tocrmhandle            t(n.;matcl=r|| (bnpuluttNoe!ou;   or, armhandle           guttNoeooutoor, annpu;t(n.;matc> tooch)tnp    vcmcmcm  cm(!filte+ermafilte+o
t(n.mtrke )))    vcmcmcmcm; )
 tectio
t(n.mtrke .|arenterma
t(n.mtrke )evt fu   e}ht >=e   ++guttNor"keydd.})evt fut(+= out)f )
 ce   v}, onFogetAllMarks:ufcm);}, 2cti", fud(os(dmarkurs ou[r;", fud(anis.it(eWfcm);}, 2r, a.hehandle fuos(dsts*ligutt.markunSt(nsevt fu  fu, d. tsctf ++i) {
     = viewstsil.ranges++[ivt fu  fut(;
  stshor.;   c!=r|| ()mmarkurseectio
tshor.mtrke )evt fu  });", fud(+= out markersce   v}, e   v| cF   ItorS:ufcm);}, 2offct{    vcmos(dch, guttNoeouanis. x, l;", fud(anis.it(eWfcm);}, 2r, a.hehandle fuos(dsz =ur, a.t (!.l.rang + 1mouscmcmfu, d.sz > offct{dchc=woff; +=(e);
an pre}ht >=e   offl-=lszevt fu    ++guttNor"keydd.})evt fut(+= out)flip(docanis, (doc , aNo.dch) ce   v}, onFoctorSF   (do:)fcm);},   meordc));vt fu  meordcc= flip(docanis, meordc);", fud(os(ditorS ) meordcoch handle i   meordcor, an<)anis. x, l rmafnordcochiew0)(+= out)0;", fud(anis.it(eWanis.fx, l,lmeordcor, a,)fcm);},   r, a.hehandle fuctorS +=ur, a.t (!.l.rang + 1mouscmcm})evt fut(+= out)ctorSce   v}, e   vmvpy:)fcm);}, 2cepyHistoryct{    vcmos(duoc r n   Doc"(text, s2racm.danis.fx, l,ltnis.fx, l +(anis.s;
 ),vanis.metuO cm, ,ltnis.fx, l)tht >=e c-1)oc = "Top*lianis.oc = "Top; c-1)oc = "Leftfs anis.oc = "Lefttht >=e c-1)oelnmnanis.sel handle c-1) (!ard     } er    vvvi   mepyHistoryct{    vcme c-1)mistoryiundoDepng =dtnis.mistoryiundoDepng;    vcme c-1)steHistory(anis.(teHistory())evt fu  }he ne  += out c-1ce   v}, e   vr, kunDoc:ufcm);}, 2o cm, scti", fud(;
  !o cm, sctE cm, sb  {}ce.getfuos(d;matc= anis.fx, l,lt)clianis.fx, l +(anis.s;
 r    vvvi   , cm, li;   c!=r|| (bnpu, cm, li;matc> ;mat)c;matc= , cm, li;matr    vvvi   , cm, lit)c!=r|| ()npu, cm, lit)c< t))wt)cli, cm, lit)ce.getfuos(dcopyp= n   Doc"(text, s2racm.do   , to),"E cm, s.metu ||uanis.metuO cm, ,l;   )ce   v li   , cm, lisharedHist)ecopy.mistoryp= tnis.mistoryce   v l2anis.r, k;d)rma2anis.r, k;d)  []))eectio{doc:ucopy,dsharedHist: , cm, lisharedHist})evt fut(copy.r, k;d)  [{doc:uracm.disParent:
an p,dsharedHist: , cm, lisharedHist}]evt fut(copySharedMarkursemepy,df toSharedMarkurseracm).
    vcm+= out mvpy handl}, onFounr, kDoc:ufcm);}, 2oes t)t{    vcm;
  Ees t
itstaeceobeCotuMirrg))lEes t*=lEes t.c-1ce   ve i   anis.r, k;dctf ++i) {
     = viewanis.r, k;dil.ranges++[i ead.lineneos(dr, k =wanis.r, k;dhi]evt fu  fu, d.r, k.c-1c!=roes t)tmvarin pr"keydd.lianis.r, k;disp(clifi,d1)tht >=e  lEes t.unr, kDoceracm);    vcme cetachSharedMarkursef toSharedMarkurseracm).
    vcmdlbreakevt fu  }he ne  penIbethe+mistories w te shared/ 
p(ctgthemcagain    vcm;
  Ees t.mistoryp== tnis.mistory.hehandle fuos(dst(ctIdcc= [Ees t.id]evt fu  fur, kunDocs(Ees t lfcm);}, 2c-1.hest(ctIdceectioc-1)id);}, te ==;extend( lEes t.mistoryp= n   History(|| ()ce   vd.liEes t.mistory.dott Y mvpyHistoryArrticanis.mistoryidott,dst(ctIdc)ce   vd.liEes t.mistory.undott Y mvpyHistoryArrticanis.mistoryiundott,dst(ctIdc)ce   vd.}he ne}, onFoit(eL, kunDocs:ufcm);}, 2o.her, kunDocs(racm.do);},  onFo(teMoen:)fcm);}, 2));+= out)anis.metu;}, onFo(teEdilor:)fcm);}, 2));+= out)anis.cmeue  })ev
dog pPublecualias. onDoc. coto doc.ec  Litter Doc. coto doc.it(eev
dog pSet up+mrthods ,  CotuMirrg)'s
pcoto doclpo redirdge to  se edilor's
)-1uethe. apos(duontDeleg))e = "it(elitserto+=L //dcopyp(teEdilor".
p(ct a ")ce  f ++i) {
 conein Doc. coto doc.);
  Doc. coto doc.hasOwnPcon(ety( con)bnpuctorSOf(uontDeleg))e,  con)b< 0m    vCotuMirrg); coto doc[ con]c= Wfcm);}, 2mrthodcti", fud(+= out fcm);}, 2));+= out)mrthod.apply(anis.)-1,lCrguethec);}evt fu}) Doc. coto doc[ con])ev
doevtheMixin Doc)ev
dog pCall
fffEveallur, kun
)-1uethes.
apllingFastr, kunDocs()-1,lf,dsharedHistOnly.hehandlllingFast conag"mo")-1,lskip,dsharedHist)t{    vcm;
  c-1)r, k;dctf ++i) {
     = viewc-1)r, k;dil.ranges++[i ead.lineneos(drelnmnc-1)r, k;dhi]evt fu  fu, d.rel.c-1c== skip)tmvarin pr"keydd.lios(dshared r  haredHistbnpurel. haredHistmouscmcmfu, d.sharedHistOnly npu!shared)tmvarin pr"keydd.lif.rel.c-1,dshared ce   vvvvvpconag"mo"rel.c-1,dc-1,dshared ce   vvv}he ne}hcmfu conag"mo")-1,l    , te ==;ext} happenAttach a )-1uetheSto an edilor.
apllingFastattachDoce.g, c-1.he
 vcm;
  c-1)cm) throw n   Errg)("Tnis )-1uetheSis alreadyein use." ce   vc);soc r c-1ce   vc-1)ctcY mtr    vestimahuLittHze();sl.g ce   vloadMoenl.g ce   v, d.! te, cm, lir, aWo en   )of toMaxxt, ".g ce   v te, cm, limetu mnc-1)metuO cm, ce   vreg (cm, ".g ce  } happenLINE UTILITIES happenF toSt
e r, anobjdge correspording to  se gionn
r, annumbut.
apllingFast(text, l)-1,ln.head.linl-=lc-1) x, l;", fui   sb< 0*rmanc>) c-1)s;
 ) throw n   Errg)("Tn te is no r, a " + (ne+uc-1) x, l) + a inafu n)-1uethe." ce   vf ++i) {
chunkfr c-1c !chunk.r, as;.head.linef ++i) {
     =es++[i ead.lineneos(dcentR*lichunk.chntRrenhor,dszc=wchntR.m(unkS;
 ();    vcmcm;
  nc< sz)* 
chunkfr chntR; breakee}ht >=e   nl-=lszevt fu  }he ne}ht e lt(e);
chunk.r, as[n]ce  } happenGet t
e  
rtpobea )-1uetheSbetweenetwolposicm, s.d)s an
arrti ibhappensate.fs.
apllingFast(teBetweencc-1,ds}
r(,dard)*ead.lios(doue Y [], n r  }
r(or, a;", fuc-1)ite+o
}
r(or, a,dardor, an+ 1, fcm);}, 2r, a.hehandle os(dt (! =ur, a.t (!ce   ve i   oer= ardor, a)et (! =utengi
(clif0,dardoch)ce   ve i   oer= 
}
r(or, a)et (! =utengi
(clif
}
r(och)ce   ve oueeectiop (!) handle ++oce   v});ht e lt(e);
outce.g}happenGet t
e guttctbetweene;matcatoSph.d)s arrti ibesate.fs.
apllingFast(text, s2)-1,lf   , t))wead.lios(doue Y [];", fuc-1)ite+oo   , to,"fcm);}, 2r, a.he oueeectior, a.t (!);v});ht e lt(e);
outce.g}hhappenU, "molthe+meft);libea gutt,  conag"melep se meft);lchcm, happenupwardccto  
rentenetus.
apllingFastr, "moLittHze();c , a/ hze();  lLeft(os(duiffb= meft);n-lgutt.meft);mouscm;
  ciffctf ++i) {
n =ur, a; n= n oun.|arent))n.meft);l+=
ciffce  } happenGionn
aSr, a objdge,af toSits
r, annumbut
by
walkele up+t
rough
vipenits
|arenter, ks.
apllingFastr, aNolr, a)he
 vcm;
  gutt.|arenteos || ())+= outanSpace.getos(d teeougutt.|arent.dno ) ctorSOf(fur.lin s,
gutt ce   vf ++i) {
chunkfr fur.|arent 
chunk;d teeouchunk,
chunkfr chunk. arent));ad.linef ++i) {
     =es++[i ead.linenei   mhunk.chntRrenhor*l=rfurm breakevt fu    no +lichunk.chntRrenhor.m(unkS;
 ();    vcm}he ne}ht e lt(e);
no + fur. x, l;", } happenF toSt
e r, anatp se gionn
verticallposicm, , uselep se meft);
vipeninform)) doeinafu n)-1uethe+tree. apllingFastr, aAtHze();cchunk,
h) ;handlos(dnfr chunk. x, l;", fuoutet:))-t{    vcmf ++i) {
     = viewchunk.chntRren.l.ranges++[i ead.lineneos(dcentR*lichunk.chntRrenhor,dchc=wchntR.meft);mouscmcmfui   hiewch)* 
chunkfr chntR; mvarin puoutetee}ht >=e   hl-=lcg;    vcme n +lichntR.m(unkS;
 ();    vcm}he ne  += out oce   v}twhicur(!chunk.r, as ce   vf ++i) {
     = viewchunk.gutts.l.ranges++[ihead.lineos(dgutter chunk.r, as[or,dlh =lgutt.meft);mouscmcmi   hiewlhm breakevt fu  hl-=llg
    vght e lt(e);
n + i;", } hhappenF toSt
e meft);lab //eo
  gionn
r, a. apllingFastmeft);Atxt, lr, aObj)* extenr, aObj   visuPoxt, lr, aObj);ehandlos(dhnmn , chunkfr r, aObj.|arent handlf ++i) {
     = viewchunk.gutts.l.ranges++[ihead.lineos(dgutter chunk.r, as[ormouscmcmi   litter= r, aObj)*breakevt fu  orSizh +=ur, a.meft);; onFo}    vf ++i) {
 fr chunk. arent; p; chunkfr p,d fr chunk. arentct{    vcmf ++i) {
     = viewp.chntRren.l.ranges++[i ead.lineneos(dcteeoup.chntRrenhormouscmcmfui   cteeor chunkm breakevt fu    orSizh +=ufur.meft);mouscmcm}he ne}ht e lt(e);
hce  } happenGet t
e bidiaEvde+elepf ++ se gionn
r, an(atoScache it). Rt(e);sase a   } epf ++guttctt
at Cretf   y reft-to-re();,datoSan
arrti ibhappenBidiSt(n objdges Ees twise.
apllingFast(teOvde+lr, a)he
 vcmos(dovde++=ur, a.ovde+mouscm;
  ovde++=s || ())ovde++=ur, a.ovde++=ubidiOvde+eleor, a.t (!);ht e lt(e);
ovde+mous} happenHISTORY hapflingFastHistory(
}
r(Gen.head.lipenArrtisfib m(cm, fevthes atoSsele);}, s. Doelepsomaaningoadds atad.lipenevthecto dott atoSce).rslundo. UndoingoL //sfevthes ;matcdone onFopento undott,d+=doingoL //sfthemcinafu nEes t*dirdge}, . onFoanis.)-tter [r  anis.undott Y [];", fuanis.undoDepng =dInfinity handlpenUfunft)ctrack+et
;
chcm, sScan*be mergunfinto a singlt undoad.lipenevthe", fuanis.    MoeTimeeouanisi    SelTimeeou0n(diapanis.    Op*lianis.    SelOp*linSpace.getanis.    Ovigin ouanis.    SelOvigin ounSpace.getpenUfunfby
t
  isCe).n())mrthode.getanis.gen(e)) do = anis.maxGen(e)) do r  }
r(Gen ||u1mous} happenCocata a mistorypm(cm, fevthee;matcatlr, "moDoc-neyln chcm, happenobjdge. apllingFastmistory (cm, F    (cm, ")-1,lch, cm );handlos(dmi  C(cm, fic{f   : copy(docfh, cm.f   ),dto: fh, cmEndcfh, cm ,lt (!:u(teBetweencc-1,dfh, cm.f   ,lfh, cm.to)}ce   vattachLocalSt(nscc-1,dmi  C(cm, ,dfh, cm.f   or, a,dch, cm.toor, an+ 1 ce   vl, kunDocs()-1,lfcm);}, 2c-1.heattachLocalSt(nscc-1,dmi  C(cm, ,dfh, cm.f   or, a,dch, cm.toor, an+ 1 c}, te ==;extenlt(e);
hi  C(cm, mous} happenPopeallusele);}, fevthes offl se etoSibea mistoryparrti. Stop*a;
vipenapm(cm, fevthe. apllingFastce).rSele);}, Evthes(arrti );handlwhicur(arrti.l.rang(cead.lineos(dg   *lirn farrti mouscmcmi   l   .rcm, s) arrti.pop( the ne  orSizbreakevt fu}hcm}""dog pF toSt
e toppm(cm, fevtheeinafu nmistoryinPopeofflsele);}, 
lipenevthectt
at Cretinafu nwti. apllingFastra  C(cm, Evthecmist,lf rca)he
 vcm;
  f rca)he
 vcm tce).rSele);}, Evthes(mist.dott.
    vcm+= out rn fmist.dott.
    v}u.viewi   mist.dott.l.rang npu!rn fmist.dott..rcm, s) {    vcm+= out rn fmist.dott.
    v}u.viewi   mist.dott.l.rang > 1bnpu!mist.dott[mist.dott.l.rang - 2].rcm, s) {    vcmmist.dott.pop( the ne  += out rn fmist.dott.
    v}hcm}""dog pRegisteraa m(cm, finafu nmistoryinMergus
chcm, sSt
at Cretwithin
vipenapsinglt on(eacm, ,  rn CretcloSizaog
es t
with (n ovigin t
at
vipenallows mergingo(
}
r(ingowith "+")finto a singlt evthe. apllingFastaddC(cm, ToHistory()-1,lch, cm,dselAft t lE Id );handlos(dmi   mnc-1)mistoryce   vmist.undottel.rangc=u0n(diapos(dtimeeou+n   D))e, fur;" onFoi   fmist.    Op*l=lE Idcrmhandle    mist.    Ovigin o=uch, cm.ovigin npuch, cm.ovigin nphandle    ((ch, cm.ovigin.chcrAt(0)fi) "+" npuc-1)ctcnpumist.    MoeTimee>dtimee-uc-1)cte, cm, limistoryEvtheDelti )rmhandle     ch, cm.ovigin.chcrAt(0)fi) "*"))tnp    vcmcm( teeouga  C(cm, Evthecmist,lmist.    Op*l=lE Id) )e; onFoeIg pMergu anis m(cm, finto  se g   *evthe", funeos(dg   *lirn ffur.chcm, s mouscmcmi   cmp(fh, cm.f   ,lfh, cm.to)c=s 0cnpucmp(fh, cm.f   ,ll   .to)c=s 0i ead.lineneg pO cmm;
 oSca epf ++s;mplelitsertFast--uc-n'tnwtheSto addad.lineneg pn   chcm, stes f ++everypm(cractera docdad.linenel   .to = fh, cmEndcfh, cm mouscmcm}eorSize.top ? -2penAddpn   sub-evthe", fune  fur.chcm, seectiomistory (cm, F    (cm, ")-1,lch, cm );    vcm}he ne}eorSize.top ? g pCa;
not*be mergun,  }
r(napn   evthe. apfuneos(dban be*lirn fmist.dott.
    vcm, d.!ban be*rma!ban be.rcm, s)", fune  ectiSele);}, ToHistory()-1.sel, mist.dott.
    vcm teeou{chcm, s: [mistory (cm, F    (cm, ")-1,lch, cm ],handle e( llllgen(e)) do:)mist.gen(e)) do}ce.getfumist.dott.pctiofurmce.getfuwhicur(mist.dott.l.rang > mist.undoDepngi ead.linenemist.dott.shift();    vcmcm;
  !mist.dott[0].rcm, s) mist.dott.shift();    vcm}he ne}ht e mist.dott.pctioselAft t)ce   vmist.gen(e)) do = ++mist.maxGen(e)) doce   vmist.    MoeTimeeoumist.    SelTimeeoutimece   vmist.    Op*limist.    SelOp*liE Idce   vmist.    Ovigin oumist.    SelOvigin ouch, cm.ovigin;" onFoi   !    )un
    ()-1,l"mistoryAdd;d" ce  } hapflingFast
ele);}, EvtheCa;BeMergud()-1,lovigin,  cev,dsel );handlos(dchc=wovigin.chcrAt(0);extenlt(e);
chc=s "*")rmhandle chc=s "+"cnp    vcm cev.rcm, sel.ranger= 
el.rcm, sel.rangcnp    vcm cev.somaaningSele);ed()er= 
el.somaaningSele);ed()enp    vcmn   D))ee-uc-1)mistoryi    SelTimee<=  c-1)cm ?uc-1)cte, cm, limistoryEvtheDelti : 500 ce  } happenCall oSet
;everafu nsele);}, fchcm, s,
stes o
  n   sele);}, f)sase a t
e  arding sele);}, finafu nmistory,datoSpcti/sfthelold  ardingase a sele);}, finto  se 'dott'
arrti et
;
itnwtsun
  ificantlyase a cifferente(innnumbut
oflsele); oSrcm, s,
em cmnesc lE(dtime). apllingFastaddSele);}, ToHistory()-1,dsel lE Id lE cm, scti", fuos(dmi   mnc-1)mistory,"Evigin =)E cm, sbnpu, cm, liovigin;" onFopenApn   evthe is s}
r( oSet
; t
e  cevious"Evigin does
not*mtnch onFopent
e furrent.d ++ se Eviginsuc-n'tnallow*mtnchele. Ovigins onFopen
}
r(ingowith *nCreta}wtis mergun, thosen
}
r(ingowith +nCre onFopenmergunfet
; s;mil {
atoSceoSizaog
es t
inafime.ouscm;
  o Idc=limist.    SelOp*rmhandle   (ovigin npumist.    SelOvigin o=wovigin nphandle    (mist.    MoeTimeeooumist.    SelTimeenpumist.    Ovigin o=wovigin rmhandle     
ele);}, EvtheCa;BeMergud()-1,lovigin, rn fmist.dott.,dsel )))    vcmmist.dott[mist.dott.l.rang - 1rfl  elevt fuorSi    vcm ctiSele);}, ToHistory(sel, mist.dott.
 e   vmist.    SelTimeeou+n   D))e;e   vmist.    SelOvigin ouovigin;"   vmist.    SelOp*liE Idce   vi   , cm, lbnpu, cm, lice).rRedo !ir f } e)
 vcm tce).rSele);}, Evthes(mist.undott)ce  } hapflingFast ctiSele);}, ToHistory(sel, des;  lLeft(os(dtop*lirn fdes; ce   v, d.!2totbnputot.rcm, sbnputot.equ } (sel ))
 vcm tdes;.pctiosel ce  } happenUfunft)cstoreimarkundst(n inform)) doeinafu nmistoryi
apllingFastattachLocalSt(nscc-1,dch, cm,df   , t))wead.lios(dexistelepouch, cm[" t(ns_"e+uc-1)id], n r 0;", fuc-1)ite+oMathomax(c-1) x, l, ;   ), Mathomin(c-1) x, le+uc-1)s;
 , to),"fcm);}, 2r, a.hehandle i   gutt.markunSt(ns)", fune  (existeleprma2existelepouch, cm[" t(ns_"e+uc-1)id]b  {}))hn] ligutt.markunSt(nsevt fu  ++oce   v});ht } happen// hrun/re-doingorestoreset (! mvarainelepmarkundst(ns, thosease a t
at h)vi beeneexp(clitlytce).rundshoutR*not*be restoredi
apllingFast+=L //Ce).runSt(nscst(nsct{    v, d.!st(nsct+= outanSpace.getf ++i) {
     , oue= viewst(nsil.ranges++[i ead.line, d. t(nshor.mtrke .exp(clitlyCe).run)* 
;
  !ou;  oue Y st(nsi
(clif0,di)ee}ht >=e .viewi   ou;  ouetectio
t(nshorctht >=}ht e lt(e);
!ou; ?ust(ns*: ouetl.rang ?vou; :unSpace.g} 
apg pRetrievt
atoSfilte+ethelold markundst(nscstorenfinnapm(cm, fevthe. apllingFast(teOldSt(nscc-1,dch, cm)wead.lios(d; )
 c= fh, cm[" t(ns_"e+uc-1)id]ce   v, d.!; )
 )blt(e);
nSpace.getf ++i) {
     , nw Y [r  viewch, cm.t (!il.ranges++[ivt fu  nwtectio+=L //Ce).runSt(nsc; )
 [orc);extenlt(e);
nwce  } happenUfunfbong thaprovida a JSON-safanobjdge inn.(teHistory,dato, wh n
vipencetachingoan)-1uethe,lt)c
p(ctgthe mistorypinetwo apllingFastcvpyHistoryArrticevthec.dn  Group, itstaeti))eSel );handlf ++i) {
     , copyp= [r  viewevthec.l.ranges++[ihead.lineos(devthe =wevthec[ormouscmcmi   evthe.rcm, s) {    vcmnecopy.|ctioitstaeti))eSel ?vSele);}, . coto doc.deepCopy.ctll2evthe)f: evthe);    vcmnecoarin pr"keydd.}he ne  os(dch, cms ouevthe.chcm, s,
n  Ch, cms ou[r
    vcm opy.|ctio{chcm, s: n  Ch, cms})evt fut(f ++i) {
j    = jiewch, cmc.l.ranges++ji ead.lineneos(dc(cm, ficch, cmshj], m;    vcmnen  Ch, cms.|ctio{f   : ch, cm.f   ,lto: fh, cm.to,"t (!:uch, cm.t (!});    vcmcm;
  n  Group) f ++i) {
 conein ch, cm)w;
  tcY  con.mtnchf/^ t(ns_(\d+)$/)ihead.lineetcm;
  ctorSOf(n  Group, Numbut(m[1]))b> -1ihead.lineetcm irn fn  Ch, cms)[ con]c= fh, cm[ con]evt fu  fu, fucedeme fh, cm[ con]evt fu  fu, }ht >=e   }"keydd.}he ne}ht e lt(e);
cvpy han} 
apg pRebasing/cesdttelepmistorypto dealowith  (!ar   ly-sourc oSch, cms hapflingFastrebasuHistSelSinglt2| c lo   , to,"ciffct{    v, d.t)c< | cor, a));vt fu  | cor, an+=
ciffce   v}u.viewi   ;matc< | cor, a));vt fu  | cor, an=     ;    vcm| coth r 0;", fu}hcm}""dog pTries po rebasuSan
arrti ibpmistorypevthectgionn
a m(cm, finafu 
vipenc-1uethe. Ibethe+m(cm, ftouci/sfthelsame guttctasfthelevthe,afu 
vipenevthe,aatoSeveryaningo'benind'
it.dis
ciscard;de Ibethe+m(cm, fisase a ban be*thelevthe,afu levthe's
posicm, snCretr, "mode Ufu ea onpencvpy-on-write sci/mepf ++ se posicm, s.dto avoidnh)velep o onpenreallocamolthemeallu, fevtryprebasu, butta} oravoidn coblems withhappenshared posicm,  objdges beeleeunsafalytr, "modehapflingFastrebasuHistArrticarrti lo   , to,"ciffct{    vf ++i) {
     = viewarrti.l.ranges++[ihead.lineos(dsub   arrti[or,dok =wan pr"keydd., d. ub.rcm, s) {    vcmne, d.!sub.cvpiun)* 
sub   arrti[or Y sub.deepCopy(); sub.cvpiun =wan pr }ht >=e   f ++i) {
j    = jiew ub.rcm, s.l.rangesji].head.line vcmrebasuHistSelSinglt2 ub.rcm, shj].anchor, o   , to,"ciffc;ad.line vcmrebasuHistSelSinglt2 ub.rcm, shj].hzad lo   , to,"ciffc;ad.line v}ht >=e   coarin pr"keydd.}he ne  f ++i) {
j    = jiew ub.ch, cmc.l.ranges++ji ead.lineneos(dcteeou ub.ch, cmchj];    vcmcm;
  t)c< fur.    or, a.head.line vcmfur.     li(docfur.    or, ae+uciff, fur.    och)ce   ve  vcmfur.to = (docfur.toor, an+ ciff, fur.tooch);ad.line v}u.viewi   ;matc<= fur.toor, a.head.line vcmok =w  } er    vvvFodlbreakevt fu    }
 vcmcm}he ne  i   !ok.head.line varrti.sp(clif0,din+ 1 ce   vne  i r 0;"andle }he ne}ht } hapflingFastrebasuHistcmist,lch, cm)wead.lios(d;matc= fh, cm.f   or, a,dto = fh, cm.toor, a,duiffb= ch, cm.t (!il.rang -  t)c- ;mat)c-d1ea, furebasuHistArrticmist.dott lo   , to,"ciffc;ad.lirebasuHistArrticmist.undott,do   , to,"ciffc;ad.}""dog pEVENT UTILITIES happenDue to  se fage t
at wen
}illusup| r( jurassic IE
versm, s.dsoma onpencvmp)) bi(cty wrappurs Cretneed;de hapos(de_ cevtheDefault r CotuMirrg);e_ cevtheDefault r fcm);}, 2a)he
 vcm;
  e. cevtheDefault) e. cevtheDefault();    v.viewe.lt(e);Valu; =w  } er   }ce.gos(de_stopPconag"medo = CotuMirrg);e_stopPconag"medo = fcm);}, 2a)he
 vcm;
  e.stopPconag"medo) e.stopPconag"medo();    v.viewe.caecelBubbleu=wan pr"ke}ce.gflingFaste_defaultPcevtheed2a)he
 vcmlt(e);
c.defaultPcevtheedc!=r|| ()?
c.defaultPcevtheedc:we.lt(e);Valu; ==w  } er   }e.gos(de_stop = CotuMirrg);e_stop = fcm);}, 2a)hee_ cevtheDefault(a)m e_stopPconag"medo(a)m}; hapflingFaste_tar(te(a.he+= out)m.tar(te rmae.srcElement;}hapflingFaste_butt, 2a)he
 vcmos(db oue.whicg;    v;
  b+=s || ())ead.line, d.e.butt,  & 1 db ou1mouscmcm.viewi   e.butt,  & 2 db ou3mouscmcm.viewi   e.butt,  & 4 db ou2tht >=}ht e ;
  tacbnpue.ctrlKey npub+=s 1 db ou3mouscm+= out)b;ad.}""dog pEVENT HANDLING happenLe();weft);levthee;mamework.u, /offla} orworku, fDOMenetus, onpenregistereleen"mevefDOMeh);
  rse hapos(ddo = CotuMirrg);do = fcm);}, 2amitt t l doc, fct{    v, d.amitt t.addEvtheListenerivt fu  amitt t.addEvtheListener( doc, f, f } e);    v.view, d.amitt t.attachEvtheivt fu  amitt t.attachEvthe("on"e+u doc, fc;    v.viewead.lineos(dmap = amitt t._h);
  rsprma2emitt t._h);
  rsp  {});ad.lineos(darrp  map[ doc]prma2map[ doc]p  []);ad.linearr.|ctiofctht >=}ht }; hapos(doffb= CotuMirrg);dffb= fcm);}, 2amitt t l doc, fct{    v, d.amitt t.+=L //EvtheListenerivt fu  amitt t.+=L //EvtheListener( doc, f, f } e);    v.view, d.amitt t.cetachEvtheivt fu  amitt t.cetachEvthe("on"e+u doc, fc;    v.viewead.lineos(darrp  emitt t._h);
  rspnpuemitt t._h);
  rs[ doc]
    vcm, d.!arr(c+= outside;
  f ++i) {
     = viewarril.ranges++[ivt fu  fu;
  arrhor*l=rfct{darrisp(clifi,d1)t breakee}ht >=}ht }; hapos(dn
    b= CotuMirrg);n
    b= fcm);}, 2amitt t l doc /*, valumc...*/)he
 vcmos(darrp  emitt t._h);
  rspnpuemitt t._h);
  rs[ doc]
    v, d.!arr(c+= outside;
os(dargsp  Arrti.pcoto doc.
(cli.ctll2Crguethec, 2 ce.getf ++i) {
     = viewarril.ranges++[i arrhor.apply(    , args);ht }; hapos(dorph);DeltiedCallbdcks ounSpace onpenOften, wenwtheSto n
    bevthes a(nappoiheSwh teewe Cretinafu  onpenmiddlt ofdsomarwork, buttc-n'tnwtheSthe m);
  rft)cst
r(nctllingase a Ees t*mrthods ,   se edilor, whicgnmit);lbetina(n inconsistent
vipenst
)e a++s;mply*not*expdge any Ees t*evthectto m)ppu . onpens
    Late+elooks et
es t
th teeCretany h);
  rs,aatoSsci/dulesase a t
emtto betexecu( oSet
; t
e g   *on(eacm,  etoc lE(,v, dno onpenon(eacm,  is acmeve, wh nnapfimeou; firus.
apllingFasts
    Late+2amitt t l doc /*, valumc...*/)he
 vcmos(darrp  emitt t._h);
  rspnpuemitt t._h);
  rs[ doc]
    v, d.!arr(c+= outside;
os(dargsp  Arrti.pcoto doc.
(cli.ctll2Crguethec, 2 ,o istce   vi   , (eacm, Group) ead.lineli   mn, (eacm, Group.celtiedCallbdcksce   v}u.viewi   orph);DeltiedCallbdcks) ead.lineli   mn,rph);DeltiedCallbdcksce   v}u.viewead.lineli   mn,rph);DeltiedCallbdcks ou[r
    vcmsetTimeou;c x,eOrph);Deltied,d0)mouscm}    vflingFastbnd2o.he+= out fcm);}, 2){f.apply(    , args);};}evt fuf ++i) {
     = viewarril.ranges++[ivt fu  li  .|ctiobnd2arrhor))ce  } hapflingFast x,eOrph);Deltied()he
 vcmos(dceltied mn,rph);DeltiedCallbdcksce   vorph);DeltiedCallbdcks ounSpacet fuf ++i) {
     = viewceltiedil.ranges++[i celtiedhor(c;ad.}""dog pThefDOMeevthectt
at CotuMirrg) h);
  sScan*be averriddnn
by onpenregistereleea (nen-DOM) m);
  rf,   se edilorpf ++ se evtheename, onpenatoSpcevtheDefault-elep se evtheeinafuat h);
  r.
apllingFasts
    DOMEvthe(.g, ;,"Everrida)he
 vcmn
    (.g, Everrida rmae. doc, .g, ;);extenlt(e);
e_defaultPcevtheed2a)hrmae.loenmirrg)Ignorece  } hapflingFastn
    CursotAcmevcty".g he
 vcmos(darrp  cm._h);
  rspnpucm._h);
  rs.cursotAcmevcty
    v, d.!arr(c+= outside;
os(dsetp  cm.curOp.cursotAcmevctyH);
  rsprma2cm.curOp.cursotAcmevctyH);
  rsp  []);ad.lif ++i) {
     = viewarril.ranges++[i ;
  ctorSOf(set, arrhor)er= -1)    vcmset.|ctioarrhor)ce  } hapflingFasthasH);
  r2amitt t l doc)he
 vcmos(darrp  emitt t._h);
  rspnpuemitt t._h);
  rs[ doc]
    vlt(e);
arrpnpuarril.rang > 0;"an} happenAddf,  atoSibf*mrthods to a consatuctor's
pcoto doc,dto mako onpenregistereleeevthes ostnucgnobjdges m be*convthithe. apllingFastevtheMixin clor)te
 vcmclor.pcoto doc.do = fcm);}, 2 doc, fct{, 2racm.d doc, fc;}evt fuclor.pcoto doc.dffb= fcm);}, 2 doc, fct{,ff2racm.d doc, fc;}evt } happenMISC UTILITIES happenNumbut
oflpix.vitaddunft)csc = "e{
atoSs;
 rft)chida sc = "barhapos(dnc = "e{CutOffb= 30; 
apg pRete);unf ++ srown
by
os(ious"pcotocolsSto n
    b'I'm*not
apg ph);
 elep sis'. apos(dPassb= CotuMirrg);Passb= {toSate.f:)fcm);}, 2)e+= out "CotuMirrg);Pass";}}; 
apg pReufunf, cm, nobjdges f ++setSele);},  pu; ietochapos(dnel_dvarSc = "b= {nc = ":)f } e}.dsel_mous fic{Evigin:v"*mous "}.dsel_mov fic{Evigin:v"+mov "}; hapflingFastDeltied()heanis.id ounSpac}   Deltied.pcoto doc.
et r fcm);}, 2ms, fct{    vce).rTimeou;canis.id);ad.lianis.id ousetTimeou;c , ms);ht }; happenCnuntsfthelcolumnSibf
et innapsate.f.d akele tabsfinto accnunt. onpenUfunfmostlytto f toSitorntae}, . onos(dcountColumnS= CotuMirrg);countColumnS= fcm);}, 2 }te.f.deto, tabS;
 , st
r(ItorS, st
r(Valu;ct{    v, d.a
 *l=r|| ())ead.lineard    }te.f.
earchf/[^\s\u00a0]/.
    vcm, d.a
 *l=r-1ihard    }te.f.l.rangr    v}    vf ++i) {
i r  }
r(ItorS rma0, n r  }
r(Valu; rma0;;.head.lineos(ds xtTab    }te.f.ctorSOf("\t",di)e    vcm, d.s xtTab < 0*rman xtTab >= ardivt fu  fult(e);
n + .a
 *-di)e    vcmn +lin xtTab - i;",  vcmn +litabS;
  -  n %itabS;
 )e    vcm, lin xtTab + 1mouscm}ht }; happenThefinverst ofdcountColumnS-- f toSthelobf
et fuat correspordsp o onpena  
rticuls(dcolumn. apllingFastf toColumn2 }te.f.dgoal, tabS;
 ct{    vf ++i) {
| clic , col    =;.head.lineos(ds xtTab    }te.f.ctorSOf("\t",d| c);", fud(, d.s xtTab l=r-1ihs xtTab    }te.f.l.rangr    vvvos(dnkippud lin xtTab - | c handle i   s xtTab l=r }te.f.l.rang rmafnl + nkippud >= goalivt fu  fult(e);
| cl+ Mathomin(nkippud.dgoal - fnl)evt fut(col +lin xtTab - | c handle col +litabS;
  -  col %itabS;
 )e    vcm| clicn xtTab + 1mouscmvvi   mel >= goali lt(e);
| c;exten}vt } hapos(dst(ceSatsp  [""]ce.gflingFastst(ceSat(n.head.liwhicur(st(ceSats.l.rang <icn)    vcmst(ceSats.ectiorst(st(ceSats) + a ");extenlt(e);
st(ceSats[n]ce  } hapllingFastrn farr));u+= out)arrharril.rang-1]; } hapos(dsele);InputS= fcm);}, 2netu));unetu.sele);(); }evt ;
  c c))penMobicurSafs(i apparently h)ita bugSwh teesele);() is broke . onFosele);InputS= fcm);}, 2netu));unetu.sele);}, S}
r(e)  = netu.sele);}, Erd   netu.valumil.ranges}evt .viewi   ie))penSuppcessbmystereous"IE10 errg)s onFosele);InputS= fcm);}, 2netu));utry);unetu.sele);(); }Scanchf_u));} }; hapflingFastctorSOf(arrti leltct{    vf ++i) {
     = viewarrti.l.ranges++[iouscmvvi   arrti[or Y=leltct+= out)c;extenlt(e);
-1r   }e.gi   [].ctorSOf)tctorSOfS= fcm);}, 2arrti leltct{u+= out)arrti.ctorSOf(eltc;e}ce.gflingFastma 2arrti lo)wead.lios(doue Y [];", fuf ++i) {
     = viewarrti.l.ranges[i].houehorfl f arrti[or,di)e    vlt(e);
outce.g}hapi   [].ma )dmap = fcm);}, 2arrti lfct{u+= out)arrti.ma 2fc;e}cee.gflingFastcocataObj(basu,  conscti", fuos(ditst
    v, d.Objdge.cocata))ead.line,n   mnObjdge.cocata(basu.
    v}u.viewead.lineos(dclor = fcm);}, 2) {}ce.getfuclor.pcoto doc = basu;ad.line,n   mnn   clor()mouscm}    vi    consctcvpyObj( cons, itst)e    vlt(e);
itst
   }cee.gflingFastcvpyObj(obj, tar(te, Everwritect{    v, d.!tar(te) tar(te   {}ce.getf ++i) {
 conein objiouscmvvi   obj.hasOwnPcon(ety( con)bnpu(Everwrite !ir f } e*rma!tar(te.hasOwnPcon(ety( con)))    vcmcmtar(te[ con]c= obj[ con]evt fu+= out)aar(tece  } hapllingFastbind2o.he
 vcmos(dargsp  Arrti.pcoto doc.
(cli.ctll2Crguethec, 1)e    vlt(e);
fcm);}, 2)e+= out f.apply(    , args);};vt } hapos(dnonASCIISingltCasuWordC(cr = /[\u00df\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/ce.gos(disWordC(crBasic = CotuMirrg);isWordC(cr = fcm);}, 2cgi ead.li+= out /\w/turn fcgi rmafg > "\x80"cnp    vcmfcg.toUppurCasu2) != ch.toLowurCasu2) rmanonASCIISingltCasuWordC(crturn fcgi);ht }; apflingFastcsWordC(cr(ch, help t)t{    v;
  !melp t)tlt(e);
isWordC(crBasic(ch);ad.lii   melp t.sourc .ctorSOf("\\w")b> -1bnpucsWordC(crBasic(ch))tlt(e);
an pr"keydlt(e);
help t.urn fcgice  } hapllingFastisEmpty objct{    vf ++i) {
nein objivi   obj.hasOwnPcon(ety(n)bnpuobj[n])blt(e);
  } er    vlt(e);
an pr"ke}""dog pE(!arding uniloenpm(cracters. Aoseries ibea nen-e(!arding m(cr + onpenatynnumbut
ofle(!arding m(crs is tocatadd)s a singlt unitd)s farhappenas edileleeard measureleeis monce);un. Tnis is
not*f   y correct, onpensincedsomarnc ipts/fvars/browsurs C} ortocat Ees t*monfigueacm, sase a ofdcodeppoihesd)s a group.
lios(dex!ardingC(crs = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065e\u0670\u06d6-\u06dc\u06de-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0900-\u0902\u093c\u0941-\u0948\u094d\u0951-\u0955\u0962\u0963\u0981\u09bc\u09be\u09c1-\u09c4\u09cd\u09d7\u09e2\u09e3\u0a01\u0a02\u0a3c\u0a41\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a70\u0a71\u0a75\u0a81\u0a82\u0abc\u0ac1-\u0ac5\u0ac7\u0ac8\u0acd\u0ae2\u0ae3\u0b01\u0b3c\u0b3e\u0b3f\u0b41-\u0b44\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b82\u0bbe\u0bc0\u0bcd\u0bd7\u0c3e-\u0c40\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0cbc\u0cbf\u0cc2\u0cc6\u0ccc\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0dca\u0dcf\u0dd2-\u0dd4\u0dd6\u0ddf\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u102d-\u1030\u1032-\u1037\u1039\u103a\u103d\u103e\u1058\u1059\u105e-\u1060\u1071-\u1074\u1082\u1085\u1086\u108d\u109d\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b7-\u17bd\u17c6\u17c9-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193b\u1a17\u1a18\u1a56\u1a58-\u1a5e\u1a60\u1a62\u1a65-\u1a6c\u1a73-\u1a7c\u1a7f\u1b00-\u1b03\u1b34\u1b36-\u1b3a\u1b3c\u1b42\u1b6b-\u1b73\u1b80\u1b81\u1ba2-\u1ba5\u1ba8\u1ba9\u1c2c-\u1c33\u1c36\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce0\u1ce2-\u1ce8\u1ced\u1dc0-\u1de6\u1dfd-\u1dff\u200c\u200d\u20d0-\u20f0\u2cef-\u2cf1\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua66f-\ua672\ua67c\ua67d\ua6f0\ua6f1\ua802\ua806\ua80b\ua825\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\uaa29-\uaa2e\uaa31\uaa32\uaa35\uaa36\uaa43\uaa4c\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uabe5\uabe8\uabed\udc00-\udfff\ufb1e\ufe00-\ufe0f\ufe20-\ufe26\uff9e\uff9f]/ce.gllingFastisEx!ardingC(cr2cgi enlt(e);
ch.chcrCotuAt(0)f>= 768pnpuex!ardingC(crs.urn fcgice}""dog pDOMeUTILITIES hapllingFastelt(tag, coarthe,ameassName, neyln)wead.lios(de =nc-1uethe.cocataElement(tag);ad.lii   meassName) e.meassNamep  ceassName;ad.lii   neyln)we.styln.cssT (! =ustyln;ad.lii    docofdcoarthec=s " }te.f")we.)ppu dC(ild()-1uethe.cocataT (!Noenl.oarthe));    v.view, d..oarthe)lf ++i) {
     = viewcoartheil.ranges++[i e.)ppu dC(ild(coarthehorctht >=lt(e);
e;vt } hapos(drcm, mous;
  c-1uethe.cocataR, cm)wrcm, ficfcm);}, 2netu,ds}
r(,dard)*ead.lios(dr =nc-1uethe.cocataR, cm()mouscmr.
etEndcnetu,dard)mouscmr.
etS}
r(2netu,ds}
r(ctht >=lt(e);
r;ht }; ap.viewrcm, ficfcm);}, 2netu,ds}
r(,dard)*ead.lios(dr =nc-1uethe.body.cocataT (!R, cm()mouscmr.mov ToElementT (!cnetu.parentNoen)mouscmr.collapsu2te ==;extenl.mov Endc"m(cracter",dard)mouscmr.mov S}
r(2"m(cracter",ds}
r(ctht >=lt(e);
r;ht }; hapllingFast+=L //ChntRren( ct{    vf ++i) {
count oue.chntRNetus.l.rangescount > 0; --countivt fu  a.+=L //ChntR(e) x, lChntRctht >=lt(e);
e;vt } hapllingFast+=L //ChntRrenAndAdd(|arent.da)he
 vcmlt(e);
+=L //ChntRren( arentc.)ppu dC(ild(t)ce  } hapflingFastmvarains(|arent.dchntR)t{    v;
  |arent.mvarainsivt fu  lt(e);
|arent.mvarains(chntRctht >=whicur(centR*lichntR.parentNoen)ouscmvvi   mentR*l=  arentctlt(e);
an pr"ke}""dollingFastacmeveElt() enlt(e);
c-1uethe.acmeveElement;g}happenOlde++versm, s ofdIE+ srowslunspecifiun errg)Set
; touciingase a c-1uethe.acmeveElementein somarca es  cureleeloade.f.din i;mame)vt ;
  ceenpuie_versm, iew11)tacmeveElt = fcm);}, 2) {ouscmtry);ult(e);
c-1uethe.acmeveElement;g}hap Scanchfe) enlt(e);
c-1uethe.body;m}ht }; hapllingFastceassT n fcls));ult(e);
n   RegExp("\\b" + fls + "\\b\\s*")ee}ht llingFast+mCeass2netu,dcls));ht >=os(dt    mnceassT n fcls);ad.lii    es;.urn fnetu.meassName)) netu.meassName   netu.meassName.+=l_mou  es;, "" ce  } apllingFastaddCeass2netu,dcls));ht >=, d.! eassT n fcls).urn fnetu.meassName)) netu.meassName += a " + flstht } apllingFastjoihCeasses(a, b.he
 vcmos(das = a.
p(ct a ")ce  fuf ++i) {
     = viewasil.ranges[i].ouscmvvi   ac[orbnpu! eassT n fac[or).urn fb) db += a " + ac[ormouscm+= out)b;ad.}""dog pWINDOW-WIDEpEVENTS happenTheiewmus;lbeth);
  oScaref   y, becaus fnaevelynregistereleea
apg ph);
 erpf ++ec   edilorpwillucaus f se edilorsSto ;everabo onpengarbagelcolle); o. hapflingFast orEc  CotuMirrg)(fct{    v, d.!c-1uethe.body.(teElementsByCeassName) += outside;
os(dbyCeass =nc-1uethe.body.(teElementsByCeassName("CotuMirrg)")ce  fuf ++i) {
     = viewbyCeassil.ranges[i].head.line) {
ctc= byCeasshor.CotuMirrg)mouscmvvi   mt)c;".g ce   v}vt } hapos(dglobalsRegistered     } er   llingFastensureGlobalH);
  rs(ct{    v, d.globalsRegistered) += outside;
registerGlobalH);
  rs(cside;
globalsRegistered   an pr"ke}"apllingFast+=gisterGlobalH);
  rs(chead.lipenWt
; t
e window resiz s,
wetneed po refreshtacmeve edilors.ad.lios(dresiz Time)mouscm, 2window.d"+esiz ", fcm);}, 2) {ouscmfu, d.resiz Time)eos || ())+=siz Time)eousetTimeou;c cm);}, 2) {ouscmfu )+=siz Time)eounSpace.get=  eknownSc = "barWidngc=unSpace.get=  e orEc  CotuMirrg)(onR=siz );    vcm}, 100)mouscm})mouscmpenWt
; t
e window eoSis f cus, wenwtheSto nhow  se edilorpas blurredouscm, 2window.d"blur", fcm);}, 2) {ouscmfu orEc  CotuMirrg)(onBlurmce.get});ht } happenFEATURE DETECTION""dog pDetdge drag-);
-drophapos(ddragAndDrop = fcm);}, 2chead.lipenTn te is *soma* kitoSibedrag-);
-dropusup| r( in IE6-8, buttIad.lipencoutRn'tn(te ieSto workuyet.ouscm;
  ceenpuie_versm, iew9)blt(e);
  } er    vos(duiv =lelt('uiv'ctht >=lt(e);
"draggablea inauiv ||
"dragDropa inauiv;ht }(); hapos(dknownSc = "barWidngce.gflingFastsc = "barWidng(measurect{    v, d.knownSc = "barWidngc!s || ())+= outaknownSc = "barWidngce.g>=os(dt    mnelt("uiv",l    ,     , "widng: 50px;tmeft);: 50px;tEverflow-x:tsc = "");extenltL //ChntRrenAndAdd(measure,dt   );ad.lii    es;.obf
etWidng.ouscmvvknownSc = "barWidngc=u es;.obf
etHeft);n-l es;.clitheHeft);mouscm+= outaknownSc = "barWidng rma0;vt } hapos(dzwspSup| r(edce.gflingFastzeroWidngElement(measurect{    v, d.zwspSup| r(ed*l=r|| ())ead.lineos(dt    mnelt(" t(n",l"\u200b");    vcmltL //ChntRrenAndAdd(measure,delt(" t(n",l[ es;, )-1uethe.cocataT (!Noenl"x")] );    vcm;
  teasure) x, lChntR.obf
etHeft);n!= 0m    vvvvvzwspSup| r(ed*l  es;.obf
etWidng <ic1bnpu es;.obf
etHeft);n> 2bnpu! ceenpuie_versm, iew8)mouscm}    vi   zwspSup| r(ed))+= outaelt(" t(n",l"\u200b");    v.viewr= outaelt(" t(n",l"\u00a0",l    , "ui
p(ay: inr, a-block; widng: 1px;tmargin-re();: -1px");ht } happenFcature-detdge IE's crummytceithe rdge +=lor(ingof ++bidiat (!hapos(dbadBidiRdgesce.gflingFasthasBadBidiRdges(measurect{    v, d.badBidiRdgesc!s || ())+= outabadBidiRdgesce.gneos(dt(! =ultL //ChntRrenAndAdd(measure,d)-1uethe.cocataT (!Noenl"A\u062eA" );    vos(dr0 =ul, cm(t(!,c , 1).(teB )
 ingCeitheRe);();    v, d.!r0*rmar0.leftfs=ar0.re();  lt(e);
  } er)penSafs(i lt(e);sr|| ()in somarca es  #2780m    vos(dr1 =ul, cm(t(!,c1, 2 .(teB )
 ingCeitheRe);();    v+= outabadBidiRdges =u(r1.re();n-lr0.re();iew3);ht } happenSeew, d"".
p(ct is t
e broke  IE
versm, ,v, dso,aprovida an
vipenal!ar  meve waylt)c
p(ctggutts.
fuos(dst(ctxt, sb= CotuMirrg);nt(ctxt, sb= "\n\nb".
p(ct /\n/).l.rang !s 3 ? fcm);}, 2 }te.f.he
 vcmos(d| clic , +=sult r [], l    }te.f.l.rangr    vwhicur(| cl<ic())ead.lineos(dnl    }te.f.ctorSOf("\n",d| c);", fud(, d.sl l=r-1ihsl    }te.f.l.rangr    vneos(dgutter  }te.f.
(clif| c l }te.f.chcrAt(nl - 1)fi) "\r" ? nl - 1 :unl)evt fut(os(dr! =ur, a.ctorSOf("\r");", fud(, d.r;n!= -1ihead.lineet+=sulteectior, a.
(clif0,drt).
    vcmdl| cl+=dr! + 1mouscmcm}eorSize.top ? -2+=sulteectior, a.
    vcmdl| cl= nl + 1mouscmcm}ouscm}    vlt(e);
+=sult;ht } : fcm);}, 2 }te.f.e+= out  }te.f.
p(ct /\r\n?|\n/);}; hapos(dhasSele);},  = window.(teSele);},  ? fcm);}, 2tect{    vtry);ult(e);
tu.sele);}, S}
r(e!=
tu.sele);}, End;g}hap Scanchfe) enlt(e);
  } er)}ht } : fcm);}, 2tect{    vtry);os(drcm, *l  e.ownerD-1uethe.sele);}, .cocataR, cm()m}hap Scanchfe) e}    v, d.!rcm, *rmar, cm. arentElement()e!=
tu)blt(e);
  } er    vlt(e);
r, cm.cvmp)r EndPoihes("S}
r(ToEnd",dr, cm)w!r 0;"an}; hapos(dhasCopyEvthe =wc cm);}, 2) {ouscmos(de =nelt("uiv");    v, d."oncvpya inae)tlt(e);
an pr"keydc.
etAt}tebute."oncvpya.d"+e outs");extenlt(e);
 docofdc.docopyp=) " cm);}, ";"an})(); hapos(dbadZoomadRdges =unSpace.gflingFasthasBadZoomadRdges(measurect{    v, d.badZoomadRdges !s || ())+= outabadZoomadRdges;    vos(dnetu mnltL //ChntRrenAndAdd(measure,delt(" t(n",l"x"));    vos(dnerm  b= netu.(teB )
 ingCeitheRe);();    vos(d;matRcm, *l l, cm(netu,d , 1).(teB )
 ingCeitheRe);();    v+= outabadZoomadRdges*l Mathoabs2nerm  .leftf-d;matRcm, .left)b> 1mous} happenKEY NAMES hapos(dkeyNamesb= {3: "Enter",d8: "Bdckst(ce",d9: "Tab",d13: "Enter",d16: "Shift",d17: "Ctrl",d18: "Alt",    vcmdlllllllllll19: "Paus ",d20: "CapsLock",d27: "Esc",d32: "St(ce",d33: "PageUp",d34: "PageDown",d35: "End",    vcmdlllllllllll36: "Homa",d37: "Left",d38: "Up",d39: "Re();",d40: "Down",d44: "Pte.rSc n",d45: "Itsert",    vcmdlllllllllll46: "Dedeme",d59: ";",d61: "=",d91: "Mod",d92: "Mod",d93: "Mod",d107: "=",d109: "-",d127: "Dedeme",    vcmdlllllllllll173: "-",d186: ";",d187: "=",d188: ",",d189: "-",d190: ".",d191: "/",d192: "`",d219: "[",d220: "\\",    vcmdlllllllllll221: "]",d222: "'",d63232: "Up",d63233: "Down",d63234: "Left",d63235: "Re();",d63272: "Dedeme",    vcmdlllllllllll63273: "Homa",d63275: "End",d63276: "PageUp",d63277: "PageDown",d63302: "Itsert"}; apCotuMirrg);keyNamesb= keyNames; apc cm);}, 2) {ouscmpenNumbut
keyse  fuf ++i) {
     = view10es[i].hkeyNames[in+ 48]b= keyNames[in+ 96]b= Sate.f(i)mouscmpenAlphabetic
keyse  fuf ++i) {
    65= vie= 90es[i].hkeyNames[i]b= Sate.f.f   ChcrCotu(i)mouscmpenFlingFastkeyse  fuf ++i) {
    1= vie= 12es[i].hkeyNames[in+ 111]b= keyNames[in+ 63235]b= "F" + i;", })(); happenBIDI HELPERS hapllingFastite+ataBidiSe);}, s ovde+,do   , to,"fct{    v, d.!ovde+)blt(e);
 oo   , to,""ltr");", fuos(d; )
 c=   } er    vf ++i) {
     = viewovde+.l.ranges++[ihead.lineos(dp
r(e) ovde+[ormouscmcmi   p
r(.;matc< t)cnpup
r(.t)c>d;matcrma;matc== t)cnpup
r(.t)c== ;mat)ce.top ? -2foMathomax(p
r(.;mat, ;   ), Mathomin(p
r(.t), to),"p
r(.level l=r1 ? "rtl" : "ltr");", fu   vf )
 c= an pr"keydd.}ouscm}    v, d.!; )
 )b oo   , to,""ltr");", } hapllingFastbidiLeft(p
r() enlt(e);
p
r(.level % 2b?up
r(.t)c: p
r(.;matee}ht llingFastbidiRe();(p
r() enlt(e);
p
r(.level % 2b?up
r(.;matc:up
r(.t); } hapllingFastr, aLeft(r, a.he os(dovde++=u(teOvde+lr, a); lt(e);
ovde+b?ubidiLeft(ovde+[0])f: 0ee}ht llingFastr, aRe();c , a)wead.lios(dovde++=u(teOvde+lr, a);    v, d.!ovde+)blt(e);
r, a.t (!.l.rangr    v+= outabidiRe();(rn fovde+));", } hapllingFastr, aS}
r(2.g, r, aN)wead.lios(dgutter (text, lc);soc, r, aN);", fuos(dvisuPo   visuPoxt, lr, a);    v, d.visuPo !=ur, a) r, aN =ur, aNo.visuPo);", fuos(dovde++=u(teOvde+lvisuPo);", fuos(dth r !ovde+b?u0*: ovde+[0].level % 2b?ur, aRe();cvisuPo)*: r, aLeft(visuPo);", fu+= outa(docr, aN.dch ce  } apllingFastr, aEndcfg, r, aN)wead.lios(dmergun, gutter (text, lc);soc, r, aN);", fuwhicur(mergunf= collapsunSt(nAtEndcr, a)) ead.linelitter mergun.f to(1, te ==or, a;", fu  r, aN =unSpace.get}ad.lios(dovde++=u(teOvde+lr, a);    vos(dth r !ovde+b?ur, a.t (!.l.rang*: ovde+[0].level % 2b?ur, aLeft(r, a.h:tr, aRe();c , a);", fu+= outa(docr, aN*l=r|| (b?ur, aNolr, a)h:tr, aN.dch ce  } apllingFastr, aS}
r(Sm
r(2.g, | c)wead.lios(ds}
r(e) r, aS}
r(2.g, | cor, a);ad.lios(dgutter (text, lc);soc, 
}
r(or, a);", fuos(dovde++=u(teOvde+lr, a);    v, d.!ovde+crmaovde+[0].level =s 0i ead.lineos(d;x, lNonWS*l Mathomax(0,ur, a.t (!.
earchf/\S/))evt fut(os(dinWS*l | cor, an== 
}
r(or, acnpup coth e= ;x, lNonWS*npup coth;    vcmlt outa(doc
}
r(or, a,dinWS*?u0*: ;x, lNonWSctht >=}ht e lt(e);

}
r(;", } hapllingFastcvmp)r BidiLevel ovde+,da, b.he
 vcmos(dr, adire) ovde+[0].level;    v, d.aer= r, adir)tlt(e);
an pr"keyd;
  b+=s r, adir)tlt(e);
  } er    vlt(e);
aiewbce  } apos(dbidiOes tce.gflingFast(teBidiP
r(At ovde+,d| c)wead.libidiOes t ounSpacet fuf ++i) {
     ,vf )
 = viewovde+.l.ranges++[ihead.lineos(dcteeouovde+[ormouscmcmi   fur.     < | cpnpucur.to >d| c)w+= out)c;extenFoi   ffur.     ll | c rmafur.to =l | c)ihead.lineet;
  f u
 *l=r|| ())ead.line   vf )
 c= c;extenFo v}u.viewi   cvmp)r BidiLevel ovde+,dfur.level,uovde+[f )
 ].level)ihead.lineetcm;
  fur.     != fur.to)ibidiOes t ouf )
 =ad.lineetcm+= out)c;extenFocm}eorSize.top ? -2cm;
  fur.     != fur.to)ibidiOes t oui=ad.lineetcm+= out)f )
 =ad.lineet}"keydd.}he ne}ht e lt(e);
f )
 =ad.} hapllingFastL //Inxt, lr, a,d| c,"ci+,dbyUnitct{    v, d.!byUnitctlt(e);
| cl+ ci+=ad.lidol| cl+=dci+=ad.liwhicur(| cl> 0cnpuisEx!ardingC(cr2r, a.t (!.chcrAt(| c)i);", fu+= outa| c;ext}""dog pThis is
need;dein ovde+cto mov f'visuPoly'+ sroughibi-dirdge}, al"dog pt (! -- i.e.,  cesselepleftfshoutR*makont
e furs ++gopleft,tevth"dog pet
;
in RTLpt (!.nThefateckydp
r(eis t
e 'jumps',Swh teeRTLpand"dog pLTRpt (! touci+ec   Ees t. Tnis oftenu+=quir/sfthelfurs ++obf
et
Fopento mov fm be*th(n ont unit,ein ovde+cto visuPoly mov font unit.hapllingFastL //VisuPolylr, a,ds}
r(,dci+,dbyUnitct{    vos(dbidi+=u(teOvde+lr, a);    v, d.!bidictlt(e);
L //LogicPolylr, a,ds}
r(,dci+,dbyUnitc;", fuos(d| cl= (teBidiP
r(At bidi,ds}
r(c,dp
r(e) bidi[| c]ce.gneos(dtar(te   L //Inxt, lr, a,ds}
r(,dp
r(.level % 2b?u-dir*: ci+,dbyUnitc;"et fuf ++i=;.head.linei    ar(te >up
r(.;matcnpu ar(te <up
r(.t))tlt(e);
aar(tece  linei    ar(te l=  ar(.;matcrma ar(te l=  ar(.t))wead.lilinei   (teBidiP
r(At bidi,dtar(te) =l | c)tlt(e);
aar(tece  line dp
r(e) bidi[| cl+=dci+];    vcmcmlt(e);
(dir*> 0)fi) p
r(.level % 2b?up
r(.t)c: p
r(.;mate"keydd.}eorSize.top ? -2p
r(e) bidi[| cl+=dci+];    vcmcm, d.!p
r() lt(e);
nSpace.getcmcm, d.(dir*> 0)fi) p
r(.level % 2)ad.lineetcmtar(te   L //Inxt, lr, a,dp
r(.t), -1,dbyUnitc;", fuuuuuorSi    vcmetcmtar(te   L //Inxt, lr, a,dp
r(.o   , 1,dbyUnitc;", fuuu}he ne}ht } hapflingFastL //LogicPolylr, a,ds}
r(,dci+,dbyUnitc);ht >=os(dtar(te   s}
r(e+ ci+=ad.li;
  byUnitc)whicur( ar(te >u0cnpuisEx!ardingC(cr2r, a.t (!.chcrAt(tar(te))) tar(te +=dci+=ad.lilt(e);
aar(te < 0*rma ar(te >ur, a.t (!.l.rang*?r|| (b:)aar(tece  } happenBidirdge}, al ovde+eleealgorithm
appenSeewhttp://uniloen.org/celor(s/tr9/tr9-13.htmlpf ++ se algorithm
appenfuat anis (p
r(iPoly) ;mplements.e onpenOne-m(cr loens ufunff ++m(cractera docs:"dog pL (L):.liLeft-to-Re();"dog pR (R):.liRe();-to-Left"dog p++iAL):.lRe();-to-Left Arabic"dog p1 (EN):.lEucon((n Numbut"dog p+ (ES):.lEucon((n NumbutnSep
ratot"dog p% (ET):.lEucon((n NumbutnTerminatot"dog p;
(AN):.lArabic Numbut"dog p, (CS):.lCommon NumbutnSep
ratot"dog pm (NSM):.Non-St(celeeMark"dog pb (BN):.lB )
 ary Neutral"dog ps (B):.liP
ragraphnSep
ratot"dog pt (S):.lnSegmenteSep
ratot"dog pw (WS):.lWhitest(ce"dog pN (ON):.lOes t Neutrals 
apg pRete);sr|| ()ifpm(cracterseCretovde+add)s es y appearhappen(left-to-re(); .d ++an
arrti ibpse);}, s o{f   , to,"level}happenobjdges)einafu novde+cinawhicgnes y occteevisuPoly.
fuos(dbidiOvde+elee=wc cm);}, 2) {ouscmpenC(cractera docsff ++moenpoihesd0cto 0xff
 vcmos(drowTdocsf= "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLN";ouscmpenC(cractera docsff ++moenpoihesd0x600cto 0x6ff
 vcmos(darabicTdocsf= "rrrrrrrrrrrr,rNNmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmrrrrrrrnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmNmmmm";ouscmllingFastc(crTdoc(code.head.linei   codepe= 0xf7)blt(e);
rowTdocs.chcrAt(coen)mouscm v.view, d.0x590c<= fodepnpucodepe= 0x5f4)blt(e);
"R"mouscm v.view, d.0x600c<= fodepnpucodepe= 0x6ed))+= outaarabicTdocs.chcrAt(coen -d0x600)mouscm v.view, d.0x6eec<= fodepnpucodepe= 0x8ac)blt(e);
"r"mouscm v.view, d.0x2000c<= fodepnpucodepe= 0x200b)blt(e);
"w"mouscm v.view, d.codep== 0x200c)blt(e);
"b"mouscm v.viewlt(e);
"L"tht >=}h    vos(dbidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/ce.g.gos(disNeutral = /[stwN]/.disStrolee=w/[LRr]/.dcountsAsLeft =w/[Lb1n]/.dcountsAsNum =w/[1n]/;ouscmpenBrowsurs seemtto a}wtis tocat t
e b )
 aries ibeblockv.vementspas beeleeL.ad.lios(douterTdoc = "L"thouscmllingFastBidiSpan(level,uf   , t))wead.lilianis.level = level;    vlianis.;matc= ;mateeanis.to = totht >=}h    vlt(e);
fcm);}, 2str.head.linei   !bidiRE.urn fstr.)tlt(e);
  } er    vcmos(dren r  }+.l.rang,a docsfou[r
    vcmf ++i) {
     ,v doc= viewl.res++[ivt fu  fu docseectio doc = c(crTdoc( }+.chcrCotuAt(i)i);"vt fu  penW1. Exam, acec   nen-st(celeemark (NSM)einafu nlevel run,pand"dofu  penm(cm, fthefadoc obethe+NSM to  se adoc obethe+ cevious"dofu  penm(cractere Ibethe+NSM is a(nthels}
r(eobethe+level run,pitnwill"dofu  penget  se adoc obes +.    vcmf ++i) {
     ,v ceveououterTdoc= viewl.res++[i ead.lineneos(d doc =  docs[ormouscmcmlii    docp=) "m")  docs[or*l |cev;", fuuuuuorSiv ceveou doc=", fuuu}hvt fu  penW2.eSearch bdckwardsa;matcec   itstaece ibea Eucon((n numbut"dofu  penuntil  se fx, lestrolee docp(R, L, AL.d ++sor)tis
f )
 e Ibean
vifu  penALtis
f )
 ,nm(cm, fthefadoc obethe+Eucon((n numbut to Arabic"dofu  pennumbut.vt fu  penW3. Ch, cmealluALsSto R.    vcmf ++i) {
     ,vcteeououterTdoc= viewl.res++[i ead.lineneos(d doc =  docs[ormouscmcmlii    docp=) "1"pnpucurp=) "r")  docs[or*l "n";", fuuuuuorSiv;
  csStrole.urn f doc).he cteeou doc= v    docp=) "r")  docs[or*l "R"mt}"keydd.}hvt fu  penW4. Aosinglt Eucon((n sep
ratot betweenetwo+Eucon((n numbuts"dofu  penm(cm, s to a Eucon((n numbut. Aosinglt common sep
ratot between"dofu  pentwo+numbuts obethe+same  docpm(cm, s to fuat adoc.    vcmf ++i) {
    1,v ceveou docs[0]= viewl.rc-d1es++[i ead.lineneos(d doc =  docs[ormouscmcmlii    docp=) "+"cnpv ceveo) "1"pnpu docs[o+1]eo) "1")  docs[or*l "1";", fuuuuuorSiv;
   docp=) ","cnpv ceveo)  docs[o+1]enphandle            ( ceveo) "1"prma ceveo) "n"))  docs[or*l |cev;", fuuuuu ceveou doc=", fuuu}hvt fu  penW5. Aosequeece ibeEucon((n terminatotitadj(ceheSto Eucon((n"dofu  pennumbutsnm(cm, s to alluEucon((n numbuts.vt fu  penW6.lOes twisu, sep
ratotseard terminatotitm(cm, ftolOes tvt fu  penNeutral.    vcmf ++i) {
     = viewl.res++[i ead.lineneos(d doc =  docs[ormouscmcmlii    docp=) ",")  docs[or*l "N";", fuuuuuorSiv;
   docp=) "%"))ead.line   vf ++i) {
ard   in+ 1;
ard ewl.rcnpu docs[ard]p=) "%"es++ard)*e}ad.line   vos(drel_moue=wcipnpu docs[o-1]eo) "!")prma2erd ewl.rcnpu docs[ard]p=) "1") ? "1"p: "N";", fuuuuu  f ++i) {
j   i= jiewe
 = ++ji  docs[j] mnltl_mou;", fuuuuu      a
 *-d1;", fuuuuu}"keydd.}hvt fu  penW7.eSearch bdckwardsa;matcec   itstaece ibea Eucon((n numbut"dofu  penuntil  se fx, lestrolee docp(R, L,  ++sor)tis
f )
 e Ibean Lfisasefu  penf )
 ,ntt
;
m(cm, fthefadoc obethe+Eucon((n numbut to L.    vcmf ++i) {
     ,vcteeououterTdoc= viewl.res++[i ead.lineneos(d doc =  docs[ormouscmcmlii   curp=) "L"pnpu doceo) "1")  docs[or*l "L";", fuuuuuorSiv;
  csStrole.urn f doc).hcteeou doc="keydd.}hvt fu  penN1. Aosequeece ibeneutralsd ak/sftheldirdge},  obethevt fu  pensurr )
 ingestrolee  (! ibethe+  (! astbong siens hasfthelsamevt fu  pendirdge}, .+Eucon((n ard Arabic numbutsnage asfibethey w teeR it"dofu  penterms obethei+cinflueece ineneutrals.eS}
r(-of-level-run (sor)"dofu  penatoSend-of-level-run (eor)tCretrfunfat level run b )
 aries.vt fu  penN2.eAnynremainelepneutralsd ak/  se embud ingedirdge}, .    vcmf ++i) {
     = viewl.res++[i ead.linene;
  csNeutral.urn f docc[or)))ead.line   vf ++i) {
ard   in+ 1;
ard ewl.rcnpucsNeutral.urn f docc[ard])es++ard)*e}ad.line   vos(dban be*=wcip?u docs[o-1]e:uouterTdoc)p=) "L";ad.line   vos(daft t ou2erd ewl.rc?u docs[ard]p:uouterTdoc)p=) "L";ad.line   vos(drel_moue=wban be*rmaaft t ? "L"p:
"R"mouscm v   vf ++i) {
j   i= jiewe
 = ++ji  docs[j] mnltl_mou;", fuuuuu      a
 *-d1;", fuuuuu}"keydd.}hvt fu  penH teewe dep
r(e;matctheld-1uetheunfalgorithm,ein ovde+cto avoidvt fu  penbuilding up+an
actuPo levels)arrti. Sincedth teeCretonlytthreevt fu  penlevels)(0,u1, 2 tina(n implementacm,  fuat doesn'tntako onfu  penexp(clit embud ingeinto accnunt, wencan*build up+fu novde+cot"dofu  pentse f y, withou; followelep se level-basunfalgorithm.    vcmos(dovde++=u[], m;    vcmf ++i) {
     = viewl.rei ead.linene;
  countsAsLeft.urn f docc[or)))ead.line   vos(ds}
r(e) imouscm v   vf ++i++[= viewl.rcnpucountsAsLeft.urn f docc[or)es++[i e}ad.line   vovde+.ection   BidiSpan(0,ds}
r(,di).
    vcmdl}eorSize.top ? -2cmos(d| cl= i,fat =wovde+.l.rangeouscm v   vf ++i++[= viewl.rcnpu docs[or*!) "L";s++[i e}ad.line   vf ++i) {
j   | c; jiewi;))ead.line   vne;
  countsAsNum.urn f docc[jr)))ead.line   v vne;
  | cl< ji ovde+.sp(clifa!,c , n   BidiSpan(1,d| c,"j).
    vcmdl? -2cmos(dns}
r(e) j
    vcmdl? -2cmf ++i++j; jiewicnpucountsAsNum.urn f docc[jr)es++ji e}    vcmdl? -2cmovde+.sp(clifa!,c , n   BidiSpan(2,dns}
r(,"j).
    vcmdl? -2cm| cl= j
    vcmdl? -2}eorSiz++j;    vcmdl? }    vcmdl? ;
  | cl< ii ovde+.sp(clifa!,c , n   BidiSpan(1,d| c,"i).
    vcmdl}
 vcmdl}
 vcmdli   orde+[0].level =s 1bnpu tcY  }+.mtnchf/^\s+/))))ead.line  orde+[0].;matc= m[0].lerangeouscm v  ovde+.unshifton   BidiSpan(0,d0,dm[0].lerang)c;", fuuu}he nedli   rn fovde+).level =s 1bnpu tcY  }+.mtnchf/\s+$/))))ead.line  rn fovde+).t)c-= m[0].lerangeouscm v  ovde+.ection   BidiSpan(0,dl.rc-dm[0].lerang,dl.r)c;", fuuu}he nedli   orde+[0].level !=urn fovde+).level)ouscm v  ovde+.ection   BidiSpan(orde+[0].level,dl.r,dl.r)c;"ouscm vlt(e);
ovde+tht >=}ce  })(); happenTHE END hapCotuMirrg);