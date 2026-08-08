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
  type FurnitureType,
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

interface FurniturePhotoClassification {
  status: "identified" | "uncertain";
  detectedFurnitureType: string;
  confidence: number;
  model: string;
}

interface FurnitureCheckPayload extends PreviewErrorPayload {
  status?: "identified" | "uncertain";
  detectedFurnitureType?: string;
  confidence?: number;
  model?: string;
}

interface FurnitureSelectionAlert {
  kind: "mismatch" | "uncertain";
  selectedFurnitureId: string;
  selectedFurnitureName: string;
  message: string;
  detectedFurnitureType?: string;
}

interface FurnitureSelectionOverride {
  aiPrediction: string;
  customerSelection: string;
}

type FurnitureCheckStatus = "idle" | "checking" | "ready" | "error";

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

type ProgressStepId = (typeof progressSteps)[number]["id"];
type EditableStep = Exclude<ProgressStepId, "review">;

interface PendingNavigation {
  next: Step;
  returnAfterApply?: Step | null;
}

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

function isAvailableStockStatus(value: string) {
  const normalised = value.trim().toLowerCase();
  return Boolean(normalised) &&
    !normalised.includes("out of stock") &&
    !normalised.includes("unavailable") &&
    !normalised.includes("discontinued");
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
    month: "long",
    year: "numeric",
  }).format(date);
}

function withArticle(value: string) {
  return `${/^[aeiou]/i.test(value) ? "an" : "a"} ${value}`;
}

