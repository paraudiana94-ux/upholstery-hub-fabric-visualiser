"use client";
/* eslint-disable @next/next/no-img-element -- live Cloudinary and local object URLs must be rendered directly */

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchPublishedCatalogue,
  type CataloguePayload,
} from "@/lib/catalogue";
import { calculateIndicativeEstimate } from "@/lib/pricing";

type Step =
  | "start"
  | "photo"
  | "furniture"
  | "fabrics"
  | "review"
  | "result"
  | "quote";

interface LocalPhoto {
  url: string;
  name: string;
  size: number;
  file: File;
}

interface GeneratedPreview {
  imageDataUrl: string;
  model: string;
  generatedAt: string;
  disclaimer: string;
}

type PreviewStatus = "idle" | "generating" | "ready" | "error";

interface PreviewErrorPayload {
  code?: string;
  message?: string;
}

const steps: Step[] = [
  "start",
  "photo",
  "furniture",
  "fabrics",
  "review",
  "result",
  "quote",
];

const progressSteps = [
  { id: "photo", label: "Photo" },
  { id: "furniture", label: "Furniture" },
  { id: "fabrics", label: "Fabric" },
  { id: "review", label: "Review" },
] as const;

const currency = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function getStoredValue(key: string, fallback = "") {
  if (typeof window === "undefined") {
    return fallback;
  }
  return window.sessionStorage.getItem(key) ?? fallback;
}

