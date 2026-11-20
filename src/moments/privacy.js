(function () {
  "use strict";

  if (typeof YTM !== "undefined" && YTM.sectionTrack) {
    YTM.sectionTrack.initSectionTrack({
      trackSelector: ".priv-track",
      trackWrapSelector: ".priv-track-wrap",
      linkSelector: ".priv-track__link",
      currentAttr: "location",
    });
  }
})();
