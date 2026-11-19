import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Circle,
  Copy,
  Download,
  ImagePlus,
  Plus,
  Presentation as PresentationIcon,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  ChartNoAxesColumn,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  MAX_DECK_IMAGE_DATA,
  MAX_ELEMENTS,
  MAX_IMAGE_BYTES,
  MAX_SLIDES,
  type PresentationElement,
  type Slide,
} from "@contract/presentations";
import { useI18n } from "@/i18n";
import { SlideCanvas } from "./SlideCanvas";
import { PresentationInspector } from "./PresentationInspector";
import {
  copySlide,
  createDeck,
  createElement,
  createSlide,
  moveItem,
  updateElement,
  type SlideLayout,
} from "./presentation-editor";
import { usePresentationLibrary } from "./usePresentationLibrary";
import { PresentationSkillWorkspace } from "./PresentationSkillWorkspace";
import "./PresentationWorkspace.css";

async function readImage(file: File): Promise<Extract<PresentationElement, { kind: "image" }>> {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > MAX_IMAGE_BYTES) throw new Error();
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(620 / bitmap.width, 460 / bitmap.height);
  const w = Math.max(24, Math.round(bitmap.width * scale));
  const h = Math.max(24, Math.round(bitmap.height * scale));
  bitmap.close();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error()));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { kind: "image", id: crypto.randomUUID(), x: 100, y: 110, w, h, data, alt: file.name.slice(0, 120) };
}

function SlidePreview({ slides, initialIndex, close }: { slides: Slide[]; initialIndex: number; close: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const change = (step: number) => setIndex((previous) => Math.min(slides.length - 1, Math.max(0, previous + step)));
  return (
    <dialog
      ref={dialog}
      className="ppt-preview"
      aria-label={t("pptPreview", "Preview")}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") change(-1);
        if (event.key === "ArrowRight") change(1);
      }}
    >
      <div className="ppt-preview-body">
        <SlideCanvas slide={slides[index]} />
      </div>
      <div className="ppt-controls ppt-preview-controls">
        <button
          className="ppt-icon"
          type="button"
          disabled={index === 0}
          aria-label={t("pptPrevious", "Previous slide")}
          onClick={() => change(-1)}
        >
          <ArrowLeft />
        </button>
        <span>
          {index + 1} / {slides.length}
        </span>
        <button
          className="ppt-icon"
          type="button"
          disabled={index === slides.length - 1}
          aria-label={t("pptNext", "Next slide")}
          onClick={() => change(1)}
        >
          <ArrowRight />
        </button>
        <button className="ppt-icon" type="button" aria-label={t("pptClosePreview", "Close preview")} onClick={close}>
          <X />
        </button>
      </div>
    </dialog>
  );
}

function slideImageSize(slide: Slide): number {
  return slide.elements.reduce((sum, element) => sum + (element.kind === "image" ? element.data.length : 0), 0);
}

