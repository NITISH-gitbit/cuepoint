var YTM = YTM || {};

(function () {
  "use strict";

  const { schema, momentsState } = YTM;
  const maxPerVideo = schema.MAX_MOMENTS_PER_VIDEO || 3;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children) node.append(c);
    return node;
  }

  function makeIcon(name, extraClass) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "icon" + (extraClass ? " " + extraClass : ""));
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(NS, "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  function safeYouTubeHref(rawUrl) {
    return schema.sanitizeUrl(rawUrl, { requireYouTubeHost: true });
  }

  function makeSafeLink(className, href, textContent, title) {
    const safeHref = safeYouTubeHref(href);
    if (!safeHref) {
      return el("span", { className, textContent, ...(title ? { title } : {}) });
    }
    return el("a", {
      className,
      href: safeHref,
      target: "_blank",
      rel: "noopener noreferrer",
      textContent,
      ...(title ? { title } : {}),
    });
  }

  function renderMedia(group) {
    const media = el("div", { className: "media" });
    const vid = group.videoId || schema.extractVideoId(group.url);
    const firstMoment = group.moments[0];
    const safeWatchUrl = safeYouTubeHref((firstMoment && firstMoment.url) || group.url);

    const badge = el("span", {
      className: "media__badge",
      textContent: `${group.moments.length}/${maxPerVideo}`,
      title: `${group.moments.length} of ${maxPerVideo} moments saved`,
    });

    function buildPlaceholder() {
      const box = el("div", { className: "thumb thumb--fallback" });
      box.append(el("span", { className: "thumb__placeholder", textContent: "YT" }));
      return box;
    }

    if (!vid || !safeWatchUrl) {
      media.append(buildPlaceholder(), badge);
      return media;
    }

    const thumbLink = el("a", {
      className: "thumb",
      href: safeWatchUrl,
      target: "_blank",
      rel: "noopener noreferrer",
    });
    thumbLink.setAttribute("aria-label", "Open video at first saved moment");

    const img = el("img", { className: "thumb__img", loading: "lazy", alt: "" });
    img.src = `https://i.ytimg.com/vi/${encodeURIComponent(vid)}/mqdefault.jpg`;
    thumbLink.append(img);

    media.append(thumbLink, badge);

    const dropThumbnail = () => {
      media.replaceChildren(buildPlaceholder(), badge);
    };
    img.addEventListener("error", dropThumbnail);
    img.addEventListener("load", () => {
      if (img.naturalWidth && img.naturalWidth <= 120) dropThumbnail();
    });

    return media;
  }

  function makeIconAction(action, id, label, iconName, danger = false) {
    const btn = el("button", {
      className: "icon-btn" + (danger ? " danger" : ""),
      type: "button",
      title: label,
    });
    btn.setAttribute("aria-label", label);
    btn.dataset.action = action;
    btn.dataset.id = id;
    btn.append(makeIcon(iconName));
    return btn;
  }

  function renderTimestampPill(m, { activeId }) {
    const hasNote = !!(m.note && m.note.trim());
    const isActive = activeId === m.id;
    const pill = el("button", {
      type: "button",
      className:
        "ts-pill" +
        (hasNote ? " ts-pill--has-note" : "") +
        (isActive ? " ts-pill--active" : ""),
      title: hasNote ? m.note : "Click or hover to view details",
    });
    pill.dataset.momentId = m.id;
    pill.setAttribute("aria-expanded", isActive ? "true" : "false");
    pill.append(el("span", { className: "ts-pill__time", textContent: schema.formatTime(m.timestamp) }));
    if (hasNote) {
      pill.append(el("span", { className: "ts-pill__dot", ariaHidden: "true" }));
    }
    return pill;
  }

  function renderPopoverContent(m, { editingId, draft }) {
    const frag = document.createDocumentFragment();
    const safeUrl = safeYouTubeHref(m.url);

    const head = el("div", { className: "ts-pop__head" }, [
      safeUrl
        ? el("a", {
            className: "ts-pop__jump",
            href: safeUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            textContent: `Jump to ${schema.formatTime(m.timestamp)} ↗`,
          })
        : el("span", {
            className: "ts-pop__jump",
            textContent: schema.formatTime(m.timestamp),
          }),
      el("span", {
        className: "ts-pop__date",
        textContent: schema.formatDate(m.savedAt),
      }),
    ]);

    frag.append(head);

    if (editingId === m.id) {
      const ta = el("textarea", {
        className: "ts-pop__textarea",
        defaultValue: m.note || "",
        value: draft ?? m.note ?? "",
      });
      ta.setAttribute("placeholder", "Write a note… (Ctrl+Enter to save, Esc to cancel)");
      ta.dataset.editor = m.id;

      const save = el("button", {
        className: "btn-sm primary",
        type: "button",
        textContent: "Save",
      });
      save.dataset.action = "save";
      save.dataset.id = m.id;

      const cancel = el("button", {
        className: "btn-sm",
        type: "button",
        textContent: "Cancel",
      });
      cancel.dataset.action = "cancel";
      cancel.dataset.id = m.id;

      const editorStatus = el("p", {
        className: "ts-pop__note ts-pop__editor-status",
        hidden: true,
        textContent: "",
      });
      editorStatus.setAttribute("role", "status");
      frag.append(ta, editorStatus, el("div", { className: "editor__actions" }, [save, cancel]));
      setTimeout(() => ta.focus(), 0);
      return frag;
    }

    const hasNote = !!(m.note && m.note.trim());
    const noteBody = el("p", {
      className: "ts-pop__note" + (hasNote ? "" : " ts-pop__note--empty"),
      textContent: hasNote ? m.note : "No note attached to this timestamp.",
    });

    const actions = el("div", { className: "ts-pop__actions" }, [
      makeIconAction("copy", m.id, "Copy timestamp link", "copy"),
      makeIconAction("share", m.id, "Copy share message", "share"),
      makeIconAction(
        "edit",
        m.id,
        draft !== undefined ? "Resume note draft" : hasNote ? "Edit note" : "Add note",
        hasNote ? "edit" : "add",
      ),
      makeIconAction("delete", m.id, "Delete moment", "delete", true),
    ]);

    frag.append(noteBody, actions);
    return frag;
  }

  function renderVideoCard(group, { activeId } = {}) {
    const li = el("li", { className: "item" });
    li.dataset.videoKey = group.key;

    const firstMoment = group.moments[0];
    const titleHref = (firstMoment && firstMoment.url) || group.url;

    const channelEl = group.channelName
      ? makeSafeLink(
          "channel",
          safeYouTubeHref(group.channelUrl) || safeYouTubeHref(group.url),
          group.channelName,
          group.channelName,
        )
      : el("span", { className: "channel channel--empty", textContent: "YouTube" });

    const byline = el("div", { className: "byline" }, [
      channelEl,
      el("span", { className: "byline__sep", textContent: "·" }),
      el("span", {
        className: "byline__date",
        textContent: schema.formatDate(group.latestSavedAt),
      }),
    ]);

    const tsBar = el("div", {
      className: "ts-bar",
      role: "group",
      ariaLabel: "Saved timestamps",
    });
    for (const m of group.moments) {
      tsBar.append(renderTimestampPill(m, { activeId }));
    }

    const body = el("div", { className: "body" }, [
      makeSafeLink(
        "label",
        titleHref,
        group.title || "(untitled video)",
        group.title || "(untitled video)",
      ),
      byline,
      tsBar,
    ]);

    li.append(renderMedia(group), body);
    return li;
  }

  function pagerButton(label, { disabled = false, current = false, onClick }) {
    const b = el("button", {
      className: "pager__btn" + (current ? " pager__btn--current" : ""),
      type: "button",
      textContent: label,
    });
    if (disabled) b.disabled = true;
    if (current) b.setAttribute("aria-current", "page");
    if (onClick && !disabled && !current) b.addEventListener("click", onClick);
    return b;
  }

  function renderPager(pagerEl, currentPage, totalPages, onGoTo) {
    pagerEl.innerHTML = "";
    if (totalPages <= 1) {
      pagerEl.hidden = true;
      return;
    }
    pagerEl.hidden = false;

    pagerEl.append(
      pagerButton("‹ Prev", {
        disabled: currentPage === 1,
        onClick: () => onGoTo(currentPage - 1),
      }),
    );

    for (const p of momentsState.pageWindow(currentPage, totalPages)) {
      if (p === "…") {
        pagerEl.append(el("span", { className: "pager__gap", textContent: "…" }));
      } else {
        pagerEl.append(
          pagerButton(String(p), {
            current: p === currentPage,
            onClick: () => onGoTo(p),
          }),
        );
      }
    }

    pagerEl.append(
      pagerButton("Next ›", {
        disabled: currentPage === totalPages,
        onClick: () => onGoTo(currentPage + 1),
      }),
    );
  }

  YTM.momentsRender = {
    el,
    renderVideoCard,
    renderPopoverContent,
    renderPager,
  };
})();