export function Visualiser() {
  const [step, setStep] = useState<Step>("start");
  const [catalogue, setCatalogue] = useState<CataloguePayload | null>(null);
  const [liveStatus, setLiveStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [localPhoto, setLocalPhoto] = useState<LocalPhoto | null>(null);
  const [draftPhoto, setDraftPhoto] = useState<LocalPhoto | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState("");
  const [draftFurnitureId, setDraftFurnitureId] = useState("");
  const [selectedFabricId, setSelectedFabricId] = useState("");
  const [draftFabricId, setDraftFabricId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [draftQuantity, setDraftQuantity] = useState(1);
  const [colourFilter, setColourFilter] = useState("");
  const [patternFilter, setPatternFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [failedSwatches, setFailedSwatches] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState("");
  const [aiAcknowledged, setAiAcknowledged] = useState(false);
  const [draftAiAcknowledged, setDraftAiAcknowledged] = useState(false);
  const [furnitureCheckStatus, setFurnitureCheckStatus] =
    useState<FurnitureCheckStatus>("idle");
  const [draftFurnitureCheckStatus, setDraftFurnitureCheckStatus] =
    useState<FurnitureCheckStatus>("idle");
  const [furnitureCheckError, setFurnitureCheckError] = useState("");
  const [draftFurnitureCheckError, setDraftFurnitureCheckError] = useState("");
  const [furniturePhotoClassification, setFurniturePhotoClassification] =
    useState<FurniturePhotoClassification | null>(null);
  const [draftFurniturePhotoClassification, setDraftFurniturePhotoClassification] =
    useState<FurniturePhotoClassification | null>(null);
  const [furnitureSelectionAlert, setFurnitureSelectionAlert] =
    useState<FurnitureSelectionAlert | null>(null);
  const [furnitureSelectionOverride, setFurnitureSelectionOverride] =
    useState<FurnitureSelectionOverride | null>(null);
  const [draftFurnitureSelectionOverride, setDraftFurnitureSelectionOverride] =
    useState<FurnitureSelectionOverride | null>(null);
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);
  const [showOverrideConfirmation, setShowOverrideConfirmation] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [generatedPreview, setGeneratedPreview] =
    useState<GeneratedPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [reconciliationNotice, setReconciliationNotice] = useState("");
  const [resumeStep, setResumeStep] = useState<Step | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<ProgressStepId>>(
    new Set(),
  );
  const [editReturnStep, setEditReturnStep] = useState<Step | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  const photoDirty =
    draftPhoto !== localPhoto || draftAiAcknowledged !== aiAcknowledged;
  const furnitureOverrideDirty =
    draftFurnitureSelectionOverride?.aiPrediction !==
      furnitureSelectionOverride?.aiPrediction ||
    draftFurnitureSelectionOverride?.customerSelection !==
      furnitureSelectionOverride?.customerSelection;
  const furnitureDirty =
    draftFurnitureId !== selectedFurnitureId ||
    draftQuantity !== quantity ||
    furnitureOverrideDirty;
  const fabricDirty = draftFabricId !== selectedFabricId;
  const dirtyStep: EditableStep | null =
    step === "photo" && photoDirty
      ? "photo"
      : step === "furniture" && furnitureDirty
        ? "furniture"
        : step === "fabrics" && fabricDirty
          ? "fabrics"
          : null;

  const mainHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const leaveDialogRef = useRef<HTMLDialogElement>(null);
  const leaveSafeButtonRef = useRef<HTMLButtonElement>(null);
  const leaveReturnFocusRef = useRef<HTMLElement | null>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const resetSafeButtonRef = useRef<HTMLButtonElement>(null);
  const resetReturnFocusRef = useRef<HTMLElement | null>(null);
  const resetDialogOpenRef = useRef(false);
  const resetHistoryEntryRef = useRef(false);
  const stepRef = useRef<Step>(step);
  const dirtyStepRef = useRef<EditableStep | null>(dirtyStep);
  const navigationBypassRef = useRef(false);

  stepRef.current = step;
  dirtyStepRef.current = dirtyStep;

  const loadCatalogue = useCallback(async () => {
    setLiveStatus("loading");
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
    } catch {
      setCatalogue(null);
      setLiveStatus("error");
    }
  }, []);

  useEffect(() => {
    const initialSync = window.setTimeout(() => setStep(getStepFromHash()), 0);
    const onHashChange = () => {
      const next = getStepFromHash();
      if (navigationBypassRef.current) {
        navigationBypassRef.current = false;
        setStep(next);
        return;
      }
      if (dirtyStepRef.current && next !== stepRef.current) {
        window.history.pushState(
          { ...(typeof window.history.state === "object" ? window.history.state : {}), upholsteryDraftGuard: true },
          "",
          `#/${stepRef.current}`,
        );
        setPendingNavigation({ next });
        setLeaveDialogOpen(true);
        return;
      }
      setStep(next);
    };
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
    const storedFurnitureId = getStoredValue("uh-furniture-id");
    const storedFabricId = getStoredValue("uh-fabric-id");
    const storedQuantity = Number(getStoredValue("uh-quantity", "1"));
    const storedCompletedSteps = getStoredValue("uh-completed-steps");
    const restoreStoredSelection = window.setTimeout(() => {
      setSelectedFurnitureId(storedFurnitureId);
      setDraftFurnitureId(storedFurnitureId);
      setSelectedFabricId(storedFabricId);
      setDraftFabricId(storedFabricId);
      const restoredQuantity =
        Number.isInteger(storedQuantity) && storedQuantity >= 1 && storedQuantity <= 10
          ? storedQuantity
          : 1;
      setQuantity(restoredQuantity);
      setDraftQuantity(restoredQuantity);
      try {
        const parsed = JSON.parse(storedCompletedSteps) as unknown;
        if (Array.isArray(parsed)) {
          setCompletedSteps(
            new Set(
              parsed.filter((value): value is ProgressStepId =>
                progressSteps.some((item) => item.id === value),
              ),
            ),
          );
        } else if (storedFabricId) {
          setCompletedSteps(new Set(["photo", "furniture", "fabrics", "review"]));
        } else if (storedFurnitureId) {
          setCompletedSteps(new Set(["photo", "furniture"]));
        }
      } catch {
        if (storedFabricId) {
          setCompletedSteps(new Set(["photo", "furniture", "fabrics", "review"]));
        } else if (storedFurnitureId) {
          setCompletedSteps(new Set(["photo", "furniture"]));
        }
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(restoreStoredSelection);
  }, []);

  useEffect(() => {
    if (step !== "start") {
      mainHeadingRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    const dialog = leaveDialogRef.current;
    if (!dialog) {
      return;
    }
    if (leaveDialogOpen && !dialog.open) {
      dialog.showModal();
      leaveSafeButtonRef.current?.focus();
    } else if (!leaveDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [leaveDialogOpen]);

  useEffect(() => {
    const dialog = resetDialogRef.current;
    if (!dialog) {
      return;
    }
    if (resetDialogOpen && !dialog.open) {
      dialog.showModal();
      resetSafeButtonRef.current?.focus();
    } else if (!resetDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [resetDialogOpen]);

  useEffect(() => {
    const cancelResetFromBrowserBack = () => {
      if (!resetDialogOpenRef.current) {
        return;
      }
      resetDialogOpenRef.current = false;
      resetHistoryEntryRef.current = false;
      setResetDialogOpen(false);
      window.requestAnimationFrame(() => resetReturnFocusRef.current?.focus());
    };
    window.addEventListener("popstate", cancelResetFromBrowserBack);
    return () => window.removeEventListener("popstate", cancelResetFromBrowserBack);
  }, []);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!dirtyStepRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, []);

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
    if (!storageReady) {
      return;
    }
    window.sessionStorage.setItem(
      "uh-completed-steps",
      JSON.stringify(Array.from(completedSteps)),
    );
  }, [completedSteps, storageReady]);

  useEffect(() => {
    if (!catalogue) {
      return;
    }
    const reconciliation = window.setTimeout(() => {
      const notices: string[] = [];
      let invalidStep: Step | null = null;
      if (
        selectedFurnitureId &&
        !catalogue.furniture.some((item) => item.id === selectedFurnitureId)
      ) {
        setSelectedFurnitureId("");
        setDraftFurnitureId("");
        setSelectedFabricId("");
        setDraftFabricId("");
        setFurnitureSelectionOverride(null);
        setDraftFurnitureSelectionOverride(null);
        clearGeneratedPreview();
        notices.push("This item is no longer available. Choose another option before continuing.");
        invalidStep = "furniture";
        setCompletedSteps((current) => {
          const next = new Set(current);
          next.delete("furniture");
          next.delete("fabrics");
          next.delete("review");
          return next;
        });
      }
      if (
        selectedFabricId &&
        !catalogue.fabrics.some(
          (item) =>
            item.id === selectedFabricId && isAvailableStockStatus(item.stockStatus),
        )
      ) {
        setSelectedFabricId("");
        setDraftFabricId("");
        clearGeneratedPreview();
        notices.push("This item is no longer available. Choose another option before continuing.");
        invalidStep ??= "fabrics";
        setCompletedSteps((current) => {
          const next = new Set(current);
          next.delete("fabrics");
          next.delete("review");
          return next;
        });
      }
      if (notices.length > 0) {
        setReconciliationNotice(notices.join(" "));
        go(invalidStep ?? "furniture");
      }
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
  const draftFurniture = catalogue?.furniture.find(
    (item) => item.id === draftFurnitureId,
  );
  const selectedFabric = catalogue?.fabrics.find(
    (item) =>
      item.id === selectedFabricId && isAvailableStockStatus(item.stockStatus),
  );
  const draftFabric = catalogue?.fabrics.find(
    (item) =>
      item.id === draftFabricId && isAvailableStockStatus(item.stockStatus),
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

  function go(next: Step) {
    setFormError("");
    const nextHash = `#/${next}`;
    if (window.location.hash === nextHash) {
      setStep(next);
    } else {
      navigationBypassRef.current = true;
      window.location.hash = nextHash;
    }
  }

  function requestNavigation(
    next: Step,
    trigger?: HTMLElement,
    returnAfterApply?: Step | null,
  ) {
    if (dirtyStep && next !== step) {
      leaveReturnFocusRef.current = trigger ?? null;
      setPendingNavigation({ next, returnAfterApply });
      setLeaveDialogOpen(true);
      return;
    }
    if (returnAfterApply !== undefined) {
      setEditReturnStep(returnAfterApply);
    }
    go(next);
  }

  function navigateToCompletedStep(next: ProgressStepId, trigger: HTMLElement) {
    const currentProgressStep: ProgressStepId | null =
      step === "result" ? "review" : progressSteps.some((item) => item.id === step)
        ? (step as ProgressStepId)
        : null;
    const currentIndex = currentProgressStep
      ? progressSteps.findIndex((item) => item.id === currentProgressStep)
      : -1;
    const nextIndex = progressSteps.findIndex((item) => item.id === next);
    const returnAfterApply =
      currentProgressStep && nextIndex < currentIndex ? currentProgressStep : undefined;
    requestNavigation(next, trigger, returnAfterApply);
  }

  function showFormError(message: string) {
    setFormError(message);
    window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }

  function markStepsComplete(...ids: ProgressStepId[]) {
    setCompletedSteps((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function discardDraft(stepToDiscard: EditableStep) {
    if (stepToDiscard === "photo") {
      if (draftPhoto && draftPhoto !== localPhoto) {
        URL.revokeObjectURL(draftPhoto.url);
      }
      setDraftPhoto(localPhoto);
      setDraftAiAcknowledged(aiAcknowledged);
      setDraftFurnitureCheckStatus(furnitureCheckStatus);
      setDraftFurnitureCheckError(furnitureCheckError);
      setDraftFurniturePhotoClassification(furniturePhotoClassification);
      setPhotoError("");
    }
    if (stepToDiscard === "furniture") {
      setDraftFurnitureId(selectedFurnitureId);
      setDraftQuantity(quantity);
      setDraftFurnitureSelectionOverride(furnitureSelectionOverride);
      setFurnitureSelectionAlert(null);
      setOverrideAcknowledged(false);
      setShowOverrideConfirmation(false);
    }
    if (stepToDiscard === "fabrics") {
      setDraftFabricId(selectedFabricId);
    }
    setFormError("");
  }

  function keepEditing() {
    setLeaveDialogOpen(false);
    setPendingNavigation(null);
    window.requestAnimationFrame(() => leaveReturnFocusRef.current?.focus());
  }

  function discardChangesAndLeave() {
    const navigation = pendingNavigation;
    const stepToDiscard = dirtyStep;
    setLeaveDialogOpen(false);
    setPendingNavigation(null);
    if (stepToDiscard) {
      discardDraft(stepToDiscard);
    }
    if (!navigation) {
      return;
    }
    if (navigation.returnAfterApply !== undefined) {
      setEditReturnStep(navigation.returnAfterApply);
    }
    go(navigation.next);
  }

  function clearGeneratedPreview() {
    setGeneratedPreview(null);
    setPreviewStatus("idle");
    setPreviewError("");
  }

  function clearFurniturePhotoCheck() {
    setFurnitureCheckStatus("idle");
    setDraftFurnitureCheckStatus("idle");
    setFurnitureCheckError("");
    setDraftFurnitureCheckError("");
    setFurniturePhotoClassification(null);
    setDraftFurniturePhotoClassification(null);
    setFurnitureSelectionAlert(null);
    setFurnitureSelectionOverride(null);
    setDraftFurnitureSelectionOverride(null);
    setOverrideAcknowledged(false);
    setShowOverrideConfirmation(false);
    setAiAcknowledged(false);
    setDraftAiAcknowledged(false);
  }

  function clearAllPhotos() {
    if (draftPhoto && draftPhoto !== localPhoto) {
      URL.revokeObjectURL(draftPhoto.url);
    }
    setDraftPhoto(null);
    setLocalPhoto(null);
    setPhotoError("");
    clearGeneratedPreview();
    clearFurniturePhotoCheck();
    setPhotoInputKey((current) => current + 1);
  }

  function removeDraftPhoto() {
    if (draftPhoto && draftPhoto !== localPhoto) {
      URL.revokeObjectURL(draftPhoto.url);
    }
    setDraftPhoto(null);
    setDraftAiAcknowledged(false);
    setDraftFurnitureCheckStatus("idle");
    setDraftFurnitureCheckError("");
    setDraftFurniturePhotoClassification(null);
    setPhotoError("");
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
      if (draftPhoto && draftPhoto !== localPhoto) {
        URL.revokeObjectURL(draftPhoto.url);
      }
      setDraftPhoto({ url: objectUrl, name: file.name, size: file.size, file });
      setDraftAiAcknowledged(false);
      setDraftFurnitureCheckStatus("idle");
      setDraftFurnitureCheckError("");
      setDraftFurniturePhotoClassification(null);
    } catch {
      URL.revokeObjectURL(objectUrl);
      setPhotoError("We could not read this photo. Try another image.");
    }
  }

  async function continueFromPhoto() {
    setPhotoError("");
    const photoChanged = draftPhoto !== localPhoto;
    if (!draftPhoto) {
      if (photoChanged) {
        setLocalPhoto(null);
        setAiAcknowledged(false);
        setFurnitureCheckStatus("idle");
        setDraftFurnitureCheckStatus("idle");
        setFurnitureCheckError("");
        setDraftFurnitureCheckError("");
        setFurniturePhotoClassification(null);
        setDraftFurniturePhotoClassification(null);
        setFurnitureSelectionOverride(null);
        setDraftFurnitureSelectionOverride(null);
        clearGeneratedPreview();
      }
      markStepsComplete("photo");
      const destination =
        editReturnStep && selectedFurniture && selectedFabric
          ? editReturnStep
          : "furniture";
      setEditReturnStep(null);
      go(destination);
      return;
    }
    if (!draftAiAcknowledged) {
      setPhotoError(
        "Confirm that you have permission to use this photo before continuing with automatic furniture checking.",
      );
      return;
    }
    let nextStatus = draftFurnitureCheckStatus;
    let nextError = draftFurnitureCheckError;
    let nextClassification = draftFurniturePhotoClassification;

    if (photoChanged || nextStatus !== "ready" || !nextClassification) {
      setDraftFurnitureCheckStatus("checking");
      setDraftFurnitureCheckError("");
      setFurnitureSelectionAlert(null);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45_000);
      const endpoint = window.location.hostname.endsWith("github.io")
        ? "https://upholstery-hub-fabric-visualiser.onrender.com/api/furniture-check"
        : "/api/furniture-check";
      const body = new FormData();
      body.append("photo", draftPhoto.file, draftPhoto.name);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          body,
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | FurnitureCheckPayload
          | null;
        if (
          !response.ok ||
          !payload?.status ||
          !payload.detectedFurnitureType ||
          typeof payload.confidence !== "number" ||
          !payload.model
        ) {
          throw new Error("photo-check-failed");
        }
        nextClassification = {
          status: payload.status,
          detectedFurnitureType: payload.detectedFurnitureType,
          confidence: payload.confidence,
          model: payload.model,
        };
        nextStatus = "ready";
        nextError = "";
      } catch {
        nextClassification = null;
        nextStatus = "error";
        nextError =
          "We couldn't analyse this photo. Try another photo or choose the furniture type yourself.";
      } finally {
        window.clearTimeout(timeout);
      }
      setDraftFurniturePhotoClassification(nextClassification);
      setDraftFurnitureCheckStatus(nextStatus);
      setDraftFurnitureCheckError(nextError);
    }

    setAiAcknowledged(draftAiAcknowledged);
    setFurniturePhotoClassification(nextClassification);
    setFurnitureCheckStatus(nextStatus);
    setFurnitureCheckError(nextError);
    if (photoChanged) {
      setLocalPhoto(draftPhoto);
      setFurnitureSelectionOverride(null);
      setDraftFurnitureSelectionOverride(null);
      clearGeneratedPreview();
    }

    markStepsComplete("photo");
    const photoMismatch = Boolean(
      photoChanged &&
        nextClassification?.status === "identified" &&
        selectedFurniture &&
        nextClassification.detectedFurnitureType !== selectedFurniture.name,
    );

    if (photoMismatch && selectedFurniture && nextClassification) {
      const previousFurniture = selectedFurniture;
      setDraftFurnitureId(previousFurniture.id);
      setSelectedFurnitureId("");
      setFurnitureSelectionAlert({
        kind: "mismatch",
        selectedFurnitureId: previousFurniture.id,
        selectedFurnitureName: previousFurniture.name,
        detectedFurnitureType: nextClassification.detectedFurnitureType,
        message: `The photo may show ${withArticle(nextClassification.detectedFurnitureType)}, but your applied selection was ${withArticle(previousFurniture.name)}. Confirm the furniture type before continuing.`,
      });
      setCompletedSteps((current) => {
        const next = new Set(current);
        next.delete("furniture");
        next.delete("fabrics");
        next.delete("review");
        return next;
      });
      setReconciliationNotice(
        "We saved your change. Please check the highlighted step because an earlier choice changed.",
      );
      setEditReturnStep(null);
      go("furniture");
      return;
    }

    const destination =
      editReturnStep && selectedFurniture && selectedFabric
        ? editReturnStep
        : "furniture";
    setEditReturnStep(null);
    go(destination);
  }

  function acceptFurnitureSelection(item: FurnitureType, isOverride = false) {
    setDraftFurnitureId(item.id);
    setDraftFurnitureSelectionOverride(
      isOverride && furniturePhotoClassification
        ? {
            aiPrediction: furniturePhotoClassification.detectedFurnitureType,
            customerSelection: item.name,
          }
        : null,
    );
    setFurnitureSelectionAlert(null);
    setOverrideAcknowledged(false);
    setShowOverrideConfirmation(false);
    setReconciliationNotice("");
    setFormError("");
  }

  function selectFurnitureType(item: FurnitureType) {
    if (!localPhoto || !furniturePhotoClassification) {
      acceptFurnitureSelection(item);
      return;
    }

    setDraftFurnitureId("");
    setDraftFurnitureSelectionOverride(null);
    setOverrideAcknowledged(false);
    setShowOverrideConfirmation(false);
    setFormError("");
    if (furniturePhotoClassification.status === "uncertain") {
      setFurnitureSelectionAlert({
        kind: "uncertain",
        selectedFurnitureId: item.id,
        selectedFurnitureName: item.name,
        message:
          "We could not confidently identify the furniture in this photo.",
      });
      return;
    }

    if (furniturePhotoClassification.detectedFurnitureType !== item.name) {
      setFurnitureSelectionAlert({
        kind: "mismatch",
        selectedFurnitureId: item.id,
        selectedFurnitureName: item.name,
        detectedFurnitureType: furniturePhotoClassification.detectedFurnitureType,
        message: `The photo may show ${withArticle(furniturePhotoClassification.detectedFurnitureType)}, but you selected ${withArticle(item.name)}. Choose the option that best describes your furniture before continuing.`,
      });
      return;
    }

    acceptFurnitureSelection(item);
  }

  function acceptFurnitureOverride() {
    const item = catalogue?.furniture.find(
      (candidate) => candidate.id === furnitureSelectionAlert?.selectedFurnitureId,
    );
    if (item && furnitureSelectionAlert?.kind === "uncertain") {
      acceptFurnitureSelection(item);
    } else if (item && overrideAcknowledged) {
      acceptFurnitureSelection(item, true);
    }
  }

  function acceptDetectedFurniture() {
    const item = catalogue?.furniture.find(
      (candidate) => candidate.name === furnitureSelectionAlert?.detectedFurnitureType,
    );
    if (item) {
      acceptFurnitureSelection(item);
    }
  }

  async function createIndicativePreview(allowMismatch = false) {
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
    const timeout = window.setTimeout(() => controller.abort(), 165_000);
    const endpoint = window.location.hostname.endsWith("github.io")
      ? "https://upholstery-hub-fabric-visualiser.onrender.com/api/preview"
      : "/api/preview";
    const body = new FormData();
    body.append("photo", localPhoto.file, localPhoto.name);
    body.append("fabricId", selectedFabric.id);
    body.append("furnitureId", selectedFurniture.id);
    if (allowMismatch) {
      body.append("allowMismatch", "true");
    }

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
        throw new Error("preview-failed");
      }

      setGeneratedPreview(payload);
      setPreviewStatus("ready");
      go("result");
    } catch {
      setPreviewStatus("error");
      setPreviewError(
        "We couldn't create a preview. Your selections and indicative estimate are still available.",
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function continueFromFurniture() {
    if (!draftFurniture) {
      showFormError("Choose one furniture type before continuing.");
      return;
    }
    if (!Number.isInteger(draftQuantity) || draftQuantity < 1 || draftQuantity > 10) {
      showFormError("Enter a whole-number quantity from 1 to 10.");
      return;
    }
    const changed = furnitureDirty;
    setSelectedFurnitureId(draftFurniture.id);
    setQuantity(draftQuantity);
    setFurnitureSelectionOverride(draftFurnitureSelectionOverride);
    markStepsComplete("furniture");
    if (changed) {
      clearGeneratedPreview();
    }
    const fabricStillAvailable = Boolean(
      selectedFabricId &&
        catalogue?.fabrics.some(
          (item) =>
            item.id === selectedFabricId && isAvailableStockStatus(item.stockStatus),
        ),
    );
    const destination =
      editReturnStep && fabricStillAvailable ? editReturnStep : "fabrics";
    setEditReturnStep(null);
    setReconciliationNotice("");
    go(destination);
  }

  function continueFromFabrics() {
    if (!draftFabric) {
      showFormError("Choose one live fabric before continuing.");
      return;
    }
    const changed = fabricDirty;
    setSelectedFabricId(draftFabric.id);
    markStepsComplete("fabrics", "review");
    if (changed) {
      clearGeneratedPreview();
    }
    const destination = editReturnStep ?? "review";
    setEditReturnStep(null);
    setReconciliationNotice("");
    go(destination);
  }

  function clearJourneyState() {
    clearAllPhotos();
    setSelectedFurnitureId("");
    setDraftFurnitureId("");
    setSelectedFabricId("");
    setDraftFabricId("");
    setQuantity(1);
    setDraftQuantity(1);
    setColourFilter("");
    setPatternFilter("");
    setStockFilter("");
    setFailedSwatches(new Set());
    setFormError("");
    setCustomerNotes("");
    setReconciliationNotice("");
    setResumeStep(null);
    setEditReturnStep(null);
    setCompletedSteps(new Set());
    Object.keys(window.sessionStorage)
      .filter((key) => key.startsWith("uh-"))
      .forEach((key) => window.sessionStorage.removeItem(key));
  }

  function hasJourneyProgress() {
    return Boolean(
      localPhoto ||
        selectedFurnitureId ||
        selectedFabricId ||
        quantity !== 1 ||
        generatedPreview ||
        customerNotes.trim(),
    );
  }

  function goHome(trigger?: HTMLElement) {
    if (step !== "start" && hasJourneyProgress()) {
      setResumeStep(step);
    }
    requestNavigation("start", trigger);
  }

  function requestJourneyReset(trigger: HTMLElement) {
    if (!hasJourneyProgress()) {
      clearJourneyState();
      go("start");
      return;
    }
    resetReturnFocusRef.current = trigger;
    resetDialogOpenRef.current = true;
    resetHistoryEntryRef.current = true;
    window.history.pushState(
      { ...(typeof window.history.state === "object" ? window.history.state : {}), upholsteryResetDialog: true },
      "",
      window.location.href,
    );
    setResetDialogOpen(true);
  }

  function cancelJourneyReset() {
    if (resetHistoryEntryRef.current) {
      resetHistoryEntryRef.current = false;
      window.history.back();
      return;
    }
    resetDialogOpenRef.current = false;
    setResetDialogOpen(false);
    window.requestAnimationFrame(() => resetReturnFocusRef.current?.focus());
  }

  function confirmJourneyReset() {
    resetDialogOpenRef.current = false;
    resetHistoryEntryRef.current = false;
    setResetDialogOpen(false);
    clearJourneyState();
    window.history.replaceState({}, "", "#/start");
    setStep("start");
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
            <strong>Loading the latest fabrics and prices…</strong>
            <p>Please wait while the current collection is checked.</p>
          </div>
        </div>
      );
    }
    if (liveStatus === "error") {
      return (
        <div className="state-panel state-panel-error" role="alert">
          <span className="status-dot status-dot-error" aria-hidden="true" />
          <div>
            <strong>We can&apos;t load the latest fabrics and prices right now.</strong>
            <p>No estimate has been created.</p>
            <div className="inline-actions">
              <button className="button button-dark" type="button" onClick={loadCatalogue}>
                Try again
              </button>
              <button className="button button-quiet" type="button" onClick={(event) => goHome(event.currentTarget)}>
                Return home
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
          Catalogue updated {catalogue ? lastUpdatedLabel(catalogue.fetchedAt) : "today"}
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

  function FurniturePredictionPanel({
    furniture = selectedFurniture,
    selectionOverride = furnitureSelectionOverride,
  }: {
    furniture?: FurnitureType;
    selectionOverride?: FurnitureSelectionOverride | null;
  } = {}) {
    if (!localPhoto || !furniturePhotoClassification || !furniture) {
      return null;
    }

    const isUncertain = furniturePhotoClassification.status === "uncertain";
    const isMatch =
      !isUncertain &&
      furniturePhotoClassification.detectedFurnitureType === furniture.name;

    return (
      <section className="furniture-comparison" aria-label="Photo prediction and furniture selection">
        <div>
          <span>AI prediction from your photo</span>
          <strong>
            {isUncertain
              ? "Furniture type unclear"
              : furniturePhotoClassification.detectedFurnitureType}
          </strong>
          <small>
            {isUncertain
              ? "We could not confidently identify the furniture in this photo."
              : "This is a prediction and may be wrong."}
          </small>
        </div>
        <div>
          <span>Your furniture selection</span>
          <strong>{furniture.name}</strong>
          <small>This selection will be used for the estimate.</small>
        </div>
        <p className={selectionOverride ? "comparison-warning" : "comparison-status"}>
          {isUncertain
            ? "You chose the furniture type manually."
            : isMatch
              ? "These appear to match."
              : "These do not match. You chose to continue with your furniture selection."}
        </p>
      </section>
    );
  }

  function renderStart() {
    const journeyInProgress = hasJourneyProgress();
    const continuation = resumeStep ?? (selectedFabricId ? "review" : selectedFurnitureId ? "fabrics" : "photo");
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
            {journeyInProgress ? (
              <>
                <button className="button button-dark button-large" type="button" onClick={() => go(continuation)}>
                  Continue your selection
                </button>
                <button className="button button-light button-large" type="button" onClick={(event) => requestJourneyReset(event.currentTarget)}>
                  Start again
                </button>
              </>
            ) : (
              <button className="button button-dark button-large" type="button" onClick={() => go("photo")}>
                Start visualising
              </button>
            )}
          </div>
          <p className="trust-line">
            <span aria-hidden="true">✓</span> No account required. A photograph stays local until you consent and continue to automatic furniture checking.
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
              <div><strong>Choose a live fabric</strong><small>Browse the current fabric collection.</small></div>
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
            <strong>Selecting a photo does not upload it.</strong>
            <p>It stays in this browser until you consent and continue. You can remove it at any time.</p>
          </div>
        </div>
        <div className="step-card">
          <label className={`upload-zone ${photoError ? "upload-zone-error" : ""}`} htmlFor="furniture-photo">
            <span className="upload-mark" aria-hidden="true">＋</span>
            <strong>{draftPhoto ? "Replace your photo" : "Choose a furniture photo"}</strong>
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
          {draftPhoto ? (
            <div className="local-preview">
              <img src={draftPhoto.url} alt="Your uploaded furniture photograph" />
              <div>
                <strong>{draftPhoto.name}</strong>
                <span>{fileSize(draftPhoto.size)} · {draftFurnitureCheckStatus === "ready" ? "Checked securely" : "Not sent"}</span>
                <button className="text-button text-button-danger" type="button" onClick={removeDraftPhoto}>
                  Remove photo
                </button>
              </div>
            </div>
          ) : null}
          {draftPhoto ? (
            <label className="acknowledgement photo-check-consent">
              <input
                type="checkbox"
                checked={draftAiAcknowledged}
                disabled={draftFurnitureCheckStatus === "checking"}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setDraftAiAcknowledged(checked);
                  if (!checked) {
                    setDraftFurnitureCheckStatus("idle");
                    setDraftFurnitureCheckError("");
                    setDraftFurniturePhotoClassification(null);
                    setFurnitureSelectionAlert(null);
                  }
                }}
              />
              <span>
                I have permission to use this photo. When I continue, it will be sent to Upholstery Hub&apos;s AI service and OpenAI to suggest the furniture type. If I later create a preview, the photo and selected fabric will be processed again.
              </span>
            </label>
          ) : null}
          {draftPhoto ? (
            <p className="field-help retention-note">OpenAI may retain API abuse-monitoring content for up to 30 days.</p>
          ) : null}
          {dirtyStep === "photo" ? <p className="unsaved-note" role="status">Unsaved changes</p> : null}
          <div className="card-actions step-navigation">
            <button className="button button-quiet navigation-back" type="button" onClick={(event) => requestNavigation("start", event.currentTarget)}>Back to home</button>
            <button
              className="button button-dark navigation-primary"
              type="button"
              disabled={draftFurnitureCheckStatus === "checking" || Boolean(draftPhoto && !draftAiAcknowledged)}
              onClick={() => void continueFromPhoto()}
            >
              {draftFurnitureCheckStatus === "checking"
                ? "Checking furniture type…"
                : completedSteps.has("photo")
                  ? "Apply photo change"
                  : draftPhoto
                    ? "Check photo and continue"
                  : "Continue without a photo"}
            </button>
          </div>
          {draftPhoto && !draftAiAcknowledged ? (
            <p className="field-help consent-help">Confirm permission above to enable the Step 2 furniture check.</p>
          ) : null}
          {draftFurnitureCheckStatus === "checking" ? (
            <div className="preview-status" role="status" aria-live="polite">
              <span className="status-dot status-dot-loading" aria-hidden="true" />
              <span>Checking your photo… This can take up to 45 seconds.</span>
            </div>
          ) : null}
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
        {localPhoto && furnitureCheckStatus === "ready" && !draftFurniture ? (
          <div className="state-panel photo-check-ready" role="status">
            <span className="status-dot status-dot-ready" aria-hidden="true" />
            <div>
              <strong>AI prediction ready</strong>
              <p>Choose the furniture type that best describes your item. The prediction may be wrong.</p>
            </div>
          </div>
        ) : null}
        {localPhoto && furnitureCheckStatus === "error" && furnitureCheckError ? (
          <div className="state-panel state-panel-warning" role="alert">
            <span className="status-dot status-dot-warning" aria-hidden="true" />
            <div>
              <strong>Photo analysis unavailable</strong>
              <p>{furnitureCheckError}</p>
              <button className="button button-light" type="button" onClick={(event) => requestNavigation("photo", event.currentTarget)}>
                Return to photo and retry
              </button>
            </div>
          </div>
        ) : null}
        {furnitureSelectionAlert ? (
          <div
            className={`state-panel ${furnitureSelectionAlert.kind === "mismatch" ? "state-panel-error" : "state-panel-warning"} furniture-selection-alert`}
            role="alert"
          >
            <span className={`status-dot ${furnitureSelectionAlert.kind === "mismatch" ? "status-dot-error" : "status-dot-warning"}`} aria-hidden="true" />
            <div>
              <strong>
                {furnitureSelectionAlert.kind === "mismatch"
                  ? "Check the furniture type"
                  : "Please confirm this furniture selection"}
              </strong>
              <p>{furnitureSelectionAlert.message}</p>
              <div className="furniture-alert-actions">
                {furnitureSelectionAlert.detectedFurnitureType &&
                catalogue?.furniture.some(
                  (item) => item.name === furnitureSelectionAlert.detectedFurnitureType,
                ) ? (
                  <button className="button button-dark" type="button" onClick={acceptDetectedFurniture}>
                    Use {furnitureSelectionAlert.detectedFurnitureType}
                  </button>
                ) : null}
                {furnitureSelectionAlert.kind === "uncertain" ? (
                  <button className="button button-dark" type="button" onClick={acceptFurnitureOverride}>
                    Use {furnitureSelectionAlert.selectedFurnitureName}
                  </button>
                ) : null}
                <button className="button button-light" type="button" onClick={(event) => requestNavigation("photo", event.currentTarget)}>
                  Change photo
                </button>
                {furnitureSelectionAlert.kind === "mismatch" ? (
                  <button className="button button-quiet" type="button" onClick={() => setShowOverrideConfirmation(true)}>
                    Keep {furnitureSelectionAlert.selectedFurnitureName} anyway
                  </button>
                ) : null}
              </div>
              {showOverrideConfirmation && furnitureSelectionAlert.kind === "mismatch" ? (
                <div className="override-confirmation">
                  <label>
                    <input
                      type="checkbox"
                      checked={overrideAcknowledged}
                      onChange={(event) => setOverrideAcknowledged(event.target.checked)}
                    />
                    <span>I understand that the estimate may be inaccurate because my selection differs from the AI prediction.</span>
                  </label>
                  <button className="button button-dark" type="button" disabled={!overrideAcknowledged} onClick={acceptFurnitureOverride}>
                    Use {furnitureSelectionAlert.selectedFurnitureName}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {catalogue ? (
          <>
            <fieldset className="choice-grid furniture-grid" aria-describedby="furniture-photo-check-help">
              <legend>Active furniture types</legend>
              {catalogue.furniture.map((item) => (
                <label className={`choice-card ${draftFurnitureId === item.id ? "choice-card-selected" : ""}`} key={item.id}>
                  <input
                    type="radio"
                    name="furniture-type"
                    value={item.id}
                    checked={draftFurnitureId === item.id}
                    onChange={() => selectFurnitureType(item)}
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
            <FurniturePredictionPanel
              furniture={draftFurniture}
              selectionOverride={draftFurnitureSelectionOverride}
            />
            <p id="furniture-photo-check-help" className="field-help furniture-check-help">
              {localPhoto
                ? "Selections are checked against your consented photograph before pricing assumptions are applied."
                : "No photo was supplied, so choose the furniture type manually."}
            </p>
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
                value={draftQuantity}
                aria-describedby="quantity-help"
                onChange={(event) => setDraftQuantity(Number(event.target.value))}
              />
            </div>
            {dirtyStep === "furniture" ? <p className="unsaved-note" role="status">Unsaved changes</p> : null}
            <div className="page-actions step-navigation">
              <button className="button button-quiet navigation-back" type="button" onClick={(event) => requestNavigation("photo", event.currentTarget)}>Back to photo</button>
              <button className="button button-dark navigation-primary" type="button" onClick={continueFromFurniture}>
                {completedSteps.has("furniture") ? "Apply furniture changes" : "Choose a fabric"}
              </button>
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
        {reconciliationNotice ? <p className="notice" role="status">{reconciliationNotice}</p> : null}
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
                  const imageFailed = failedSwatches.has(fabric.id) || !fabric.swatchImageUrl;
                  const unavailable = !isAvailableStockStatus(fabric.stockStatus);
                  return (
                    <label className={`fabric-card ${draftFabricId === fabric.id ? "fabric-card-selected" : ""} ${unavailable ? "fabric-card-unavailable" : ""}`} key={fabric.id}>
                      <input
                        type="radio"
                        name="fabric"
                        value={fabric.id}
                        disabled={unavailable}
                        checked={draftFabricId === fabric.id}
                        onChange={() => {
                          setDraftFabricId(fabric.id);
                          setReconciliationNotice("");
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
                            <span>Image unavailable. Colour shown is approximate.</span>
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
                        {unavailable ? <small className="unavailable-copy">This item is no longer available. Choose another option before continuing.</small> : null}
                      </div>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <div className="state-panel">
                <div>
                  <strong>No fabrics match your current filters.</strong>
                  <p>Clear the filters to see the current collection.</p>
                  <button className="button button-light" type="button" onClick={() => {
                    setColourFilter("");
                    setPatternFilter("");
                    setStockFilter("");
                  }}>Clear filters</button>
                </div>
              </div>
            )}
            {dirtyStep === "fabrics" ? <p className="unsaved-note" role="status">Unsaved changes</p> : null}
            <div className="page-actions step-navigation">
              <button className="button button-quiet navigation-back" type="button" onClick={(event) => requestNavigation("furniture", event.currentTarget)}>Back to furniture</button>
              <button className="button button-dark navigation-primary" type="button" onClick={continueFromFabrics}>
                {completedSteps.has("fabrics") ? "Apply fabric change" : "Review my choices"}
              </button>
            </div>
          </>
        ) : null}
      </section>
    );
  }

  function renderReview() {
    if (!storageReady || liveStatus === "loading" || liveStatus === "error") {
      return (
        <section className="narrow-section" aria-labelledby="review-heading">
          <h1 id="review-heading" tabIndex={-1} ref={mainHeadingRef}>Review your choices</h1>
          <LiveDataPanel />
        </section>
      );
    }

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
        {localPhoto && furnitureCheckStatus === "error" && furnitureCheckError ? (
          <div className="state-panel state-panel-warning" role="status">
            <span className="status-dot status-dot-warning" aria-hidden="true" />
            <div>
              <strong>Automatic furniture check unavailable</strong>
              <p>Your applied furniture selection is still being used. You can return to Photo and retry the check.</p>
            </div>
          </div>
        ) : null}
        <div className="review-grid">
          <div className="review-media-card">
            {localPhoto ? (
              <img className="review-photo" src={localPhoto.url} alt="Your uploaded furniture photograph" />
            ) : (
              <div className="no-photo-placeholder"><span aria-hidden="true">○</span><strong>No photograph selected</strong><p>The price path remains available.</p></div>
            )}
            <div className="review-swatch">
              {failedSwatches.has(selectedFabric.id) || !selectedFabric.swatchImageUrl ? (
                <div
                  className="swatch-fallback review-swatch-fallback"
                  style={{ backgroundColor: safeHex(selectedFabric.colourHex) }}
                  role="img"
                  aria-label={`Image unavailable for ${selectedFabric.name}. Approximate colour ${selectedFabric.mainColour}.`}
                >
                  <span>Image unavailable. Colour shown is approximate.</span>
                </div>
              ) : (
                <img src={selectedFabric.swatchImageUrl} alt={`${selectedFabric.name} live fabric swatch`} onError={() => markSwatchFailed(selectedFabric.id)} />
              )}
              <div><span className="eyebrow">Selected fabric</span><strong>{selectedFabric.name}</strong><small>{selectedFabric.id} · {selectedFabric.stockStatus}</small></div>
            </div>
          </div>
          <div className="ai-panel">
            <FurniturePredictionPanel />
            <span className="eyebrow">AI preview status</span>
            <h2>{localPhoto ? "Create an indicative preview" : "Add a photo to create a preview"}</h2>
            <p id="ai-blocked">
              The AI service can apply your selected fabric to the furniture photo. The result is an indicative prediction, may alter details and is not a finished-work guarantee.
            </p>
            {localPhoto ? (
              <>
                <p className="consent-confirmation"><span aria-hidden="true">✓</span> Photo permission confirmed before the Step 2 furniture check.</p>
                <button
                  className="button button-dark button-full"
                  type="button"
                  disabled={previewStatus === "generating"}
                  aria-describedby="ai-blocked preview-guidance"
                  onClick={() => void createIndicativePreview(Boolean(furnitureSelectionOverride))}
                >
                  {previewStatus === "generating" ? "Creating preview…" : "Create indicative AI preview"}
                </button>
                <p id="preview-guidance" className="field-help">
                  Generation may take up to two minutes. This prototype limits each visitor to 10 previews per hour.
                </p>
              </>
            ) : null}
            {previewStatus === "generating" ? (
              <div className="preview-status" role="status" aria-live="polite">
                <span className="status-dot status-dot-loading" aria-hidden="true" />
                <span>Creating an indicative AI preview. This can take up to two minutes.</span>
              </div>
            ) : null}
            {previewStatus === "error" && previewError ? (
              <div className="preview-status preview-status-error" role="alert">
                <span className="status-dot status-dot-error" aria-hidden="true" />
                <span>{previewError}</span>
              </div>
            ) : null}
            <button
              className={`button ${localPhoto ? "button-light" : "button-dark"} button-full`}
              type="button"
              disabled={previewStatus === "generating"}
              onClick={() => go("result")}
            >
              Continue to indicative estimate
            </button>
            {!localPhoto ? (
              <button className="button button-light button-full" type="button" onClick={(event) => requestNavigation("photo", event.currentTarget, "review")}>
                Add a photo first
              </button>
            ) : null}
          </div>
        </div>
        <div className="page-actions step-navigation">
          <button className="button button-quiet navigation-back" type="button" onClick={(event) => requestNavigation("fabrics", event.currentTarget, "review")} disabled={previewStatus === "generating"}>Back to fabrics</button>
        </div>
      </section>
    );
  }

  function renderResult() {
    if (!storageReady || liveStatus === "loading") {
      return (
        <section className="narrow-section" aria-labelledby="result-heading">
          <h1 id="result-heading" tabIndex={-1} ref={mainHeadingRef}>Indicative estimate</h1>
          <LiveDataPanel />
        </section>
      );
    }

    if (liveStatus === "error") {
      return (
        <section className="narrow-section" aria-labelledby="result-heading">
          <h1 id="result-heading" tabIndex={-1} ref={mainHeadingRef}>Indicative estimate</h1>
          <LiveDataPanel />
        </section>
      );
    }

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
                {failedSwatches.has(selectedFabric.id) || !selectedFabric.swatchImageUrl ? (
                  <div className="swatch-fallback" style={{ backgroundColor: safeHex(selectedFabric.colourHex) }} role="img" aria-label={`Image unavailable for ${selectedFabric.name}. Approximate colour ${selectedFabric.mainColour}.`}><span>Image unavailable. Colour shown is approximate.</span></div>
                ) : (
                  <img src={selectedFabric.swatchImageUrl} alt={`${selectedFabric.name}, ${selectedFabric.mainColour}, ${selectedFabric.pattern} fabric swatch`} onError={() => markSwatchFailed(selectedFabric.id)} />
                )}
              </div>
            )}
            <span className="eyebrow">{generatedPreview ? "AI-generated indicative preview" : "Selected direction, not an AI preview"}</span>
            <h2>{selectedFurniture.name} in {selectedFabric.name}</h2>
            <p>{selectedFabric.pattern} · {selectedFabric.material} · {selectedFabric.stockStatus}</p>
            <div className="disclosure-box">
              <strong>{generatedPreview ? "AI prediction — check before relying on it." : "No AI image was created."}</strong>
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
              <div><dt>Furniture used for estimate</dt><dd>{selectedFurniture.name}</dd></div>
              {furniturePhotoClassification ? (
                <div><dt>AI prediction from photo</dt><dd>{furniturePhotoClassification.status === "uncertain" ? "Unclear — check manually" : `${furniturePhotoClassification.detectedFurnitureType} — prediction only`}</dd></div>
              ) : null}
              <div><dt>Quantity</dt><dd>{quantity}</dd></div>
              <div><dt>Starting labour per item</dt><dd>{currency.format(selectedFurniture.labourCost)}</dd></div>
              <div><dt>Live fabric price</dt><dd>{currency.format(selectedFabric.pricePerMetre)} / metre</dd></div>
              <div><dt>Estimated fabric</dt><dd>{selectedFurniture.minMetres} to {selectedFurniture.maxMetres} m / item</dd></div>
              <div><dt>Indicative turnaround</dt><dd>{selectedFurniture.minTurnaroundWeeks} to {selectedFurniture.maxTurnaroundWeeks} weeks</dd></div>
            </dl>
            <div className="estimate-note"><strong>Inspection note</strong><p>{selectedFurniture.specialConsiderations}</p></div>
            {furnitureSelectionOverride ? (
              <div className="estimate-note estimate-note-warning"><strong>Furniture types do not match</strong><p>The AI predicted {furnitureSelectionOverride.aiPrediction}; this estimate uses your selection, {furnitureSelectionOverride.customerSelection}.</p></div>
            ) : null}
            <p className="fine-print">Repairs, replacement fillings, specialist finishes, transport, taxes, additional pattern matching and work found during inspection are excluded.</p>
            <p className="estimate-disclaimer"><strong>This is not a quotation.</strong> Upholstery Hub must inspect the furniture and approve the fabric before confirming price and turnaround.</p>
          </div>
        </div>
        <div className="page-actions page-actions-prominent">
          <button className="button button-dark button-large" type="button" onClick={() => go("quote")}>View &amp; save project summary</button>
          <button className="button button-light" type="button" onClick={(event) => requestNavigation("furniture", event.currentTarget, "review")}>Edit selections</button>
          <button className="button button-quiet" type="button" onClick={(event) => requestNavigation("photo", event.currentTarget, "review")}>Change photo</button>
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

    if (!storageReady || liveStatus === "loading") {
      return (
        <section className="narrow-section" aria-labelledby="quote-heading">
          <span className="eyebrow">Your project summary</span>
          <h1 id="quote-heading" tabIndex={-1} ref={mainHeadingRef}>Review and save your project summary</h1>
          <LiveDataPanel />
        </section>
      );
    }

    if (liveStatus === "error" || !catalogue) {
      return (
        <section className="narrow-section" aria-labelledby="quote-heading">
          <span className="eyebrow">Your project summary</span>
          <h1 id="quote-heading" tabIndex={-1} ref={mainHeadingRef}>Review and save your project summary</h1>
          <LiveDataPanel />
        </section>
      );
    }

    if (!hasCompleteSummary) {
      return (
        <section className="narrow-section" aria-labelledby="quote-heading">
          <span className="eyebrow">Your project summary</span>
          <h1 id="quote-heading" tabIndex={-1} ref={mainHeadingRef}>Review and save your project summary</h1>
          <div className="state-panel state-panel-warning" role="status">
            <span className="status-dot status-dot-warning" aria-hidden="true" />
            <div>
              <strong>Complete a live selection first</strong>
              <p>Choose a furniture type and fabric to create a printable project summary.</p>
              <button className="button button-dark" type="button" onClick={() => go("photo")}>Start visualising</button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="quote-layout" aria-labelledby="quote-heading">
        <div className="summary-controls">
          <span className="eyebrow">Your project summary</span>
          <h1 id="quote-heading" tabIndex={-1} ref={mainHeadingRef}>Review and save your project summary</h1>
          <p className="lede">
            Review your selections, add optional notes, then print or save a PDF to bring to Upholstery Hub.
          </p>
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
            {estimate ? <button className="button button-light" type="button" onClick={(event) => requestNavigation("furniture", event.currentTarget, "review")}>Edit selections</button> : null}
            <button className="button button-light" type="button" onClick={(event) => requestJourneyReset(event.currentTarget)}>Start again</button>
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
              {failedSwatches.has(selectedFabric.id) || !selectedFabric.swatchImageUrl ? (
                <div
                  className="swatch-fallback summary-swatch-fallback"
                  style={{ backgroundColor: safeHex(selectedFabric.colourHex) }}
                  role="img"
                  aria-label={`Image unavailable for ${selectedFabric.name}. Approximate colour ${selectedFabric.mainColour}.`}
                >
                  <span>Image unavailable. Colour shown is approximate.</span>
                </div>
              ) : (
                <img src={selectedFabric.swatchImageUrl} alt={`${selectedFabric.name} live fabric swatch`} onError={() => markSwatchFailed(selectedFabric.id)} />
              )}
              <figcaption>Selected live fabric swatch</figcaption>
            </figure>
          ) : null}
          <h2>Your selection and price summary</h2>
          <dl>
            <div><dt>Furniture used for estimate</dt><dd>{selectedFurniture ? `${selectedFurniture.name} × ${quantity}` : "Not selected"}</dd></div>
            {furniturePhotoClassification ? (
              <div><dt>AI prediction from photo</dt><dd>{furniturePhotoClassification.status === "uncertain" ? "Unclear — check manually" : `${furniturePhotoClassification.detectedFurnitureType} — prediction only`}</dd></div>
            ) : null}
            <div><dt>Fabric</dt><dd>{selectedFabric ? `${selectedFabric.name} (${selectedFabric.id})` : "Not selected"}</dd></div>
            <div><dt>Pattern and material</dt><dd>{selectedFabric ? `${selectedFabric.pattern} · ${selectedFabric.material}` : "Not selected"}</dd></div>
            <div><dt>Stock status</dt><dd>{selectedFabric?.stockStatus ?? "Unavailable"}</dd></div>
            <div><dt>Indicative estimate</dt><dd>{estimate ? `${currency.format(estimate.low)} to ${currency.format(estimate.high)}` : "Unavailable"}</dd></div>
            <div><dt>Estimated fabric</dt><dd>{selectedFurniture ? `${selectedFurniture.minMetres} to ${selectedFurniture.maxMetres} m per item` : "Unavailable"}</dd></div>
            <div><dt>Indicative turnaround</dt><dd>{selectedFurniture ? `${selectedFurniture.minTurnaroundWeeks} to ${selectedFurniture.maxTurnaroundWeeks} weeks` : "Unavailable"}</dd></div>
            <div><dt>AI preview</dt><dd>{generatedPreview ? "Generated — indicative only" : "Not generated"}</dd></div>
            <div><dt>Catalogue checked</dt><dd>{catalogue ? lastUpdatedLabel(catalogue.fetchedAt) : "Unavailable"}</dd></div>
          </dl>
          {furnitureSelectionOverride ? (
            <div className="summary-warning">
              <strong>Furniture types do not match</strong>
              <p>The AI predicted {furnitureSelectionOverride.aiPrediction}; this estimate uses your selection, {furnitureSelectionOverride.customerSelection}.</p>
            </div>
          ) : null}
          {customerNotes.trim() ? (
            <div className="summary-notes">
              <strong>Consultation notes</strong>
              <p>{customerNotes.trim()}</p>
            </div>
          ) : null}
          <div className="summary-exclusions">
            <strong>Estimate exclusions</strong>
            <p>Repairs, replacement fillings, specialist finishes, transport, taxes, additional pattern matching and work found during inspection are excluded.</p>
          </div>
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
          goHome(event.currentTarget);
        }}>
          <picture>
            <source media="(max-width: 480px)" srcSet="branding/UpholsteryHubIcon.png" />
            <img className="brand-logo" src="branding/UpholsteryHubLogo-Horizontal.png" alt="" />
          </picture>
        </a>
        <div className="header-actions">
          {step !== "start" ? (
            <button className="text-button" type="button" onClick={(event) => goHome(event.currentTarget)}>Home</button>
          ) : null}
          <span className="pilot-chip">Customer pilot</span>
        </div>
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
              const complete = completedSteps.has(item.id);
              const unsaved = current && dirtyStep === item.id;
              const marker = complete ? "✓" : index + 1;
              return (
                <li key={item.id} className={`${current ? "progress-current" : complete ? "progress-complete" : ""} ${unsaved ? "progress-dirty" : ""}`} aria-current={current ? "step" : undefined}>
                  {complete && !current ? (
                    <button
                      className="progress-step-button"
                      type="button"
                      aria-label={`Edit ${item.label.toLowerCase()} step`}
                      onClick={(event) => navigateToCompletedStep(item.id, event.currentTarget)}
                    >
                      <span className="progress-marker">{marker}</span>
                      <span>{item.label}</span>
                    </button>
                  ) : (
                    <span className="progress-step-static">
                      <span className="progress-marker">{marker}</span>
                      <span className="progress-label">
                        <span>{item.label}</span>
                        {unsaved ? <small>Unsaved changes</small> : null}
                      </span>
                    </span>
                  )}
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
        <p className="footer-status">Prototype demonstration. No account required.</p>
      </footer>

      <dialog
        className="reset-dialog"
        ref={leaveDialogRef}
        aria-labelledby="leave-dialog-title"
        aria-describedby="leave-dialog-description"
        onCancel={(event) => {
          event.preventDefault();
          keepEditing();
        }}
      >
        <h2 id="leave-dialog-title">Leave without applying changes?</h2>
        <p id="leave-dialog-description">Your changes on this step have not been applied.</p>
        <div className="reset-dialog-actions">
          <button className="button button-dark" type="button" ref={leaveSafeButtonRef} onClick={keepEditing}>Keep editing</button>
          <button className="button button-light" type="button" onClick={discardChangesAndLeave}>Discard changes</button>
        </div>
      </dialog>

      <dialog
        className="reset-dialog"
        ref={resetDialogRef}
        aria-labelledby="reset-dialog-title"
        aria-describedby="reset-dialog-description"
        onCancel={(event) => {
          event.preventDefault();
          cancelJourneyReset();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelJourneyReset();
          }
        }}
      >
        <h2 id="reset-dialog-title">Start again?</h2>
        <p id="reset-dialog-description">This will remove your photo, furniture, fabric, AI preview and project notes from this browser.</p>
        <div className="reset-dialog-actions">
          <button className="button button-light" type="button" ref={resetSafeButtonRef} onClick={cancelJourneyReset}>Keep my progress</button>
          <button className="button button-danger" type="button" onClick={confirmJourneyReset}>Start again</button>
        </div>
      </dialog>
    </div>
  );
}