function NativePresentationWorkspace({
  cwd,
  hidden,
  openSkill,
}: {
  cwd: string | null;
  hidden: boolean;
  openSkill: () => void;
}) {
  const { t } = useI18n();
  const library = usePresentationLibrary(cwd);
  const { deck } = library;
  const [slideSelection, setSlideSelection] = useState<{ deckId: string; slideId: string } | null>(null);
  const [elementId, setElementId] = useState<string | null>(null);
  const [layout, setLayout] = useState<SlideLayout>("blank");
  const [preview, setPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState("");
  const [error, setError] = useState("");
  const [panelClosed, setPanelClosed] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<{ deckId: string; slideId: string } | null>(null);
  const editing = !library.busy;
  const activeSlide =
    deck?.slides.find(({ id }) => slideSelection?.deckId === deck.id && slideSelection.slideId === id) ??
    deck?.slides[0];
  const visibleSlides = deck?.slides ?? [];
  const activeIndex = activeSlide ? visibleSlides.findIndex(({ id }) => id === activeSlide.id) : -1;
  const activeElement = activeSlide?.elements.find(({ id }) => id === elementId);
  const canInsert = editing && !!activeSlide && activeSlide.elements.length < MAX_ELEMENTS;
  const layouts = [
    ["blank", t("pptBlank", "Blank")],
    ["cover", t("pptCover", "Cover")],
    ["content", t("pptContent", "Content")],
    ["data", t("pptData", "Data")],
    ["closing", t("pptClosing", "Closing")],
  ] as const;
  const untitled = t("pptUntitled", "Untitled presentation");
  const saveLabel =
    library.status.kind === "saved"
      ? t("pptSaved", "Saved locally")
      : library.status.kind === "saving"
        ? t("pptSaving", "Saving…")
        : t("pptSaveFailed", "Could not save");

  function selectSlide(id: string) {
    if (!deck) return;
    setSlideSelection({ deckId: deck.id, slideId: id });
    setElementId(null);
  }

  function createBlank() {
    setError("");
    setExported("");
    setElementId(null);
    void library.create(createDeck(untitled, [createSlide("blank", t("pptBlank", "Blank"), "")]));
  }

  function patchSlide(update: (slide: Slide) => Slide, target = activeSlide?.id) {
    if (!target) return;
    library.change((current) => {
      const slide = current.slides.find(({ id }) => id === target);
      if (!slide) return current;
      const next = update(slide);
      return next === slide
        ? current
        : { ...current, slides: current.slides.map((item) => (item.id === target ? next : item)) };
    });
  }

  function appendSlide(slide: Slide) {
    if (!deck || deck.slides.length >= MAX_SLIDES) return;
    if (deck.slides.reduce((sum, page) => sum + slideImageSize(page), slideImageSize(slide)) > MAX_DECK_IMAGE_DATA) {
      setError(t("pptImageLimit", "This deck has reached its image storage limit."));
      return;
    }
    library.change((current) => {
      const next = [...current.slides];
      next.splice(activeIndex + 1, 0, slide);
      return { ...current, slides: next };
    });
    selectSlide(slide.id);
  }

  function removeSlide() {
    if (!activeSlide || !deck || deck.slides.length <= 1) return;
    const next = deck.slides[activeIndex + 1] ?? deck.slides[activeIndex - 1];
    library.change((current) => ({ ...current, slides: current.slides.filter(({ id }) => id !== activeSlide.id) }));
    selectSlide(next.id);
  }

  function addElement(kind: Exclude<PresentationElement["kind"], "image">, label: string) {
    if (!canInsert) return;
    const element = createElement(kind, label);
    patchSlide((slide) => ({ ...slide, elements: [...slide.elements, element] }));
    setElementId(element.id);
  }

  async function insertImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const target = imageTarget.current;
    try {
      const image = await readImage(file);
      if (!target) return;
      library.change((current) => {
        const slide = current.id === target.deckId && current.slides.find(({ id }) => id === target.slideId);
        if (!slide || slide.elements.length >= MAX_ELEMENTS) return current;
        const total = current.slides.reduce((sum, page) => sum + slideImageSize(page), image.data.length);
        if (total > MAX_DECK_IMAGE_DATA)
          throw new Error(t("pptImageLimit", "This deck has reached its image storage limit."));
        return {
          ...current,
          slides: current.slides.map((page) =>
            page.id === target.slideId ? { ...page, elements: [...page.elements, image] } : page,
          ),
        };
      });
      setElementId(image.id);
    } catch (error) {
      setError(
        error instanceof Error && error.message
          ? error.message
          : t("pptImageError", "Choose a valid PNG or JPEG up to 4 MB."),
      );
    }
  }

  function changeElement(id: string, update: (element: PresentationElement) => PresentationElement) {
    patchSlide((slide) => ({
      ...slide,
      elements: slide.elements.map((element) => (element.id === id ? update(element) : element)),
    }));
  }

  function removeElement() {
    if (!activeElement) return;
    patchSlide((slide) => ({ ...slide, elements: slide.elements.filter(({ id }) => id !== activeElement.id) }));
    setElementId(null);
  }

  async function exportDeck() {
    if (!deck || exporting) return;
    setExporting(true);
    setError("");
    setExported("");
    try {
      const filename = await window.piBridge.exportPresentation(deck);
      if (filename) setExported(filename);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (!editing || !(event.ctrlKey || event.metaKey) || !["z", "y"].includes(event.key.toLowerCase())) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable], select"))
      return;
    event.preventDefault();
    if (event.shiftKey || event.key.toLowerCase() === "y") library.redo();
    else library.undo();
  }

  return (
    <section className="ppt-workspace" hidden={hidden} aria-label={t("pptTitle", "PPT Studio")} onKeyDown={keyboard}>
      <header className="ppt-header">
        <div className="ppt-workspace-name" title={cwd ?? undefined}>
          <PresentationIcon aria-hidden="true" />
          <h1>{t("pptTitle", "PPT Studio")}</h1>
        </div>
        <div className="ppt-controls ppt-deck-controls">
          {library.summaries.length > 0 && (
            <select
              value={deck?.id ?? ""}
              aria-label={t("pptProject", "Project decks")}
              disabled={library.busy}
              onChange={(event) => {
                setElementId(null);
                setExported("");
                void library.selectDeck(event.currentTarget.value);
              }}
            >
              {!deck && (
                <option value="" disabled>
                  {t("pptSelectDeck", "Select a deck")}
                </option>
              )}
              {library.summaries.map((summary) => (
                <option key={summary.id} value={summary.id}>
                  {summary.title}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="ppt-button" onClick={createBlank} disabled={library.busy}>
            <Plus />
            {t("pptNew", "New deck")}
          </button>
        </div>
        <div className="ppt-controls ppt-header-actions">
          <button className="ppt-button" type="button" onClick={openSkill}>
            {t("pptSkillWorkflow", "Presentation workspace")}
          </button>
          <button
            className="ppt-icon"
            type="button"
            aria-label={t("pptTogglePanel", "Toggle studio panel")}
            title={t("pptTogglePanel", "Toggle studio panel")}
            aria-pressed={!panelClosed}
            onClick={() => setPanelClosed(!panelClosed)}
          >
            {panelClosed ? <PanelRightOpen /> : <PanelRightClose />}
          </button>
          {deck && (
            <>
              <span className="ppt-save-state" role="status">
                {library.status.kind === "saved" && <Check />}
                {saveLabel}
              </span>
              <button
                type="button"
                className="ppt-button"
                onClick={() => setPreview(true)}
                disabled={visibleSlides.length === 0}
              >
                <PresentationIcon />
                {t("pptPreview", "Preview")}
              </button>
              <button
                type="button"
                className="ppt-button is-primary"
                onClick={() => void exportDeck()}
                disabled={exporting || library.busy}
              >
                <Download />
                {exporting ? t("pptExporting", "Exporting…") : t("pptExport", "Export PPTX")}
              </button>
            </>
          )}
        </div>
      </header>
      {(error || library.error || library.status.kind === "failed" || exported) && (
        <div
          className="ppt-notice"
          role={error || library.error || library.status.kind === "failed" ? "alert" : "status"}
        >
          <span>
            {error ||
              library.error ||
              (library.status.kind === "failed" ? library.status.message : t("pptExported", "PPTX exported"))}
          </span>
          {library.status.kind === "failed" && (
            <>
              <button type="button" className="ppt-button" onClick={() => void library.flush()}>
                {t("pptRetry", "Retry")}
              </button>
              <button type="button" className="ppt-button" onClick={() => void library.reload()}>
                {t("pptReloadSaved", "Discard edits and reload")}
              </button>
            </>
          )}
          {library.error && !deck && (
            <button type="button" className="ppt-button" onClick={() => void library.initialize()}>
              {t("pptRetry", "Retry")}
            </button>
          )}
          {exported && (
            <button
              type="button"
              className="ppt-button"
              onClick={() => {
                void window.piBridge.showItemInFolder(exported).catch((error) => setError(String(error)));
              }}
            >
              {t("pptExportFolder", "Show in folder")}
            </button>
          )}
          {(error || exported) && (
            <button
              type="button"
              className="ppt-icon"
              aria-label={t("pptDismiss", "Dismiss")}
              onClick={() => {
                setError("");
                setExported("");
              }}
            >
              <X />
            </button>
          )}
        </div>
      )}
      <div className={`ppt-editor${!deck ? " is-empty" : ""}${panelClosed || !deck ? " panel-closed" : ""}`}>
        {deck && (
          <nav className="ppt-slide-list" aria-label={t("pptSlides", "Slides")}>
            <div className="ppt-column-heading">
              <h2>{t("pptSlides", "Slides")}</h2>
              <span>{visibleSlides.length}</span>
            </div>
            <ol className="ppt-thumbnails">
              {visibleSlides.map((slide, index) => (
                <li key={slide.id}>
                  <button
                    type="button"
                    className="ppt-thumbnail"
                    aria-current={slide.id === activeSlide?.id ? "page" : undefined}
                    onClick={() => selectSlide(slide.id)}
                  >
                    <div className="ppt-thumb-canvas" aria-hidden="true">
                      <SlideCanvas slide={slide} />
                    </div>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>{slide.title}</span>
                  </button>
                </li>
              ))}
            </ol>
            {editing && deck && (
              <div className="ppt-slide-actions">
                <select
                  value={layout}
                  aria-label={t("pptSlideLayout", "Slide layout")}
                  onChange={(event) =>
                    setLayout(layouts.find(([id]) => id === event.currentTarget.value)?.[0] ?? "blank")
                  }
                >
                  {layouts.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ppt-icon"
                  title={t("pptAddSlide", "Add slide")}
                  aria-label={t("pptAddSlide", "Add slide")}
                  disabled={deck.slides.length >= MAX_SLIDES}
                  onClick={() =>
                    appendSlide(
                      createSlide(
                        layout,
                        layouts.find(([id]) => id === layout)?.[1] ?? untitled,
                        layout === "cover"
                          ? t("pptSubtitle", "Add a subtitle")
                          : layout === "data"
                            ? t("pptInsertChart", "Bar chart")
                            : t("pptBody", "Add the key points for this slide."),
                      ),
                    )
                  }
                >
                  <Plus />
                </button>
              </div>
            )}
          </nav>
        )}
        <main className="ppt-center">
          {activeSlide ? (
            <>
              <div className="ppt-toolbar">
                <div className="ppt-controls ppt-slide-history">
                  <button
                    className="ppt-icon"
                    type="button"
                    disabled={!library.canUndo || !editing}
                    title={t("pptUndo", "Undo")}
                    aria-label={t("pptUndo", "Undo")}
                    onClick={library.undo}
                  >
                    <Undo2 />
                  </button>
                  <button
                    className="ppt-icon"
                    type="button"
                    disabled={!library.canRedo || !editing}
                    title={t("pptRedo", "Redo")}
                    aria-label={t("pptRedo", "Redo")}
                    onClick={library.redo}
                  >
                    <Redo2 />
                  </button>
                </div>
                <div className="ppt-controls">
                  {(
                    [
                      ["text", t("pptInsertText", "Text"), Type],
                      ["rect", t("pptInsertRect", "Rectangle"), Square],
                      ["ellipse", t("pptInsertEllipse", "Ellipse"), Circle],
                      ["chart", t("pptInsertChart", "Bar chart"), ChartNoAxesColumn],
                    ] as const
                  ).map(([kind, label, Icon]) => (
                    <button
                      key={kind}
                      className="ppt-icon"
                      type="button"
                      disabled={!canInsert}
                      title={label}
                      aria-label={label}
                      onClick={() => addElement(kind, label)}
                    >
                      <Icon />
                    </button>
                  ))}
                  <button
                    className="ppt-icon"
                    type="button"
                    disabled={!canInsert}
                    title={t("pptInsertImage", "Image")}
                    aria-label={t("pptInsertImage", "Image")}
                    onClick={() => {
                      if (deck && activeSlide) imageTarget.current = { deckId: deck.id, slideId: activeSlide.id };
                      imageInput.current?.click();
                    }}
                  >
                    <ImagePlus />
                  </button>
                  <input
                    ref={imageInput}
                    type="file"
                    accept="image/png,image/jpeg"
                    hidden
                    onChange={(event) => void insertImage(event)}
                  />
                </div>
                <div className="ppt-controls ppt-page-controls">
                  <button
                    className="ppt-icon"
                    type="button"
                    disabled={!deck || deck.slides.length >= MAX_SLIDES || !editing}
                    title={t("pptDuplicate", "Duplicate slide")}
                    aria-label={t("pptDuplicate", "Duplicate slide")}
                    onClick={() => activeSlide && appendSlide(copySlide(activeSlide))}
                  >
                    <Copy />
                  </button>
                  <button
                    className="ppt-icon"
                    type="button"
                    disabled={activeIndex <= 0 || !editing}
                    title={t("pptMoveUp", "Move up")}
                    aria-label={t("pptMoveUp", "Move up")}
                    onClick={() =>
                      library.change((current) => ({
                        ...current,
                        slides: moveItem(current.slides, activeIndex, -1),
                      }))
                    }
                  >
                    <ArrowUp />
                  </button>
                  <button
                    className="ppt-icon"
                    type="button"
                    disabled={!deck || activeIndex >= deck.slides.length - 1 || !editing}
                    title={t("pptMoveDown", "Move down")}
                    aria-label={t("pptMoveDown", "Move down")}
                    onClick={() =>
                      library.change((current) => ({
                        ...current,
                        slides: moveItem(current.slides, activeIndex, 1),
                      }))
                    }
                  >
                    <ArrowDown />
                  </button>
                  <button
                    className="ppt-icon ppt-delete"
                    type="button"
                    disabled={!deck || deck.slides.length <= 1 || !editing}
                    title={t("pptDeleteSlide", "Delete slide")}
                    aria-label={t("pptDeleteSlide", "Delete slide")}
                    onClick={removeSlide}
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
              <div className="ppt-stage">
                <div className="ppt-paper">
                  <SlideCanvas
                    key={activeSlide.id}
                    slide={activeSlide}
                    edit={
                      editing
                        ? {
                            selected: activeElement?.id ?? null,
                            select: (id) => {
                              setElementId(id);
                            },
                            change: (element) => changeElement(element.id, () => element),
                            remove: removeElement,
                          }
                        : undefined
                    }
                  />
                </div>
              </div>
              <footer className="ppt-stage-footer">
                <span>
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${visibleSlides.length}` : "0"}
                  <span className="ppt-footer-divider">·</span>16:9
                </span>
                {deck && (
                  <input
                    className="ppt-title-input"
                    key={deck.id + deck.title}
                    aria-label={t("pptRename", "Presentation title")}
                    maxLength={120}
                    defaultValue={deck.title}
                    disabled={!editing}
                    onBlur={(event) => {
                      const title = event.currentTarget.value.trim() || deck.title;
                      event.currentTarget.value = title;
                      if (title !== deck.title) library.change((current) => ({ ...current, title }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                )}
              </footer>
            </>
          ) : (
            <div className="ppt-empty-state">
              <span className="ppt-empty-icon">
                <PresentationIcon />
              </span>
              <h2>
                {library.busy ? t("pptLoading", "Loading presentations…") : t("pptWelcome", "Create a slide deck")}
              </h2>
              {!library.busy && (
                <>
                  <p>{t("pptWelcomeHint", "Create a blank deck or open a saved presentation.")}</p>
                  <button className="ppt-button" type="button" onClick={createBlank}>
                    <Plus />
                    {t("pptNew", "New deck")}
                  </button>
                </>
              )}
            </div>
          )}
        </main>
        <aside hidden={panelClosed || !deck} className="ppt-sidepanel" aria-label={t("pptProperties", "Properties")}>
          <div className="ppt-column-heading">
            <h2>{t("pptProperties", "Properties")}</h2>
          </div>
          {activeSlide && (
            <div className="ppt-panel-content">
              <PresentationInspector
                key={activeElement?.id ?? activeSlide.id}
                slide={activeSlide}
                element={activeElement}
                disabled={!editing}
                patchSlide={(patch) => patchSlide((slide) => ({ ...slide, ...patch }))}
                patchElement={(patch) =>
                  activeElement && changeElement(activeElement.id, (element) => updateElement(element, patch))
                }
                moveLayer={(delta) =>
                  activeElement &&
                  patchSlide((slide) => ({
                    ...slide,
                    elements: moveItem(
                      slide.elements,
                      slide.elements.findIndex(({ id }) => id === activeElement.id),
                      delta,
                    ),
                  }))
                }
                remove={removeElement}
              />
            </div>
          )}
        </aside>
      </div>
      {preview && !hidden && visibleSlides.length > 0 && (
        <SlidePreview slides={visibleSlides} initialIndex={Math.max(activeIndex, 0)} close={() => setPreview(false)} />
      )}
    </section>
  );
}

export function PresentationWorkspace(props: { cwd: string | null; hidden: boolean }) {
  const [engine, setEngine] = useState<"skill" | "native">("skill");
  return engine === "skill" ? (
    <PresentationSkillWorkspace
      key={props.cwd ?? "local"}
      cwd={props.cwd}
      hidden={props.hidden}
      openNative={() => setEngine("native")}
    />
  ) : (
    <NativePresentationWorkspace {...props} openSkill={() => setEngine("skill")} />
  );
}
