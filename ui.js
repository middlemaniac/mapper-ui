export function createMapperView(state, { fieldMap }) {
    const ui = {
      levelsRow: document.querySelector("#levels-row"),
      connectors: document.querySelector("#connector-layer"),
      toast: document.querySelector("#toast"),
      toastMessage: document.querySelector("#toast-message"),
      overlay: document.querySelector("#dialog-overlay"),
      exportDialog: document.querySelector("#mapping-export-dialog"),
      confirmationDialog: document.querySelector("#confirmation-dialog"),
      confirmationMessage: document.querySelector("#confirmation-message"),
      sampleDialog: document.querySelector("#sample-dialog"),
      sampleDialogList: document.querySelector("#sample-dialog-list"),
      levelSchemaFile: document.querySelector("#level-schema-file"),
      mappingFile: document.querySelector("#mapping-file"),
      mappingAllFile: document.querySelector("#mapping-all-file")
    };
    let toastTimer = null;
    let toastDeadline = 0;
    let toastRemaining = 2800;
    let toastPaused = false;
    let confirmationResolver = null;
    let overlayReturnFocus = null;

    function typeGlyph(type) {
      return ({ string: "Aa", number: "#", integer: "#", boolean: "◐", datetime: "◷", date: "◷" })[type.toLowerCase()] || "Aa";
    }

    function levelPanel(levelIndex) {
      return ui.levelsRow.querySelector(`[data-level-index="${levelIndex}"]`);
    }

    function linkPanel(linkIndex) {
      return ui.levelsRow.querySelector(`[data-link-index="${linkIndex}"]`);
    }

    function levelMappedPaths(levelIndex) {
      const mapped = new Set();
      const incoming = state.links[levelIndex - 1];
      if (incoming) for (const mapping of incoming.mappings) mapped.add(mapping.targetPath);
      const outgoing = state.links[levelIndex];
      if (outgoing) for (const mapping of outgoing.mappings) mapped.add(mapping.sourcePath);
      return mapped;
    }

    function renderLevelTree(levelIndex, search = "") {
      const panel = levelPanel(levelIndex);
      if (!panel) return;
      const schema = state.levels[levelIndex];
      const tree = panel.querySelector("[data-level-tree]");
      const mapped = levelMappedPaths(levelIndex);
      const query = search.trim().toLowerCase();
      const groupTemplate = document.querySelector("#tree-group-template");
      const fieldTemplate = document.querySelector("#tree-field-template");
      const messageTemplate = document.querySelector("#tree-message-template");
      const canBeSource = levelIndex < state.levels.length - 1;
      function renderFields(fields, parentPath) {
        const fragment = document.createDocumentFragment();
        let hasVisibleFields = false;
        let leafCount = 0;
        for (const field of fields) {
          const path = `${parentPath}.${field.name}`;
          const isObject = Array.isArray(field.children) && field.children.length > 0;
          const children = isObject ? renderFields(field.children, path) : null;
          const ownMatch = `${field.name} ${path} ${field.type}`.toLowerCase().includes(query);
          if (query && !ownMatch && (!children || !children.hasVisibleFields)) continue;
          if (isObject) {
            const group = groupTemplate.content.firstElementChild.cloneNode(true);
            group.dataset.groupPath = path;
            group.querySelector("[data-group-name]").textContent = field.name;
            group.querySelector("[data-group-type]").textContent = field.type;
            group.querySelector("[data-group-children]").append(children.fragment);
            fragment.append(group);
            leafCount += children.leafCount;
            hasVisibleFields = true;
            continue;
          }
          leafCount += 1;
          const isSelected = state.selectedField?.levelIndex === levelIndex && state.selectedField.path === path;
          const pathWithoutRoot = path.slice(schema.root.length + 1);
          const button = fieldTemplate.content.firstElementChild.cloneNode(true);
          button.classList.toggle("active", isSelected);
          button.draggable = canBeSource;
          button.dataset.levelIndex = String(levelIndex);
          button.dataset.path = path;
          button.dataset.fieldPath = `${levelIndex}:${path}`;
          button.setAttribute("aria-pressed", String(isSelected));
          button.setAttribute("aria-label", `${pathWithoutRoot}, ${field.type}${mapped.has(path) ? ", mapped" : ""}`);
          button.querySelector("[data-field-glyph]").textContent = typeGlyph(field.type);
          button.querySelector("[data-field-name]").textContent = field.name;
          button.querySelector("[data-field-mapped]").hidden = !mapped.has(path);
          fragment.append(button);
          hasVisibleFields = true;
        }
        return { fragment, hasVisibleFields, leafCount };
      }
      const rendered = renderFields(schema.fields, schema.root);
      if (rendered.hasVisibleFields) tree.replaceChildren(rendered.fragment);
      else {
        const message = messageTemplate.content.firstElementChild.cloneNode(true);
        const text = message.querySelector("[data-tree-message]");
        const importButton = message.querySelector("[data-import-side]");
        if (schema.fields.length) {
          text.textContent = "No fields match your search.";
          importButton.remove();
        } else {
          text.textContent = `No schema loaded yet.`;
          importButton.dataset.importSide = String(levelIndex);
          importButton.textContent = `Import schema`;
        }
        tree.replaceChildren(message);
      }
      panel.querySelector("[data-level-field-count]").textContent = `${rendered.leafCount} fields`;
      panel.querySelector("[data-level-schema-name]").textContent = schema.name;
      panel.querySelector("[data-level-root]").textContent = schema.root || "Not loaded";
      panel.querySelector("[data-clear-schema]").disabled = !schema.fields.length;
    }

    function renderLinkMappings(linkIndex) {
      const panel = linkPanel(linkIndex);
      if (!panel) return;
      const link = state.links[linkIndex];
      const fromSchema = state.levels[linkIndex];
      const toSchema = state.levels[linkIndex + 1];
      const fromFields = fieldMap(fromSchema);
      const toFields = fieldMap(toSchema);
      const rowTemplate = document.querySelector("#mapping-row-template");
      const rows = document.createDocumentFragment();
      for (const mapping of link.mappings) {
        const source = fromFields.get(mapping.sourcePath);
        const target = toFields.get(mapping.targetPath);
        if (!source || !target) continue;
        const sourcePath = mapping.sourcePath.slice(fromSchema.root.length + 1);
        const targetPath = mapping.targetPath.slice(toSchema.root.length + 1);
        const row = rowTemplate.content.firstElementChild.cloneNode(true);
        row.classList.toggle("active", state.selectedMapping?.linkIndex === linkIndex && state.selectedMapping.id === mapping.id);
        row.dataset.mappingId = mapping.id;
        row.dataset.linkIndex = String(linkIndex);
        row.querySelector("[data-source-name]").textContent = source.name;
        row.querySelector("[data-source-path]").textContent = sourcePath;
        row.querySelector("[data-target-name]").textContent = target.name;
        row.querySelector("[data-target-path]").textContent = targetPath;
        const removeButton = row.querySelector("[data-remove-id]");
        removeButton.dataset.removeId = mapping.id;
        removeButton.dataset.linkIndex = String(linkIndex);
        removeButton.setAttribute("aria-label", `Remove mapping from ${source.name} to ${target.name}`);
        removeButton.querySelector("[data-remove-label]").textContent = `Remove mapping from ${source.name} to ${target.name}`;
        rows.append(row);
      }
      panel.querySelector("[data-link-list]").replaceChildren(rows);
      panel.querySelector("[data-link-clear]").disabled = !link.mappings.length;
      panel.querySelector("[data-link-export]").disabled = !link.mappings.length;
      const hasSchemas = fromSchema.fields.length > 0 && toSchema.fields.length > 0;
      const emptyState = panel.querySelector("[data-link-empty]");
      emptyState.hidden = link.mappings.length > 0;
      if (!link.mappings.length) {
        emptyState.querySelector("[data-link-empty-copy]").textContent = hasSchemas
          ? "Import a mapping file, or connect fields by selecting one on each side."
          : "Import schemas on both sides first so mapping field paths can be checked.";
      }
    }

    // Walks link[0..n-1] mappings and stitches adjacent segments (link[i].targetPath === link[i+1].sourcePath)
    // into mapping chains spanning all levels. Branches when a path fans out to more than one continuation.
    function buildMappingChains() {
      const links = state.links;
      const bySource = links.map((link) => {
        const map = new Map();
        for (const mapping of link.mappings) {
          if (!map.has(mapping.sourcePath)) map.set(mapping.sourcePath, []);
          map.get(mapping.sourcePath).push(mapping);
        }
        return map;
      });
      const targetPathSets = links.map((link) => new Set(link.mappings.map((mapping) => mapping.targetPath)));
      const chains = [];
      function finalize(segments) {
        const cells = new Array(state.levels.length).fill(null);
        for (const segment of segments) {
          cells[segment.linkIndex] = segment.mapping.sourcePath;
          cells[segment.linkIndex + 1] = segment.mapping.targetPath;
        }
        chains.push({ cells, segments: segments.map((segment) => ({ linkIndex: segment.linkIndex, id: segment.mapping.id })) });
      }
      function extend(path, nextLinkIndex, segments) {
        const continuations = nextLinkIndex < links.length ? bySource[nextLinkIndex].get(path) : null;
        if (!continuations || !continuations.length) {
          finalize(segments);
          return;
        }
        for (const mapping of continuations) {
          extend(mapping.targetPath, nextLinkIndex + 1, [...segments, { linkIndex: nextLinkIndex, mapping }]);
        }
      }
      for (let linkIndex = 0; linkIndex < links.length; linkIndex += 1) {
        for (const mapping of links[linkIndex].mappings) {
          const isContinuation = linkIndex > 0 && targetPathSets[linkIndex - 1].has(mapping.sourcePath);
          if (isContinuation) continue;
          extend(mapping.targetPath, linkIndex + 1, [{ linkIndex, mapping }]);
        }
      }
      return chains;
    }

    // Reserve fixed arrow tracks while preserving the rendered field-list start positions.
    function e2eColumnTemplate() {
      const arrowWidth = 22;
      const tracks = [];
      state.levels.forEach((_, levelIndex) => {
        const tree = levelPanel(levelIndex)?.querySelector("[data-level-tree]");
        const currentLeft = tree?.getBoundingClientRect().left || 0;
        if (levelIndex < state.levels.length - 1) {
          const nextTree = levelPanel(levelIndex + 1)?.querySelector("[data-level-tree]");
          const nextLeft = nextTree?.getBoundingClientRect().left || currentLeft;
          tracks.push(`${Math.max(0, nextLeft - currentLeft - arrowWidth)}px`, `${arrowWidth}px`);
        } else {
          const panelRight = levelPanel(levelIndex)?.getBoundingClientRect().right || currentLeft;
          tracks.push(`${Math.max(0, panelRight - currentLeft)}px`);
        }
      });
      return tracks.join(" ");
    }

    function renderEndToEndHeader() {
      const header = document.querySelector("#e2e-header");
      header.style.gridTemplateColumns = e2eColumnTemplate();
      const cells = [];
      state.levels.forEach((level, levelIndex) => {
        const cell = document.createElement("span");
        cell.className = "text-truncate";
        cell.textContent = level.label;
        cells.push(cell);
        if (levelIndex < state.levels.length - 1) cells.push(document.createElement("span"));
      });
      header.replaceChildren(...cells);
    }

    function renderEndToEndMappings() {
      const panel = document.querySelector("#e2e-panel");
      // Only meaningful once there's more than one link to chain together.
      if (state.levels.length < 3) {
        panel.classList.add("d-none");
        return;
      }
      panel.classList.remove("d-none");
      renderEndToEndHeader();
      const chains = buildMappingChains();
      document.querySelector("#e2e-empty").hidden = chains.length > 0;
      const fragment = document.createDocumentFragment();
      for (const [chainIndex, chain] of chains.entries()) {
        const row = document.createElement("article");
        row.className = "list-group-item d-flex align-items-center gap-2 position-relative px-0";
        const isActive = state.selectedChain?.length === chain.segments.length &&
          state.selectedChain.every((selected, index) => selected.linkIndex === chain.segments[index].linkIndex && selected.id === chain.segments[index].id);
        row.classList.toggle("active", isActive);
        row.dataset.chainIndex = String(chainIndex);
        row.dataset.chainSegments = JSON.stringify(chain.segments);
        const grid = document.createElement("div");
        grid.className = "d-grid align-items-center";
        grid.dataset.e2eGrid = "";
        grid.style.gridTemplateColumns = e2eColumnTemplate();
        chain.cells.forEach((path, levelIndex) => {
          const cell = document.createElement("div");
          cell.className = "px-3";
          cell.dataset.e2eCell = "";
          cell.dataset.connected = String(Boolean(path && chain.cells[levelIndex + 1]));
          if (path) {
            const schema = state.levels[levelIndex];
            const field = fieldMap(schema).get(path);
            const name = document.createElement("span");
            name.className = "d-block small text-truncate fw-semibold";
            name.textContent = field?.name || path;
            const fullPath = document.createElement("span");
            fullPath.className = "d-block small font-monospace text-body-secondary text-truncate";
            fullPath.textContent = path.slice(schema.root.length + 1);
            cell.append(name, fullPath);
          } else {
            cell.dataset.empty = "true";
            cell.className += " small text-body-secondary opacity-50 text-center";
            cell.textContent = "—";
          }
          grid.append(cell);
          if (levelIndex < chain.cells.length - 1) {
            const arrow = document.createElement("span");
            arrow.className = "text-body-secondary text-start";
            const connected = Boolean(path && chain.cells[levelIndex + 1]);
            arrow.dataset.connected = String(connected);
            arrow.classList.toggle("invisible", !connected);
            arrow.setAttribute("aria-hidden", "true");
            arrow.textContent = "→";
            grid.append(arrow);
          }
        });
        row.append(grid);
        fragment.append(row);
      }
      document.querySelector("#e2e-list").replaceChildren(fragment);
    }

    function buildLevelPanel(levelIndex) {
      const schema = state.levels[levelIndex];
      const template = document.querySelector("#level-panel-template");
      const panel = template.content.firstElementChild.cloneNode(true);
      panel.dataset.levelIndex = String(levelIndex);
      panel.dataset.levelKind = schema.kind;
      panel.style.gridColumn = String(levelIndex + 1);
      panel.setAttribute("aria-label", `${schema.label} fields`);
      panel.querySelector("[data-level-icon]").className = schema.kind === "source" ? "text-info" : "text-success";
      panel.querySelector("[data-level-title]").textContent = schema.label;
      panel.querySelector("[data-import-schema]").setAttribute("aria-label", `Import ${schema.label} schema`);
      panel.querySelector("[data-import-schema]").setAttribute("title", `Import ${schema.label} schema`);
      panel.querySelector("[data-clear-schema]").setAttribute("aria-label", `Clear ${schema.label} schema`);
      panel.querySelector("[data-clear-schema]").setAttribute("title", `Clear ${schema.label} schema`);
      const removeButton = panel.querySelector("[data-remove-level]");
      const targetLevelCount = state.levels.filter((level) => level.kind === "target").length;
      if (schema.kind === "target" && targetLevelCount > 1) {
        removeButton.hidden = false;
        removeButton.setAttribute("aria-label", `Remove ${schema.label}`);
        removeButton.setAttribute("title", `Remove ${schema.label}`);
      } else {
        removeButton.remove();
      }
      return panel;
    }

    function buildMappingCard(linkIndex) {
      const template = document.querySelector("#mapping-card-template");
      const panel = template.content.firstElementChild.cloneNode(true);
      panel.dataset.linkIndex = String(linkIndex);
      // Data-dependent spans and widths keep each mapping card aligned to its level columns.
      panel.style.gridColumn = `${linkIndex + 1} / span 2`;
      const isFirst = linkIndex === 0;
      const isLast = linkIndex === state.links.length - 1;
      if (isFirst && isLast) panel.style.width = "100%";
      else if (isFirst) { panel.style.width = "75%"; panel.dataset.align = "start"; }
      else if (isLast) { panel.style.width = "75%"; panel.dataset.align = "end"; }
      else panel.style.width = "50%";
      const from = state.levels[linkIndex];
      const to = state.levels[linkIndex + 1];
      panel.querySelector("[data-link-source-header]").textContent = from.label;
      panel.querySelector("[data-link-target-header]").textContent = to.label;
      const insertButton = panel.querySelector("[data-insert-level]");
      insertButton.setAttribute("aria-label", `Insert target level between ${from.label} and ${to.label}`);
      insertButton.setAttribute("title", `Insert target level between ${from.label} and ${to.label}`);
      return panel;
    }

    // Bootstrap has no utility for the variable track count or fixed track width in this shared grid.
    // Up to 3 levels use equal fluid tracks; above 3, fixed 300px tracks enable horizontal scrolling.
    function renderStructure() {
      // Fixed track width once scrolling kicks in, so existing columns never shrink as levels are added.
      const needsScroll = state.levels.length > 3;
      const columnTrack = needsScroll ? "300px" : "minmax(0, 1fr)";
      ui.levelsRow.style.gridTemplateColumns = `repeat(${state.levels.length}, ${columnTrack})`;
      // Avoid showing a horizontal scrollbar from sub-pixel grid rounding when columns already fit.
      ui.levelsRow.style.overflowX = needsScroll ? "auto" : "hidden";
      const levelsFragment = document.createDocumentFragment();
      for (let levelIndex = 0; levelIndex < state.levels.length; levelIndex += 1) {
        levelsFragment.append(buildLevelPanel(levelIndex));
        if (levelIndex < state.links.length) levelsFragment.append(buildMappingCard(levelIndex));
      }
      ui.levelsRow.replaceChildren(ui.connectors, levelsFragment, document.querySelector("#e2e-panel"));
    }

    const svgNamespace = "http://www.w3.org/2000/svg";

    function drawConnectors() {
      const row = ui.levelsRow;
      const rowRect = row.getBoundingClientRect();
      if (!rowRect.width) {
        ui.connectors.classList.add("d-none");
        ui.connectors.querySelectorAll("[data-connector-path]").forEach((path) => path.remove());
        return;
      }
      ui.connectors.classList.remove("d-none");
      ui.connectors.setAttribute("width", "0");
      ui.connectors.setAttribute("height", "0");
      const width = row.scrollWidth;
      const height = row.scrollHeight;
      ui.connectors.setAttribute("width", String(width));
      ui.connectors.setAttribute("height", String(height));
      ui.connectors.setAttribute("viewBox", `0 0 ${width} ${height}`);
      ui.connectors.setAttribute("preserveAspectRatio", "none");
      ui.connectors.querySelectorAll("[data-connector-path]").forEach((path) => path.remove());
      const offsetX = row.scrollLeft - rowRect.left;
      const offsetY = row.scrollTop - rowRect.top;
      for (let linkIndex = 0; linkIndex < state.links.length; linkIndex += 1) {
        const fromPanel = levelPanel(linkIndex);
        const toPanel = levelPanel(linkIndex + 1);
        if (!fromPanel || !toPanel) continue;
        for (const mapping of state.links[linkIndex].mappings) {
          const source = fromPanel.querySelector(`[data-field-path="${CSS.escape(`${linkIndex}:${mapping.sourcePath}`)}"]`);
          const target = toPanel.querySelector(`[data-field-path="${CSS.escape(`${linkIndex + 1}:${mapping.targetPath}`)}"]`);
          if (!source || !target) continue;
          const sourceBounds = source.getBoundingClientRect();
          const targetBounds = target.getBoundingClientRect();
          const sx = sourceBounds.right + offsetX - 1;
          const sy = sourceBounds.top + sourceBounds.height / 2 + offsetY;
          const tx = targetBounds.left + offsetX + 1;
          const ty = targetBounds.top + targetBounds.height / 2 + offsetY;
          const selected = (state.selectedMapping?.linkIndex === linkIndex && state.selectedMapping.id === mapping.id) ||
            (state.selectedChain?.some((segment) => segment.linkIndex === linkIndex && segment.id === mapping.id) ?? false);
          const bend = Math.max(32, (tx - sx) * 0.42);
          const path = document.createElementNS(svgNamespace, "path");
          path.dataset.connectorPath = "true";
          path.setAttribute("d", `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", selected ? "#ca7958" : "#8cab94");
          path.setAttribute("stroke-width", selected ? "2" : "1.5");
          path.setAttribute("opacity", selected ? ".95" : ".72");
          path.setAttribute("marker-end", `url(#connector-arrow${selected ? "-selected" : ""})`);
          ui.connectors.append(path);
        }
      }
    }

    function renderAll() {
      renderStructure();
      for (let levelIndex = 0; levelIndex < state.levels.length; levelIndex += 1) {
        renderLevelTree(levelIndex, "");
      }
      for (let linkIndex = 0; linkIndex < state.links.length; linkIndex += 1) {
        renderLinkMappings(linkIndex);
      }
      renderEndToEndMappings();
      const totalMappings = state.links.reduce((sum, link) => sum + link.mappings.length, 0);
      document.querySelector("#export-all-button").disabled = totalMappings === 0;
      document.querySelector("#clear-all-button").disabled =
        !state.levels.some((level) => level.fields.length) && totalMappings === 0 && state.levels.length <= 2;
      requestAnimationFrame(drawConnectors);
    }

    function refreshTrees() {
      for (let levelIndex = 0; levelIndex < state.levels.length; levelIndex += 1) {
        const panel = levelPanel(levelIndex);
        const search = panel?.querySelector("[data-level-search]")?.value || "";
        renderLevelTree(levelIndex, search);
      }
      requestAnimationFrame(drawConnectors);
    }

    function showToast(message, isError = false) {
      clearTimeout(toastTimer);
      ui.toastMessage.textContent = message;
      ui.toast.classList.toggle("text-bg-danger", isError);
      ui.toast.classList.add("show");
      toastRemaining = 2800;
      toastPaused = ui.toast.matches(":hover");
      if (!toastPaused) scheduleToastDismissal();
    }

    function scheduleToastDismissal() {
      toastDeadline = performance.now() + toastRemaining;
      toastTimer = setTimeout(() => ui.toast.classList.remove("show"), toastRemaining);
    }

    ui.toast.addEventListener("pointerenter", () => {
      if (!ui.toast.classList.contains("show") || toastPaused) return;
      clearTimeout(toastTimer);
      toastRemaining = Math.max(0, toastDeadline - performance.now());
      toastPaused = true;
    });
    ui.toast.addEventListener("pointerleave", () => {
      if (!toastPaused || ui.toast.matches(":hover")) return;
      toastPaused = false;
      scheduleToastDismissal();
    });

    function showOverlay(panel) {
      overlayReturnFocus = document.activeElement;
      ui.exportDialog.hidden = panel !== ui.exportDialog;
      ui.confirmationDialog.hidden = panel !== ui.confirmationDialog;
      ui.sampleDialog.hidden = panel !== ui.sampleDialog;
      ui.overlay.classList.remove("d-none");
      ui.overlay.classList.add("d-flex");
      ui.overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("overflow-hidden");
      (panel.querySelector("textarea") || panel.querySelector("button"))?.focus();
    }

    function hideOverlay(result = false) {
      ui.overlay.classList.remove("d-flex");
      ui.overlay.classList.add("d-none");
      ui.overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("overflow-hidden");
      ui.exportDialog.hidden = true;
      ui.confirmationDialog.hidden = true;
      ui.sampleDialog.hidden = true;
      if (confirmationResolver) {
        confirmationResolver(result);
        confirmationResolver = null;
      }
      if (overlayReturnFocus instanceof HTMLElement) overlayReturnFocus.focus();
    }

    function requestConfirmation(title, message, confirmLabel) {
      document.querySelector("#confirmation-title").textContent = title;
      ui.confirmationMessage.textContent = message;
      document.querySelector("#accept-confirmation").textContent = confirmLabel;
      showOverlay(ui.confirmationDialog);
      return new Promise((resolve) => { confirmationResolver = resolve; });
    }

    function openSampleDialog(samples) {
      const fragment = document.createDocumentFragment();
      for (const sample of samples) {
        const button = document.createElement("button");
        button.className = "list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3";
        button.type = "button";
        button.dataset.sampleId = sample.id;
        const name = document.createElement("strong");
        name.textContent = sample.name;
        const description = document.createElement("span");
        description.className = "text-body-secondary small";
        description.textContent = sample.description;
        button.append(name, description);
        fragment.append(button);
      }
      ui.sampleDialogList.replaceChildren(fragment);
      showOverlay(ui.sampleDialog);
    }

    function parseXmlDocument(text) {
      const documentNode = new DOMParser().parseFromString(text, "application/xml");
      function serializeElement(element) {
        const children = [];
        const textNodes = [];
        for (const child of Array.from(element.childNodes || [])) {
          if (child.nodeType === 1) children.push(serializeElement(child));
          else if (child.nodeType === 3 || child.nodeType === 4) textNodes.push(child.textContent);
        }
        return {
          localName: element.localName || element.nodeName.split(":").pop(),
          nodeName: element.nodeName,
          namespaceURI: element.namespaceURI,
          attributes: Array.from(element.attributes || [], (attribute) => ({
            name: attribute.name,
            localName: attribute.localName || attribute.name.split(":").pop(),
            namespaceURI: attribute.namespaceURI,
            value: attribute.value
          })),
          children,
          textNodes
        };
      }
      return {
        hasParseError: documentNode.getElementsByTagName("parsererror").length > 0,
        root: documentNode.documentElement ? serializeElement(documentNode.documentElement) : null
      };
    }

    function resetSearch() {
      ui.levelsRow.querySelectorAll("[data-level-search]").forEach((input) => { input.value = ""; });
    }

    function requestMappingFile(linkIndex) {
      ui.mappingFile.dataset.pendingLinkIndex = String(linkIndex);
      ui.mappingFile.click();
    }

    function requestSchemaFile(levelIndex) {
      ui.levelSchemaFile.dataset.pendingLevelIndex = String(levelIndex);
      ui.levelSchemaFile.click();
    }

    function showExportPreview(json, { title, filename }) {
      document.querySelector("#mapping-export-preview").value = json;
      document.querySelector("#mapping-export-title").textContent = title;
      document.querySelector("#download-mapping-export").dataset.filename = filename;
      const status = document.querySelector("#mapping-export-status");
      status.textContent = "";
      status.classList.remove("text-danger");
      showOverlay(ui.exportDialog);
    }

    async function downloadExport(json, filename) {
      const status = document.querySelector("#mapping-export-status");
      const downloadButton = document.querySelector("#download-mapping-export");
      try {
        downloadButton.disabled = true;
        if (typeof window.showSaveFilePicker === "function") {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "JSON mapping", accept: { "application/json": [".json"] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(json);
          await writable.close();
        } else {
          const blobUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = filename;
          document.body.append(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        }
        hideOverlay();
        showToast("Exported JSON file.");
      } catch (error) {
        if (error && error.name === "AbortError") {
          status.textContent = "Save cancelled.";
        } else {
          status.textContent = error instanceof Error ? `Could not export JSON: ${error.message}` : "Could not export JSON.";
          status.classList.add("text-danger");
        }
      } finally {
        downloadButton.disabled = false;
      }
    }

    function readSelectedFile(input, handler) {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener("load", () => handler(String(reader.result), file.name));
      reader.addEventListener("error", () => showToast("The selected file could not be read.", true));
      reader.addEventListener("loadend", () => { input.value = ""; }, { once: true });
      reader.readAsText(file);
    }

    function bind(handlers) {
      function closestLevelIndex(target) {
        const panel = target.closest("[data-level-index]");
        return panel ? Number(panel.dataset.levelIndex) : null;
      }
      function closestLinkIndex(target) {
        const panel = target.closest("[data-link-index]");
        return panel ? Number(panel.dataset.linkIndex) : null;
      }

      ui.levelsRow.addEventListener("click", (event) => {
        const importSide = event.target.closest("[data-import-side]");
        if (importSide) {
          requestSchemaFile(Number(importSide.dataset.importSide));
          return;
        }
        const groupLabel = event.target.closest("[data-ui='tree-group-label']");
        if (groupLabel) {
          const group = groupLabel.parentElement;
          const collapsed = group.dataset.collapsed !== "true";
          group.dataset.collapsed = String(collapsed);
          groupLabel.nextElementSibling.hidden = collapsed;
          groupLabel.setAttribute("aria-expanded", String(!collapsed));
          groupLabel.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${group.dataset.groupPath.split(".").pop()} fields`);
          requestAnimationFrame(drawConnectors);
          return;
        }
        const field = event.target.closest("[data-ui='tree-field']");
        if (field) {
          handlers.onFieldClick(Number(field.dataset.levelIndex), field.dataset.path);
          return;
        }
        const importSchema = event.target.closest("[data-import-schema]");
        if (importSchema) {
          requestSchemaFile(closestLevelIndex(importSchema));
          return;
        }
        const clearSchema = event.target.closest("[data-clear-schema]");
        if (clearSchema) {
          handlers.onClearSchema(closestLevelIndex(clearSchema));
          return;
        }
        const removeLevel = event.target.closest("[data-remove-level]");
        if (removeLevel) {
          handlers.onRemoveLevel(closestLevelIndex(removeLevel));
        }
      });

      document.querySelector("#e2e-list").addEventListener("click", (event) => {
        const row = event.target.closest("[data-chain-segments]");
        if (!row) return;
        const segments = JSON.parse(row.dataset.chainSegments);
        handlers.onSelectChain(segments);
      });

      ui.levelsRow.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-id]");
        if (remove) {
          handlers.onRemoveMapping(Number(remove.dataset.linkIndex), remove.dataset.removeId);
          return;
        }
        const card = event.target.closest("[data-mapping-id]");
        if (card) {
          handlers.onSelectMapping(Number(card.dataset.linkIndex), card.dataset.mappingId);
          return;
        }
        const linkImport = event.target.closest("[data-link-import]");
        if (linkImport) {
          handlers.onImportMappings(closestLinkIndex(linkImport));
          return;
        }
        const insertLevel = event.target.closest("[data-insert-level]");
        if (insertLevel) {
          handlers.onInsertLevel(closestLinkIndex(insertLevel));
          return;
        }
        const linkExport = event.target.closest("[data-link-export]");
        if (linkExport) {
          handlers.onOpenExport(closestLinkIndex(linkExport));
          return;
        }
        const linkClear = event.target.closest("[data-link-clear]");
        if (linkClear) {
          handlers.onClearMappings(closestLinkIndex(linkClear));
        }
      });

      ui.levelsRow.addEventListener("input", (event) => {
        const search = event.target.closest("[data-level-search]");
        if (search) renderLevelTree(closestLevelIndex(search), search.value);
      });

      ui.levelsRow.addEventListener("dragstart", (event) => {
        const field = event.target.closest("[data-ui='tree-field']");
        if (!field || field.draggable !== true) return;
        event.dataTransfer.setData("text/plain", field.dataset.path);
        event.dataTransfer.effectAllowed = "link";
        field.classList.add("active");
        handlers.onDragStart(Number(field.dataset.levelIndex), field.dataset.path);
      });
      ui.levelsRow.addEventListener("dragend", handlers.onDragEnd);
      ui.levelsRow.addEventListener("dragover", (event) => {
        const field = event.target.closest("[data-ui='tree-field']");
        if (!field || !state.dragSource) return;
        const levelIndex = closestLevelIndex(field);
        if (levelIndex !== state.dragSource.levelIndex + 1) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "link";
      });
      ui.levelsRow.addEventListener("drop", (event) => {
        const field = event.target.closest("[data-ui='tree-field']");
        if (!field || !state.dragSource) return;
        const levelIndex = closestLevelIndex(field);
        if (levelIndex !== state.dragSource.levelIndex + 1) return;
        event.preventDefault();
        handlers.onDrop(levelIndex, field.dataset.path);
      });
      ui.levelsRow.addEventListener("scroll", () => requestAnimationFrame(drawConnectors));

      document.querySelector("#add-level-button").addEventListener("click", handlers.onAddLevel);
      document.querySelector("#import-all-button").addEventListener("click", () => ui.mappingAllFile.click());
      document.querySelector("#export-all-button").addEventListener("click", handlers.onOpenExportAll);
      document.querySelector("#load-sample-button").addEventListener("click", handlers.onLoadSample);
      document.querySelector("#clear-all-button").addEventListener("click", handlers.onClearAll);
      document.querySelector("#download-mapping-export").addEventListener("click", () => {
        const json = document.querySelector("#mapping-export-preview").value;
        const filename = document.querySelector("#download-mapping-export").dataset.filename;
        if (json && filename) downloadExport(json, filename);
      });
      document.querySelector("#close-mapping-export").addEventListener("click", () => hideOverlay());
      document.querySelector("#cancel-mapping-export").addEventListener("click", () => hideOverlay());
      document.querySelector("#cancel-confirmation-close").addEventListener("click", () => hideOverlay(false));
      document.querySelector("#cancel-confirmation").addEventListener("click", () => hideOverlay(false));
      document.querySelector("#accept-confirmation").addEventListener("click", () => hideOverlay(true));
      document.querySelector("#close-sample-dialog").addEventListener("click", () => hideOverlay(false));
      ui.sampleDialogList.addEventListener("click", (event) => {
        const sampleId = event.target.closest("[data-sample-id]")?.dataset.sampleId;
        if (sampleId) handlers.onSelectSample(sampleId);
      });
      ui.overlay.addEventListener("click", (event) => {
        if (event.target === ui.overlay) hideOverlay(false);
      });
      ui.levelSchemaFile.addEventListener("change", () => readSelectedFile(ui.levelSchemaFile, (text, name) => {
        const xmlDocument = text.trimStart().startsWith("<") ? parseXmlDocument(text) : null;
        handlers.onSchemaFile(Number(ui.levelSchemaFile.dataset.pendingLevelIndex), text, name, xmlDocument);
      }));
      ui.mappingFile.addEventListener("change", () => readSelectedFile(ui.mappingFile, (text) =>
        handlers.onMappingFile(Number(ui.mappingFile.dataset.pendingLinkIndex), text)));
      ui.mappingAllFile.addEventListener("change", () => readSelectedFile(ui.mappingAllFile, (text) =>
        handlers.onAllMappingsFile(text)));
      document.addEventListener("keydown", (event) => {
        if (ui.overlay.getAttribute("aria-hidden") === "false") {
          if (event.key === "Escape") {
            event.preventDefault();
            hideOverlay(false);
            return;
          }
          if (event.key === "Tab") {
            const panel = [ui.exportDialog, ui.confirmationDialog, ui.sampleDialog].find((candidate) => !candidate.hidden);
            const focusable = Array.from(panel.querySelectorAll("button:not(:disabled), textarea:not(:disabled)"));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
          return;
        }
        if (event.key === "Escape") handlers.onClearSelection();
      });
    }

    return {
      bind, renderLevelTree, renderLinkMappings, renderEndToEndMappings, renderAll, refreshTrees, drawConnectors,
      showToast, hideOverlay, requestConfirmation, resetSearch, openSampleDialog,
      requestMappingFile, showExportPreview
    };
}