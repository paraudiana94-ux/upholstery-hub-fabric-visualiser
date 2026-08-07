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
import { calculateIndicativeEstimate } from "@/lib/pricing";

type Step =
  | "start"
  | "photo"
  | "furniture"
  | "fabrics"
  | "review"
  | "result"
  | "quote";

interface Fabric {
  id: string;
  name: string;
  collection: string;
  mainColour: string;
  colourHex: string;
  pattern: string;
  material: string;
  pricePerMetre: number;
  suitableFurnitureTypes: string;
  stockStatus: string;
  active: boolean;
  demoData: boolean;
  lastUpdated: string;
  swatchImageUrl: string;
}

interface FurnitureType {
  id: string;
  name: string;
  minMetres: number;
  maxMetres: number;
  labourCost: number;
  minTurnaroundWeeks: number;
  maxTurnaroundWeeks: number;
  specialConsiderations: string;
  active: boolean;
  demoData: boolean;
  lastUpdated: string;
}

interface CataloguePayload {
  source: string;
  sourceUrl: string;
  spreadsheetId: string;
  fetchedAt: string;
  fabrics: Fabric[];
  furniture: FurnitureType[];
}

interface LocalPhoto {
  url: string;
  name: string;
  size: number;
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
        throw new Error(
          "This GitHub Pages preview cannot run the live catalogue server. The source remains Google Sheets, and no stored rows have been substituted.",
        );
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
    window.sessionStorage.setItem("uh-furniture-id", selectedFurnitureId);
  }, [selectedFurnitureId]);

  useEffect(() => {
    window.sessionStorage.setItem("uh-fabric-id", selectedFabricId);
  }, [selectedFabricId]);

  useEffect(() => {
    window.sessionStorage.setItem("uh-quantity", String(quantity));
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

  function removePhoto() {
    if (localPhoto) {
      URL.revokeObjectURL(localPhoto.url);
    }
    setLocalPhoto(null);
    setPhotoError("");
    setAiAcknowledged(false);
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
      setLocalPhoto({ url: objectUrl, name: file.name, size: file.size });
      setAiAcknowledged(false);
    } catch {
      URL.revokeObjectURL(objectUrl);
      setPhotoError("We could not read this photo. Try another image.");
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

  function resetJourney() {
    removePhoto();
    setSelectedFurnitureId("");
    setSelectedFabricId("");
    setQuantity(1);
    setColourFilter("");
    setPatternFilter("");
    setStockFilter("");
    setFormError("");
    window.sessionStorage.removeItem("uh-furniture-id");
    window.sessionStorage.removeItem("uh-fabric-id");
    window.sessionStorage.removeItem("uh-quantity");
    go("start");
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
            <button className="button button-light button-large" type="button" onClick={() => go("quote")}>
              Request a professional quote
            </button>
          </div>
          <p className="trust-line">
            <span aria-hidden="true">✓</span> No account required. Selecting a photograph does not send it anywhere.
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
            <p>The file stays in this browser session. You can remove it at any time.</p>
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
                <span>{fileSize(localPhoto.size)} · Local only</span>
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
            <h2>Preview service not connected</h2>
            <p id="ai-blocked">
              No image service, secure processing boundary or photograph-retention policy has been approved. This prototype will not send your photo or pretend that a preview was created.
            </p>
            {localPhoto ? (
              <label className="acknowledgement">
                <input type="checkbox" checked={aiAcknowledged} onChange={(event) => setAiAcknowledged(event.target.checked)} />
                <span>I understand that any future AI preview would be indicative and I have permission to use this photograph.</span>
              </label>
            ) : null}
            <button className="button button-disabled" type="button" disabled aria-describedby="ai-blocked">
              Create indicative preview
            </button>
            <p className="field-help">External transmission is blocked until the Manager approves the service and policy.</p>
            <button className="button button-dark button-full" type="button" onClick={() => go("result")}>
              Continue without an AI preview
            </button>
          </div>
        </div>
        <div className="page-actions">
          <button className="button button-quiet" type="button" onClick={() => go("fabrics")}>Back to fabrics</button>
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
            <div className="direction-images">
              {localPhoto ? <img src={localPhoto.url} alt="Your uploaded furniture photograph" /> : <div className="no-photo-small">No photo selected</div>}
              {failedSwatches.has(selectedFabric.id) ? (
                <div className="swatch-fallback" style={{ backgroundColor: safeHex(selectedFabric.colourHex) }} role="img" aria-label={`Image unavailable for ${selectedFabric.name}`}><span>Image unavailable</span></div>
              ) : (
                <img src={selectedFabric.swatchImageUrl} alt={`${selectedFabric.name}, ${selectedFabric.mainColour}, ${selectedFabric.pattern} fabric swatch`} onError={() => markSwatchFailed(selectedFabric.id)} />
              )}
            </div>
            <span className="eyebrow">Selected direction, not an AI preview</span>
            <h2>{selectedFurniture.name} in {selectedFabric.name}</h2>
            <p>{selectedFabric.pattern} · {selectedFabric.material} · {selectedFabric.stockStatus}</p>
            <div className="disclosure-box">
              <strong>No AI image was created.</strong>
              <p>The photo and live swatch are shown separately. Screen colour, texture and pattern scale may differ.</p>
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
          <button className="button button-dark button-large" type="button" onClick={() => go("quote")}>Request a professional quote</button>
          <button className="button button-light" type="button" onClick={() => go("fabrics")}>Try another fabric</button>
          <button className="button button-quiet" type="button" onClick={() => go("photo")}>Change photo</button>
        </div>
      </section>
    );
  }

  function renderQuote() {
    return (
      <section className="quote-layout" aria-labelledby="quote-heading">
        <div>
          <span className="eyebrow">Professional next step</span>
          <h1 id="quote-heading" tabIndex={-1} ref={mainHeadingRef}>Bring your selection to Upholstery Hub</h1>
          <p className="lede">A physical inspection is needed to confirm suitability, fabric quantity, repairs, price and turnaround.</p>
          <div className="state-panel state-panel-warning">
            <span className="status-dot status-dot-warning" aria-hidden="true" />
            <div>
              <strong>Verified quotation route not supplied</strong>
              <p>This prototype cannot send a request yet. No photograph, contact details or quote request has been transmitted.</p>
            </div>
          </div>
          <div className="page-actions page-actions-left">
            {estimate ? <button className="button button-dark" type="button" onClick={() => go("result")}>Review my estimate</button> : null}
            <button className="button button-light" type="button" onClick={resetJourney}>Start a new selection</button>
          </div>
        </div>
        <aside className="quote-summary" aria-label="Quotation preparation summary">
          <span className="eyebrow">Prepared summary</span>
          <h2>Your current direction</h2>
          <dl>
            <div><dt>Furniture</dt><dd>{selectedFurniture ? `${selectedFurniture.name} × ${quantity}` : "Not selected"}</dd></div>
            <div><dt>Fabric</dt><dd>{selectedFabric ? `${selectedFabric.name} (${selectedFabric.id})` : "Not selected"}</dd></div>
            <div><dt>Estimate</dt><dd>{estimate ? `${currency.format(estimate.low)} to ${currency.format(estimate.high)}` : "Unavailable"}</dd></div>
            <div><dt>AI preview</dt><dd>Not generated</dd></div>
          </dl>
          <p>This summary remains in this browser session. It has not been submitted anywhere.</p>
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
          go("start");
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
          <span>AI service: Not connected</span>
          <span>Quote route: Awaiting verification</span>
        </div>
      </footer>
    </div>
  );
}