function getStepFromHash(): Step {
  if (typeof window === "undefined") {
    return "start";
  }
  const candidate = window.location.hash.replace(/^#\//, "") as Step;
  return steps.includes(candidate) ? candidate : "start";
}

function fileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeHex(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#D8D2C8";
}

function lastUpdatedLabel(value: string) {
  if (!value) {
    return "date unavailable";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function Visualiser() {
  const [step, setStep] = useState<Step>("start");
  const [catalogue, setCatalogue] = useState<CataloguePayload | null>(null);
  const [liveStatus, setLiveStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [catalogueError, setCatalogueError] = useState("");
  const [localPhoto, setLocalPhoto] = useState<LocalPhoto | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState(() =>
    getStoredValue("uh-furniture-id"),
  );
  const [selectedFabricId, setSelectedFabricId] = useState(() =>
    getStoredValue("uh-fabric-id"),
  );
  const [quantity, setQuantity] = useState(() => {
    const stored = Number(getStoredValue("uh-quantity", "1"));
    return Number.isInteger(stored) && stored >= 1 && stored <= 10 ? stored : 1;
  });
  const [colourFilter, setColourFilter] = useState("");
  const [patternFilter, setPatternFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [failedSwatches, setFailedSwatches] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState("");
  const [aiAcknowledged, setAiAcknowledged] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [generatedPreview, setGeneratedPreview] =
    useState<GeneratedPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [reconciliationNotice, setReconciliationNotice] = useState("");

  const mainHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const loadCatalogue = useCallback(async () => {
    setLiveStatus("loading");
    setCatalogueError("");
    try {
      if (
        typeof window !== "undefined" &&
        window.location.hostname.endsWith("github.io")
      ) {
        setCatalogue(await fetchPublishedCatalogue());
        setLiveStatus("ready");
        return;
      }
      const response = await fetch("/api/catalogue", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const payload = (await response.json()) as
        | CataloguePayload
        | { message?: string; detail?: string };
      if (!response.ok || !("fabrics" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "The live catalogue could not be read.",
        );
      }
      setCatalogue(payload);
      setLiveStatus("ready");
    } catch (error) {
      setCatalogue(null);
      setLiveStatus("error");
      setCatalogueError(
        error instanceof Error
          ? error.message
          : "The live catalogue could not be read.",
      );
    }
  }, []);

  useEffect(() => {
    const initialSync = window.setTimeout(() => setStep(getStepFromHash()), 0);
    const onHashChange = () => setStep(getStepFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.clearTimeout(initialSync);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadCatalogue(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadCatalogue]);

  useEffect(() => {
    if (step !== "start") {
      mainHeadingRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (selectedFurnitureId) {
      window.sessionStorage.setItem("uh-furniture-id", selectedFurnitureId);
    } else {
      window.sessionStorage.removeItem("uh-furniture-id");
    }
  }, [selectedFurnitureId]);

  useEffect(() => {
    if (selectedFabricId) {
      window.sessionStorage.setItem("uh-fabric-id", selectedFabricId);
    } else {
      window.sessionStorage.removeItem("uh-fabric-id");
    }
  }, [selectedFabricId]);

  useEffect(() => {
    if (quantity === 1) {
      window.sessionStorage.removeItem("uh-quantity");
    } else {
      window.sessionStorage.setItem("uh-quantity", String(quantity));
    }
  }, [quantity]);

  useEffect(() => {
    if (!catalogue) {
      return;
    }
    const reconciliation = window.setTimeout(() => {
      const notices: string[] = [];
      if (
        selectedFurnitureId &&
        !catalogue.furniture.some((item) => item.id === selectedFurnitureId)
      ) {
        setSelectedFurnitureId("");
        notices.push("Your previous furniture choice is no longer active.");
      }
      if (
        selectedFabricId &&
        !catalogue.fabrics.some((item) => item.id === selectedFabricId)
      ) {
        setSelectedFabricId("");
        notices.push("Your previous fabric choice is no longer active.");
      }
      setReconciliationNotice(notices.join(" "));
    }, 0);
    return () => window.clearTimeout(reconciliation);
  }, [catalogue, selectedFabricId, selectedFurnitureId]);

  useEffect(
    () => () => {
      if (localPhoto) {
        URL.revokeObjectURL(localPhoto.url);
      }
    },
    [localPhoto],
  );

  const selectedFurniture = catalogue?.furniture.find(
    (item) => item.id === selectedFurnitureId,
  );
  const selectedFabric = catalogue?.fabrics.find(
    (item) => item.id === selectedFabricId,
  );

  const estimate = useMemo(() => {
    if (!selectedFurniture || !selectedFabric) {
      return null;
    }
    return calculateIndicativeEstimate({
      quantity,
      labourCost: selectedFurniture.labourCost,
      pricePerMetre: selectedFabric.pricePerMetre,
      minMetres: selectedFurniture.minMetres,
      maxMetres: selectedFurniture.maxMetres,
    });
  }, [quantity, selectedFabric, selectedFurniture]);

  const filterOptions = useMemo(() => {
    const fabrics = catalogue?.fabrics ?? [];
    const unique = (values: string[]) =>
      Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "en-IE"),
      );
    return {
      colours: unique(fabrics.map((fabric) => fabric.mainColour)),
      patterns: unique(fabrics.map((fabric) => fabric.pattern)),
      stocks: unique(fabrics.map((fabric) => fabric.stockStatus)),
    };
  }, [catalogue]);

  const filteredFabrics = useMemo(
    () =>
      (catalogue?.fabrics ?? []).filter(
        (fabric) =>
          (!colourFilter || fabric.mainColour === colourFilter) &&
          (!patternFilter || fabric.pattern === patternFilter) &&
          (!stockFilter || fabric.stockStatus === stockFilter),
      ),
    [catalogue, colourFilter, patternFilter, stockFilter],
  );

  const progressIndex = Math.max(
    0,
    progressSteps.findIndex((item) => item.id === step),
  );

  function go(next: Step) {
    setFormError("");
    const nextHash = `#/${next}`;
    if (window.location.hash === nextHash) {
      setStep(next);
    } else {
      window.location.hash = nextHash;
    }
  }

  function showFormError(message: string) {
    setFormError(message);
    window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }

  function clearGeneratedPreview() {
    setGeneratedPreview(null);
    setPreviewStatus("idle");
    setPreviewError("");
    setAiAcknowledged(false);
  }

  function removePhoto() {
    if (localPhoto) {
      URL.revokeObjectURL(localPhoto.url);
    }
    setLocalPhoto(null);
    setPhotoError("");
    clearGeneratedPreview();
    setPhotoInputKey((current) => current + 1);
  }

  async function onPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setPhotoError("");
    const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!acceptedTypes.includes(file.type)) {
      setPhotoError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError("This photo is larger than 10 MB. Choose a smaller image.");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("decode"));
        image.src = objectUrl;
      });
      if (localPhoto) {
        URL.revokeObjectURL(localPhoto.url);
      }
      setLocalPhoto({ url: objectUrl, name: file.name, size: file.size, file });
      clearGeneratedPreview();
    } catch {
      URL.revokeObjectURL(objectUrl);
      setPhotoError("We could not read this photo. Try another image.");
    }
  }

  async function createIndicativePreview() {
    if (!localPhoto || !selectedFabric || !selectedFurniture || !aiAcknowledged) {
      setPreviewStatus("error");
      setPreviewError(
        "Add a photo, complete both live selections and confirm the consent statement before generating.",
      );
      return;
    }

    setPreviewStatus("generating");
    setPreviewError("");
    setGeneratedPreview(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 130_000);
    const endpoint = window.location.hostname.endsWith("github.io")
      ? "https://upholstery-hub-fabric-visualiser.onrender.com/api/preview"
      : "/api/preview";
    const body = new FormData();
    body.append("photo", localPhoto.file, localPhoto.name);
    body.append("fabricId", selectedFabric.id);
    body.append("furnitureId", selectedFurniture.id);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | GeneratedPreview
        | PreviewErrorPayload
        | null;
      if (!response.ok || !payload || !("imageDataUrl" in payload)) {
        throw new Error(
          payload && "message" in payload && payload.message
            ? payload.message
            : "The AI preview could not be created. Your estimate is still available.",
        );
      }

      setGeneratedPreview(payload);
      setPreviewStatus("ready");
      go("result");
    } catch (error) {
      setPreviewStatus("error");
      setPreviewError(
        error instanceof DOMException && error.name === "AbortError"
          ? "The AI preview took too long. Please try again; your selections remain available."
          : error instanceof Error
            ? error.message
            : "The AI preview could not be created. Your estimate is still available.",
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function continueFromFurniture() {
    if (!selectedFurniture) {
      showFormError("Choose one furniture type before continuing.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      showFormError("Enter a whole-number quantity from 1 to 10.");
      return;
    }
    go("fabrics");
  }

  function continueFromFabrics() {
    if (!selectedFabric) {
      showFormError("Choose one live fabric before continuing.");
      return;
    }
    go("review");
  }

  function clearJourneyState() {
    removePhoto();
    setSelectedFurnitureId("");
    setSelectedFabricId("");
    setQuantity(1);
    setColourFilter("");
    setPatternFilter("");
    setStockFilter("");
    setFailedSwatches(new Set());
    setFormError("");
    setCustomerNotes("");
    setReconciliationNotice("");
    Object.keys(window.sessionStorage)
      .filter((key) => key.startsWith("uh-"))
      .forEach((key) => window.sessionStorage.removeItem(key));
  }

  function resetJourney() {
    clearJourneyState();
    go("start");
  }

  function resetJourneyFromLogo() {
    clearJourneyState();
    window.location.hash = "#/start";
    window.location.reload();
  }

  function printProjectSummary() {
    const previousTitle = document.title;
    const fabricReference = selectedFabric?.id ?? "selection";
    document.title = `Upholstery Hub project summary - ${fabricReference}`;
    window.addEventListener(
      "afterprint",
      () => {
        document.title = previousTitle;
      },
      { once: true },
    );
    window.print();
  }

  function markSwatchFailed(id: string) {
    setFailedSwatches((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function LiveDataPanel() {
    if (liveStatus === "loading") {
      return (
        <div className="state-panel" role="status" aria-live="polite">
          <span className="status-dot status-dot-loading" aria-hidden="true" />
          <div>
            <strong>Loading the live catalogue</strong>
            <p>Reading current fabric and pricing rows from Google Sheets.</p>
          </div>
        </div>
      );
    }
    if (liveStatus === "error") {
      return (
        <div className="state-panel state-panel-error" role="alert">
          <span className="status-dot status-dot-error" aria-hidden="true" />
          <div>
            <strong>The live catalogue is unavailable</strong>
            <p>{catalogueError}</p>
            <p>No stored prices or catalogue rows have been substituted.</p>
            <div className="inline-actions">
              <button className="button button-dark" type="button" onClick={loadCatalogue}>
                Retry live data
              </button>
              <button className="button button-quiet" type="button" onClick={() => go("quote")}>
                Continue to professional advice
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="live-strip" role="status">
        <span className="status-dot status-dot-ready" aria-hidden="true" />
        <span>
          Live Google Sheets data fetched {catalogue ? lastUpdatedLabel(catalogue.fetchedAt) : "now"}
        </span>
        <button className="text-button" type="button" onClick={loadCatalogue}>
          Refresh
        </button>
      </div>
    );
  }

  function ErrorSummary() {
    if (!formError) {
      return null;
    }
    return (
      <div
        className="error-summary"
        role="alert"
        tabIndex={-1}
        ref={errorSummaryRef}
      >
        <strong>Check this step</strong>
        <p>{formError}</p>
      </div>
    );
  }

  function SelectionSummary() {
    if (!selectedFurniture && !selectedFabric) {
      return null;
    }
    return (
      <aside className="selection-summary" aria-label="Your current choices">
        <span className="eyebrow">Your choices</span>
        <div className="summary-items">
          {selectedFurniture ? (
            <span>
              <strong>{selectedFurniture.name}</strong> × {quantity}
            </span>
          ) : null}
          {selectedFabric ? (
            <span>
              <strong>{selectedFabric.name}</strong> <small>{selectedFabric.id}</small>
            </span>
          ) : null}
        </div>
      </aside>
    );
  }

  function renderStart() {
    return (
      <section className="hero-grid" aria-labelledby="start-heading">
        <div className="hero-copy">
          <span className="eyebrow">Furniture, reimagined carefully</span>
          <h1 id="start-heading">See a possible new look for your furniture</h1>
          <p className="lede">
            Choose a live fabric, review an indicative price range and prepare a clearer
            conversation with Upholstery Hub.
          </p>
          <div className="hero-actions">
            <button className="button button-dark button-large" type="button" onClick={() => go("photo")}>
              Start visualising
            </button>
          </div>
          <p className="trust-line">
            <span aria-hidden="true">✓</span> No account required. Selecting a photograph keeps it local until you consent and request an AI preview.
          </p>
        </div>
        <div className="process-card" aria-label="How the prototype works">
          <div className="process-card-top">
            <span className="mini-chip">Focused prototype</span>
            <span aria-hidden="true">01 / 03</span>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div><strong>Add your furniture</strong><small>Use a local photo or continue without one.</small></div>
            </li>
            <li>
              <span>02</span>
              <div><strong>Choose a live fabric</strong><small>Browse the current Google Sheets catalogue.</small></div>
            </li>
            <li>
              <span>03</span>
              <div><strong>Review an estimate</strong><small>See a transparent range before expert advice.</small></div>
            </li>
          </ol>
          <div className="material-sample" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>
    );
  }

  function renderPhoto() {
    return (
      <section className="step-layout" aria-labelledby="photo-heading">
        <div className="step-copy">
          <span className="eyebrow">Step 1 of 4</span>
          <h1 id="photo-heading" tabIndex={-1} ref={mainHeadingRef}>Add a furniture photo</h1>
          <p className="lede-small">
            Use one clear photo with the whole item visible. Avoid people and unrelated personal details.
          </p>
          <div className="privacy-note">
            <strong>Selecting a photo does not send it anywhere.</strong>
            <p>The file stays in this browser session until you explicitly consent and press “Create indicative preview”. You can remove it at any time.</p>
          </div>
        </div>
        <div className="step-card">
          <label className={`upload-zone ${photoError ? "upload-zone-error" : ""}`} htmlFor="furniture-photo">
            <span className="upload-mark" aria-hidden="true">＋</span>
            <strong>{localPhoto ? "Replace your photo" : "Choose a furniture photo"}</strong>
            <span>JPEG, PNG or WebP, up to 10 MB</span>
          </label>
          <input
            key={photoInputKey}
            className="visually-hidden-input"
            id="furniture-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="photo-guidance photo-error"
            onChange={onPhotoChange}
          />
          <p id="photo-guidance" className="field-help">One item, even light and minimal obstruction works best.</p>
          {photoError ? <p id="photo-error" className="field-error" role="alert">{photoError}</p> : null}
          {localPhoto ? (
            <div className="local-preview">
              <img src={localPhoto.url} alt="Your uploaded furniture photograph" />
              <div>
                <strong>{localPhoto.name}</strong>
                <span>{fileSize(localPhoto.size)} · Not sent</span>
                <button className="text-button text-button-danger" type="button" onClick={removePhoto}>
                  Remove photo
                </button>
              </div>
            </div>
          ) : null}
          <div className="card-actions">
            <button className="button button-dark" type="button" onClick={() => go("furniture")}>
              {localPhoto ? "Continue with this photo" : "Continue without a photo"}
            </button>
            <button className="button button-quiet" type="button" onClick={() => go("start")}>Back</button>
          </div>
        </div>
      </section>
    );
  }

  function renderFurniture() {
    return (
      <section aria-labelledby="furniture-heading">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">Step 2 of 4</span>
            <h1 id="furniture-heading" tabIndex={-1} ref={mainHeadingRef}>Choose your furniture type</h1>
            <p className="lede-small">This live choice supplies the labour, material and turnaround assumptions.</p>
          </div>
          <SelectionSummary />
        </div>
        <LiveDataPanel />
        {reconciliationNotice ? <p className="notice" role="status">{reconciliationNotice}</p> : null}
        <ErrorSummary />
        {catalogue ? (
          <>
            <fieldset className="choice-grid furniture-grid">
              <legend>Active furniture types</legend>
              {catalogue.furniture.map((item) => (
                <label className={`choice-card ${selectedFurnitureId === item.id ? "choice-card-selected" : ""}`} key={item.id}>
                  <input
                    type="radio"
                    name="furniture-type"
                    value={item.id}
                    checked={selectedFurnitureId === item.id}
                    onChange={() => {
                      setSelectedFurnitureId(item.id);
                      clearGeneratedPreview();
                      setFormError("");
                    }}
                  />
                  <span className="choice-check" aria-hidden="true" />
                  <span className="choice-card-kicker">{item.id} · Demo data</span>
                  <strong>{item.name}</strong>
                  <span>{item.minMetres} to {item.maxMetres} estimated metres</span>
                  <span>{item.minTurnaroundWeeks} to {item.maxTurnaroundWeeks} weeks, indicative</span>
                  <small>{item.specialConsiderations}</small>
                </label>
              ))}
            </fieldset>
            <div className="quantity-row">
              <div>
                <label htmlFor="quantity"><strong>Quantity</strong></label>
                <span id="quantity-help">Whole numbers from 1 to 10</span>
              </div>
              <input
                id="quantity"
                type="number"
                min="1"
                max="10"
                step="1"
                value={quantity}
                aria-describedby="quantity-help"
                onChange={(event) => setQuantity(Number(event.target.value))}
              />
            </div>
            <div className="page-actions">
              <button className="button button-quiet" type="button" onClick={() => go("photo")}>Back</button>
              <button className="button button-dark" type="button" onClick={continueFromFurniture}>Choose a fabric</button>
            </div>
          </>
        ) : null}
      </section>
    );
  }

  function renderFabrics() {
    return (
      <section aria-labelledby="fabric-heading">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">Step 3 of 4</span>
            <h1 id="fabric-heading" tabIndex={-1} ref={mainHeadingRef}>Choose a live fabric</h1>
            <p className="lede-small">Screen colour is approximate. Confirm your choice with Upholstery Hub and a physical swatch.</p>
          </div>
          <SelectionSummary />
        </div>
        <LiveDataPanel />
        <ErrorSummary />
        {catalogue ? (
          <>
            <div className="filter-panel" aria-label="Fabric filters">
              <label>Colour
                <select value={colourFilter} onChange={(event) => setColourFilter(event.target.value)}>
                  <option value="">All colours</option>
                  {filterOptions.colours.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label>Pattern
                <select value={patternFilter} onChange={(event) => setPatternFilter(event.target.value)}>
                  <option value="">All patterns</option>
                  {filterOptions.patterns.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label>Stock
                <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}>
                  <option value="">All stock states</option>
                  {filterOptions.stocks.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <button className="button button-light" type="button" onClick={() => {
                setColourFilter("");
                setPatternFilter("");
                setStockFilter("");
              }}>Clear filters</button>
            </div>
            <p className="result-count" aria-live="polite">{filteredFabrics.length} active fabrics match these filters</p>
            {filteredFabrics.length > 0 ? (
              <fieldset className="choice-grid fabric-grid">
                <legend>Live fabric options</legend>
                {filteredFabrics.map((fabric) => {
                  const imageFailed = failedSwatches.has(fabric.id);
                  return (
                    <label className={`fabric-card ${selectedFabricId === fabric.id ? "fabric-card-selected" : ""}`} key={fabric.id}>
                      <input
                        type="radio"
                        name="fabric"
                        value={fabric.id}
                        checked={selectedFabricId === fabric.id}
                        onChange={() => {
                          setSelectedFabricId(fabric.id);
                          clearGeneratedPreview();
                          setFormError("");
                        }}
                      />
                      <span className="choice-check" aria-hidden="true" />
                      <div className="swatch-frame">
                        {imageFailed ? (
                          <div
                            className="swatch-fallback"
                            style={{ backgroundColor: safeHex(fabric.colourHex) }}
                            role="img"
                            aria-label={`Image unavailable for ${fabric.name}. Approximate colour ${fabric.mainColour}.`}
                          >
                            <span>Image unavailable</span>
                          </div>
                        ) : (
                          <img
                            src={fabric.swatchImageUrl}
                            alt={`${fabric.name}, ${fabric.mainColour}, ${fabric.pattern} fabric swatch`}
                            loading="lazy"
                            onError={() => markSwatchFailed(fabric.id)}
                          />
                        )}
                      </div>
                      <div className="fabric-card-body">
                        <div className="fabric-card-topline">
                          <span>{fabric.id}</span>
                          <span className="demo-badge">Demo data</span>
                        </div>
                        <strong>{fabric.name}</strong>
                        <span>{fabric.pattern} · {fabric.material}</span>
                        <span>{currency.format(fabric.pricePerMetre)} per metre</span>
                        <div className="fabric-status-row">
                          <span className={`stock-badge stock-${fabric.stockStatus.toLowerCase().replaceAll(" ", "-")}`}>{fabric.stockStatus}</span>
                          <span>Suitability to confirm</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <div className="state-panel">
                <div>
                  <strong>No fabrics match these filters</strong>
                  <p>Clear one or more filters to see the active catalogue.</p>
                  <button className="button button-light" type="button" onClick={() => {
                    setColourFilter("");
                    setPatternFilter("");
                    setStockFilter("");
                  }}>Clear filters</button>
                </div>
              </div>
            )}
            <div className="page-actions">
              <button className="button button-quiet" type="button" onClick={() => go("furniture")}>Back</button>
              <button className="button button-dark" type="button" onClick={continueFromFabrics}>Review my choices</button>
            </div>
          </>
        ) : null}
      </section>
    );
  }

  function renderReview() {
    if (!selectedFurniture || !selectedFabric) {
      return (
        <section className="narrow-section" aria-labelledby="review-heading">
          <h1 id="review-heading" tabIndex={-1} ref={mainHeadingRef}>Review your choices</h1>
          <div className="state-panel state-panel-error">
            <div>
              <strong>A live selection is missing</strong>
              <p>Return to the live catalogue and complete the missing furniture or fabric choice.</p>
              <button className="button button-dark" type="button" onClick={() => go(selectedFurniture ? "fabrics" : "furniture")}>Return to selection</button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section aria-labelledby="review-heading">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">Step 4 of 4</span>
            <h1 id="review-heading" tabIndex={-1} ref={mainHeadingRef}>Review your choices</h1>
            <p className="lede-small">Check the live selection before viewing the indicative estimate.</p>
          </div>
          <SelectionSummary />
        </div>
        <div className="review-grid">
          <div className="review-media-card">
            {localPhoto ? (
              <img className="review-photo" src={localPhoto.url} alt="Your uploaded furniture photograph" />
            ) : (
              <div className="no-photo-placeholder"><span aria-hidden="true">○</span><strong>No photograph selected</strong><p>The price path remains available.</p></div>
            )}
            <div className="review-swatch">
              <img src={selectedFabric.swatchImageUrl} alt={`${selectedFabric.name} live fabric swatch`} onError={() => markSwatchFailed(selectedFabric.id)} />
              <div><span className="eyebrow">Selected fabric</span><strong>{selectedFabric.name}</strong><small>{selectedFabric.id} · {selectedFabric.stockStatus}</small></div>
            </div>
          </div>
          <div className="ai-panel">
            <span className="eyebrow">AI preview status</span>
            <h2>{localPhoto ? "Create an indicative preview" : "Add a photo to create a preview"}</h2>
            <p id="ai-blocked">
              The secure Render service uses OpenAI to apply the selected live Cloudinary swatch to your furniture photo. Results can alter details and are not a finished-work guarantee.
            </p>
            {localPhoto ? (
              <>
                <label className="acknowledgement">
                  <input
                    type="checkbox"
                    checked={aiAcknowledged}
                    disabled={previewStatus === "generating"}
                    onChange={(event) => setAiAcknowledged(event.target.checked)}
                  />
                  <span>
                    I have permission to use this photo and agree to send it, plus the selected public fabric swatch, to Upholstery Hub’s Render service and OpenAI to generate an indicative preview. OpenAI may retain API abuse-monitoring content for up to 30 days.
                  </span>
                </label>
                <button
                  className="button button-dark button-full"
                  type="button"
                  disabled={!aiAcknowledged || previewStatus === "generating"}
                  aria-describedby="ai-blocked preview-guidance"
                  onClick={() => void createIndicativePreview()}
                >
                  {previewStatus === "generating" ? "Creating preview…" : "Create indicative preview"}
                </button>
                <p id="preview-guidance" className="field-help">
                  Generation may take up to two minutes. This prototype limits each visitor to 10 previews per hour.
                </p>
              </>
            ) : (
              <button className="button button-light button-full" type="button" onClick={() => go("photo")}>
                Add a furniture photo
              </button>
            )}
            {previewStatus === "generating" ? (
              <div className="preview-status" role="status" aria-live="polite">
                <span className="status-dot status-dot-loading" aria-hidden="true" />
                <span>Creating your indicative preview securely. Keep this page open.</span>
              </div>
            ) : null}
            {previewStatus === "error" && previewError ? (
              <div className="preview-status preview-status-error" role="alert">
                <span className="status-dot status-dot-error" aria-hidden="true" />
                <span>{previewError}</span>
              </div>
            ) : null}
            <button
              className="button button-light button-full"
              type="button"
              disabled={previewStatus === "generating"}
              onClick={() => go("result")}
            >
              Continue without an AI preview
            </button>
          </div>
        </div>
        <div className="page-actions">
          <button className="button button-quiet" type="button" onClick={() => go("fabrics")} disabled={previewStatus === "generating"}>Back to fabrics</button>
        </div>
      </section>
    );
  }

  function renderResult() {
    if (!selectedFurniture || !selectedFabric || !estimate) {
      return (
        <section className="narrow-section" aria-labelledby="result-heading">
          <h1 id="result-heading" tabIndex={-1} ref={mainHeadingRef}>Indicative estimate</h1>
          <div className="state-panel state-panel-error">
            <div>
              <strong>We cannot calculate from the current catalogue data</strong>
              <p>Retry the live data and complete both selections. No zero or stored estimate has been substituted.</p>
              <button className="button button-dark" type="button" onClick={() => go("furniture")}>Return to live choices</button>
            </div>
          </div>
        </section>
      );
    }

    const isDemo = selectedFurniture.demoData || selectedFabric.demoData;
    return (
      <section aria-labelledby="result-heading">
        <div className="result-heading-row">
          <div>
            <span className="eyebrow">Your live selection</span>
            <h1 id="result-heading" tabIndex={-1} ref={mainHeadingRef}>Indicative estimate</h1>
            <p className="lede-small">A transparent starting range for a professional conversation.</p>
          </div>
          {isDemo ? <span className="demo-badge demo-badge-large">Demonstration estimate</span> : null}
        </div>
        <div className="result-grid">
          <div className="direction-card">
            {generatedPreview ? (
              <img
                className="generated-preview-image"
                src={generatedPreview.imageDataUrl}
                alt={`AI-generated indicative preview of ${selectedFurniture.name} in ${selectedFabric.name}`}
              />
            ) : (
              <div className="direction-images">
                {localPhoto ? <img src={localPhoto.url} alt="Your uploaded furniture photograph" /> : <div className="no-photo-small">No photo selected</div>}
                {failedSwatches.has(selectedFabric.id) ? (
                  <div className="swatch-fallback" style={{ backgroundColor: safeHex(selectedFabric.colourHex) }} role="img" aria-label={`Image unavailable for ${selectedFabric.name}`}><span>Image unavailable</span></div>
                ) : (
                  <img src={selectedFabric.swatchImageUrl} alt={`${selectedFabric.name}, ${selectedFabric.mainColour}, ${selectedFabric.pattern} fabric swatch`} onError={() => markSwatchFailed(selectedFabric.id)} />
                )}
              </div>
            )}
            <span className="eyebrow">{generatedPreview ? "AI-generated indicative preview" : "Selected direction, not an AI preview"}</span>
            <h2>{selectedFurniture.name} in {selectedFabric.name}</h2>
            <p>{selectedFabric.pattern} · {selectedFabric.material} · {selectedFabric.stockStatus}</p>
            <div className="disclosure-box">
              <strong>{generatedPreview ? "AI image created." : "No AI image was created."}</strong>
              <p>
                {generatedPreview
                  ? "The preview may alter furniture or room details. Confirm colour, texture and pattern scale with a physical swatch and professional inspection."
                  : "The photo and live swatch are shown separately. Screen colour, texture and pattern scale may differ."}
              </p>
            </div>
          </div>
          <div className="estimate-card">
            <span className="eyebrow">Indicative estimate</span>
            <p className="estimate-range">{currency.format(estimate.low)} <span>to</span> {currency.format(estimate.high)}</p>
            <dl className="price-breakdown">
              <div><dt>Quantity</dt><dd>{quantity}</dd></div>
              <div><dt>Starting labour per item</dt><dd>{currency.format(selectedFurniture.labourCost)}</dd></div>
              <div><dt>Live fabric price</dt><dd>{currency.format(selectedFabric.pricePerMetre)} / metre</dd></div>
              <div><dt>Estimated fabric</dt><dd>{selectedFurniture.minMetres} to {selectedFurniture.maxMetres} m / item</dd></div>
              <div><dt>Indicative turnaround</dt><dd>{selectedFurniture.minTurnaroundWeeks} to {selectedFurniture.maxTurnaroundWeeks} weeks</dd></div>
            </dl>
            <div className="estimate-note"><strong>Inspection note</strong><p>{selectedFurniture.specialConsiderations}</p></div>
            <p className="fine-print">Repairs, replacement fillings, specialist finishes, transport, taxes, additional pattern matching and work found during inspection are excluded.</p>
            <p className="estimate-disclaimer"><strong>This is not a quotation.</strong> Upholstery Hub must inspect the furniture and approve the fabric before confirming price and turnaround.</p>
          </div>
        </div>
        <div className="page-actions page-actions-prominent">
          <button className="button button-dark button-large" type="button" onClick={() => go("quote")}>View &amp; save project summary</button>
          <button className="button button-light" type="button" onClick={() => {
            clearGeneratedPreview();
            go("fabrics");
          }}>Try another fabric</button>
          <button className="button button-quiet" type="button" onClick={() => go("photo")}>Change photo</button>
        </div>
      </section>
    );
  }

  function renderQuote() {
    const hasCompleteSummary = Boolean(selectedFurniture && selectedFabric && estimate);
    const preparedOn = new Intl.DateTimeFormat("en-IE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());

    return (
      <section className="quote-layout" aria-labelledby="quote-heading">
        <div className="summary-controls">
          <span className="eyebrow">Professional next step</span>
          <h1 id="quote-heading" tabIndex={-1} ref={mainHeadingRef}>View &amp; save your project summary</h1>
          <p className="lede">
            Add an optional note, then print this page or choose “Save as PDF” in your browser’s print window.
          </p>
          {!hasCompleteSummary ? (
            <div className="state-panel state-panel-warning" role="status">
              <span className="status-dot status-dot-warning" aria-hidden="true" />
              <div>
                <strong>Complete a live selection first</strong>
                <p>Choose a furniture type and fabric to create a printable project summary.</p>
                <button className="button button-dark" type="button" onClick={() => go("photo")}>
                  Start visualising
                </button>
              </div>
            </div>
          ) : null}
          <div className="notes-field">
            <label htmlFor="customer-notes"><strong>Notes for your consultation</strong> <small>Optional</small></label>
            <textarea
              id="customer-notes"
              value={customerNotes}
              maxLength={600}
              rows={6}
              disabled={!hasCompleteSummary}
              aria-describedby="customer-notes-help customer-notes-count"
              placeholder="For example: keep the existing piping, discuss firmer seat filling, or check collection options."
              onChange={(event) => setCustomerNotes(event.target.value)}
            />
          </div>
          <div className="notes-meta">
            <span id="customer-notes-help">Notes stay in this browser and appear only in your printed or saved copy.</span>
            <span id="customer-notes-count">{customerNotes.length} / 600</span>
          </div>
          <button
            className="button button-dark button-large button-full"
            type="button"
            disabled={!hasCompleteSummary}
            onClick={printProjectSummary}
          >
            Print or save as PDF
          </button>
          <p className="field-help">In the print window, select “Save as PDF” to download a copy.</p>
          <div className="page-actions page-actions-left">
            {estimate ? <button className="button button-light" type="button" onClick={() => go("result")}>Back to estimate</button> : null}
            <button className="button button-light" type="button" onClick={resetJourney}>Start a new selection</button>
          </div>
        </div>
        <aside className="quote-summary" aria-label="Printable project summary">
          <div className="summary-document-header">
            <img src="branding/UpholsteryHubLogo-Horizontal.png" alt="Upholstery Hub" />
            <div>
              <span className="eyebrow">Project summary</span>
              <small>Prepared {preparedOn}</small>
            </div>
          </div>
          {generatedPreview ? (
            <figure className="summary-media">
              <img src={generatedPreview.imageDataUrl} alt={`AI-generated indicative preview of ${selectedFurniture?.name ?? "furniture"} in ${selectedFabric?.name ?? "the selected fabric"}`} />
              <figcaption>AI-generated indicative preview</figcaption>
            </figure>
          ) : selectedFabric ? (
            <figure className="summary-media summary-media-swatch">
              <img src={selectedFabric.swatchImageUrl} alt={`${selectedFabric.name} live fabric swatch`} />
              <figcaption>Selected live fabric swatch</figcaption>
            </figure>
          ) : null}
          <h2>Your selected direction</h2>
          <dl>
            <div><dt>Furniture</dt><dd>{selectedFurniture ? `${selectedFurniture.name} × ${quantity}` : "Not selected"}</dd></div>
            <div><dt>Fabric</dt><dd>{selectedFabric ? `${selectedFabric.name} (${selectedFabric.id})` : "Not selected"}</dd></div>
            <div><dt>Pattern and material</dt><dd>{selectedFabric ? `${selectedFabric.pattern} · ${selectedFabric.material}` : "Not selected"}</dd></div>
            <div><dt>Stock status</dt><dd>{selectedFabric?.stockStatus ?? "Unavailable"}</dd></div>
            <div><dt>Estimate</dt><dd>{estimate ? `${currency.format(estimate.low)} to ${currency.format(estimate.high)}` : "Unavailable"}</dd></div>
            <div><dt>Estimated fabric</dt><dd>{selectedFurniture ? `${selectedFurniture.minMetres} to ${selectedFurniture.maxMetres} m per item` : "Unavailable"}</dd></div>
            <div><dt>Indicative turnaround</dt><dd>{selectedFurniture ? `${selectedFurniture.minTurnaroundWeeks} to ${selectedFurniture.maxTurnaroundWeeks} weeks` : "Unavailable"}</dd></div>
            <div><dt>AI preview</dt><dd>{generatedPreview ? "Generated — indicative only" : "Not generated"}</dd></div>
          </dl>
          {customerNotes.trim() ? (
            <div className="summary-notes">
              <strong>Consultation notes</strong>
              <p>{customerNotes.trim()}</p>
            </div>
          ) : null}
          <div className="summary-disclaimer">
            <strong>This project summary is not a quotation.</strong>
            <p>
              Screen colour, AI output and estimates are indicative. Upholstery Hub must inspect the furniture and confirm fabric suitability, quantity, repairs, price and turnaround.
            </p>
          </div>
          <p className="summary-privacy">This summary has not been emailed or submitted. It remains in this browser unless you print or save it.</p>
        </aside>
      </section>
    );
  }

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <a className="brand-link" href="#/start" aria-label="Upholstery Hub home" onClick={(event) => {
          event.preventDefault();
          resetJourneyFromLogo();
        }}>
          <picture>
            <source media="(max-width: 480px)" srcSet="branding/UpholsteryHubIcon.png" />
            <img className="brand-logo" src="branding/UpholsteryHubLogo-Horizontal.png" alt="" />
          </picture>
        </a>
        <span className="pilot-chip">Customer pilot</span>
      </header>

      <div className="demo-banner" role="note">
        <strong>Prototype demonstration</strong>
        <span>Catalogue, availability, pricing and turnaround values have not been verified as Upholstery Hub trading data.</span>
      </div>

      {step !== "start" && step !== "quote" ? (
        <nav className="progress-nav" aria-label="Visualiser progress">
          <ol>
            {progressSteps.map((item, index) => {
              const current = item.id === step || (step === "result" && item.id === "review");
              const complete = index < progressIndex || step === "result";
              return (
                <li key={item.id} className={current ? "progress-current" : complete ? "progress-complete" : ""} aria-current={current ? "step" : undefined}>
                  <span>{complete && !current ? "✓" : index + 1}</span>
                  {item.label}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <main id="main-content" className={`main-content main-${step}`}>
        {step === "start" ? renderStart() : null}
        {step === "photo" ? renderPhoto() : null}
        {step === "furniture" ? renderFurniture() : null}
        {step === "fabrics" ? renderFabrics() : null}
        {step === "review" ? renderReview() : null}
        {step === "result" ? renderResult() : null}
        {step === "quote" ? renderQuote() : null}
      </main>

      <footer className="app-footer">
        <div>
          <strong>Upholstery Hub Fabric Visualiser</strong>
          <p>Indicative decision support for a professional upholstery conversation.</p>
        </div>
        <div className="footer-status">
          <span>Live source: Google Sheets</span>
          <span>AI service: OpenAI through Render</span>
          <span>Quote route: Awaiting verification</span>
        </div>
      </footer>
    </div>
  );
}
