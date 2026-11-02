export function createMapperView(state, { fieldMap, mappingSourcePaths }) {
    const ui = {
      layout: document.querySelector("#mapping-layout"),
      connectors: document.querySelector("#connector-layer"),
      sourceTree: document.querySelector("#source-tree"),
      targetTree: document.querySelector("#target-tree"),
      list: document.querySelector("#mapping-list"),
      count: document.querySelector("#mapping-count"),
      summary: document.querySelector("#mapping-summary"),
      hint: document.querySelector("#mapping-hint"),
      status: document.querySelector("#footer-status-text"),
      toast: document.querySelector("#toast"),
      toastMessage: document.querySelector("#toast-message"),
      overlay: document.querySelector("#dialog-overlay"),
      exportDialog: document.querySelector("#mapping-export-dialog"),
      confirmationDialog: document.querySelector("#confirmation-dialog"),
      confirmationMessage: document.querySelector("#confirmation-message"),
      sourceSearch: document.querySelector("#source-search"),
      targetSearch: document.querySelector("#target-search"),
      sourceSchemaFile: document.querySelector("#source-schema-file"),
      targetSchemaFile: document.querySelector("#target-schema-file"),
      mappingFile: document.querySelector("#mapping-file"),
      sourceFieldCount: document.querySelector("#source-field-count"),
      targetFieldCount: document.querySelector("#target-field-count")
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

    function renderTree(schema, side, search = "") {
      const mapped = new Set(state.mappings.flatMap((item) =>
        side === "source" ? mappingSourcePaths(item) : [item.targetPath]
      ));
      const query = search.trim().toLowerCase();
      const groupTemplate = document.querySelector("#tree-group-template");
      const fieldTemplate = document.querySelector("#tree-field-template");
      const messageTemplate = document.querySelector("#tree-message-template");
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
          const isSelected = side === "source" && state.selectedSource === path;
          const pathWithoutRoot = path.slice(schema.root.length + 1);
          const button = fieldTemplate.content.firstElementChild.cloneNode(true);
          button.classList.toggle("active", isSelected);
          button.draggable = side === "source";
          button.dataset.side = side;
          button.dataset.path = path;
          button.dataset.fieldPath = `${side}:${path}`;
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
      const tree = side === "source" ? ui.sourceTree : ui.targetTree;
      if (rendered.hasVisibleFields) tree.replaceChildren(rendered.fragment);
      else {
        const message = messageTemplate.content.firstElementChild.cloneNode(true);
        const text = message.querySelector("[data-tree-message]");
        const importButton = message.querySelector("[data-import-side]");
        if (schema.fields.length) {
          text.textContent = "No fields match your search.";
          importButton.remove();
        } else {
          text.textContent = `No ${side} schema loaded yet.`;
          importButton.dataset.importSide = side;
          importButton.textContent = `Import ${side} schema`;
        }
        tree.replaceChildren(message);
      }
      (side === "source" ? ui.sourceFieldCount : ui.targetFieldCount).textContent = `${rendered.leafCount} fields`;
    }

    function updateHint(message) {
      const text = ui.hint.querySelector("span:nth-child(2)");
      if (message) text.textContent = message;
      else if (state.selectedSource) text.textContent = `${fieldMap(state.source).get(state.selectedSource)?.name || state.selectedSource} selected — choose a target field`;
      else if (!state.source.fields.length || !state.target.fields.length) {
        const missing = [];
        if (!state.source.fields.length) missing.push("source");
        if (!state.target.fields.length) missing.push("target");
        text.textContent = `Import ${missing.join(" and ")} schema${missing.length > 1 ? "s" : ""} to begin mapping`;
      } else text.textContent = "Select a source field to get started";
    }

    function renderMappings() {
      const sourceFields = fieldMap(state.source);
      const targetFields = fieldMap(state.target);
      const rowTemplate = document.querySelector("#mapping-row-template");
      const rows = document.createDocumentFragment();
      for (const mapping of state.mappings) {
        const sources = mappingSourcePaths(mapping).map((path) => sourceFields.get(path));
        const target = targetFields.get(mapping.targetPath);
        if (sources.some((source) => !source) || !target) continue;
        const sourceNames = sources.map((source) => source.name);
        const sourcePath = mappingSourcePaths(mapping).map((path) => path.slice(state.source.root.length + 1)).join(" + ");
        const targetPath = mapping.targetPath.slice(state.target.root.length + 1);
        const row = rowTemplate.content.firstElementChild.cloneNode(true);
        row.classList.toggle("active", state.selectedMapping === mapping.id);
        row.dataset.mappingId = mapping.id;
        row.querySelector("[data-source-name]").textContent = sourceNames.join(" + ");
        row.querySelector("[data-source-path]").textContent = sourcePath;
        row.querySelector("[data-target-name]").textContent = target.name;
        row.querySelector("[data-target-path]").textContent = targetPath;
        const removeButton = row.querySelector("[data-remove-id]");
        removeButton.dataset.removeId = mapping.id;
        removeButton.setAttribute("aria-label", `Remove mapping from ${sourceNames.join(" and ")} to ${target.name}`);
        removeButton.querySelector("[data-remove-label]").textContent = `Remove mapping from ${sourceNames.join(" and ")} to ${target.name}`;
        rows.append(row);
      }
      ui.list.replaceChildren(rows);
      ui.count.textContent = String(state.mappings.length);
      const columns = document.querySelector("#mapping-columns");
      columns.hidden = !state.mappings.length;
      const hasSchemas = state.source.fields.length > 0 && state.target.fields.length > 0;
      document.querySelector("#clear-mappings").disabled = !state.mappings.length;
      document.querySelector("#export-mappings-button").disabled = !state.mappings.length;
      const emptyState = document.querySelector("#empty-state");
      emptyState.hidden = state.mappings.length > 0;
      if (!state.mappings.length) {
        emptyState.querySelector("#empty-state-copy").textContent = hasSchemas
          ? "Import a mapping file, or connect fields by selecting a source and target."
          : "Import source and target schemas first so mapping field paths can be checked.";
      }
      ui.summary.textContent = state.mappings.length
        ? `${state.mappings.length} field${state.mappings.length === 1 ? "" : "s"} connected`
        : "";
      ui.status.textContent = state.mappings.length
        ? `${state.mappings.length} mapping${state.mappings.length === 1 ? "" : "s"} ready`
        : hasSchemas ? "Ready to map" : "Import schemas to begin";
      updateHint();
    }

    function drawConnectors() {
      if (!ui.layout.getBoundingClientRect().width || window.matchMedia("(max-width: 767.98px)").matches) {
        ui.connectors.classList.add("d-none");
        ui.connectors.querySelectorAll("[data-connector-path]").forEach((path) => path.remove());
        return;
      }
      ui.connectors.classList.remove("d-none");
      const rect = ui.connectors.getBoundingClientRect();
      ui.connectors.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
      ui.connectors.setAttribute("preserveAspectRatio", "none");
      ui.connectors.querySelectorAll("[data-connector-path]").forEach((path) => path.remove());
      for (const mapping of state.mappings) {
        const target = ui.targetTree.querySelector(`[data-field-path="${CSS.escape(`target:${mapping.targetPath}`)}"]`);
        if (!target) continue;
        const targetBounds = target.getBoundingClientRect();
        const tx = targetBounds.left - rect.left + 1;
        const ty = targetBounds.top + targetBounds.height / 2 - rect.top;
        const selected = state.selectedMapping === mapping.id;
        for (const sourcePath of mappingSourcePaths(mapping)) {
          const source = ui.sourceTree.querySelector(`[data-field-path="${CSS.escape(`source:${sourcePath}`)}"]`);
          if (!source) continue;
          const sourceBounds = source.getBoundingClientRect();
          const sx = sourceBounds.right - rect.left - 1;
          const sy = sourceBounds.top + sourceBounds.height / 2 - rect.top;
          const bend = Math.max(32, (tx - sx) * 0.42);
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
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
      document.querySelector("#source-schema-name").textContent = state.source.name;
      document.querySelector("#target-schema-name").textContent = state.target.name;
      document.querySelector("#clear-source-schema").disabled = !state.source.fields.length;
      document.querySelector("#clear-target-schema").disabled = !state.target.fields.length;
      document.querySelector("#source-root-name").textContent = state.source.root || "Not loaded";
      document.querySelector("#target-root-name").textContent = state.target.root || "Not loaded";
      document.querySelector("#source-footnote-text").textContent = state.source.fields.length
        ? "Drag a field or select it to begin"
        : "Import a schema to see source fields";
      document.querySelector("#target-footnote-text").textContent = state.target.fields.length
        ? "Unmapped fields are ready to connect"
        : "Import a schema to see target fields";
      ui.sourceSearch.disabled = !state.source.fields.length;
      ui.targetSearch.disabled = !state.target.fields.length;
      renderTree(state.source, "source", ui.sourceSearch.value);
      renderTree(state.target, "target", ui.targetSearch.value);
      renderMappings();
      requestAnimationFrame(drawConnectors);
    }

    function refreshTrees() {
      renderTree(state.source, "source", ui.sourceSearch.value);
      renderTree(state.target, "target", ui.targetSearch.value);
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

    function resetSearch() {
      ui.sourceSearch.value = "";
      ui.targetSearch.value = "";
    }

    function requestMappingFile() {
      ui.mappingFile.click();
    }

    function requestSchemaFile(side) {
      (side === "source" ? ui.sourceSchemaFile : ui.targetSchemaFile).click();
    }

    function showExportPreview(json) {
      document.querySelector("#mapping-export-preview").value = json;
      const status = document.querySelector("#mapping-export-status");
      status.textContent = "";
      status.classList.remove("text-danger");
      showOverlay(ui.exportDialog);
    }

    async function downloadExport(json) {
      const status = document.querySelector("#mapping-export-status");
      const downloadButton = document.querySelector("#download-mapping-export");
      try {
        downloadButton.disabled = true;
        if (typeof window.showSaveFilePicker === "function") {
          const handle = await window.showSaveFilePicker({
            suggestedName: "fieldwork-mappings.json",
            types: [{ description: "JSON mapping", accept: { "application/json": [".json"] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(json);
          await writable.close();
        } else {
          const blobUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = "fieldwork-mappings-only.json";
          document.body.append(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        }
        hideOverlay();
        showToast("Mapping exported as JSON.");
      } catch (error) {
        if (error && error.name === "AbortError") {
          status.textContent = "Save cancelled.";
        } else {
          status.textContent = error instanceof Error ? `Could not export mapping: ${error.message}` : "Could not export mapping.";
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
      function handleTreeClick(side, event) {
        if (event.target.closest(`[data-import-side='${side}']`)) {
          requestSchemaFile(side);
          return;
        }
        const field = event.target.closest("[data-ui='tree-field']");
        if (field) handlers.onFieldClick(field.dataset);
      }
      function toggleGroup(event) {
        const button = event.target.closest("[data-ui='tree-group-label']");
        if (!button) return;
        const group = button.parentElement;
        const collapsed = group.dataset.collapsed !== "true";
        group.dataset.collapsed = String(collapsed);
        button.nextElementSibling.hidden = collapsed;
        button.setAttribute("aria-expanded", String(!collapsed));
        button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${group.dataset.groupPath.split(".").pop()} fields`);
        requestAnimationFrame(drawConnectors);
      }

      ui.sourceTree.addEventListener("click", (event) => handleTreeClick("source", event));
      ui.targetTree.addEventListener("click", (event) => handleTreeClick("target", event));
      ui.sourceTree.addEventListener("click", toggleGroup);
      ui.targetTree.addEventListener("click", toggleGroup);
      ui.sourceTree.addEventListener("dragstart", (event) => {
        const field = event.target.closest("[data-ui='tree-field']");
        if (!field) return;
        event.dataTransfer.setData("text/plain", field.dataset.path);
        event.dataTransfer.effectAllowed = "link";
        field.classList.add("active");
        handlers.onDragStart(field.dataset);
      });
      ui.sourceTree.addEventListener("dragend", handlers.onDragEnd);
      ui.targetTree.addEventListener("dragover", (event) => {
        if (!event.target.closest("[data-ui='tree-field']") || !state.dragSource) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "link";
      });
      ui.targetTree.addEventListener("drop", (event) => {
        const field = event.target.closest("[data-ui='tree-field']");
        if (!field || !state.dragSource) return;
        event.preventDefault();
        handlers.onDrop(field.dataset);
      });
      ui.list.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-id]");
        if (remove) {
          handlers.onRemoveMapping(remove.dataset);
          return;
        }
        const card = event.target.closest("[data-mapping-id]");
        if (card && !event.target.closest("select")) handlers.onSelectMapping(card.dataset);
      });
      ui.sourceSearch.addEventListener("input", () => renderTree(state.source, "source", ui.sourceSearch.value));
      ui.targetSearch.addEventListener("input", () => renderTree(state.target, "target", ui.targetSearch.value));
      document.querySelector("#clear-mappings").addEventListener("click", handlers.onClearMappings);
      document.querySelector("#export-mappings-button").addEventListener("click", handlers.onOpenExport);
      document.querySelector("#download-mapping-export").addEventListener("click", () => {
        const json = handlers.onGetExportJson();
        if (json) downloadExport(json);
      });
      document.querySelector("#close-mapping-export").addEventListener("click", () => hideOverlay());
      document.querySelector("#cancel-mapping-export").addEventListener("click", () => hideOverlay());
      document.querySelector("#cancel-confirmation-close").addEventListener("click", () => hideOverlay(false));
      document.querySelector("#cancel-confirmation").addEventListener("click", () => hideOverlay(false));
      document.querySelector("#accept-confirmation").addEventListener("click", () => hideOverlay(true));
      ui.overlay.addEventListener("click", (event) => {
        if (event.target === ui.overlay) hideOverlay(false);
      });
      document.querySelector("#load-sample-button").addEventListener("click", handlers.onLoadSample);
      document.querySelector("#import-mappings-button").addEventListener("click", handlers.onImportMappings);
      document.querySelector("#clear-source-schema").addEventListener("click", () => handlers.onClearSchema("source"));
      document.querySelector("#clear-target-schema").addEventListener("click", () => handlers.onClearSchema("target"));
      document.querySelector("#empty-state").addEventListener("click", (event) => {
        if (event.target.closest("#empty-load-mapping")) handlers.onImportMappings();
      });
      ui.sourceSchemaFile.addEventListener("change", () => readSelectedFile(ui.sourceSchemaFile, handlers.onSourceSchemaFile));
      ui.targetSchemaFile.addEventListener("change", () => readSelectedFile(ui.targetSchemaFile, handlers.onTargetSchemaFile));
      ui.mappingFile.addEventListener("change", () => readSelectedFile(ui.mappingFile, handlers.onMappingFile));
      document.querySelector("#source-menu").addEventListener("click", () => ui.sourceSchemaFile.click());
      document.querySelector("#target-menu").addEventListener("click", () => ui.targetSchemaFile.click());
      document.addEventListener("keydown", (event) => {
        if (ui.overlay.getAttribute("aria-hidden") === "false") {
          if (event.key === "Escape") {
            event.preventDefault();
            hideOverlay(false);
            return;
          }
          if (event.key === "Tab") {
            const panel = ui.exportDialog.hidden ? ui.confirmationDialog : ui.exportDialog;
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
        if (event.key === "/" && !event.target.matches("input, textarea, select, [contenteditable='true']")) {
          event.preventDefault();
          ui.sourceSearch.focus();
        }
      });
      window.addEventListener("resize", drawConnectors);
    }

    return {
      bind, renderTree, renderMappings, renderAll, refreshTrees, drawConnectors,
      updateHint, showToast, hideOverlay, requestConfirmation, resetSearch,
      requestMappingFile, showExportPreview
    };
}